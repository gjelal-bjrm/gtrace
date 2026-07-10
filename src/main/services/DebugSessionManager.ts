import sql from 'mssql'
import { randomUUID } from 'node:crypto'
import type {
  BreakpointRunOptions,
  ConnectionConfig,
  DebugSessionEvent,
  InstrumentResult,
  StepError
} from '@shared/types'
import type { SidecarService } from './SidecarService'
import type { DebugRunInput } from './DebugService'
import {
  assemble,
  enforceReadOnly,
  buildStep,
  ERROR_TAG,
  OUTPUT_TAG,
  PAUSE_TAG,
  TRACE_TAG,
  type Collected,
  type RawRecordset
} from './DebugService'
import { buildSqlConfig, coerceParam, defaultLiteralToRaw } from './SqlService'
import {
  clearSignal,
  CONTROL_TABLE,
  initSignal,
  sessionTransactionState,
  updateSignal
} from './ControlService'

export type EmitFn = (event: DebugSessionEvent) => void

interface ActiveSession {
  id: string
  cfg: ConnectionConfig
  /** Connexion dédiée (max 1) : Stop/rollback garantis sur LA connexion d'exécution */
  pool: sql.ConnectionPool
  request: sql.Request
  instrument: InstrumentResult
  collected: Collected
  spid: number | null
  stepCount: number
  currentSeq: number
  paused: boolean
  stopping: 'user' | 'timeout' | null
  timer: NodeJS.Timeout
  emit: EmitFn
  finalized: boolean
}

/**
 * Sessions de debug interactives (breakpoints simulés, spec Phase 2).
 * L'exécution tourne sur une connexion dédiée ; les blocs de pause injectés
 * pollent GTraceDB.dbo.ControlSignal ; le driver reçoit steps et marqueurs de
 * pause en streaming et pilote via UPDATE du signal. Stop = annulation driver
 * (signal d'attention) + ROLLBACK sur la même connexion.
 */
export class DebugSessionManager {
  private sessions = new Map<string, ActiveSession>()

  constructor(private readonly sidecar: SidecarService) {}

  async start(
    input: DebugRunInput,
    pauseOptions: BreakpointRunOptions,
    emit: EmitFn
  ): Promise<{ sessionId: string; instrument: InstrumentResult }> {
    await enforceReadOnly(this.sidecar, input)
    const sessionId = randomUUID()
    const instrument = await this.sidecar.instrument(
      input.sql,
      input.compatLevel,
      {
        sessionId,
        breakpoints: pauseOptions.breakpoints,
        controlTable: CONTROL_TABLE
      },
      input.snapshots
    )
    if (instrument.errors.length > 0 || !instrument.script) {
      throw new Error(
        `Instrumentation impossible : ${instrument.errors.map((e) => e.message).join(' | ')}`
      )
    }

    let script = instrument.script
    const outputs = instrument.parameters.filter((p) => p.isOutput)
    if (outputs.length > 0) {
      const cols = outputs.map((p) => `, ${p.name} AS [${p.name}]`).join('')
      script += `\nSELECT '${OUTPUT_TAG}' AS _t${cols};`
    }

    const cfg = input.connection
    // stopOnEntry : la première pause bloque ; sinon on file au premier breakpoint.
    await initSignal(cfg, sessionId, !pauseOptions.stopOnEntry)

    const pool = await new sql.ConnectionPool({
      ...buildSqlConfig(cfg),
      pool: { max: 1, min: 1 },
      requestTimeout: 0 // le timeout est géré par nous (annulation + rollback)
    }).connect()
    const spid = (await pool.request().query<{ s: number }>('SELECT @@SPID AS s')).recordset[0].s

    const request = pool.request()
    request.stream = true
    for (const p of instrument.parameters) {
      const raw =
        input.paramValues && p.name in input.paramValues
          ? input.paramValues[p.name]
          : defaultLiteralToRaw(p.defaultText)
      const { type, value } = coerceParam(p.type, raw)
      request.input(p.name.slice(1), type, value)
    }

    const session: ActiveSession = {
      id: sessionId,
      cfg,
      pool,
      request,
      instrument,
      collected: { recordsets: [], errors: [] },
      spid,
      stepCount: 0,
      currentSeq: 0,
      paused: false,
      stopping: null,
      timer: setTimeout(() => {
        void this.stop(sessionId, 'timeout')
      }, pauseOptions.timeoutMs),
      emit,
      finalized: false
    }
    this.sessions.set(sessionId, session)

    let current: RawRecordset | null = null
    request.on('recordset', (columns: Record<string, unknown>) => {
      current = { columns: Object.keys(columns), rows: [] }
      // Poussé dès l'ouverture : un recordset vide (0 ligne) doit aussi être collecté.
      session.collected.recordsets.push(current)
    })
    request.on('row', (row: Record<string, unknown>) => {
      if (!current) return
      current.rows.push(row)
      if (current.rows.length === 1) this.onFirstRow(session, current)
    })
    request.on('error', (err: Error) => {
      if (session.stopping) return // annulation attendue (ECANCEL)
      const e = err as Error & { number?: number; lineNumber?: number; class?: number; state?: number }
      const stepError: StepError = {
        number: e.number ?? 0,
        message: e.message,
        line: e.lineNumber ?? null,
        severity: e.class,
        state: e.state
      }
      session.collected.errors.push(stepError)
      emit({ type: 'error', sessionId, message: e.message })
    })
    request.on('done', () => {
      void this.finalize(session)
    })

    void request.query(script).catch(() => {
      // erreurs déjà remontées par l'événement 'error' ; 'done' suit
    })

    emit({ type: 'started', sessionId, instrument })
    return { sessionId, instrument }
  }

