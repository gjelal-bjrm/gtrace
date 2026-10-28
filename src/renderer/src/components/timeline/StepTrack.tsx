import { memo, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Flag, Pencil, Table2, TriangleAlert, type LucideIcon } from 'lucide-react'
import { CATEGORY_LABEL, type RunModel } from '../../lib/runModel'
import type { Bookmarks } from '../../stores/replayStore'

export type ColorMode = 'type' | 'duration'

/** Une barre de la piste : une étape, ou plusieurs quand la place manque. */
interface Bar {
  start: number
  end: number
  /** Hauteur en % : la durée, pour repérer d'un coup d'œil ce qui est long */
  h: number
  cls: string
  dim: boolean
  gap: number
}

const MIN_BAR_PX = 3
const MARKER_PX = 18

/** Priorité d'affichage quand plusieurs étapes se partagent une barre. */
const PRIORITY = { error: 5, write: 4, call: 3, read: 2, calc: 1, ctrl: 0 } as const

const pct = (v: number, n: number): string => `${(v / n) * 100}%`

/**
 * Piste du Déroulé : une barre par instruction exécutée, de gauche à droite.
 * Couleur = famille d'instruction (ou durée, au choix) ; hauteur = durée ;
 * repères au-dessus (signet, erreur, résultat, écriture) ; accolades des
 * boucles en dessous. On clique ou on fait glisser pour revenir à un moment.
 */
