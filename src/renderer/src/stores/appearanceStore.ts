import { create } from 'zustand'
import { applyAppearance, DEFAULT_APPEARANCE, type Appearance } from '../theme/applyTheme'

const KEY = 'gtrace.appearance'

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_APPEARANCE
    // Fusion avec les valeurs par défaut : un réglage ajouté plus tard ne casse
    // pas une configuration enregistrée avant son existence.
    return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

interface AppearanceState {
  appearance: Appearance
  /** Applique le thème au démarrage (appelé une fois par App). */
  init: () => void
  update: (patch: Partial<Appearance>) => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: load(),

  init: () => {
    applyAppearance(get().appearance)
  },

  update: (patch) => {
    const next = { ...get().appearance, ...patch }
    applyAppearance(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* persistance best-effort */
    }
    set({ appearance: next })
  }
}))
