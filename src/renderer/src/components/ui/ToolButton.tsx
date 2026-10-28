import type { JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Bouton de barre d'outils, au gabarit des barres de SSMS : une icône de 16 px,
 * un libellé seulement pour les commandes principales (« Nouvelle requête »,
 * « Exécuter »), et une info-bulle qui rappelle le raccourci.
 *
 * Un bouton indisponible reste survolable (aria-disabled plutôt que disabled) :
 * son info-bulle explique ce qu'il fait même quand on ne peut pas s'en servir.
 */
export function ToolButton({
  icon: Icon,
  label,
  showLabel = false,
  tip,
  shortcut,
  onClick,
  disabled = false,
  active = false,
  variant,
  iconFill = false,
  children
}: {
  icon: LucideIcon
  label: string
  showLabel?: boolean
  /** Texte de l'info-bulle (par défaut : le libellé) */
  tip?: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  /** Bouton bascule enfoncé (ex. volet de résultats affiché) */
  active?: boolean
  /** « run » : vert d'exécution ; « danger » : rouge d'arrêt */
  variant?: 'run' | 'danger'
  /** Icône pleine (ex. le carré d'arrêt) */
  iconFill?: boolean
  children?: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className={[
        'tool-btn',
        showLabel ? 'with-label' : '',
        variant ?? '',
        active ? 'active' : '',
        disabled ? 'is-disabled' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-pressed={active || undefined}
      data-tip={tip ?? label}
      data-shortcut={shortcut}
      onClick={disabled ? undefined : onClick}
    >
      <Icon
        size={16}
        strokeWidth={1.8}
        fill={iconFill ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      {showLabel && <span className="tool-label">{label}</span>}
      {children}
    </button>
  )
}

/** Trait vertical entre deux groupes de boutons. */
export function ToolSeparator(): JSX.Element {
  return <span className="tool-sep" aria-hidden="true" />
}
