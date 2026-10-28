import type { JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Panneau encore vide : une icône, un titre et une phrase qui dit quoi faire,
 * plutôt qu'un texte brut perdu en haut du panneau.
 */
export default function EmptyState({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}
