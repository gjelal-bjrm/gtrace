/**
 * Thèmes complets : chaque palette redéfinit l'ensemble des variables CSS
 * (fonds, textes, bordures, statuts). Aucun composant n'est modifié : tout
 * passe par les variables déclarées dans `styles.css`.
 *
 * `base` pilote aussi le thème Monaco (clair/sombre) et `color-scheme`
 * (ascenseurs et contrôles natifs).
 */
export interface ThemeDef {
  id: string
  label: string
  tagline: string
  base: 'dark' | 'light'
  /** Variables CSS surchargées (clés sans « -- »). */
  vars: Record<string, string>
}

export const THEMES: ThemeDef[] = [
  {
    id: 'azur',
    label: 'Azur clair',
    tagline: 'Fond clair, accents bleus — le classique des éditeurs SQL',
    base: 'light',
    vars: {
      bg: '#f3f3f3',
      'bg-panel': '#eceff3',
      'bg-input': '#ffffff',
      'bg-hover': 'rgba(0, 90, 158, 0.08)',
      border: '#d0d5db',
      'border-strong': '#adb4bd',
      text: '#1e1e1e',
      'text-dim': '#5f6b78',
      accent: '#005a9e',
      'accent-dim': 'rgba(0, 90, 158, 0.12)',
      run: '#107c10',
      'run-dim': 'rgba(16, 124, 16, 0.14)',
      error: '#c42b1c',
      'error-dim': 'rgba(196, 43, 28, 0.12)',
      ok: '#107c10',
      overlay: 'rgba(0, 0, 0, 0.35)',
      shadow: 'rgba(0, 0, 0, 0.22)',
      zebra: 'rgba(0, 0, 0, 0.032)',
      'heat-0': '#c9d3de',
      'heat-1': '#f0c674',
      'heat-2': '#e8973a',
      'heat-3': '#c42b1c'
    }
  },
  {
    id: 'ambre',
    label: 'Ambre sombre',
    tagline: 'Ambre sur anthracite — l’identité GTrace',
    base: 'dark',
    vars: {
      bg: '#16181d',
      'bg-panel': '#21252d',
      'bg-input': '#14161a',
      'bg-hover': 'rgba(255, 255, 255, 0.045)',
      border: '#2b2f37',
      'border-strong': '#3a404b',
      text: '#d6d9de',
      'text-dim': '#8b909a',
      accent: '#d9a441',
      'accent-dim': 'rgba(217, 164, 65, 0.14)',
      run: '#3f9d57',
      'run-dim': 'rgba(63, 157, 87, 0.16)',
      error: '#d96c6c',
      'error-dim': 'rgba(217, 108, 108, 0.14)',
      ok: '#7dbb7d',
      overlay: 'rgba(0, 0, 0, 0.6)',
      shadow: 'rgba(0, 0, 0, 0.5)',
      zebra: 'rgba(255, 255, 255, 0.022)',
      'heat-0': '#3a3f4a',
      'heat-1': '#8a6d2f',
      'heat-2': '#c99a3a',
      'heat-3': '#d96c6c'
    }
  },
  {
    id: 'ardoise',
    label: 'Ardoise',
    tagline: 'Gris profond et bleu vif, contraste doux',
    base: 'dark',
    vars: {
      bg: '#1e1e1e',
      'bg-panel': '#252526',
      'bg-input': '#1a1a1a',
      'bg-hover': 'rgba(255, 255, 255, 0.06)',
      border: '#333333',
      'border-strong': '#454545',
      text: '#d4d4d4',
      'text-dim': '#8c8c8c',
      accent: '#3794ff',
      'accent-dim': 'rgba(55, 148, 255, 0.16)',
      run: '#3fb950',
      'run-dim': 'rgba(63, 185, 80, 0.16)',
      error: '#f14c4c',
      'error-dim': 'rgba(241, 76, 76, 0.14)',
      ok: '#3fb950',
      overlay: 'rgba(0, 0, 0, 0.6)',
      shadow: 'rgba(0, 0, 0, 0.5)',
      zebra: 'rgba(255, 255, 255, 0.025)',
      'heat-0': '#3a3f4a',
      'heat-1': '#9d7d2f',
      'heat-2': '#d19a3a',
      'heat-3': '#f14c4c'
    }
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    tagline: 'Nuit bleutée, accents cobalt',
    base: 'dark',
    vars: {
      bg: '#1b1b1c',
      'bg-panel': '#2d2d30',
      'bg-input': '#1e1e1e',
      'bg-hover': 'rgba(0, 122, 204, 0.16)',
      border: '#3f3f46',
      'border-strong': '#54545c',
      text: '#e6e6e6',
      'text-dim': '#9a9aa0',
      accent: '#0097fb',
      'accent-dim': 'rgba(0, 151, 251, 0.16)',
      run: '#4ec94e',
      'run-dim': 'rgba(78, 201, 78, 0.16)',
      error: '#f45b5b',
      'error-dim': 'rgba(244, 91, 91, 0.14)',
      ok: '#4ec94e',
      overlay: 'rgba(0, 0, 0, 0.6)',
      shadow: 'rgba(0, 0, 0, 0.55)',
      zebra: 'rgba(255, 255, 255, 0.028)',
      'heat-0': '#3f3f46',
      'heat-1': '#9d7d2f',
      'heat-2': '#d19a3a',
      'heat-3': '#f45b5b'
    }
  },
  {
    id: 'contrast',
    label: 'Contraste élevé',
    tagline: 'Noir et jaune, lisibilité maximale',
    base: 'dark',
    vars: {
      bg: '#000000',
      'bg-panel': '#0d0d0d',
      'bg-input': '#000000',
      'bg-hover': 'rgba(255, 255, 0, 0.14)',
      border: '#5a5a5a',
      'border-strong': '#8a8a8a',
      text: '#ffffff',
      'text-dim': '#c0c0c0',
      accent: '#ffd400',
      'accent-dim': 'rgba(255, 212, 0, 0.18)',
      run: '#00e05a',
      'run-dim': 'rgba(0, 224, 90, 0.18)',
      error: '#ff5b5b',
      'error-dim': 'rgba(255, 91, 91, 0.18)',
      ok: '#00e05a',
      overlay: 'rgba(0, 0, 0, 0.75)',
      shadow: 'rgba(0, 0, 0, 0.8)',
      zebra: 'rgba(255, 255, 255, 0.06)',
      'heat-0': '#4a4a4a',
      'heat-1': '#b09000',
      'heat-2': '#ffd400',
      'heat-3': '#ff5b5b'
    }
  }
]

export const DEFAULT_THEME_ID = 'azur'

export function findTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
}
