import type { DebugRunResult, TableSnapshot } from '@shared/types'
import { formatSqlValue } from '../stores/replayStore'
import { valueAt, type RunModel, type StepCategory } from './runModel'
import { compareRows, type RowChange } from './tableDiff'

/**
 * « Comparer deux moments » du Déroulé : ce qui a changé entre deux étapes,
 * pour les variables et pour le contenu des tables suivies. Chaque moment est
 * l'état juste après l'étape correspondante.
 */

export interface VariableDiff {
  name: string
  before: unknown
  /** Faux si la variable n'était pas encore écrite au premier moment */
  hadBefore: boolean
  after: unknown
  hadAfter: boolean
  /** Nombre d'écritures entre les deux moments */
  writes: number
  changed: boolean
  /** Après − avant, quand les deux valeurs sont des nombres */
  delta: number | null
}

export interface TableDiff {
  table: string
  /** Dernière capture au premier moment (null : pas encore capturée) */
  before: TableSnapshot | null
  after: TableSnapshot | null
  changes: RowChange[]
  unchanged: number
}

export interface Comparison {
  /** Le plus ancien des deux moments */
  from: number
  /** Le plus récent */
  to: number
  durationMs: number
  /** Instructions exécutées entre les deux, par famille */
  counts: Partial<Record<StepCategory, number>>
  variables: VariableDiff[]
  tables: TableDiff[]
}

/** Nombre SQL (les bigint arrivent en texte). */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}

export function compareMoments(
  model: RunModel,
  run: DebugRunResult,
  a: number,
  b: number
): Comparison {
  const from = Math.min(a, b)
  const to = Math.max(a, b)

  let durationMs = 0
  const counts: Partial<Record<StepCategory, number>> = {}
  for (let i = from + 1; i <= to && i < model.steps.length; i++) {
    const s = model.steps[i]
    durationMs += s.durationMs ?? 0
    counts[s.category] = (counts[s.category] ?? 0) + 1
  }

  const variables = model.variables.map((track): VariableDiff => {
    const before = valueAt(model, track, from)
    const after = valueAt(model, track, to)
    const changed =
      (before === null) !== (after === null) ||
      (before !== null && after !== null && formatSqlValue(before.value) !== formatSqlValue(after.value))
    const nb = before ? asNumber(before.value) : null
    const na = after ? asNumber(after.value) : null
    return {
      name: track.name,
      before: before?.value,
      hadBefore: before !== null,
      after: after?.value,
      hadAfter: after !== null,
      writes: track.steps.filter((i) => i > from && i <= to).length,
      changed,
      delta: changed && nb !== null && na !== null ? Number((na - nb).toFixed(10)) : null
    }
  })

  const byTable = new Map<string, TableSnapshot[]>()
  for (const snap of run.snapshots) {
    const list = byTable.get(snap.table)
    if (list) list.push(snap)
    else byTable.set(snap.table, [snap])
  }
  // Contenu d'une table à un moment : sa dernière capture jusqu'à cette étape.
  const at = (snaps: TableSnapshot[], step: number): TableSnapshot | null => {
    let found: TableSnapshot | null = null
    for (const s of snaps) if (s.stepIndex <= step) found = s
    return found
  }
  const tables = [...byTable].map(([table, snaps]): TableDiff => {
    const before = at(snaps, from)
    const after = at(snaps, to)
    if (before === after) {
      return { table, before, after, changes: [], unchanged: after?.rows.length ?? 0 }
    }
    return { table, before, after, ...compareRows(before?.rows ?? [], after?.rows ?? []) }
  })

  return { from, to, durationMs, counts, variables, tables }
}