  /** Premier row d'un recordset : classification et événements live. */
  private onFirstRow(session: ActiveSession, rs: RawRecordset): void {
    const tag = rs.columns[0] === '_t' ? rs.rows[0]['_t'] : null

    if (tag === PAUSE_TAG) {
      const row = rs.rows[0]
      session.currentSeq = Number(row['_seq'])
      session.paused = true
      const statementIndex = Number(row['_s'])
      const statement = session.instrument.statements[statementIndex]
      const tranCount = Number(row['_tc'])
      // Isolation + locks via connexion séparée (DMV : ne pose pas de verrous)
      void sessionTransactionState(session.cfg, session.spid ?? -1).then((state) => {
        if (session.finalized) return
        session.emit({
          type: 'paused',
          sessionId: session.id,
          info: {
            seq: session.currentSeq,
            statementIndex,
            startLine: statement?.startLine ?? 0,
            tranCount,
            isolationLevel: state.isolationLevel,
            lockCount: state.lockCount
          }
        })
      })
      return
    }

    if (session.paused) {
      session.paused = false
      session.emit({ type: 'resumed', sessionId: session.id })
    }

    if (tag === TRACE_TAG || tag === ERROR_TAG) {
      const step = buildStep(session.instrument, rs, session.stepCount++, [])
      session.emit({ type: 'step', sessionId: session.id, step })
    }
    // resultsets métier : rattachés lors de l'assemblage final
  }

  async continue_(sessionId: string): Promise<void> {
    const s = this.mustGet(sessionId)
    await updateSignal(s.cfg, sessionId, s.currentSeq, true)
  }

  async stepOnce(sessionId: string): Promise<void> {
    const s = this.mustGet(sessionId)
    await updateSignal(s.cfg, sessionId, s.currentSeq, false)
  }

  async stop(sessionId: string, reason: 'user' | 'timeout' = 'user'): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s || s.stopping) return
    s.stopping = reason
    s.request.cancel() // signal d'attention : interrompt statement ou WAITFOR
  }

  private async finalize(session: ActiveSession): Promise<void> {
    if (session.finalized) return
    session.finalized = true
    clearTimeout(session.timer)

    try {
      // Toujours sur LA connexion d'exécution (pool max 1) : rollback de toute
      // transaction restée ouverte (Stop pendant une transaction, script incomplet…).
      await session.pool.request().query('IF @@TRANCOUNT > 0 ROLLBACK;')
    } catch {
      /* connexion peut être morte : rien à faire */
    }

    await clearSignal(session.cfg, session.id).catch(() => undefined)
    await session.pool.close().catch(() => undefined)
    this.sessions.delete(session.id)

    const result = {
      sessionId: session.id,
      instrument: session.instrument,
      ...assemble(session.instrument, session.collected)
    }
    session.emit({ type: 'done', sessionId: session.id, result })
    if (session.stopping) {
      session.emit({ type: 'stopped', sessionId: session.id, reason: session.stopping })
    }
  }

  private mustGet(sessionId: string): ActiveSession {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`Session inconnue ou terminée : ${sessionId}`)
    return s
  }

  async disposeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.stop(id, 'user').catch(() => undefined)
    }
  }
}
