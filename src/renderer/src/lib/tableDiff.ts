/**
 * Comparaison de deux contenus d'une même table : captures successives de
 * l'onglet Données, et « Comparer deux moments » du Déroulé.
 */

/** Clé d'une ligne (les dates en ISO, pour comparer des valeurs égales). */
export function rowKey(row: unknown[]): string {
  return JSON.stringify(row.map((v) => (v instanceof Date ? v.toISOString() : v)))
}

/**
 * Diff multiset : lignes ajoutées (nombre par clé) et lignes supprimées entre
 * deux contenus. Les doublons comptent : deux lignes identiques avant et une
 * seule après font une suppression.
 */
export function multisetDiff(
  current: unknown[][],
  previous: unknown[][]
): { addedKeys: Map<string, number>; removedRows: unknown[][] } {
  const prevCounts = new Map<string, number>()
  for (const row of previous) {
    const k = rowKey(row)
    prevCounts.set(k, (prevCounts.get(k) ?? 0) + 1)
  }
  const addedKeys = new Map<string, number>()
  for (const row of current) {
    const k = rowKey(row)
    const left = prevCounts.get(k) ?? 0
    if (left > 0) {
      prevCounts.set(k, left - 1)
    } else {
      addedKeys.set(k, (addedKeys.get(k) ?? 0) + 1)
    }
  }
  const removedRows: unknown[][] = []
  for (const row of previous) {
    const k = rowKey(row)
    const count = prevCounts.get(k) ?? 0
    if (count > 0) {
      removedRows.push(row)
      prevCounts.set(k, count - 1)
    }
  }
  return { addedKeys, removedRows }
}

export interface RowChange {
  kind: 'added' | 'removed' | 'modified'
  /** La ligne après le changement (pour une suppression : telle qu'elle était) */
  row: unknown[]
  /** Pour une modification : la ligne avant */
  before?: unknown[]
  /** Pour une modification : index des colonnes qui ont changé */
  changed?: number[]
}

const firstColumnIsKey = (rows: unknown[][]): boolean => {
  const seen = new Set<string>()
  for (const row of rows) {
    const k = rowKey([row[0]])
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/**
 * Lignes ajoutées, supprimées et modifiées entre deux contenus. Une
 * modification se reconnaît quand la première colonne identifie les lignes
 * (valeurs uniques avant comme après, typiquement un id) : la ligne supprimée
 * et la ligne ajoutée qui partagent cet identifiant ne font qu'une ligne
 * modifiée, cellules changées à l'appui.
 */
export function compareRows(
  before: unknown[][],
  after: unknown[][]
): { changes: RowChange[]; unchanged: number } {
  const { addedKeys, removedRows } = multisetDiff(after, before)
  const pending = new Map(addedKeys)
  const added: unknown[][] = []
  for (const row of after) {
    const k = rowKey(row)
    const left = pending.get(k) ?? 0
    if (left > 0) {
      added.push(row)
      pending.set(k, left - 1)
    }
  }

  const keyed =
    before.length > 0 &&
    after.length > 0 &&
    after[0].length > 1 &&
    firstColumnIsKey(before) &&
    firstColumnIsKey(after)
  const removedById = new Map<string, unknown[]>()
  if (keyed) for (const row of removedRows) removedById.set(rowKey([row[0]]), row)

  const changes: RowChange[] = []
  for (const row of added) {
    const id = rowKey([row[0]])
    const previous = keyed ? removedById.get(id) : undefined
    if (previous) {
      removedById.delete(id)
      changes.push({
        kind: 'modified',
        row,
        before: previous,
        changed: row.flatMap((v, i) => (rowKey([v]) === rowKey([previous[i]]) ? [] : [i]))
      })
    } else {
      changes.push({ kind: 'added', row })
    }
  }
  for (const row of removedRows) {
    if (keyed && !removedById.has(rowKey([row[0]]))) continue // déjà apparié
    changes.push({ kind: 'removed', row })
  }
  return { changes, unchanged: after.length - added.length }
}
