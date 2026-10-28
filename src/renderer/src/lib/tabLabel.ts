import type { EditorTab } from '../stores/editorStore'
import type { OpenConnection } from '../stores/connectionsStore'

/**
 * Libellés d'un onglet, sur le modèle de SSMS : « fichier - serveur.base ».
 *
 * - `target` : « serveur.base » (ou « non connecté »), affiché dans l'onglet,
 *   tronqué au milieu pour garder lisibles le début du serveur et la base ;
 * - `full` : le nom complet avec l'utilisateur, pour l'info-bulle et le titre
 *   de la fenêtre.
 */
export interface TabLabel {
  target: string
  full: string
}

const TARGET_MAX = 30

/** Coupe au milieu avec « … » : le début et la fin restent lisibles. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep * 0.4)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

export function tabLabel(tab: EditorTab, conn: OpenConnection | null): TabLabel {
  if (!conn) {
    return { target: 'non connecté', full: `${tab.title} - non connecté` }
  }
  const where = `${conn.server}.${tab.database ?? conn.defaultDatabase}`
  return {
    target: middleTruncate(where, TARGET_MAX),
    full: `${tab.title} - ${where} (${conn.user})`
  }
}
