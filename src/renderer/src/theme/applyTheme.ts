import { findTheme, type ThemeDef } from './themes'

/** Réglages d'apparence persistés (thème + confort de lecture). */
export interface Appearance {
  themeId: string
  /** Taille de police de l'interface, en px (12–17). */
  fontSize: number
  /** Taille de police de l'éditeur SQL, en px (11–20). */
  editorFontSize: number
  /** Densité des tableaux et listes. */
  density: 'compact' | 'confortable'
}

export const DEFAULT_APPEARANCE: Appearance = {
  themeId: 'azur',
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

  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(`--${key}`, value)
  }
  // Ascenseurs et contrôles natifs suivent le thème.
  root.style.setProperty('color-scheme', theme.base)
  root.dataset.themeBase = theme.base

  root.style.setProperty('--ui-font-size', `${a.fontSize}px`)
  root.style.setProperty('--row-pad', a.density === 'compact' ? '2px' : '5px')

  return theme
}
