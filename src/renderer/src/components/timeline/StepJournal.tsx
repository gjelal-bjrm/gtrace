import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ChevronLeft, ChevronRight, Flag, Repeat, TriangleAlert } from 'lucide-react'
import { CATEGORY_LABEL, iterationOf, type LoopRun, type RunModel, type TreeNode } from '../../lib/runModel'
import { formatSqlValue, type Bookmarks } from '../../stores/replayStore'

const ROW = 26
/** Lignes rendues au-delà de la zone visible (défilement fluide). */
const OVERSCAN = 8

type Row =
  | { kind: 'step'; index: number; depth: number }
  | { kind: 'loop'; run: LoopRun; depth: number; shown: number }
  | { kind: 'stop'; text: string }

/**
 * Journal du Déroulé : les étapes écrites en clair, une par ligne (numéro,
 * ligne du code, famille, instruction, effet, durée). Les tours de boucle sont
 * repliés : on choisit le tour à afficher. Seules les lignes visibles sont
 * dessinées, pour rester fluide sur des milliers d'étapes.
 */
export default function StepJournal({
  model,
  current,
  bookmarks,
  filtered,
  followVar,
  matches,
  stopError,
  onSelect,
  onMenu,
  onRename
}: {
  model: RunModel
  current: number
  bookmarks: Bookmarks
  /** Un filtre est actif : liste à plat des seules étapes retenues */
  filtered: boolean
  /** Variable suivie : la colonne Effet montre sa valeur avant → après */
  followVar: string | null
  matches: (index: number) => boolean
  /** L'exécution s'est arrêtée sur une erreur non interceptée */
  stopError: string | null
  onSelect: (index: number) => void
  onMenu: (index: number, x: number, y: number) => void
  onRename: (index: number) => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  /** Tour choisi pour les boucles qui ne contiennent pas l'étape courante */
  const [chosen, setChosen] = useState<Record<string, number>>({})

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo((): Row[] => {
    if (filtered) {
      return model.steps.filter((s) => matches(s.index)).map((s) => ({ kind: 'step', index: s.index, depth: 0 }))
    }
    const out: Row[] = []
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const node of nodes) {
        if (node.kind === 'step') {
          out.push({ kind: 'step', index: node.index, depth })
          continue
        }
        const shown =
          current >= node.start && current <= node.end
            ? iterationOf(node, current)
            : Math.min(chosen[node.key] ?? 0, node.iterations.length - 1)
        out.push({ kind: 'loop', run: node, depth, shown })
        walk(node.iterations[shown], depth + 1)
      }
    }
    walk(model.tree, 0)
    if (stopError) out.push({ kind: 'stop', text: stopError })
    return out
  }, [model, filtered, matches, current, chosen, stopError])

  const currentRow = rows.findIndex((r) => r.kind === 'step' && r.index === current)

  // L'étape courante reste visible quand on navigue (F10, piste, flèches).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || currentRow < 0) return
    const top = currentRow * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW / 2)
    }
    // Seulement quand l'étape ou le filtre change : pas pendant que l'on fait défiler.
  }, [current, filtered])

  const goToIteration = (run: LoopRun, k: number): void => {
    const target = Math.max(0, Math.min(run.iterations.length - 1, k))
    setChosen((c) => ({ ...c, [run.key]: target }))
    onSelect(run.iterationStarts[target])
  }

  /** Étape suivante / précédente dans l'ordre affiché (respecte filtre et tours repliés). */
  const move = (dir: 1 | -1): void => {
    let r = currentRow
    if (r < 0) {
      // Étape courante masquée par le filtre : on repart de sa position.
      r = rows.findIndex((row) => row.kind === 'step' && row.index > current)
      if (r < 0) r = rows.length
      if (dir === 1) r -= 1
    }
    for (let k = r + dir; k >= 0 && k < rows.length; k += dir) {
      const row = rows[k]
      if (row.kind === 'step') {
        onSelect(row.index)
        return
      }
    }
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)

  return (
    <div className="dr-journal">
      <div className="dr-journal-head" aria-hidden="true">
        <span className="dr-c-num">N°</span>
        <span>Ligne</span>
        <span>Type</span>
        <span>Instruction</span>
        <span>{followVar ? `Valeur de ${followVar}` : 'Effet'}</span>
        <span className="dr-c-ms">Durée</span>
      </div>
      <div
        ref={scrollRef}
        className="dr-journal-scroll"
        tabIndex={0}
        role="listbox"
        aria-label="Journal des étapes"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            move(e.key === 'ArrowDown' ? 1 : -1)
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault()
            const steps = rows.filter((r) => r.kind === 'step')
            const target = e.key === 'Home' ? steps[0] : steps[steps.length - 1]
            if (target?.kind === 'step') onSelect(target.index)
          }
        }}
      >
        {rows.length === 0 && (
          <div className="dr-journal-empty">Aucune étape ne correspond à ce filtre.</div>
        )}
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(first, last).map((row, k) => {
            const top = (first + k) * ROW
            if (row.kind === 'stop') {
              return (
                <div key="stop" className="dr-row dr-stop" style={{ top }}>
                  <TriangleAlert size={13} aria-hidden="true" />
                  <span>{row.text}</span>
                </div>
              )
            }
            if (row.kind === 'loop') {
              return (
                <LoopRow
                  key={`loop-${row.run.key}`}
                  top={top}
                  run={row.run}
                  depth={row.depth}
                  shown={row.shown}
                  onGo={(i) => goToIteration(row.run, i)}
                />
              )
            }
            const s = model.steps[row.index]
            const mark = bookmarks[row.index]
            const selected = row.index === current
            const change = followVar ? s.changes.find((c) => c.name === followVar) : undefined
            const effect = change
              ? change.hadBefore
                ? `${formatSqlValue(change.before)} → ${formatSqlValue(change.after)}`
                : `= ${formatSqlValue(change.after)}`
              : s.effect
            return (
              <div
                key={row.index}
                className={`dr-row${selected ? ' selected' : ''}`}
                style={{ top }}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(row.index)}
                onDoubleClick={() => onRename(row.index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onMenu(row.index, e.clientX, e.clientY)
                }}
              >
                <span className="dr-c-num">{row.index + 1}</span>
                <span className="dr-c-line">l. {s.line}</span>
                <span className={`dr-badge dr-badge-${s.category}`}>{CATEGORY_LABEL[s.category]}</span>
                <span className="dr-c-code" style={{ paddingLeft: row.depth * 16 }}>
                  {mark && (
                    <span className="dr-mark">
                      <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
                      {mark}
                    </span>
                  )}
                  <code>{s.code}</code>
                </span>
                <span
                  className={`dr-c-effect${s.category === 'error' ? ' error' : ''}${change ? ' followed' : ''}`}
                  data-tip={effect.length > 48 ? effect : undefined}
                >
                  {effect}
                </span>
                <span className={`dr-c-ms${s.slow ? ' slow' : ''}`}>
                  <i
                    className={`dr-msbar dr-heat-${s.heat}`}
                    style={{
                      width:
                        s.durationMs === null || model.maxMs <= 0
                          ? 0
                          : Math.max(2, Math.round(Math.sqrt(s.durationMs / model.maxMs) * 26))
                    }}
                  />
                  {s.durationMs === null ? '—' : `${s.durationMs} ms`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** En-tête d'une boucle repliée : nombre de tours et choix du tour affiché. */
function LoopRow({
  top,
  run,
  depth,
  shown,
  onGo
}: {
  top: number
  run: LoopRun
  depth: number
  shown: number
  onGo: (iteration: number) => void
}): JSX.Element {
  const count = run.iterations.length
  return (
    <div className="dr-row dr-loop" style={{ top }}>
      <span className="dr-c-num" />
      <span className="dr-c-line">l. {run.line}</span>
      <span className="dr-loop-title" style={{ paddingLeft: depth * 16 }}>
        <Repeat size={13} aria-hidden="true" />
        Boucle WHILE
        <span className="dr-loop-meta">
          {count} tour{count > 1 ? 's' : ''} · étapes {run.start + 1} à {run.end + 1}
        </span>
      </span>
      <span className="dr-iter" role="group" aria-label="Tour affiché">
        <span className="dr-iter-label">tour</span>
        {count <= 12 ? (
          Array.from({ length: count }, (_, k) => (
            <button
              key={k}
              type="button"
              className={`dr-iter-btn${k === shown ? ' on' : ''}`}
              aria-pressed={k === shown}
              onClick={() => onGo(k)}
            >
              {k + 1}
            </button>
          ))
        ) : (
          <>
            <button
              type="button"
              className="dr-iter-btn"
              aria-label="Tour précédent"
              onClick={() => onGo(shown - 1)}
            >
              <ChevronLeft size={13} aria-hidden="true" />
            </button>
            <span className="dr-iter-count">
              {shown + 1} / {count}
            </span>
            <button
              type="button"
              className="dr-iter-btn"
              aria-label="Tour suivant"
              onClick={() => onGo(shown + 1)}
            >
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </>
        )}
      </span>
    </div>
  )
}
