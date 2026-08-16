import { create } from 'zustand'

/**
 * Variables « suivies » : celles que l'utilisateur marque d'une couleur pour ne
 * pas les perdre de vue en naviguant d'une étape à l'autre.
 *
 * Le marquage sert à deux endroits : la liste des variables (remontée en tête,
 * pastille colorée) et la chronologie, où les étapes qui modifient une variable
 * suivie portent un repère de la même couleur. Répond à « où cette valeur
 * change-t-elle ? » sans lire les 79 étapes une par une.
 */

/** Teintes vives, distinctes du dégradé de durée de la chronologie. */
export const WATCH_COLORS = [
  '#e0555f',
  '#4aa3e0',
  '#5fce7c',
  '#c07ae0',
  '#e0a23c',
  '#3fc9c1'
]

const KEY = 'gtrace.watchedVars'

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

interface WatchState {
  /** nom de variable (minuscules) → index dans WATCH_COLORS */
  marked: Record<string, number>
  /** Couleur d'une variable, ou null si non suivie. */
  colorOf: (name: string) => string | null
  /** Marque, change de couleur, puis retire au tour suivant. */
  cycle: (name: string) => void
  clearAll: () => void
}

function persist(marked: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(marked))
  } catch {
    /* persistance best-effort */
  }
}

export const useWatchStore = create<WatchState>((set, get) => ({
  marked: load(),

  colorOf: (name) => {
    const idx = get().marked[name.toLowerCase()]
    return idx === undefined ? null : WATCH_COLORS[idx % WATCH_COLORS.length]
  },

  cycle: (name) => {
    const key = name.toLowerCase()
    const marked = { ...get().marked }
    const cur = marked[key]
    if (cur === undefined) {
      // Première couleur libre, pour que deux variables suivies se distinguent.
      const used = new Set(Object.values(marked))
      let next = 0
      while (used.has(next) && next < WATCH_COLORS.length) next++
      marked[key] = next % WATCH_COLORS.length
    } else if (cur + 1 < WATCH_COLORS.length) {
      marked[key] = cur + 1
    } else {
      delete marked[key]
    }
    persist(marked)
    set({ marked })
  },

  clearAll: () => {
    persist({})
    set({ marked: {} })
  }
}))
