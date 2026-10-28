import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

interface Tip {
  text: string
  shortcut: string | null
  /** Centre horizontal de l'élément survolé */
  x: number
  /** Bord de l'élément (bas si la bulle s'affiche dessous, haut sinon) */
  y: number
  below: boolean
}

/** Délai avant la première info-bulle ; ensuite, elles s'enchaînent sans attendre. */
const SHOW_DELAY = 450
const WARM_MS = 400

/**
 * Info-bulles de l'interface : tout élément portant `data-tip` (et en option
 * `data-shortcut`) en reçoit une, rapide et lisible, au lieu de la bulle
 * native de Windows qui met plus d'une seconde à venir. Un seul calque pour
 * toute l'application : rien à câbler bouton par bouton.
 */
export default function TooltipLayer(): JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer = 0
    let current: Element | null = null
    let hiddenAt = 0
    let visible = false

    const hide = (): void => {
      window.clearTimeout(timer)
      current = null
      if (visible) hiddenAt = Date.now()
      visible = false
      setTip(null)
    }

    const onOver = (e: PointerEvent): void => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === current) return
      window.clearTimeout(timer)
      current = el
      if (!el) {
        if (visible) hiddenAt = Date.now()
        visible = false
        setTip(null)
        return
      }
      const show = (): void => {
        if (!el.isConnected || current !== el) return
        const r = el.getBoundingClientRect()
        const below = r.bottom + 44 < window.innerHeight
        visible = true
        setTip({
          text: el.getAttribute('data-tip') ?? '',
          shortcut: el.getAttribute('data-shortcut'),
          x: r.left + r.width / 2,
          y: below ? r.bottom + 6 : r.top - 6,
          below
        })
      }
      // D'un bouton à son voisin, la bulle suit immédiatement (barre d'outils).
      if (visible || Date.now() - hiddenAt < WARM_MS) show()
      else timer = window.setTimeout(show, SHOW_DELAY)
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Reste dans la fenêtre : la bulle est recadrée une fois sa largeur connue.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !tip) return
    const w = box.offsetWidth
    const left = Math.min(Math.max(6, tip.x - w / 2), window.innerWidth - w - 6)
    box.style.left = `${left}px`
    box.style.top = tip.below ? `${tip.y}px` : `${tip.y - box.offsetHeight}px`
  }, [tip])

  if (!tip || !tip.text) return null
  return (
    <div ref={boxRef} className={`ui-tooltip${tip.below ? '' : ' above'}`} role="tooltip">
      <span>{tip.text}</span>
      {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
    </div>
  )
}
