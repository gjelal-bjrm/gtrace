/**
 * Phase 2 — breakpoints simulés, bout-en-bout contre SQL Server réel :
 * pause sur breakpoint (itérations de boucle), Step, Continue, bandeau
 * transactionnel (TRANCOUNT/locks/isolation), inspect READ UNCOMMITTED,
 * Stop (annulation + ROLLBACK), timeout de sécurité.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-breakpoints.ts
 */
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugSessionManager } from '../src/main/services/DebugSessionManager'
import { controlStatus, createControl } from '../src/main/services/ControlService'
import { closeAllPools, getPool, inspectQuery } from '../src/main/services/SqlService'
import type { ConnectionConfig, DebugSessionEvent } from '../src/shared/types'

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

/** Collecteur d'événements avec attente typée. */
class EventSink {
  events: DebugSessionEvent[] = []
  private waiters: Array<{ pred: (e: DebugSessionEvent) => boolean; resolve: (e: DebugSessionEvent) => void }> = []

  emit = (e: DebugSessionEvent): void => {
    this.events.push(e)
    this.waiters = this.waiters.filter((w) => {
      if (w.pred(e)) {
        w.resolve(e)
        return false
      }
      return true
    })
  }

  waitFor<T extends DebugSessionEvent['type']>(
    type: T,
    timeoutMs = 15000,
    pred: (e: Extract<DebugSessionEvent, { type: T }>) => boolean = () => true
  ): Promise<Extract<DebugSessionEvent, { type: T }>> {
    const matches = (e: DebugSessionEvent): boolean =>
      e.type === type && pred(e as Extract<DebugSessionEvent, { type: T }>)
    const already = this.events.find(matches)
    if (already) return Promise.resolve(already as Extract<DebugSessionEvent, { type: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout en attendant '${type}'`)), timeoutMs)
      this.waiters.push({
        pred: matches,
        resolve: (e) => {
          clearTimeout(timer)
          resolve(e as Extract<DebugSessionEvent, { type: T }>)
        }
      })
    })
  }
}

const LOOP_SCRIPT = `DECLARE @i int = 0;
DECLARE @total int = 0;
WHILE @i < 4
BEGIN
  SET @i = @i + 1;
  SET @total = @total + @i;
END
SELECT @total AS Total;`

const LOCK_SCRIPT = `DECLARE @x int = 0;
BEGIN TRANSACTION;
UPDATE dbo.GTraceLockTest SET Valeur = Valeur + 1 WHERE Id = 1;
SET @x = 1;
ROLLBACK;
SELECT @x AS X;`

async function main(): Promise<void> {
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )
  const manager = new DebugSessionManager(sidecar)
  const pool = await getPool(CONNECTION)

  // ── GTraceDB : création (consentement simulé) ──────────────────────────────
  await createControl(CONNECTION)
  const status = await controlStatus(CONNECTION)
  check('GTraceDB + ControlSignal créées', status.databaseExists && status.tableExists, status)

  // ── Scénario 1 : breakpoint dans une boucle, Step puis Continue ────────────
  {
    const sink = new EventSink()
    // Map du script : 0=DECLARE @i, 1=DECLARE @total, 2=WHILE, 3=BEGIN/END,
    // 4=SET @i (← breakpoint), 5=SET @total, 6=SELECT.
    const { sessionId, instrument } = await manager.start(
      { connection: CONNECTION, sql: LOOP_SCRIPT, compatLevel: 160 },
      { breakpoints: [4], stopOnEntry: false, timeoutMs: 60_000 },
      sink.emit
    )
    check('map : statement 4 = SET @i', instrument.statements[4]?.type === 'SetVariableStatement')

    const pause1 = await sink.waitFor('paused')
    check('pause au breakpoint (statement 4, itération 1)',
      pause1.info.statementIndex === 4 && pause1.info.startLine === 5, pause1.info)
    check('TRANCOUNT 0 hors transaction', pause1.info.tranCount === 0, pause1.info)

    // Step : un statement de plus (SET @i), pause suivante au statement 5
    await manager.stepOnce(sessionId)
    const pause2 = await sink.waitFor('paused', 15000, (e) => e.info.seq > pause1.info.seq)
    check('Step → pause au statement suivant (5)', pause2.info.statementIndex === 5, pause2.info)
    const stepI = sink.events.find((e) => e.type === 'step' && e.step.statementIndex === 4)
    check('le step exécuté a bien écrit @i = 1',
      stepI?.type === 'step' && Number(stepI.step.variables['@i']) === 1, stepI)

    // Continue : file jusqu'au breakpoint, itération 2
    await manager.continue_(sessionId)
    const pause3 = await sink.waitFor('paused', 15000, (e) => e.info.seq > pause2.info.seq)
    check('Continue → re-pause au breakpoint (itération 2)',
      pause3.info.statementIndex === 4, pause3.info)

    // Continue ×3 : itérations 3 et 4 puis fin
    await manager.continue_(sessionId)
    const pause4 = await sink.waitFor('paused', 15000, (e) => e.info.seq > pause3.info.seq)
    await manager.continue_(sessionId)
    const pause5 = await sink.waitFor('paused', 15000, (e) => e.info.seq > pause4.info.seq)
    check('4 passages au breakpoint pour 4 itérations',
      pause4.info.statementIndex === 4 && pause5.info.statementIndex === 4)
    await manager.continue_(sessionId)

    const done = await sink.waitFor('done')
    // 2 DECLARE + 4 itérations × 2 SET + 1 SELECT = 11 steps
    check('exécution terminée : les 11 steps capturés',
      done.result.steps.length === 11, done.result.steps.length)
    check('résultat final correct (Total = 10)',
      Number(done.result.resultsets[0]?.rows[0]?.[0]) === 10, done.result.resultsets)
    const finalI = done.result.steps.filter((s) => '@i' in s.variables).map((s) => Number(s.variables['@i']))
    check('itérations complètes visibles (@i jusqu à 4)', Math.max(...finalI) === 4, finalI)

    const signal = await pool.request().query(
      `SELECT COUNT(*) AS n FROM GTraceDB.dbo.ControlSignal WHERE SessionId = '${sessionId}'`
    )
    check('signal de contrôle nettoyé', signal.recordset[0].n === 0)
  }

  // ── Scénario 2 : bandeau transactionnel + inspect pendant la pause ─────────
  {
    await pool.request().batch(
      `IF OBJECT_ID('dbo.GTraceLockTest') IS NOT NULL DROP TABLE dbo.GTraceLockTest;
       CREATE TABLE dbo.GTraceLockTest (Id int PRIMARY KEY, Valeur int NOT NULL);
       INSERT INTO dbo.GTraceLockTest VALUES (1, 100);`
    )
    const sink = new EventSink()
    // Map : 0=DECLARE @x, 1=BEGIN TRAN, 2=UPDATE, 3=SET @x (← bp), 4=ROLLBACK, 5=SELECT
    const { sessionId } = await manager.start(
      { connection: CONNECTION, sql: LOCK_SCRIPT, compatLevel: 160 },
      { breakpoints: [3], stopOnEntry: false, timeoutMs: 60_000 },
      sink.emit
    )
    const paused = await sink.waitFor('paused')
    check('pause dans la transaction : TRANCOUNT = 1', paused.info.tranCount === 1, paused.info)
    check('locks tenus détectés (bandeau)', (paused.info.lockCount ?? 0) > 0, paused.info)
    check('niveau d isolation remonté', paused.info.isolationLevel === 'READ COMMITTED', paused.info)

    // Inspection pendant la pause : READ UNCOMMITTED voit la valeur non commitée
    const dirty = await inspectQuery(
      CONNECTION,
      'SELECT Valeur FROM dbo.GTraceLockTest WHERE Id = 1;',
      true
    )
    check('inspect READ UNCOMMITTED lit la valeur modifiée non commitée (101)',
      Number(dirty[0]?.rows[0]?.[0]) === 101, dirty[0]?.rows)

    await manager.continue_(sessionId)
    const done = await sink.waitFor('done')
    check('ROLLBACK final : la valeur revient à 100 en base',
      Number((await pool.request().query('SELECT Valeur AS v FROM dbo.GTraceLockTest WHERE Id = 1')).recordset[0].v) === 100)
    check('scénario 2 terminé proprement', done.result.errors.length === 0, done.result.errors)
  }

  // ── Scénario 3 : Stop pendant une pause (annulation + rollback) ────────────
  {
    const sink = new EventSink()
    const { sessionId } = await manager.start(
      { connection: CONNECTION, sql: LOCK_SCRIPT, compatLevel: 160 },
      { breakpoints: [3], stopOnEntry: false, timeoutMs: 60_000 },
      sink.emit
    )
    await sink.waitFor('paused')
    await manager.stop(sessionId)
    const stopped = await sink.waitFor('stopped')
    check('Stop → événement stopped (user)', stopped.reason === 'user', stopped)
    const val = await pool.request().query('SELECT Valeur AS v FROM dbo.GTraceLockTest WHERE Id = 1')
    check('Stop → transaction rollbackée (valeur 100)', Number(val.recordset[0].v) === 100, val.recordset[0])
    const orphans = await pool.request().query(
      `SELECT COUNT(*) AS n FROM sys.dm_tran_session_transactions`
    )
    check('aucune transaction orpheline', Number(orphans.recordset[0].n) === 0, orphans.recordset[0])
  }

  // ── Scénario 4 : timeout de sécurité ───────────────────────────────────────
  {
    const sink = new EventSink()
    await manager.start(
      { connection: CONNECTION, sql: LOOP_SCRIPT, compatLevel: 160 },
      { breakpoints: [], stopOnEntry: true, timeoutMs: 3000 },
      sink.emit
    )
    await sink.waitFor('paused')
    const stopped = await sink.waitFor('stopped', 10000)
    check('timeout de sécurité → arrêt automatique', stopped.reason === 'timeout', stopped)
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