export default function StepTrack({
  model,
  current,
  bookmarks,
  colorMode,
  matches,
  watchColors,
  onSelect,
  onMenu
}: {
  model: RunModel
  current: number
  bookmarks: Bookmarks
  colorMode: ColorMode
  matches: (index: number) => boolean
  /** Couleur de la variable suivie modifiée par chaque étape (null : aucune) */
  watchColors: (string | null)[]
  onSelect: (index: number) => void
  onMenu: (index: number, x: number, y: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const n = model.steps.length

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const bars = useMemo(
    () => buildBars(model, width, colorMode, matches),
    [model, width, colorMode, matches]
  )

  const watchSegments = useMemo(() => {
    const out: { start: number; end: number; color: string }[] = []
    watchColors.forEach((color, i) => {
      if (!color) return
      const prev = out[out.length - 1]
      if (prev && prev.end === i && prev.color === color) prev.end = i + 1
      else out.push({ start: i, end: i + 1, color })
    })
    return out
  }, [watchColors])

  // Repères : une icône par tranche de 18 px (la plus importante), signets toujours visibles.
  const markers = useMemo(() => {
    const buckets = Math.max(1, Math.floor(width / MARKER_PX))
    const best = new Map<number, { index: number; rank: number; icon: LucideIcon; cls: string }>()
    const marked = new Set(Object.keys(bookmarks).map(Number))
    const markedBuckets = new Set([...marked].map((i) => Math.floor((i / n) * buckets)))
    model.steps.forEach((s, i) => {
      const kind =
        s.category === 'error'
          ? { rank: 3, icon: TriangleAlert, cls: 'error' }
          : s.hasResult
            ? { rank: 2, icon: Table2, cls: 'read' }
            : s.category === 'write'
              ? { rank: 1, icon: Pencil, cls: 'write' }
              : null
      if (!kind) return
      const b = Math.min(buckets - 1, Math.floor((i / n) * buckets))
      if (markedBuckets.has(b)) return
      const cur = best.get(b)
      if (!cur || kind.rank > cur.rank) best.set(b, { index: i, ...kind })
    })
    return [...best.values()]
  }, [model, width, bookmarks, n])

  const indexAt = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)))
  }

  const slotPx = width / n
  const hovered = hover !== null && hover < n ? model.steps[hover] : null

  return (
    <div
      ref={ref}
      className="dr-track"
      role="slider"
      tabIndex={0}
      aria-label="Piste des étapes"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={current + 1}
      aria-valuetext={`Étape ${current + 1} sur ${n}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onSelect(indexAt(e.clientX))
      }}
      onPointerMove={(e) => {
        const i = indexAt(e.clientX)
        setHover(i)
        if (dragging.current && i !== current) onSelect(i)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(indexAt(e.clientX), e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        const to =
          e.key === 'ArrowLeft'
            ? current - 1
            : e.key === 'ArrowRight'
              ? current + 1
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? n - 1
                  : null
        if (to === null) return
        e.preventDefault()
        onSelect(Math.max(0, Math.min(n - 1, to)))
      }}
    >
      {slotPx >= 4 && (
        <span className="dr-slot" style={{ left: pct(current, n), width: pct(1, n) }} />
      )}
      {hover !== null && slotPx >= 4 && hover !== current && (
        <span className="dr-slot hover" style={{ left: pct(hover, n), width: pct(1, n) }} />
      )}

      <div className="dr-markers">
        {markers.map((m) => (
          <m.icon
            key={m.index}
            className={`dr-marker ${m.cls}`}
            style={{ left: pct(m.index + 0.5, n) }}
            size={12}
            strokeWidth={2}
            aria-hidden="true"
          />
        ))}
        {Object.entries(bookmarks).map(([key, name]) => {
          const i = Number(key)
          if (i >= n) return null
          const toLeft = i > n * 0.6
          return (
            <span
              key={key}
              className={`dr-flag${toLeft ? ' to-left' : ''}`}
              style={{ left: pct(i + 0.5, n) }}
            >
              <Flag size={12} strokeWidth={2.2} aria-hidden="true" />
              <span className="dr-flag-name">{name}</span>
            </span>
          )
        })}
      </div>

      <div className="dr-bars">
        <BarList bars={bars} n={n} />
        {watchSegments.map((w) => (
          <span
            key={w.start}
            className="dr-watch"
            style={{ left: pct(w.start, n), width: pct(w.end - w.start, n), background: w.color }}
          />
        ))}
      </div>

      <div className="dr-loops">
        {model.topLoops.map((loop) => {
          const count = loop.iterations.length
          const px = ((loop.end - loop.start + 1) / n) * width
          return (
            <span
              key={loop.key}
              className="dr-loop-bracket"
              style={{ left: pct(loop.start, n), width: pct(loop.end - loop.start + 1, n) }}
              data-tip={`Boucle WHILE ligne ${loop.line} : ${count} tour${count > 1 ? 's' : ''} (étapes ${loop.start + 1} à ${loop.end + 1})`}
            >
              {px >= 150
                ? `boucle WHILE ligne ${loop.line} · ${count} tour${count > 1 ? 's' : ''}`
                : px >= 34
                  ? `×${count}`
                  : ''}
            </span>
          )
        })}
      </div>

      <span className="dr-playhead" style={{ left: pct(current + 0.5, n) }} />

      {hovered &&
        ref.current &&
        createPortal(
          <TrackTip
            rect={ref.current.getBoundingClientRect()}
            x={((hover! + 0.5) / n) * width}
            title={`Étape ${hover! + 1} · ligne ${hovered.line} · ${CATEGORY_LABEL[hovered.category]}`}
            code={hovered.code}
            effect={hovered.effect}
            error={hovered.category === 'error'}
            duration={
              hovered.durationMs === null
                ? 'durée non mesurée'
                : `${hovered.durationMs} ms${hovered.slow ? ' · parmi les plus lentes' : ''}`
            }
            bookmark={bookmarks[hover!] ?? null}
          />,
          document.body
        )}
    </div>
  )
}

/** Les barres changent rarement : on ne les redessine pas à chaque déplacement du curseur. */
const BarList = memo(function BarList({ bars, n }: { bars: Bar[]; n: number }): JSX.Element {
  return (
    <>
      {bars.map((b) => (
        <span
          key={b.start}
          className={`dr-bar ${b.cls}${b.dim ? ' dim' : ''}`}
          style={{
            left: pct(b.start, n),
            width: `calc(${pct(b.end - b.start, n)} - ${b.gap}px)`,
            height: `${b.h}%`
          }}
        />
      ))}
    </>
  )
})

function buildBars(
  model: RunModel,
  width: number,
  colorMode: ColorMode,
  matches: (index: number) => boolean
): Bar[] {
  const n = model.steps.length
  if (n === 0 || width <= 0) return []
  const count = Math.max(1, Math.min(n, Math.floor(width / MIN_BAR_PX)))
  const slotPx = width / count
  const gap = slotPx >= 6 ? 2 : slotPx >= 4 ? 1 : 0
  const bars: Bar[] = []
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * n) / count)
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / count))
    let lead = model.steps[start]
    let maxMs: number | null = null
    let anyMatch = false
    for (let i = start; i < end; i++) {
      const s = model.steps[i]
      if (PRIORITY[s.category] > PRIORITY[lead.category]) lead = s
      if (s.durationMs !== null && (maxMs === null || s.durationMs > maxMs)) maxMs = s.durationMs
      if (!anyMatch && matches(i)) anyMatch = true
    }
    // Racine carrée : les écarts restent visibles sans écraser les étapes rapides.
    const h =
      model.maxMs <= 0 ? 55 : maxMs === null ? 22 : 22 + 78 * Math.sqrt(maxMs / model.maxMs)
    const heat = model.maxMs <= 0 || maxMs === null ? 0 : heatLevel(maxMs / model.maxMs)
    bars.push({
      start,
      end,
      h,
      cls:
        colorMode === 'type' || lead.category === 'error'
          ? `dr-cat-${lead.category}`
          : `dr-heat-${heat}`,
      dim: !anyMatch,
      gap
    })
  }
  return bars
}

const heatLevel = (ratio: number): number =>
  ratio < 0.25 ? 0 : ratio < 0.5 ? 1 : ratio < 0.75 ? 2 : 3

/** Info-bulle immédiate au-dessus de la piste (hors du panneau : jamais rognée). */
function TrackTip({
  rect,
  x,
  title,
  code,
  effect,
  error,
  duration,
  bookmark
}: {
  rect: DOMRect
  x: number
  title: string
  code: string
  effect: string
  error: boolean
  duration: string
  bookmark: string | null
}): JSX.Element {
  const left = Math.max(rect.left + 150, Math.min(rect.right - 150, rect.left + x))
  return (
    <div className="dr-tip" style={{ left, top: rect.top - 8 }} role="tooltip">
      <div className="dr-tip-title">
        {bookmark && (
          <span className="dr-tip-mark">
            <Flag size={11} aria-hidden="true" /> {bookmark}
          </span>
        )}
        {title}
      </div>
      <code className="dr-tip-code">{code}</code>
      {effect && <div className={`dr-tip-effect${error ? ' error' : ''}`}>{effect}</div>}
      <div className="dr-tip-foot">
        {duration} · cliquez ou faites glisser pour y revenir
      </div>
    </div>
  )
}
