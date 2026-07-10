/**
 * Phase 3 — profilage passif Extended Events contre SQL Server réel :
 * session XEvents éphémère, heatmap par ligne, progression live, nettoyage,
 * mode batch et mode procédure, dégradation gracieuse sans permission.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-xevents.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { XEventsProfiler } from '../src/main/services/XEventsService'
import { closeAllPools, getPool } from '../src/main/services/SqlService'
import type { ConnectionConfig, XEventsEvent } from '../src/shared/types'

const CONNECTION: ConnectionConfig = {
  server: 'localhost',
  port: 14333,
  database: 'master',
  user: 'sa',
  password: 'GTrace!Dev2026',
  trustServerCertificate: true
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

function collectUntilDone(
  start: (emit: (e: XEventsEvent) => void) => Promise<unknown>
): Promise<XEventsEvent[]> {
  return new Promise((resolve, reject) => {
    const events: XEventsEvent[] = []
    const timer = setTimeout(() => reject(new Error('timeout profilage')), 60_000)
    start((e) => {
      events.push(e)
      if (e.type === 'xe-done' || e.type === 'xe-error') {
        clearTimeout(timer)
        resolve(events)
      }
    }).catch((e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

const LOOP_SCRIPT = `DECLARE @i int = 0;
DECLARE @total int = 0;
WHILE @i < 4
BEGIN
  SET @i = @i + 1;
  SET @total = @total + @i;
END
SELECT @total AS Total;`

async function main(): Promise<void> {
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )
  const profiler = new XEventsProfiler(sidecar)
  const pool = await getPool(CONNECTION)

  check('permission ALTER ANY EVENT SESSION détectée (sa)', await profiler.checkPermission(CONNECTION))

  // ── Mode batch : script libre, événements sql_statement_* ──────────────────
  {
    const events = await collectUntilDone((emit) =>
      profiler.start({ connection: CONNECTION, sql: LOOP_SCRIPT, compatLevel: 160 }, emit)
    )
    const started = events.find((e) => e.type === 'xe-started')
    check('mode batch détecté', started?.type === 'xe-started' && started.mode === 'batch', started)

    const done = events.find((e) => e.type === 'xe-done')
    if (done?.type !== 'xe-done') throw new Error('pas de xe-done')
    check('profil batch sans erreur', done.errors.length === 0, done.errors)
    check('résultat métier présent (Total = 10)',
      Number(done.resultsets[0]?.rows[0]?.[0]) === 10, done.resultsets)

    const line5 = done.stats.find((s) => s.line === 5) // SET @i = @i + 1
    check('heatmap : ligne 5 exécutée 4 fois (boucle)', line5?.count === 4, done.stats)
    check('durées mesurées (µs)', done.stats.some((s) => s.totalDurationUs >= 0) && done.stats.length >= 4,
      done.stats.length)
  }

  // ── Mode procédure : ventes.TraiteCommandesEnAttente (317 lignes) ──────────
  {
    // (Re)créer le schéma et la procédure de test
    const setupSql = readFileSync(join(__dirname, 'fixtures', 'ventes-setup.sql'), 'utf8')
    for (const batch of setupSql.split(/^\s*GO\s*$/m).filter((b) => b.trim())) {
      await pool.request().batch(batch)
    }
    const procSql = readFileSync(join(__dirname, 'fixtures', 'TraiteCommandesEnAttente.sql'), 'utf8')
    await pool.request().batch(procSql)

    const events = await collectUntilDone((emit) =>
      profiler.start(
        {
          connection: CONNECTION,
          sql: procSql,
          compatLevel: 160,
          paramValues: { '@DateLimite': '2026-07-04' }
        },
        emit
      )
    )
    const started = events.find((e) => e.type === 'xe-started')
    check('mode proc détecté', started?.type === 'xe-started' && started.mode === 'proc', started)

    const done = events.find((e) => e.type === 'xe-done')
    if (done?.type !== 'xe-done') throw new Error('pas de xe-done')
    check('profil proc sans erreur', done.errors.length === 0, done.errors)
    check('couverture large (≥ 25 lignes distinctes)', done.stats.length >= 25, done.stats.length)

    // La boucle interne tourne 15 fois au total (3+2+3+1+4+2 lignes candidates)
    const setLigne = done.stats.find((s) => s.line === 141) // SET @LigneCourante = @LigneCourante + 1
    check('ligne 141 (boucle interne) exécutée 15+ fois', (setLigne?.count ?? 0) >= 15, setLigne)

    const progress = events.filter((e) => e.type === 'xe-progress')
    check('progression live émise', progress.length >= 1, progress.length)
    check('lignes dans les bornes du source',
      done.stats.every((s) => s.line >= 1 && s.line <= 317),
      done.stats.filter((s) => s.line < 1 || s.line > 317))
  }

  // ── Nettoyage : aucune session gtrace_xe_* résiduelle ──────────────────────
  {
    const leftover = await pool.request().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sys.server_event_sessions WHERE name LIKE 'gtrace_xe_%'`
    )
    check('aucune session XEvents résiduelle', leftover.recordset[0].n === 0, leftover.recordset[0])
  }

  // ── Dégradation gracieuse : login sans permission ──────────────────────────
  {
    await pool.request().batch(
      `IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'gtrace_lowpriv')
         CREATE LOGIN gtrace_lowpriv WITH PASSWORD = 'LowPriv!2026x', CHECK_POLICY = OFF;`
    )
    const lowCfg: ConnectionConfig = { ...CONNECTION, user: 'gtrace_lowpriv', password: 'LowPriv!2026x' }
    check('permission absente détectée (login restreint)',
      !(await profiler.checkPermission(lowCfg)))
    let refused = false
    try {
      await profiler.start({ connection: lowCfg, sql: 'SELECT 1;' }, () => undefined)
    } catch (e) {
      refused = e instanceof Error && e.message.includes('ALTER ANY EVENT SESSION')
    }
    check('démarrage refusé avec message explicite', refused)
  }

  console.log(`\n${failures === 0 ? 'SUCCÈS' : `${failures} ÉCHEC(S)`}`)
  sidecar.dispose()
  await closeAllPools()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e)
  await closeAllPools().catch(() => undefined)
  process.exit(2)
})
