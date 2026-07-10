import sql from 'mssql'
import { randomUUID } from 'node:crypto'
import type {
  ConnectionConfig,
  ProcParameter,
  ResultSetData,
  StepError,
  XeLineStat,
  XeStartRequest,
  XEventsEvent
} from '@shared/types'

type XeProcParameter = ProcParameter
import type { SidecarService } from './SidecarService'
import { buildSqlConfig, coerceParam, defaultLiteralToRaw, getPool } from './SqlService'

export type XeEmitFn = (event: XEventsEvent) => void

export type XeStartInput = Omit<XeStartRequest, 'connection'> & { connection: ConnectionConfig }

interface RawXeEvent {
  name: string
  timestamp: string
  line: number | null
  durationUs: number | null
  rowCount: number | null
  /** object_id du module (procs…) ; hash pour les batches ad hoc */
  objectId: number | null
  /** 'PROC' | 'ADHOC' | … (object_name est vide sur certains builds, object_type est fiable) */
  objectType: string
  /** Début du texte du statement (filtrage du bruit driver) */
  statement: string
}

/** Requêtes techniques émises par le driver mssql/tedious sur la connexion d'exécution. */
function isDriverNoise(statement: string): boolean {
  const s = statement.trim().toUpperCase()
  return s === 'SELECT 1' || s.startsWith('SELECT @@SPID')
}

const POLL_INTERVAL_MS = 400
const DEFAULT_TIMEOUT_MS = 10 * 60_000

/**
 * Profilage passif par Extended Events (spec Phase 3) : une session XEvents
 * éphémère filtrée sur le spid de la connexion d'exécution capture
 * sp_statement_starting/completed (procédures) et sql_statement_* (batches).
 * L'exécution n'est PAS instrumentée — profil réel, code intact.
 */
export class XEventsProfiler {
  private active = new Map<string, () => void>()

  constructor(private readonly sidecar: SidecarService) {}

  async checkPermission(cfg: ConnectionConfig): Promise<boolean> {
    const pool = await getPool(cfg)
    const result = await pool
      .request()
      .query<{ p: number | null }>(
        "SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'ALTER ANY EVENT SESSION') AS p"
      )
    return Number(result.recordset[0]?.p) === 1
  }

  async start(input: XeStartInput, emit: XeEmitFn): Promise<{ profileId: string }> {
    if (!(await this.checkPermission(input.connection))) {
      throw new Error(
        "Permission « ALTER ANY EVENT SESSION » absente sur ce serveur : le profilage XEvents n'est pas disponible avec ce login (les autres fonctions restent utilisables)."
      )
    }

    const profileId = randomUUID()

    // Analyse (sidecar) uniquement pour les métadonnées : nom de proc + paramètres.
    const analysis = await this.sidecar.instrument(input.sql, input.compatLevel)
    if (analysis.errors.length > 0) {
      throw new Error(`Le source ne parse pas : ${analysis.errors[0]?.message}`)
    }

    // La suite (session XEvents + exécution + polling) tourne en tâche de fond :
    // le renderer est notifié par événements.
    void this.runProfile(profileId, input, analysis.procedureName, analysis.parameters, emit)
    return { profileId }
  }

