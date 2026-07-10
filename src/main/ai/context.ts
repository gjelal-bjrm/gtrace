import type { HistoryEntry } from '@shared/types'
import { executionPath, procSource, sessionSummary, stepsPage } from '../mcp/summarizers'

const LAST_STEPS = 15

/**
 * Contexte compact pour le diagnostic IA embarqué (spec Phase 6 §5) : même
 * logique de compression que le MCP (§3.5) — statement fautif, chemin emprunté,
 * derniers steps avec variables, erreur remappée. Jamais la trace brute.
 */
export function buildDiagnosisPrompt(entry: HistoryEntry): string {
  const summary = sessionSummary(entry)
  const source = procSource(entry)
  const path = executionPath(entry)
  const lastSteps = stepsPage(entry, {
    fromStep: Math.max(0, entry.run.steps.length - LAST_STEPS),
    pageSize: LAST_STEPS
  })

  const out: string[] = []
  out.push(
    'Tu es un expert T-SQL. Diagnostique cette session de debug GTrace (trace d\'exécution réelle, instrumentée).',
    'Les numéros de ligne se réfèrent au source ci-dessous. Ne suppose rien qui contredise la trace.',
    ''
  )
  out.push(`## Session : ${entry.title} (${entry.server}/${entry.database}) — statut ${summary.status}`)
  out.push('')
  out.push('## Paramètres d\'entrée')
  out.push(JSON.stringify(summary.parameters, null, 1))
  out.push('')
  out.push('## Erreurs (lignes du source)')
  out.push(JSON.stringify({ errors: summary.errors, catchSteps: summary.catchSteps }, null, 1))
  out.push('')
  out.push('## Chemin d\'exécution (boucles agrégées)')
  out.push(JSON.stringify(path.slice(0, 30)))
  out.push('')
  out.push(`## ${LAST_STEPS} derniers steps (variables écrites par chaque statement)`)
  out.push(
    JSON.stringify(
      lastSteps.steps.map((s) => ({
        step: s.stepIndex,
        ligne: s.line,
        type: s.statementType,
        rows: s.rowCount,
        variables: s.variables,
        erreur: s.error ?? undefined
      })),
      null,
      1
    )
  )
  out.push('')
  out.push(`## Source (${source.lineCount} lignes)`)
  out.push('```sql')
  out.push(source.source.split('\n').slice(0, 500).join('\n'))
  out.push('```')
  out.push('')
  out.push('## Réponse attendue (en français, concise)')
  out.push('1. **Cause racine** : ligne précise + chaîne causale (valeurs → chemin → erreur).')
  out.push(
    '2. **Vérifications** : 1 à 3 requêtes SELECT (lecture seule) dans des blocs ```sql pour confirmer, exécutables telles quelles.'
  )
  out.push('3. **Correctif proposé** : le(s) statement(s) corrigé(s) dans un bloc ```sql, avec justification.')

  return out.join('\n')
}
