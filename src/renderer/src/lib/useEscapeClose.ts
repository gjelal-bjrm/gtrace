import { useEffect } from 'react'

/**
 * Ferme un dialogue sur la touche Échap.
 *
 * Les dialogues de saisie ne se ferment volontairement PAS au clic sur le fond :
 * un clic à côté ne doit jamais faire perdre un formulaire en cours. On sort
 * donc par Échap, par la croix, ou par le bouton d'annulation.
 */
export function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
