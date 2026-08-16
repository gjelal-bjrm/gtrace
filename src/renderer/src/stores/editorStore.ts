import { create } from 'zustand'

/**
 * Un onglet = un document éditable. Le contenu, l'identité fichier et le
 * contexte d'édition (niveau de compat, valeurs de paramètres, breakpoints,
 * tables à snapshotter) vivent ici, par onglet. L'état d'exécution dérivé
 * (analyse, replay, profil) reste dans App et se réinitialise au changement
 * d'onglet — même invariant que « éditer le SQL invalide l'analyse ».
 */
export interface EditorTab {
  id: string
  title: string
  /** Chemin sur disque, ou null pour un onglet non enregistré / virtuel (proc, historique) */
  filePath: string | null
  content: string
  /** Contenu différent du disque (modifications non enregistrées) */
  dirty: boolean
  /** Connexion ouverte à laquelle cet onglet est lié (null = aucune) */
  connectionId: string | null
  /** Base cible d'exécution de cet onglet (null = base par défaut de la connexion) */
  database: string | null
  compatLevel: number
  paramValues: Record<string, string | null>
  /** Lignes portant un breakpoint (le Set est reconstruit côté App) */
  breakpoints: number[]
  snapshotTargets: string
  /** Mode lecture seule strict (garde de sécurité, par onglet) */
  readOnly: boolean
  /** Liste blanche du mode lecture seule (tables/procs autorisées en écriture) */
  roWhitelist: string
}

let untitledCounter = 0
function nextUntitled(): string {
  untitledCounter += 1
  return `sans titre ${untitledCounter}`
}

function makeTab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    id: crypto.randomUUID(),
    title: over.title ?? nextUntitled(),
    filePath: over.filePath ?? null,
    content: over.content ?? '',
    dirty: over.dirty ?? false,
    connectionId: over.connectionId ?? null,
    database: over.database ?? null,
    compatLevel: over.compatLevel ?? 160,
    paramValues: over.paramValues ?? {},
    breakpoints: over.breakpoints ?? [],
    snapshotTargets: over.snapshotTargets ?? '',
    readOnly: over.readOnly ?? false,
    roWhitelist: over.roWhitelist ?? ''
  }
}

interface EditorState {
  tabs: EditorTab[]
  activeId: string
  /** Onglet actif (jamais undefined : au moins un onglet existe toujours). */
  active: () => EditorTab
  newTab: () => void
  /** Ouvre un fichier ; réutilise l'onglet actif s'il est vierge, dédoublonne par chemin. */
  openFile: (filePath: string, name: string, content: string) => void
  /** Onglet non-fichier (procédure chargée, script généré, session d'historique). */
  openVirtual: (
    title: string,
    content: string,
    database?: string | null,
    connectionId?: string | null
  ) => void
  /** Détache les onglets d'une connexion fermée. */
  detachConnection: (connectionId: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  /** Édition du contenu (marque l'onglet modifié). */
  editContent: (content: string) => void
  /** Met à jour le contexte d'édition de l'onglet actif (ne touche pas dirty). */
  patchActive: (patch: Partial<EditorTab>) => void
  markSaved: (id: string, filePath: string, name: string) => void
  /** Remplace tous les onglets (restauration de l'espace de travail au lancement). */
  restore: (tabs: EditorTab[], activeId: string | null) => void
}

// Au premier lancement : un onglet vierge « sans titre 1 », jamais de script
// de démonstration (l'espace de travail enregistré prend le relais ensuite).
const first = makeTab()

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [first],
  activeId: first.id,
  active: () => {
    const s = get()
    return s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0]
  },
  newTab: () => {
    const t = makeTab()
    set((s) => ({ tabs: [...s.tabs, t], activeId: t.id }))
  },
  openFile: (filePath, name, content) => {
    set((s) => {
      const existing = s.tabs.find((t) => t.filePath === filePath)
      if (existing) return { activeId: existing.id }
      const act = s.tabs.find((t) => t.id === s.activeId)
      // Réutilise l'onglet actif s'il est vierge et non modifié.
      if (act && !act.dirty && act.filePath === null && act.content.trim() === '') {
        const replaced = { ...act, title: name, filePath, content, dirty: false }
        return { tabs: s.tabs.map((t) => (t.id === act.id ? replaced : t)), activeId: act.id }
      }
      const t = makeTab({ title: name, filePath, content })
      return { tabs: [...s.tabs, t], activeId: t.id }
    })
  },
  openVirtual: (title, content, database, connectionId) => {
    const t = makeTab({
      title,
      content,
      database: database ?? null,
      connectionId: connectionId ?? null
    })
    set((s) => ({ tabs: [...s.tabs, t], activeId: t.id }))
  },
  detachConnection: (connectionId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.connectionId === connectionId ? { ...t, connectionId: null, database: null } : t
      )
    })),
  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return s
      const tabs = s.tabs.filter((t) => t.id !== id)
      if (tabs.length === 0) {
        const t = makeTab()
        return { tabs: [t], activeId: t.id }
      }
      let activeId = s.activeId
      if (id === s.activeId) activeId = tabs[Math.min(idx, tabs.length - 1)].id
      return { tabs, activeId }
    })
  },
  setActive: (id) => set({ activeId: id }),
  editContent: (content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, content, dirty: true } : t))
    })),
  patchActive: (patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, ...patch } : t))
    })),
  markSaved: (id, filePath, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, filePath, title: name, dirty: false } : t))
    })),
  restore: (tabs, activeId) => {
    if (tabs.length === 0) return
    const active = activeId && tabs.some((t) => t.id === activeId) ? activeId : tabs[0].id
    set({ tabs, activeId: active })
  }
}))
