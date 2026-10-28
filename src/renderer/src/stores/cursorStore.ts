import { create } from 'zustand'

/**
 * Position du curseur dans l'éditeur (Ln / Col de la barre d'état, F9).
 *
 * Tenue hors de App : elle change à chaque frappe et à chaque clic, et la
 * garder dans l'état de App redessinait toute la fenêtre (explorateur, grille
 * de résultats, Déroulé) à chaque mouvement du curseur.
 */
interface CursorState {
  cursor: { line: number; column: number } | null
  setCursor: (line: number, column: number) => void
}

export const useCursorStore = create<CursorState>((set) => ({
  cursor: null,
  setCursor: (line, column) => set({ cursor: { line, column } })
}))
