import type { JSX } from 'react'
import { X, type LucideIcon } from 'lucide-react'

/** En-tête commun des dialogues : icône, titre, bouton Fermer (Échap). */
export default function ModalHeader({
  icon: Icon,
  title,
  onClose
}: {
  icon?: LucideIcon
  title: string
  onClose?: () => void
}): JSX.Element {
  return (
    <div className="modal-header">
      <span className="modal-title">
        {Icon && <Icon size={17} strokeWidth={1.8} aria-hidden="true" />}
        {title}
      </span>
      {onClose && (
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Fermer"
          data-tip="Fermer"
          data-shortcut="Échap"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
