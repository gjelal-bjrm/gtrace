import type { JSX } from 'react'
import type { Crumb } from '../../lib/executionPath'

/**
 * Fil d'Ariane de la ligne courante : « WHILE › IF › ELSE › IF ».
 *
 * Sur une procédure de plusieurs centaines de lignes, savoir dans quelles
 * imbrications on se trouve évite de remonter le code à la main. Une seule
 * ligne fine, qui disparaît quand elle n'a rien à dire.
 */
export default function Breadcrumb({
  crumbs,
  onJump
}: {
  crumbs: Crumb[]
  onJump: (line: number) => void
}): JSX.Element | null {
  if (crumbs.length === 0) return null
  return (
    <div className="breadcrumb" title="Imbrications autour de la ligne courante — cliquez pour y aller">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${c.line}`} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          <button className="breadcrumb-btn" onClick={() => onJump(c.line)}>
            {c.label}
            <span className="breadcrumb-line">{c.line}</span>
          </button>
        </span>
      ))}
    </div>
  )
}
