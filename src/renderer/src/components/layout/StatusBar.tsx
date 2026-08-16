import type { JSX } from 'react'
import type { DebugRunResult } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'

/**
 * Barre d'état en bas de fenêtre, sur le modèle de SSMS : on y voit en
 * permanence à quoi on est connecté, sur quelle base, et le résultat de la
 * dernière exécution (durée, lignes). Sert de repère constant : plus besoin
 * d'aller chercher l'information dans les panneaux.
 */
export default function StatusBar({
  connection,
  database,
  run,
  busy,
  sessionStatus,
  selectionLines
}: {
  connection: OpenConnection | null
  database: string | null
  run: DebugRunResult | null
  busy: boolean
  sessionStatus: string | null
  selectionLines: number
}): JSX.Element {
  const rows = run ? run.resultsets.reduce((n, rs) => n + rs.rows.length, 0) : null
  // Durée totale = somme des durées de steps (DebugRunResult n'expose pas de total).
  const elapsed = run ? run.steps.reduce((ms, s) => ms + (s.durationMs ?? 0), 0) : null

  let state = 'Prêt'
  let stateClass = 'ok'
  if (busy) {
    state = 'Exécution…'
    stateClass = 'busy'
  } else if (sessionStatus === 'paused') {
    state = 'En pause'
    stateClass = 'busy'
  } else if (run && run.errors.length > 0) {
    state = 'Erreur'
    stateClass = 'err'
  }

  return (
    <footer className="status-bar">
      <span className={`status-state ${stateClass}`}>{state}</span>

      {connection ? (
        <>
          <span className="status-item" title="Serveur connecté">
            🖥 {connection.server}
          </span>
          <span className="status-item" title="Base de données de l'onglet actif">
            🗄 {database ?? connection.defaultDatabase}
          </span>
          <span className="status-item" title="Compte de connexion">
            👤 {connection.user}
          </span>
          {connection.production && (
            <span className="status-item prod" title="Connexion marquée « production »">
              ⚠ PROD
            </span>
          )}
        </>
      ) : (
        <span className="status-item dimmed">Non connecté — cliquez « Connecter »</span>
      )}

      <span className="status-spacer" />

      {selectionLines > 0 && (
        <span className="status-item accent" title="« Exécuter » ne lancera que la sélection">
          ✂ sélection : {selectionLines} ligne(s)
        </span>
      )}
      {rows !== null && <span className="status-item">{rows} ligne(s)</span>}
      {elapsed !== null && <span className="status-item">{elapsed} ms</span>}
    </footer>
  )
}