  private async runProfile(
    profileId: string,
    input: XeStartInput,
    procedureName: string | null,
    parameters: XeProcParameter[],
    emit: XeEmitFn
  ): Promise<void> {
    const xeName = `gtrace_xe_${profileId.slice(0, 8)}`
    const cfg = input.connection
    const procMode = procedureName !== null

    const execPool = await new sql.ConnectionPool({
      ...buildSqlConfig(cfg),
      pool: { max: 1, min: 1 },
      requestTimeout: 0
    }).connect()

    let cancelled = false
    let request: sql.Request | null = null
    const timeout = setTimeout(() => {
      cancelled = true
      request?.cancel()
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.active.set(profileId, () => {
      cancelled = true
      request?.cancel()
    })

    const admin = await getPool(cfg)
    const t0 = Date.now()

    try {
      const spid = (await execPool.request().query<{ s: number }>('SELECT @@SPID AS s'))
        .recordset[0].s

      await admin.request().batch(
        `CREATE EVENT SESSION [${xeName}] ON SERVER
           ADD EVENT sqlserver.sp_statement_starting  (ACTION (sqlserver.session_id) WHERE (sqlserver.session_id = ${spid})),
           ADD EVENT sqlserver.sp_statement_completed (ACTION (sqlserver.session_id) WHERE (sqlserver.session_id = ${spid})),
           ADD EVENT sqlserver.sql_statement_starting (ACTION (sqlserver.session_id) WHERE (sqlserver.session_id = ${spid})),
           ADD EVENT sqlserver.sql_statement_completed(ACTION (sqlserver.session_id) WHERE (sqlserver.session_id = ${spid}))
           ADD TARGET package0.ring_buffer (SET max_memory = 8192)
         WITH (MAX_DISPATCH_LATENCY = 1 SECONDS, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS);
         ALTER EVENT SESSION [${xeName}] ON SERVER STATE = START;`
      )

      emit({ type: 'xe-started', profileId, mode: procMode ? 'proc' : 'batch' })

      // Empiriquement (tedious), tous les statements remontent en sp_statement_*.
      // Discriminant fiable : object_id (connu pour la proc) / object_type ADHOC.
      let procObjectId: number | null = null
      if (procMode) {
        const idResult = await admin
          .request()
          .input('n', sql.NVarChar(400), procedureName)
          .query<{ id: number | null }>('SELECT OBJECT_ID(@n) AS id')
        procObjectId = idResult.recordset[0]?.id ?? null
        if (procObjectId === null) {
          throw new Error(
            `La procédure ${procedureName} n'existe pas en base : le profilage XEvents exécute la procédure réelle (EXEC), pas le texte de l'éditeur.`
          )
        }
      }
      const isWanted = (e: RawXeEvent): boolean =>
        procMode
          ? e.objectId === procObjectId
          : e.objectType === 'ADHOC' && !isDriverNoise(e.statement)
      let processed = 0
      let currentLine: number | null = null
      let completedCount = 0
      const stats = new Map<number, XeLineStat>()

      const poll = async (): Promise<void> => {
        const events = (await readRingBuffer(admin, xeName)).slice(processed)
        processed += events.length
        for (const e of events) {
          if (!isWanted(e) || e.line === null || e.line < 1) continue
          if (e.name.endsWith('_starting')) {
            currentLine = e.line
            continue
          }
          completedCount++
          const stat = stats.get(e.line) ?? {
            line: e.line,
            count: 0,
            totalDurationUs: 0,
            maxDurationUs: 0,
            rowCount: 0
          }
          stat.count++
          stat.totalDurationUs += e.durationUs ?? 0
          stat.maxDurationUs = Math.max(stat.maxDurationUs, e.durationUs ?? 0)
          stat.rowCount = e.rowCount ?? stat.rowCount
          stats.set(e.line, stat)
        }
        if (events.length > 0) {
          emit({ type: 'xe-progress', profileId, currentLine, statements: completedCount })
        }
      }

      const timer = setInterval(() => {
        void poll().catch(() => undefined)
      }, POLL_INTERVAL_MS)

      // ── Exécution réelle, non instrumentée ────────────────────────────────
      const errors: StepError[] = []
      let resultsets: ResultSetData[] = []
      try {
        request = execPool.request()
        let execSql = input.sql
        if (procMode) {
          for (const p of parameters) {
            const raw =
              input.paramValues && p.name in input.paramValues
                ? input.paramValues[p.name]
                : defaultLiteralToRaw(p.defaultText)
            const { type, value } = coerceParam(p.type, raw)
            request.input(p.name.slice(1), type, value)
          }
          const args = parameters
            .map((p) => `${p.name} = ${p.name}${p.isOutput ? ' OUTPUT' : ''}`)
            .join(', ')
          execSql = `EXEC ${procedureName} ${args};`
        }
        const result = await request.query(execSql)
        const recordsets = (result.recordsets as sql.IRecordSet<Record<string, unknown>>[]) ?? []
        resultsets = recordsets.map((rs, index) => {
          const columns = Object.keys(rs.columns ?? {})
          return {
            index,
            columns,
            rows: rs.slice(0, 200).map((row) => columns.map((c) => row[c])),
            stepIndex: null
          }
        })
      } catch (e) {
        const err = e as Error & { number?: number; lineNumber?: number; class?: number }
        if (!cancelled) {
          errors.push({
            number: err.number ?? 0,
            message: err.message,
            line: err.lineNumber ?? null,
            severity: err.class
          })
        }
      }
      const elapsedMs = Date.now() - t0

      // Laisser la latence de dispatch (1 s) écouler les derniers événements.
      clearInterval(timer)
      await sleep(1500)
      await poll().catch(() => undefined)

      // Nettoyage AVANT l'événement final : quand xe-done part, plus rien ne traîne.
      await dropXeSession(admin, xeName)

      emit({
        type: 'xe-done',
        profileId,
        stats: [...stats.values()].sort((a, b) => b.totalDurationUs - a.totalDurationUs),
        resultsets,
        errors: cancelled
          ? [...errors, { number: 0, message: 'Profilage annulé', line: null }]
          : errors,
        elapsedMs
      })
    } catch (e) {
      emit({ type: 'xe-error', profileId, message: e instanceof Error ? e.message : String(e) })
    } finally {
      clearTimeout(timeout)
      this.active.delete(profileId)
      await dropXeSession(admin, xeName) // filet de sécurité (idempotent)
      await execPool.close().catch(() => undefined)
    }
  }

  stop(profileId: string): void {
    this.active.get(profileId)?.()
  }

  disposeAll(): void {
    for (const cancel of this.active.values()) cancel()
    this.active.clear()
  }
}

async function dropXeSession(pool: sql.ConnectionPool, xeName: string): Promise<void> {
  await pool
    .request()
    .batch(
      `IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${xeName}')
       BEGIN
         IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${xeName}')
           ALTER EVENT SESSION [${xeName}] ON SERVER STATE = STOP;
         DROP EVENT SESSION [${xeName}] ON SERVER;
       END`
    )
    .catch(() => undefined)
}

async function readRingBuffer(pool: sql.ConnectionPool, xeName: string): Promise<RawXeEvent[]> {
  const result = await pool
    .request()
    .input('name', sql.NVarChar(128), xeName)
    .query<{ x: string | null }>(
      `SELECT CAST(t.target_data AS nvarchar(max)) AS x
       FROM sys.dm_xe_sessions s
       JOIN sys.dm_xe_session_targets t ON t.event_session_address = s.address
       WHERE s.name = @name AND t.target_name = 'ring_buffer'`
    )
  const xml = result.recordset[0]?.x
  if (!xml) return []
  return parseRingBuffer(xml)
}

/** Parse minimaliste du XML du ring buffer (uniquement les champs utiles). */
export function parseRingBuffer(xml: string): RawXeEvent[] {
  const events: RawXeEvent[] = []
  const blocks = xml.match(/<event name="[^"]+"[\s\S]*?<\/event>/g) ?? []
  for (const block of blocks) {
    const header = block.match(/^<event name="([^"]+)"[^>]*timestamp="([^"]+)"/)
    if (!header) continue
    events.push({
      name: header[1],
      timestamp: header[2],
      line: extractInt(block, 'line_number'),
      durationUs: extractInt(block, 'duration'),
      rowCount: extractInt(block, 'row_count'),
      objectId: extractInt(block, 'object_id'),
      objectType: extractTypeText(block, 'object_type'),
      statement: extractText(block, 'statement').slice(0, 120)
    })
  }
  return events
}

function extractInt(block: string, field: string): number | null {
  const match = block.match(new RegExp(`<data name="${field}">[\\s\\S]*?<value>(-?\\d+)</value>`))
  return match ? Number(match[1]) : null
}

function extractText(block: string, field: string): string {
  const match = block.match(
    new RegExp(`<data name="${field}">[\\s\\S]*?<value>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>)?</value>`)
  )
  return match?.[1] ?? ''
}

/** Libellé du champ (élément <text> des types mappés, ex. object_type → ADHOC/PROC). */
function extractTypeText(block: string, field: string): string {
  const match = block.match(
    new RegExp(`<data name="${field}">[\\s\\S]*?<text><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></text>`)
  )
  return match?.[1] ?? ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
