import type { DebugRunResult, InstrumentedStatement } from '@shared/types'

/**
 * Analyse du chemin réellement parcouru par une exécution.
 *
 * C'est la brique commune aux aides à la navigation : marge colorée, repli des
 * branches non prises, fil d'Ariane, plan de la procédure. Tout part du même
 * constat : on sait quelles instructions ont produit un step, donc quelles
 * lignes ont tourné — et par déduction, lesquelles n'ont jamais été atteintes.
 */

export interface LineRange {
  start: number
  end: number
}

/** Index des instructions ayant réellement produit au moins un step. */
export function executedStatements(run: DebugRunResult): Set<number> {
  const set = new Set<number>()
  for (const step of run.steps) set.add(step.statementIndex)
  return set
}

/** Lignes couvertes par au moins une instruction exécutée. */
export function executedLines(run: DebugRunResult): Set<number> {
  const lines = new Set<number>()
  for (const step of run.steps) {
    for (let l = step.startLine; l <= step.endLine; l++) lines.add(l)
  }
  return lines
}

/**
 * Plages de lignes jamais atteintes, prêtes à être repliées.
 *
 * On ne considère que les instructions traçables : un `BEGIN`/`END` ou un
 * conteneur n'a pas de step propre et ne doit pas être compté comme mort. On
 * ignore aussi les plages trop courtes, dont le repli n'apporterait rien.
 */
export function deadRanges(
  statements: InstrumentedStatement[],
  run: DebugRunResult,
  minLines = 2
): LineRange[] {
  const executed = executedStatements(run)
  const live = executedLines(run)

  const ranges: LineRange[] = []
  for (const st of statements) {
    if (st.kind !== 'statement' || !st.traced) continue
    if (executed.has(st.index)) continue
    // Une ligne partagée avec du code exécuté ne doit jamais être masquée.
    let start = st.startLine
    let end = st.endLine
    while (start <= end && live.has(start)) start++
    while (end >= start && live.has(end)) end--
    if (end - start + 1 >= minLines) ranges.push({ start, end })
  }
  return mergeRanges(ranges)
}

/** Fusionne les plages qui se touchent ou se chevauchent. */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: LineRange[] = [{ ...sorted[0] }]
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (r.start <= last.end + 1) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

export interface Crumb {
  /** Libellé court, ex. « WHILE », « IF », « BEGIN TRY » */
  label: string
  line: number
}

/**
 * Fil d'Ariane : les conteneurs qui englobent une ligne, du plus extérieur au
 * plus intérieur. Répond à « où suis-je dans les imbrications ? » sur une
 * procédure de plusieurs centaines de lignes.
 */
export function breadcrumbFor(statements: InstrumentedStatement[], line: number): Crumb[] {
  return statements
    .filter((s) => s.kind === 'container' && s.startLine <= line && line <= s.endLine)
    .sort((a, b) => a.depth - b.depth || a.startLine - b.startLine)
    .map((s) => ({ label: shortLabel(s.type), line: s.startLine }))
}

/** Nom d'instruction ScriptDom → libellé lisible. */
export function shortLabel(type: string): string {
  const t = type.replace(/Statement$/, '')
  const table: Record<string, string> = {
    While: 'WHILE',
    If: 'IF',
    BeginEnd: 'BEGIN',
    TryCatch: 'TRY',
    Begin: 'BEGIN',
    Declare: 'DECLARE',
    Execute: 'EXEC',
    Select: 'SELECT',
    Insert: 'INSERT',
    Update: 'UPDATE',
    Delete: 'DELETE',
    Set: 'SET',
    CreateProcedure: 'PROCEDURE'
  }
  return table[t] ?? t.toUpperCase()
}
