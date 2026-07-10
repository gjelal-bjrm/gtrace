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

interface ConnectionsState {
  connections: OpenConnection[]
  add: (conn: OpenConnection) => void
  remove: (id: string) => void
  get: (id: string | null) => OpenConnection | null
  /** Remplace la liste (restauration de l'espace de travail au lancement). */
  setAll: (connections: OpenConnection[]) => void
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  add: (conn) => set((s) => ({ connections: [...s.connections, conn] })),
  remove: (id) => set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),
  get: (id) => (id ? (get().connections.find((c) => c.id === id) ?? null) : null),
  setAll: (connections) => set({ connections })
}))
