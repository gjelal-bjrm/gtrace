import { createHash } from 'node:crypto'
import type { HistoryEntry, TraceStep } from '@shared/types'

/**
 * Compression des traces pour consommation IA (spec Phase 6 §3.5) :
 * l'agent doit pouvoir diagnostiquer en 5–10 appels ciblés, jamais en
 * aspirant la trace brute. Toutes les fonctions sont pures.
 */

const MAX_VALUE_LENGTH = 2000

export function truncateValue(v: unknown): unknown {
  if (typeof v === 'string' && v.length > MAX_VALUE_LENGTH) {
    return v.slice(0, MAX_VALUE_LENGTH) + `… [tronqué, ${v.length} caractères]`
  }
  if (v instanceof Date) return v.toISOString()
  return v
}

function truncateVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, truncateValue(v)]))
}

// ─── Chemin d'exécution ───────────────────────────────────────────────────────

export interface PathSegment {
  kind: 'sequence' | 'loop' | 'catch'
  fromStep: number
  toStep: number
  fromLine: number
  toLine: number
  /** Pour kind 'loop' : nombre de passages (retours arrière vers fromLine) */
  iterations?: number
}

/**
 * Séquence compacte des blocs traversés : les steps sont découpés en segments
 * de progression avant ; un retour arrière (statementIndex qui recule) signale
 * une itération de boucle — les itérations d'une même boucle sont agrégées.
 */
export function executionPath(entry: HistoryEntry): PathSegment[] {
  const steps = entry.run.steps
  if (steps.length === 0) return []

  const segments: PathSegment[] = []
  let segStart = 0

  const flush = (endIndex: number): void => {
    const first = steps[segStart]
    const last = steps[endIndex]
    segments.push({
      kind: first.kind === 'catch' ? 'catch' : 'sequence',
      fromStep: first.stepIndex,
      toStep: last.stepIndex,
      fromLine: first.startLine,
      toLine: last.startLine
    })
  }

  for (let i = 1; i < steps.length; i++) {
    const backward = steps[i].statementIndex < steps[i - 1].statementIndex
    const catchBoundary = steps[i].kind === 'catch' || steps[i - 1].kind === 'catch'
    if (backward || catchBoundary) {
      flush(i - 1)
      segStart = i
    }
  }
  flush(steps.length - 1)

  // Agrégation des itérations : segments consécutifs démarrant à la même ligne = boucle
  const compact: PathSegment[] = []
  for (const seg of segments) {
    const prev = compact[compact.length - 1]
    if (
      prev &&
      prev.kind !== 'catch' &&
      seg.kind === 'sequence' &&
      seg.fromLine === (prev.kind === 'loop' ? prev.fromLine : prev.fromLine) &&
      seg.fromStep === prev.toStep + 1 &&
      prev.toLine >= seg.fromLine
    ) {
      prev.kind = 'loop'
      prev.iterations = (prev.iterations ?? 1) + 1
      prev.toStep = seg.toStep
      prev.toLine = Math.max(prev.toLine, seg.toLine)
    } else {
      compact.push({ ...seg })
    }
  }
  return compact
}

// ─── Changements de variables ────────────────────────────────────────────────

export interface VariableChange {
  stepIndex: number
  line: number
  previous: unknown
  value: unknown
}

export function findVariableChanges(entry: HistoryEntry, variableName: string): VariableChange[] {
  const wanted = variableName.toLowerCase()
  const changes: VariableChange[] = []
  let previous: unknown
  let seen = false
  for (const step of entry.run.steps) {
    const key = Object.keys(step.variables).find((k) => k.toLowerCase() === wanted)
    if (key === undefined) continue
    const value = step.variables[key]
    if (!seen || JSON.stringify(value) !== JSON.stringify(previous)) {
      changes.push({
        stepIndex: step.stepIndex,
        line: step.startLine,
        previous: seen ? truncateValue(previous) : null,
        value: truncateValue(value)
      })
    }
    previous = value
    seen = true
  }
  return changes
}

// ─── Variables à un step ─────────────────────────────────────────────────────

export function variablesAtStep(
  entry: HistoryEntry,
  stepIndex: number,
  names?: string[]
): Record<string, unknown> {
  const wanted = names?.map((n) => n.toLowerCase())
  const state = new Map<string, unknown>()
  for (const step of entry.run.steps) {
    if (step.stepIndex > stepIndex) break
    for (const [name, value] of Object.entries(step.variables)) {
      state.set(name, value)
    }
  }
  const result: Record<string, unknown> = {}
  for (const [name, value] of state) {
    if (wanted && !wanted.includes(name.toLowerCase())) continue
    result[name] = truncateValue(value)
  }
  return result
}

