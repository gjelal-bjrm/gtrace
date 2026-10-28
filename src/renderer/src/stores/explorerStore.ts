import { create } from 'zustand'

/**
 * Élément sélectionné dans l'explorateur d'objets, et zone qui a le focus.
 *
 * Comme dans SSMS, une nouvelle requête (Ctrl+N) hérite du contexte : si
 * l'explorateur a le focus, elle se connecte au serveur et à la base de
 * l'élément sélectionné ; sinon elle reprend la connexion et la base de
 * l'onglet actif.
 */
export interface ExplorerSelection {
  /** Clé du nœud (sert à le surligner) */
  key: string
  connectionId: string
  /** Base de l'élément, ou null pour le nœud serveur (base par défaut). */
  database: string | null
}

interface ExplorerState {
  selection: ExplorerSelection | null
  /** Dernière zone cliquée ou ayant reçu le clavier. */
  focusArea: 'explorer' | 'editor'
  select: (selection: ExplorerSelection) => void
  setFocusArea: (area: 'explorer' | 'editor') => void
  /** Oublie la sélection d'une connexion fermée. */
  forget: (connectionId: string) => void
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  selection: null,
  focusArea: 'editor',
  select: (selection) => set({ selection }),
  setFocusArea: (focusArea) => set({ focusArea }),
  forget: (connectionId) =>
    set((s) => (s.selection?.connectionId === connectionId ? { selection: null } : s))
}))
