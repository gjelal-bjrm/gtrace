import type { DebugRunResult } from '@shared/types'

/**
 * Contenu de l'onglet « Messages », sur le modèle de SSMS :
 * « (5 lignes affectées) » après chaque instruction qui lit ou écrit des
 * lignes, les erreurs en rouge au format « Msg 207, Niveau 16, État 1,
 * Ligne 5 », puis l'heure de fin.
 */
export interface RunMessage {
  kind: 'info' | 'error'
  /** En-tête d'erreur (« Msg 207, Niveau 16, État 1, Ligne 5 »), absent pour une info */
  header?: string
  text: string
  /** Ligne de l'éditeur visée par l'erreur (double-clic → sélection de la ligne) */
  line?: number
}

/** Instructions pour lesquelles SQL Server annonce un nombre de lignes. */
const COUNTED = new Set([
  'SelectStatement',
  'InsertStatement',
  'UpdateStatement',
  'DeleteStatement',
  'MergeStatement'
])

function affected(n: number): string {
  return n === 1 ? '(1 ligne affectée)' : `(${n} lignes affectées)`
}

function finishedLabel(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `Heure de fin : ${p(at.getDate())}.${p(at.getMonth() + 1)}.${at.getFullYear()} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`
}

export function buildMessages(
  run: DebugRunResult | null,
  finishedAt: Date | null,
  execError: string | null
): RunMessage[] {
  const out: RunMessage[] = []
  if (run) {
    const types = new Map(run.instrument.statements.map((s) => [s.index, s.type]))
    // L'instruction qui a échoué n'annonce pas de lignes (SSMS n'affiche que l'erreur).
    const errorLines = run.errors.flatMap((e) => (e.line !== null ? [e.line] : []))
    for (const step of run.steps) {
      if (step.kind !== 'step' || step.rowCount === null) continue
      if (!COUNTED.has(types.get(step.statementIndex) ?? '')) continue
      if (errorLines.some((l) => l >= step.startLine && l <= step.endLine)) continue
      out.push({ kind: 'info', text: affected(step.rowCount) })
    }
    for (const e of run.errors) {
      out.push({
        kind: 'error',
        header: `Msg ${e.number}, Niveau ${e.severity ?? 16}, État ${e.state ?? 1}${e.line !== null ? `, Ligne ${e.line}` : ''}`,
        text: e.message,
        line: e.line ?? undefined
      })
    }
  }
  // Échec avant toute exécution (syntaxe, connexion…) : pas de run, seulement l'erreur.
  if (execError) out.push({ kind: 'error', text: execError })
  if (finishedAt && (run || execError)) out.push({ kind: 'info', text: finishedLabel(finishedAt) })
  return out
}
