import type sql from 'mssql'
import { randomUUID } from 'node:crypto'
import type {
  ConnectionConfig,
  DebugRequest,
  DebugRunResult,
  InstrumentResult,
  ResultSetData,
  StepError,
  TableSnapshot,
  TraceStep
} from '@shared/types'
import type { SidecarService } from './SidecarService'
import { coerceParam, defaultLiteralToRaw, getPool } from './SqlService'

/** DebugRequest dont la référence de connexion a déjà été résolue (côté main). */
export type DebugRunInput = Omit<DebugRequest, 'connection'> & { connection: ConnectionConfig }

/** Mode lecture seule strict (spec Phase 5) : lève si des écritures sont détectées. */
export async function enforceReadOnly(
  sidecar: SidecarService,
  input: Pick<DebugRunInput, 'sql' | 'compatLevel' | 'readOnly' | 'readOnlyWhitelist'>
): Promise<void> {
  if (!input.readOnly) return
  const validation = await sidecar.validate(
    input.sql,
    input.compatLevel,
    input.readOnlyWhitelist ?? []
  )
  if (validation.violations.length > 0) {
    const details = validation.violations
      .slice(0, 8)
      .map((v) => `ligne ${v.line} : ${v.type} → ${v.target}`)
      .join(' ; ')
    const more =
      validation.violations.length > 8 ? ` (+${validation.violations.length - 8} autres)` : ''
    throw new Error(
      `Mode lecture seule : ${validation.violations.length} écriture(s) détectée(s) — ${details}${more}. ` +
        'Ajoutez les cibles légitimes à la liste blanche ou désactivez le mode lecture seule.'
    )
  }
}

export const TRACE_TAG = '__GTRACE__'
export const ERROR_TAG = '__GTRACE_ERR__'
export const OUTPUT_TAG = '__GTRACE_OUT__'
export const PAUSE_TAG = '__GTRACE_PAUSE__'
export const SNAP_TAG = '__GTRACE_SNAP__'

export interface RawRecordset {
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface Collected {
  recordsets: RawRecordset[]
  errors: StepError[]
}

/** Construit un TraceStep depuis un resultset de trace (__GTRACE__ / __GTRACE_ERR__). */
export function buildStep(
  instrument: InstrumentResult,
  rs: RawRecordset,
  stepIndex: number,
  resultsetIndexes: number[]
): TraceStep {
  const first = rs.rows[0]
  const tag = first['_t']
  const statementIndex = Number(first['_s'])
  const statement = instrument.statements[statementIndex]
  const variables: Record<string, unknown> = {}
  for (const col of rs.columns) {
    if (col.startsWith('@')) variables[col] = first[col]
  }
  const ts = first['_ts'] instanceof Date ? (first['_ts'] as Date) : null
  return {
    stepIndex,
    statementIndex,
    kind: tag === ERROR_TAG ? 'catch' : 'step',
    startLine: statement?.startLine ?? 0,
    endLine: statement?.endLine ?? 0,
    rowCount: tag === TRACE_TAG ? Number(first['_rc']) : null,
    executedAt: ts ? ts.toISOString() : null,
    durationMs: null,
    variables,
    returnValue: first['_ret'] ?? null,
    error:
      tag === ERROR_TAG
        ? {
            number: Number(first['_errnum']),
            message: String(first['_errmsg'] ?? ''),
            line: first['_errline'] === null ? null : Number(first['_errline']),
            severity: Number(first['_errsev']),
            state: Number(first['_errstate'])
          }
        : null,
    resultsetIndexes
  }
}

/**
 * Exécution instrumentée, stratégie A (spec §6.3) : le script ne persiste rien —
 * chaque point de trace est un resultset tagué que le driver intercepte au fil de
 * l'eau. Zéro dépendance transactionnelle : les traces survivent aux ROLLBACK.
 */
export class DebugService {
  constructor(private readonly sidecar: SidecarService) {}

