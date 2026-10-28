import { useEffect, useState, type JSX } from 'react'
import {
  CircleCheck,
  CirclePause,
  CircleX,
  LoaderCircle,
  Plug,
  TriangleAlert,
  Unplug,
  type LucideIcon
} from 'lucide-react'
import type { DebugRunResult } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'
import { statusColor } from '../../lib/connectionColors'

/**
 * Barre d'état de la requête, sous les résultats, comme la barre jaune de
 * SSMS : à gauche l'état de l'exécution, à droite serveur (version),
 * utilisateur, base, durée (chronomètre pendant l'exécution) et nombre de
 * lignes. Elle prend la couleur choisie pour la connexion, pour savoir d'un
 * coup d'œil sur quel serveur on travaille.
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

export default function QueryStatusBar({
  connection,
  database,
  run,
  running,
  paused,
  failed,
  cancelled,
  startedAt,
  finishedAt
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
}): JSX.Element {
  // Chronomètre : rafraîchi chaque seconde tant que l'exécution tourne.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const rows = run ? run.resultsets.reduce((n, rs) => n + rs.rows.length, 0) : 0
  const elapsed = startedAt
    ? (running ? now : (finishedAt?.getTime() ?? now)) - startedAt.getTime()
    : null

  let Icon: LucideIcon = Plug
  let state = 'Connecté.'
  let tone = 'idle'
  if (paused !== null) {
    Icon = CirclePause
    state = `En pause avant la ligne ${paused}.`
    tone = 'busy'
  } else if (running) {
    Icon = LoaderCircle
    state = 'Exécution de la requête en cours…'
    tone = 'busy'
  } else if (cancelled) {
    Icon = CircleX
    state = 'Requête annulée.'
    tone = 'err'
  } else if (failed || (run && run.errors.length > 0)) {
    Icon = TriangleAlert
    state = 'Requête terminée avec des erreurs.'
    tone = 'err'
  } else if (run) {
    Icon = CircleCheck
    state = 'Exécution de requête réussie.'
    tone = 'ok'
  } else if (!connection) {
    Icon = Unplug
    state = 'Déconnecté.'
  }

  const color = statusColor(connection)
  const version = connection ? shortVersion(connection.version) : ''

  return (
    <footer
      className={`query-status${color ? ' colored' : ''}`}
      style={color ? { background: color } : undefined}
    >
      <span className={`qs-state ${tone}`}>
        <Icon size={14} className={running && paused === null ? 'spin' : ''} aria-hidden="true" />
        {state}
      </span>
      <span className="qs-spacer" />
      {connection && (
        <>
          {connection.production && (
            <span className="qs-item prod" data-tip="Connexion marquée « production »">
              PRODUCTION
            </span>
          )}
          <span className="qs-item" data-tip={connection.version}>
            {connection.server}
            {version && ` (${version})`}
          </span>
          <span className="qs-item" data-tip="Compte de connexion">
            {connection.user}
          </span>
          <span className="qs-item" data-tip="Base de données de l'onglet">
            {database ?? connection.defaultDatabase}
          </span>
        </>
      )}
      <span className="qs-item mono" data-tip="Durée de la dernière exécution">
        {elapsed !== null ? hms(elapsed) : '00:00:00'}
      </span>
      <span className="qs-item" data-tip="Lignes renvoyées par la dernière exécution">
        {rows} ligne{rows > 1 ? 's' : ''}
      </span>
    </footer>
  )
}