// ─── Steps paginés ───────────────────────────────────────────────────────────

export interface StepView {
  stepIndex: number
  statementIndex: number
  kind: TraceStep['kind']
  line: number
  statementType: string
  durationMs: number | null
  rowCount: number | null
  variables: Record<string, unknown>
  returnValue: unknown
  error: TraceStep['error']
}

export function stepsPage(
  entry: HistoryEntry,
  options: { fromStep?: number; toStep?: number; onlyLines?: number[]; pageSize?: number }
): { steps: StepView[]; total: number; truncated: boolean; nextFromStep: number | null } {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 500)
  const lines = options.onlyLines ? new Set(options.onlyLines) : null
  const filtered = entry.run.steps.filter(
    (s) =>
      (options.fromStep === undefined || s.stepIndex >= options.fromStep) &&
      (options.toStep === undefined || s.stepIndex <= options.toStep) &&
      (lines === null || lines.has(s.startLine))
  )
  const page = filtered.slice(0, pageSize)
  const truncated = filtered.length > page.length
  return {
    steps: page.map((s) => ({
      stepIndex: s.stepIndex,
      statementIndex: s.statementIndex,
      kind: s.kind,
      line: s.startLine,
      statementType:
        s.kind === 'catch'
          ? 'CATCH'
          : (entry.run.instrument.statements[s.statementIndex]?.type ?? '?'),
      durationMs: s.durationMs,
      rowCount: s.rowCount,
      variables: truncateVariables(s.variables),
      returnValue: truncateValue(s.returnValue),
      error: s.error
    })),
    total: filtered.length,
    truncated,
    nextFromStep: truncated ? page[page.length - 1].stepIndex + 1 : null
  }
}

// ─── Résumé de session ───────────────────────────────────────────────────────

export function sessionSummary(entry: HistoryEntry): Record<string, unknown> {
  const { run } = entry
  const catches = run.steps.filter((s) => s.kind === 'catch')

  const slowest = [...run.steps]
    .filter((s) => s.durationMs !== null)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 10)
    .map((s) => ({
      stepIndex: s.stepIndex,
      line: s.startLine,
      statementType: run.instrument.statements[s.statementIndex]?.type ?? '?',
      durationMs: s.durationMs
    }))

  const changeCounts = new Map<string, number>()
  for (const step of run.steps) {
    for (const name of Object.keys(step.variables)) {
      changeCounts.set(name, (changeCounts.get(name) ?? 0) + 1)
    }
  }
  const mostChanged = [...changeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, writes]) => ({ name, writes }))

  const path = executionPath(entry)

  return {
    sessionId: entry.id,
    title: entry.title,
    savedAt: entry.savedAt,
    server: entry.server,
    database: entry.database,
    status: entry.errorCount > 0 ? 'erreur' : 'ok',
    parameters: run.instrument.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      isOutput: p.isOutput,
      inputValue: entry.paramValues?.[p.name] ?? null,
      outputValue: p.isOutput ? truncateValue(run.outputValues[p.name]) : undefined
    })),
    stepCount: run.steps.length,
    resultsetCount: run.resultsets.length,
    snapshotCount: run.snapshots.length,
    errors: run.errors.map((e) => ({ number: e.number, line: e.line, message: e.message })),
    catchSteps: catches.map((s) => ({
      stepIndex: s.stepIndex,
      line: s.startLine,
      error: s.error
    })),
    executionPath: path.slice(0, 40),
    executionPathTruncated: path.length > 40,
    slowestStatements: slowest,
    mostChangedVariables: mostChanged,
    untracedStatements: run.instrument.statements
      .filter((s) => s.kind === 'statement' && !s.traced)
      .map((s) => ({ line: s.startLine, reason: s.skipReason }))
  }
}

// ─── Source ──────────────────────────────────────────────────────────────────

export function procSource(entry: HistoryEntry): {
  title: string
  hash: string
  lineCount: number
  source: string
} {
  const lines = entry.sql.replace(/\r\n/g, '\n').split('\n')
  const width = String(lines.length).length
  return {
    title: entry.title,
    hash: createHash('sha256').update(entry.sql).digest('hex').slice(0, 16),
    lineCount: lines.length,
    source: lines.map((l, i) => `${String(i + 1).padStart(width)} | ${l}`).join('\n')
  }
}
