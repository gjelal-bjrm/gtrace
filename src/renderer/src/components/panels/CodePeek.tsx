import type { JSX } from 'react'

/**
 * Aperçu du code autour de la ligne courante.
 *
 * En mode « Agrandir », l'éditeur est masqué : en cliquant les cases de la
 * chronologie on voyait les variables changer sans savoir *où* on se trouvait
 * dans la procédure. Cet extrait rétablit le repère sans rendre la place à
 * l'éditeur complet.
 */
export default function CodePeek({
  sql,
  line,
  context = 2
}: {
  sql: string
  /** Ligne courante, 1-based (0 ou moins = rien à montrer). */
  line: number
  context?: number
}): JSX.Element | null {
  if (!sql || line <= 0) return null
  const lines = sql.split('\n')
  const from = Math.max(1, line - context)
  const to = Math.min(lines.length, line + context)

  return (
    <div className="code-peek" title="Code autour de l'étape courante">
      {Array.from({ length: to - from + 1 }, (_, i) => {
        const n = from + i
        return (
          <div key={n} className={`peek-line${n === line ? ' peek-current' : ''}`}>
            <span className="peek-num">{n}</span>
            <span className="peek-text">{lines[n - 1] ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}
