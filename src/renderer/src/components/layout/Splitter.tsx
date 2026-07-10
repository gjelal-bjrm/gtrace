import { useCallback, useRef } from 'react'

interface Props {
  /** 'x' = barre verticale qu'on tire horizontalement (redimensionne une largeur)
   *  'y' = barre horizontale qu'on tire verticalement (redimensionne une hauteur) */
  axis: 'x' | 'y'
  /** Reçoit le déplacement incrémental du pointeur le long de l'axe (px). */
  onDrag: (delta: number) => void
}

/** Poignée de redimensionnement entre deux panneaux. */
export default function Splitter({ axis, onDrag }: Props): JSX.Element {
  const last = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      last.current = axis === 'x' ? e.clientX : e.clientY
      const move = (ev: MouseEvent): void => {
        const cur = axis === 'x' ? ev.clientX : ev.clientY
        onDrag(cur - last.current)
        last.current = cur
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [axis, onDrag]
  )

  return <div className={`splitter splitter-${axis}`} onMouseDown={onMouseDown} />
}
