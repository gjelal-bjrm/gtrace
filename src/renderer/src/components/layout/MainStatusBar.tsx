import type { JSX } from 'react'
import { useCursorStore } from '../../stores/cursorStore'

/**
 * Barre d'état générale, tout en bas de la fenêtre, comme celle de SSMS :
 * « Prêt » à gauche, position du curseur à droite (Ln / Col), puis l'état du
 * moteur d'analyse et la version de GTrace.
 */
export default function MainStatusBar({
  busy,
  selectionLines,
  engineRunning,
  engineVersion,
  appVersion,
  onVersionClick
}: {
  busy: boolean
  selectionLines: number
  engineRunning: boolean
  engineVersion: string | null
  appVersion: string
  onVersionClick: () => void
}): JSX.Element {
  const cursor = useCursorStore((s) => s.cursor)
  return (
    <footer className="main-status">
      <span className="ms-ready">{busy ? 'Exécution en cours…' : 'Prêt'}</span>
      <span className="ms-spacer" />
      {cursor && (
        <span className="ms-item" data-tip="Ligne et colonne du curseur">
          Ln {cursor.line}
          <span className="ms-gap" />
          Col {cursor.column}
        </span>
      )}
      {selectionLines > 0 && (
        <span className="ms-item" data-tip="« Exécuter » ne lancera que la sélection">
          Sél. {selectionLines} ligne{selectionLines > 1 ? 's' : ''}
        </span>
      )}
      <span
        className={`ms-item ms-engine${engineRunning ? '' : ' off'}`}
        data-tip={
          engineRunning
            ? `Moteur d'analyse T-SQL actif (ScriptDom ${engineVersion ?? ''})`
            : "Moteur d'analyse T-SQL inactif : l'analyse et l'exécution sont impossibles"
        }
      >
        <i aria-hidden="true" />
        {engineRunning ? 'Moteur prêt' : 'Moteur inactif'}
      </span>
      <button
        type="button"
        className="ms-item ms-version"
        data-tip="Voir les nouveautés"
        onClick={onVersionClick}
      >
        GTrace {appVersion || '…'}
      </button>
    </footer>
  )
}
