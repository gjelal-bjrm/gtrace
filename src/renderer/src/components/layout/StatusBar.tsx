import { useEffect, useState, type JSX } from 'react'
import type { DebugRunResult } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'
import { statusColor } from '../../lib/connectionColors'

/**
 * Barre d'état en bas de fenêtre, sur le modèle de celle des requêtes SSMS :
 * à gauche l'état de l'exécution avec une icône, à droite serveur (version),
 * utilisateur, base, durée (chronomètre pendant l'exécution), nombre de
 * lignes, puis la position du curseur. Elle prend la couleur choisie pour la
 * connexion, pour savoir d'un coup d'œil sur quel serveur on travaille.
 */

/** « Microsoft SQL Server 2022 (RTM-CU12) - 16.0.4135.4 (X64) » → « 16.0 RTM-CU12 ». */
export function shortVersion(version: string): string {
  const num = /(\d+\.\d+)\.\d+/.exec(version)?.[1]
  const level = /\((RTM[^)]*|SP\d[^)]*)\)/.exec(version)?.[1]
  return [num, level].filter(Boolean).join(' ')
}

/** Durée au format SSMS « 00:00:03 ». */
function hms(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`
}

export default function StatusBar({
  connection,
  database,
  run,
  running,
  paused,
  failed,
  cancelled,
  startedAt,
  finishedAt,
  selectionLines,
  cursor
}: {
  connection: OpenConnection | null
  database: string | null
  run: DebugRunResult | null
  /** Exécution (ou session de débogage) en cours */
  running: boolean
  /** Ligne de la pause en cours (session avec points d'arrêt), sinon null */
  paused: number | null
  /** Échec avant tout résultat (syntaxe, connexion…) */
  failed: boolean
  /** Exécution arrêtée par l'utilisateur */
  cancelled: boolean
  startedAt: Date | null
  finishedAt: Date | null
  selectionLines: number
  cursor: { line: number; column: number } | null
}): JSX.Element {
  // Chronomètre : rafraîchi chaque seconde tant que l'exécution tourne.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const rows = run ? run.resultsets.reduce((n, rs) => n + rs.rows.length, 0) : null
  const elapsed = startedAt
    ? (running ? now : (finishedAt?.getTime() ?? now)) - startedAt.getTime()
    : null

  let icon = '🔌'
  let state = 'Connecté.'
  let stateClass = 'idle'
  if (paused !== null) {
    icon = '⏸'
    state = `En pause avant la ligne ${paused}.`
    stateClass = 'busy'
  } else if (running) {
    icon = '⏳'
    state = 'Exécution de la requête en cours…'
    stateClass = 'busy'
  } else if (cancelled) {
    icon = '✖'
    state = 'Requête annulée.'
    stateClass = 'err'
  } else if (failed || (run && run.errors.length > 0)) {
    icon = '⚠'
    state = 'Requête terminée avec des erreurs.'
    stateClass = 'err'
  } else if (run) {
    icon = '✔'
    state = 'Exécution de requête réussie.'
    stateClass = 'ok'
  } else if (!connection) {
    icon = '⛔'
    state = 'Déconnecté.'
  }

  const color = statusColor(connection)

  return (
    <footer
      className={`status-bar${color ? ' colored' : ''}`}
      style={color ? { background: color } : undefined}
    >
      <span className={`status-state ${stateClass}`}>
        <span className="status-icon">{icon}</span> {state}
      </span>

      <span className="status-spacer" />

      {selectionLines > 0 && (
        <span className="status-item accent" title="« Exécuter » ne lancera que la sélection">
          sélection : {selectionLines} ligne(s)
        </span>
      )}
      {connection && (
        <>
          {connection.production && (
            <span className="status-item prod" title="Connexion marquée « production »">
              ⚠ PROD
            </span>
          )}
          <span className="status-item" title={connection.version}>
            {connection.server}
            {shortVersion(connection.version) && ` (${shortVersion(connection.version)})`}
          </span>
          <span className="status-item" title="Compte de connexion">
            {connection.user}
          </span>
          <span className="status-item" title="Base de données de l'onglet actif">
            {database ?? connection.defaultDatabase}
          </span>
        </>
      )}
      <span className="status-item mono" title="Durée de la dernière exécution">
        {elapsed !== null ? hms(elapsed) : '00:00:00'}
      </span>
      <span className="status-item">{rows ?? 0} ligne{(rows ?? 0) > 1 ? 's' : ''}</span>
      {cursor && (
        <span className="status-item mono status-cursor" title="Ligne et colonne du curseur">
          Ln {cursor.line}  Col {cursor.column}
        </span>
      )}
    </footer>
  )
}
