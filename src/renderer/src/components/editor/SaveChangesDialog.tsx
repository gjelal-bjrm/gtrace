import { useEffect, useRef } from 'react'
import { useEscapeClose } from '../../lib/useEscapeClose'

export type SaveChoice = 'yes' | 'no' | 'cancel'

/**
 * « Voulez-vous enregistrer les modifications apportées aux éléments
 * suivants ? » — Oui / Non / Annuler, comme SSMS à la fermeture d'onglets
 * modifiés. Oui est le bouton par défaut (Entrée), Échap vaut Annuler.
 */
export default function SaveChangesDialog({
  titles,
  onChoice
}: {
  titles: string[]
  onChoice: (choice: SaveChoice) => void
}): JSX.Element {
  useEscapeClose(() => onChoice('cancel'))
  const yesRef = useRef<HTMLButtonElement>(null)
  useEffect(() => yesRef.current?.focus(), [])

  return (
    <div className="modal-overlay">
      <div className="modal save-changes-dialog">
        <div className="modal-header">
          <h2>GTrace</h2>
        </div>
        <div className="modal-body">
          <p>Voulez-vous enregistrer les modifications apportées aux éléments suivants ?</p>
          <ul className="save-changes-list">
            {titles.map((t, i) => (
              <li key={i}>{t}*</li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button className="btn btn-primary" ref={yesRef} onClick={() => onChoice('yes')}>
              Oui
            </button>
            <button className="btn" onClick={() => onChoice('no')}>
              Non
            </button>
            <button className="btn" onClick={() => onChoice('cancel')}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
