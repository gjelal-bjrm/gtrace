import type { JSX, ReactNode } from 'react'
import { ChevronRight, X } from 'lucide-react'

/**
 * Panneau ancré, sur le modèle des fenêtres outils de SSMS : une barre de
 * titre (surlignée quand le panneau a le focus), une petite barre d'outils
 * optionnelle, puis le contenu. Repliable pour les panneaux secondaires.
 */
export default function DockPanel({
  title,
  className,
  focused = false,
  toolbar,
  badge,
  collapsible = false,
  open = true,
  onToggle,
  onClose,
  closeTip,
  children
}: {
  title: string
  className?: string
  focused?: boolean
  toolbar?: ReactNode
  /** Petit compteur à droite du titre */
  badge?: ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  onClose?: () => void
  closeTip?: string
  children: ReactNode
}): JSX.Element {
  const expanded = !collapsible || open
  return (
    <section
      className={[
        'dock-panel',
        className,
        focused ? 'focused' : '',
        expanded ? 'open' : 'collapsed'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header
        className={`dock-title${collapsible ? ' clickable' : ''}`}
        onClick={collapsible ? onToggle : undefined}
      >
        {collapsible && <ChevronRight size={14} className="dock-chevron" aria-hidden="true" />}
        <span className="dock-title-text">{title}</span>
        {badge}
        <span className="dock-title-actions">
          {onClose && (
            <button
              type="button"
              className="dock-btn"
              data-tip={closeTip ?? 'Masquer'}
              aria-label={closeTip ?? 'Masquer'}
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
      {expanded && toolbar && <div className="dock-toolbar">{toolbar}</div>}
      {expanded && <div className="dock-body">{children}</div>}
    </section>
  )
}
