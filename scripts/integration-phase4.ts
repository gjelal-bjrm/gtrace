/**
 * Phase 4 — snapshots de tables (#temp, variables tables) + historique de sessions.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-phase4.ts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugService } from '../src/main/services/DebugService'
import { HistoryStore } from '../src/main/services/HistoryStore'
import { closeAllPools } from '../src/main/services/SqlService'
import type { ConnectionConfig } from '../src/shared/types'

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

const SCRIPT = `CREATE TABLE #tmp (Id int, Val int);
DECLARE @t TABLE (Nom nvarchar(10));
INSERT INTO #tmp VALUES (1, 10);
INSERT INTO @t VALUES (N'a');
INSERT INTO #tmp VALUES (2, 20);
UPDATE #tmp SET Val = 99 WHERE Id = 1;
DELETE FROM #tmp;
SELECT 1 AS Fin;`

async function main(): Promise<void> {
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )
  const debug = new DebugService(sidecar)

  // ── Snapshots ───────────────────────────────────────────────────────────────
  const run = await debug.run({
    connection: CONNECTION,
    sql: SCRIPT,
    compatLevel: 160,
    snapshots: ['#tmp', '@t']
  })
  check('exécution sans erreur', run.errors.length === 0, run.errors)
  check('5 snapshots capturés (3 INSERT + UPDATE + DELETE)', run.snapshots.length === 5,
    run.snapshots.map((s) => `${s.table}@${s.statementIndex}`))

  const tmpSnaps = run.snapshots.filter((s) => s.table === '#tmp')
  const tSnaps = run.snapshots.filter((s) => s.table === '@t')
  check('4 snapshots de #tmp, 1 de @t', tmpSnaps.length === 4 && tSnaps.length === 1)

  check('après INSERT 1 : une ligne (1, 10)',
    JSON.stringify(tmpSnaps[0]?.rows) === '[[1,10]]', tmpSnaps[0]?.rows)
  check('variable table @t capturée (invisible depuis une autre connexion)',
    JSON.stringify(tSnaps[0]?.rows) === '[["a"]]', tSnaps[0]?.rows)
  check('après INSERT 2 : deux lignes', tmpSnaps[1]?.rows.length === 2, tmpSnaps[1]?.rows)
  check('après UPDATE : Val = 99 pour Id 1',
    tmpSnaps[2]?.rows.some((r) => Number(r[0]) === 1 && Number(r[1]) === 99), tmpSnaps[2]?.rows)
  check('après DELETE : 0 ligne mais colonnes connues',
    tmpSnaps[3]?.rows.length === 0 &&
      JSON.stringify(tmpSnaps[3]?.columns) === '["Id","Val"]',
    tmpSnaps[3])
  check('snapshots rattachés à des steps croissants',
    run.snapshots.every((s, i, arr) => i === 0 || s.stepIndex >= arr[i - 1].stepIndex),
    run.snapshots.map((s) => s.stepIndex))
  check('le statementIndex du snapshot correspond au statement écrivain',
    tmpSnaps.every((s) => {
      const type = run.instrument.statements[s.statementIndex]?.type
      return ['InsertStatement', 'UpdateStatement', 'DeleteStatement'].includes(type ?? '')
    }),
    tmpSnaps.map((s) => run.instrument.statements[s.statementIndex]?.type))
  check('les steps et resultsets classiques sont intacts',
    run.steps.length >= 8 && run.resultsets.length === 1 &&
      Number(run.resultsets[0].rows[0][0]) === 1,
    { steps: run.steps.length, resultsets: run.resultsets.length })

  // ── Historique ──────────────────────────────────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'gtrace-hist-'))
  try {
    const store = new HistoryStore(dir)
    const saved = store.save({
      title: 'script de test',
      server: 'localhost',
      database: 'master',
      sql: SCRIPT,
      run
    })
    check('session sauvegardée', saved.stepCount === run.steps.length, saved)

    const list = store.list()
    check('listée dans l historique', list.length === 1 && list[0].id === saved.id, list)

    const loaded = store.load(saved.id)
    check('rechargée : SQL + steps + snapshots identiques',
      loaded.sql === SCRIPT &&
        loaded.run.steps.length === run.steps.length &&
        loaded.run.snapshots.length === 5,
      { steps: loaded.run.steps.length, snaps: loaded.run.snapshots.length })

    store.delete(saved.id)
    check('supprimée', store.list().length === 0)

    let rejected = false
    try {
      store.load('../../evil')
    } catch {
      rejected = true
    }
    check('id malveillant rejeté', rejected)
  } finally {
    rmSync(dir, { recursive: true, force: true })
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
