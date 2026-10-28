import type { OpenConnection } from '../stores/connectionsStore'

/**
 * Couleurs proposées pour la barre d'état d'une connexion, comme l'option
 * « Utiliser une couleur personnalisée » de SSMS : repérer d'un coup d'œil
 * sur quel serveur on travaille (la production en rouge, par exemple).
 * Teintes moyennes : le texte blanc y reste lisible en thème clair et sombre.
 */
export const CONNECTION_COLORS: { value: string; label: string }[] = [
  { value: '#c0392b', label: 'Rouge' },
  { value: '#d35400', label: 'Orange' },
  { value: '#b7950b', label: 'Jaune' },
  { value: '#2e8b57', label: 'Vert' },
  { value: '#2f6fb5', label: 'Bleu' },
  { value: '#7d4cb5', label: 'Violet' },
  { value: '#5f6b7a', label: 'Gris' }
]

/** Couleur effective : celle choisie, sinon rouge pour une connexion « production ». */
export function statusColor(conn: OpenConnection | null): string | null {
  if (!conn) return null
  return conn.color ?? (conn.production ? CONNECTION_COLORS[0].value : null)
}