  async run(request: DebugRunInput): Promise<DebugRunResult> {
    await enforceReadOnly(this.sidecar, request)
    const instrument = await this.sidecar.instrument(
      request.sql,
      request.compatLevel,
      undefined,
      request.snapshots
    )
    const sessionId = randomUUID()

    if (instrument.errors.length > 0 || !instrument.script) {
      return {
        sessionId,
        instrument,
        steps: [],
        resultsets: [],
        outputValues: {},
        errors: instrument.errors.map((e) => ({
          number: e.number,
          message: e.message,
          line: e.line
        })),
        snapshots: []
      }
    }

    let script = instrument.script
    const outputs = instrument.parameters.filter((p) => p.isOutput)
    if (outputs.length > 0) {
      const cols = outputs.map((p) => `, ${p.name} AS [${p.name}]`).join('')
      script += `\nSELECT '${OUTPUT_TAG}' AS _t${cols};`
    }

    const pool = await getPool(request.connection)
    const sqlRequest = pool.request()
    for (const p of instrument.parameters) {
      const raw =
        request.paramValues && p.name in request.paramValues
          ? request.paramValues[p.name]
          : defaultLiteralToRaw(p.defaultText)
      const { type, value } = coerceParam(p.type, raw)
      // mssql attend le nom sans « @ » ; les paramètres OUTPUT sont liés en entrée,
      // leur valeur finale est capturée par le SELECT __GTRACE_OUT__ final.
      sqlRequest.input(p.name.slice(1), type, value)
    }
    const collected = await executeStreaming(sqlRequest, script)
    return { sessionId, instrument, ...assemble(instrument, collected) }
  }
}

export function executeStreaming(request: sql.Request, script: string): Promise<Collected> {
  return new Promise((resolve) => {
    request.stream = true
    const recordsets: RawRecordset[] = []
    const errors: StepError[] = []
    let current: RawRecordset | null = null

    request.on('recordset', (columns: Record<string, unknown>) => {
      current = { columns: Object.keys(columns), rows: [] }
      recordsets.push(current)
    })
    request.on('row', (row: Record<string, unknown>) => {
      current?.rows.push(row)
    })
    request.on('error', (err: Error) => {
      const e = err as Error & {
        number?: number
        lineNumber?: number
        class?: number
        state?: number
      }
      errors.push({
        number: e.number ?? 0,
        message: e.message,
        line: e.lineNumber ?? null,
        severity: e.class,
        state: e.state
      })
    })
    request.on('done', () => resolve({ recordsets, errors }))

    void request.query(script).catch(() => {
      // L'erreur est déjà collectée via l'événement 'error' ; 'done' est émis ensuite.
    })
  })
}

export function assemble(
  instrument: InstrumentResult,
  collected: Collected
): Pick<DebugRunResult, 'steps' | 'resultsets' | 'outputValues' | 'errors' | 'snapshots'> {
  const steps: TraceStep[] = []
  const resultsets: ResultSetData[] = []
  const outputValues: Record<string, unknown> = {}
  const snapshots: TableSnapshot[] = []
  let pending: number[] = []
  // En-tête SNAP vu : le prochain recordset est le contenu de la table.
  let expectedSnap: { statementIndex: number; table: string } | null = null

  for (const rs of collected.recordsets) {
    const first = rs.rows[0]
    const tag = rs.columns[0] === '_t' && first ? first['_t'] : null

    if (expectedSnap) {
      snapshots.push({
        index: snapshots.length,
        table: expectedSnap.table,
        stepIndex: steps.length - 1,
        statementIndex: expectedSnap.statementIndex,
        columns: rs.columns,
        rows: rs.rows.map((row) => rs.columns.map((c) => row[c]))
      })
      expectedSnap = null
      continue
    }

    if (tag === PAUSE_TAG) continue // marqueur de pause : pas un step

    if (tag === SNAP_TAG) {
      expectedSnap = { statementIndex: Number(first!['_s']), table: String(first!['_tbl']) }
      continue
    }

    if (tag === TRACE_TAG || tag === ERROR_TAG) {
      steps.push(buildStep(instrument, rs, steps.length, pending))
      pending = []
      continue
    }

    if (tag === OUTPUT_TAG) {
      for (const col of rs.columns) {
        if (col.startsWith('@')) outputValues[col] = first![col]
      }
      continue
    }

    const index = resultsets.length
    resultsets.push({
      index,
      columns: rs.columns,
      rows: rs.rows.map((row) => rs.columns.map((c) => row[c])),
      stepIndex: null
    })
    pending.push(index)
  }

  for (const step of steps) {
    for (const i of step.resultsetIndexes) resultsets[i].stepIndex = step.stepIndex
  }

  // Un RETURN sort du batch avant le SELECT __GTRACE_OUT__ final : à défaut,
  // la valeur OUTPUT est le dernier snapshot vu dans les steps.
  for (const p of instrument.parameters.filter((p) => p.isOutput)) {
    if (p.name in outputValues) continue
    for (let i = steps.length - 1; i >= 0; i--) {
      if (p.name in steps[i].variables) {
        outputValues[p.name] = steps[i].variables[p.name]
        break
      }
    }
  }

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].executedAt
    const curr = steps[i].executedAt
    steps[i].durationMs =
      prev && curr ? Math.max(0, new Date(curr).getTime() - new Date(prev).getTime()) : null
  }

  return { steps, resultsets, outputValues, errors: collected.errors, snapshots }
}
