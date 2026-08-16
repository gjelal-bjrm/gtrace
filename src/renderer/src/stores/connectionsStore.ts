import { create } from 'zustand'
import type { ConnectionRef } from '@shared/types'

/**
 * Connexions ouvertes (instances SQL Server), comme l'explorateur d'objets de
 * SSMS : on peut se connecter à plusieurs moteurs en parallèle, chaque serveur
 * est une racine de l'arbre, et chaque onglet d'édition est lié à l'une d'elles.
 */
export interface OpenConnection {
  /** Id local (session UI) — les onglets s'y réfèrent */
  id: string
  /** Référence résolue côté main ({id sauvegardé} ou {config inline}) */
  ref: ConnectionRef
  /** Libellé d'affichage, ex. « localhost,14333 (sa) » ou le nom sauvegardé */
  label: string
  server: string
  user: string
  /** Première ligne de @@VERSION, ex. « Microsoft SQL Server 2022 … » */
  version: string
  production: boolean
  /** Base par défaut de la connexion (Initial Catalog) */
  defaultDatabase: string
}

/**
 * Deux connexions ouvertes désignent-elles la même cible ? Sert à ne jamais
 * ouvrir deux fois le même serveur/base : sinon l'explorateur affiche des
 * racines identiques et on ne sait plus laquelle porte quel onglet.
 *
 * Comparaison par connexion enregistrée quand il y en a une, sinon par
 * serveur + utilisateur + base (insensible à la casse).
 */
export function sameTarget(a: OpenConnection, b: OpenConnection): boolean {
  const aSaved = 'id' in a.ref ? a.ref.id : null
  const bSaved = 'id' in b.ref ? b.ref.id : null
  if (aSaved !== null || bSaved !== null) {
    if (aSaved !== bSaved) return false
    // Même connexion enregistrée : la surcharge de base doit aussi coïncider.
    return (a.ref.database ?? '').toLowerCase() === (b.ref.database ?? '').toLowerCase()
  }
  const norm = (s: string): string => s.trim().toLowerCase()
  return (
    norm(a.server) === norm(b.server) &&
    norm(a.user) === norm(b.user) &&
    norm(a.defaultDatabase) === norm(b.defaultDatabase)
  )
}

interface ConnectionsState {
  connections: OpenConnection[]
  add: (conn: OpenConnection) => void
  remove: (id: string) => void
  get: (id: string | null) => OpenConnection | null
  /** Connexion ouverte visant la même cible, ou null. */
  findSame: (conn: OpenConnection) => OpenConnection | null
  /** Remplace la liste (restauration de l'espace de travail au lancement). */
  setAll: (connections: OpenConnection[]) => void
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  add: (conn) => set((s) => ({ connections: [...s.connections, conn] })),
  remove: (id) => set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),
  get: (id) => (id ? (get().connections.find((c) => c.id === id) ?? null) : null),
  findSame: (conn) => get().connections.find((c) => sameTarget(c, conn)) ?? null,
  // Restauration de l'espace de travail : on écarte les doublons éventuels
  // d'un fichier hérité, pour ne pas ressusciter des racines identiques.
  setAll: (connections) =>
    set({
      connections: connections.filter(
        (c, i) => connections.findIndex((o) => sameTarget(o, c)) === i
      )
    })
}))
