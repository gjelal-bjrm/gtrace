import { findTheme, THEMES, type ThemeDef } from './themes'

/** Réglages d'apparence persistés (thème + confort de lecture). */
export interface Appearance {
  themeId: string
  /** Taille de police de l'interface, en px (12–17). */
  fontSize: number
  /** Taille de police de l'éditeur SQL, en px (11–20). */
  editorFontSize: number
  /** Densité des tableaux et listes. */
  density: 'compact' | 'confortable'
  /**
   * Génération du thème par défaut : quand le défaut change (Azur → Sauge),
   * une préférence restée sur l'ancien défaut est basculée une seule fois.
   */
  themeVersion?: number
}

/** Génération actuelle du thème par défaut (2 = Sauge et sable). */
export const THEME_VERSION = 2

export const DEFAULT_APPEARANCE: Appearance = {
  themeId: 'sauge',
  themeVersion: THEME_VERSION,
  fontSize: 13,
  editorFontSize: 13,
  density: 'confortable'
}

/**
 * Applique le thème et les réglages de confort sur `:root` (variables CSS).
 * Les composants ne connaissent que les variables : rien d'autre à toucher.
 */
export function applyAppearance(a: Appearance): ThemeDef {
  const theme = findTheme(a.themeId)
  const root = document.documentElement

  // Repart d'une page blanche : une couleur propre à l'ancien thème (ex.
  // icônes de Sauge) ne doit pas survivre au changement de thème.
  for (const key of new Set(THEMES.flatMap((t) => Object.keys(t.vars)))) {
    root.style.removeProperty(`--${key}`)
  }
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${key}`, value)
  }
  root.dataset.shell = theme.shell ?? 'classic'
  // Ascenseurs et contrôles natifs suivent le thème.
  root.style.setProperty('color-scheme', theme.base)
  root.dataset.themeBase = theme.base

  root.style.setProperty('--ui-font-size', `${a.fontSize}px`)
  root.style.setProperty('--row-pad', a.density === 'compact' ? '2px' : '5px')

  return theme
}
