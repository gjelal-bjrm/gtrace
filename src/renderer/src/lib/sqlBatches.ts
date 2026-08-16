/**
 * Isolation de la procédure dans un script de déploiement.
 *
 * En pratique, on colle le fichier tel qu'il est en gestion de sources :
 *
 *   IF EXISTS (...) DROP PROCEDURE ...
 *   GO
 *   CREATE PROCEDURE ... AS BEGIN ... END
 *   GO
 *   GRANT EXEC ON ... TO ...
 *
 * `GO` n'est pas du T-SQL : c'est un séparateur de lots côté client. Un tel
 * script ne peut donc pas être exécuté d'un bloc, et l'instrumentation ne
 * produisait rien du tout — d'où l'impression que « les variables ne sont pas
 * prises en compte ».
 *
 * On isole donc le lot qui définit la procédure, en remplaçant tous les autres
 * par des lignes vides : les numéros de ligne du fichier d'origine sont
 * conservés, donc les erreurs, breakpoints et décorations restent alignés.
 */

export interface IsolatedBatch {
  sql: string
  /** Vrai si des lots annexes ont été neutralisés. */
  isolated: boolean
  /** Nom de la procédure repérée, pour l'expliquer à l'utilisateur. */
  procedureName: string | null
}

/** Une ligne composée du seul mot GO (éventuellement suivi d'un compteur). */
const GO_LINE = /^\s*GO\s*(?:\d+\s*)?(?:--.*)?$/i

const DEFINITION = /\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROC|PROCEDURE|FUNCTION)\b/i

/** Nom qui suit CREATE/ALTER PROCEDURE, crochets retirés. */
function definitionName(batch: string): string | null {
  const m =
    /\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROC|PROCEDURE|FUNCTION)\s+((?:\[[^\]]+\]|[\w#@$]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w#@$]+))?)/i.exec(
      batch
    )
  return m ? m[1].replace(/[[\]]/g, '').replace(/\s*\.\s*/g, '.') : null
}

export function isolateProcedureBatch(sql: string): IsolatedBatch {
  const lines = sql.split('\n')
  const separators = lines
    .map((l, i) => (GO_LINE.test(l) ? i : -1))
    .filter((i) => i >= 0)

  // Pas de séparateur : rien à isoler, on renvoie le script tel quel.
  if (separators.length === 0) return { sql, isolated: false, procedureName: null }

  // Découpe en lots [début, fin[ en s'appuyant sur les lignes GO.
  const bounds: { start: number; end: number }[] = []
  let start = 0
  for (const sep of separators) {
    bounds.push({ start, end: sep })
    start = sep + 1
  }
  bounds.push({ start, end: lines.length })

  const target = bounds.find((b) => DEFINITION.test(lines.slice(b.start, b.end).join('\n')))
  if (!target) {
    // Aucun lot ne définit de procédure : on neutralise seulement les GO, qui
    // feraient échouer l'exécution en un seul bloc.
    const cleaned = lines.map((l) => (GO_LINE.test(l) ? '' : l))
    return { sql: cleaned.join('\n'), isolated: true, procedureName: null }
  }

  // Ne conserve que le lot de définition ; le reste devient des lignes vides.
  const kept = lines.map((l, i) =>
    i >= target.start && i < target.end && !GO_LINE.test(l) ? l : ''
  )
  const batchText = lines.slice(target.start, target.end).join('\n')
  return {
    sql: kept.join('\n'),
    isolated: true,
    procedureName: definitionName(batchText)
  }
}
