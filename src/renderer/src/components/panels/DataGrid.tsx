import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { copyText } from '../../lib/clipboard'

/**
 * Grille de données lisible et interactive.
 *
 * - En-tête et colonne de numéros figés ; colonnes bornées + info-bulle ; NULL
 *   grisé ; nombres alignés à droite.
 * - Clic sur le n° d'une ligne : cycle une couleur de fond (palette lisible) et
 *   marque la ligne comme sélectionnée ; re-cliquer fait défiler les couleurs
 *   puis revient à l'état d'origine.
 * - Clic sur la case « # » (en-tête) : (dé)sélectionne toutes les lignes.
 * - Clic sur un en-tête de colonne : sélectionne la colonne (comme SSMS).
 * - Copie : Ctrl+C sans en-têtes, Ctrl+Maj+C avec (raccourcis SSMS) ; la
 *   colonne sélectionnée, sinon les lignes sélectionnées, sinon tout. NULL est
 *   copié en toutes lettres, comme SSMS.
 * - Clic droit : menu (copier avec/sans en-têtes, colorer, exporter CSV/JSON/Excel).
 * - Toutes les lignes sont consultables, mais seules celles à l'écran existent
 *   dans la page (grille « virtualisée ») : 20 000 cellules à mettre en page
 *   figeaient la fenêtre près d'une seconde après chaque SELECT. Les largeurs de
 *   colonnes sont donc calculées d'après le texte, et non laissées au navigateur.
 */

const PALETTE = [
  'rgba(217, 164, 65, 0.24)', // ambre
  'rgba(63, 157, 87, 0.24)', // vert
  'rgba(90, 150, 220, 0.26)', // bleu
  'rgba(180, 120, 220, 0.26)', // violet
  'rgba(217, 108, 108, 0.24)', // rouge
  'rgba(80, 195, 205, 0.24)' // turquoise
]

function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '')
  return String(v)
}

function cellClass(v: unknown): string {
  if (v === null || v === undefined) return 'cell-null'
  if (typeof v === 'number' || typeof v === 'bigint') return 'cell-num'
  return ''
}

/** Valeur brute pour copie/export (NULL → vide, dates ISO, reste tel quel). */
function cellRaw(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '')
  return String(v)
}

function jsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return v
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Menu {
  x: number
  y: number
  row: number | null
}

/** Lignes créées en plus au-dessus et en dessous de la zone visible (défilement fluide). */
const OVERSCAN = 20
/** Lignes lues pour estimer la largeur des colonnes. */
const WIDTH_SAMPLE = 1000
/** Largeur maximale d'une colonne (au-delà, le texte est coupé « … »). */
const MAX_COL_PX = 380
/** Marges intérieures + bordure d'une cellule. */
const CELL_EXTRA_PX = 22

/** Largeur d'un caractère de la police à chasse fixe de la grille. */
function charWidth(font: string): number {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 7.2
  ctx.font = font
  return ctx.measureText('0000000000').width / 10 || 7.2
}

/**
 * Une ligne de la grille, redessinée seulement si ses valeurs, sa couleur ou la
 * colonne sélectionnée changent : colorer une ligne ne reconstruit plus les
 * milliers de cellules des autres.
 */
const GridRow = memo(function GridRow({
  row,
  ri,
  color,
  selectedCol,
  onRowNum
}: {
  row: unknown[]
  ri: number
  color: number | undefined
  selectedCol: number | null
  onRowNum: (ri: number) => void
}): JSX.Element {
  const bg = color !== undefined ? PALETTE[color] : undefined
  return (
    <tr
      data-row={ri}
      className={`${ri % 2 === 1 ? 'zebra' : ''}${color !== undefined ? ' row-marked' : ''}`}
    >
      <td
        className="grid-rownum clickable"
        title="Colorer / sélectionner la ligne (re-cliquer pour changer / réinitialiser)"
        onClick={() => onRowNum(ri)}
      >
        {ri + 1}
      </td>
      {row.map((cell, ci) => {
        const t = cellText(cell)
        return (
          <td
            key={ci}
            className={`${cellClass(cell)}${selectedCol === ci ? ' col-selected' : ''}`}
            title={t}
            style={bg ? { background: bg } : undefined}
          >
            {t}
          </td>
        )
      })}
    </tr>
  )
})

function DataGrid({
  columns,
  rows,
  totalRows,
  name = 'resultset'
}: {
  columns: string[]
  rows: unknown[][]
  /** Nombre réel de lignes quand `rows` est tronqué (exécution relue depuis l'historique) */
  totalRows?: number
  name?: string
}): JSX.Element {
  const shown = rows
  const [rowColor, setRowColor] = useState<Map<number, number>>(() => new Map())
  const [menu, setMenu] = useState<Menu | null>(null)
  /** Colonne sélectionnée par un clic sur son en-tête (null = aucune). */
  const [selectedCol, setSelectedCol] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  /** Indices ciblés par copie/export : lignes colorées, sinon toutes les lignes. */
  const targetIndices = useCallback((): number[] => {
    const marked = [...rowColor.keys()].filter((i) => i < shown.length).sort((a, b) => a - b)
    return marked.length > 0 ? marked : shown.map((_, i) => i)
  }, [rowColor, shown])

  /** Prochaine teinte de la rotation : deux lignes marquées à la suite diffèrent. */
  const nextColorRef = useRef(0)

  const cycleRow = useCallback((i: number) => {
    setSelectedCol(null)
    setRowColor((prev) => {
      const next = new Map(prev)
      if (next.has(i)) {
        // Ligne déjà marquée : re-cliquer la remet à son état d'origine.
        next.delete(i)
      } else {
        next.set(i, nextColorRef.current)
        nextColorRef.current = (nextColorRef.current + 1) % PALETTE.length
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setRowColor((prev) => {
      if (prev.size >= shown.length) return new Map()
      const next = new Map<number, number>()
      for (let i = 0; i < shown.length; i++) next.set(i, 0)
      return next
    })
  }, [shown.length])

  const setColor = useCallback(
    (indices: number[], color: number | null) => {
      setRowColor((prev) => {
        const next = new Map(prev)
        for (const i of indices) {
          if (color === null) next.delete(i)
          else next.set(i, color)
        }
        return next
      })
    },
    []
  )

  const doCopy = useCallback(
    async (withHeaders: boolean) => {
      const idx = selectedCol !== null ? shown.map((_, i) => i) : targetIndices()
      const pick = (row: unknown[]): unknown[] => (selectedCol !== null ? [row[selectedCol]] : row)
      const lines: string[] = []
      if (withHeaders) lines.push(pick(columns).join('\t'))
      for (const i of idx) lines.push(pick(shown[i]).map(cellText).join('\t'))
      await copyText(lines.join('\r\n'))
      setMenu(null)
    },
    [columns, shown, targetIndices, selectedCol]
  )

  const doExport = useCallback(
    (fmt: 'csv' | 'csvNoHead' | 'json' | 'xlsx') => {
      // Export = lignes sélectionnées si présentes, sinon TOUTES les lignes (non plafonné).
      const marked = [...rowColor.keys()].sort((a, b) => a - b)
      const src = marked.length > 0 ? marked.map((i) => rows[i]).filter(Boolean) : rows
      if (fmt === 'json') {
        const objs = src.map((row) => {
          const o: Record<string, unknown> = {}
          columns.forEach((c, i) => (o[c || `col${i + 1}`] = jsonValue(row[i])))
          return o
        })
        download(`${name}.json`, JSON.stringify(objs, null, 2), 'application/json')
      } else if (fmt === 'xlsx') {
        // Table HTML lue nativement par Excel comme une feuille (types préservés visuellement).
        let html =
          '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">'
        html += '<tr>' + columns.map((c) => `<th>${htmlEscape(c)}</th>`).join('') + '</tr>'
        for (const row of src)
          html += '<tr>' + row.map((v) => `<td>${htmlEscape(cellRaw(v))}</td>`).join('') + '</tr>'
        html += '</table></body></html>'
        download(`${name}.xls`, html, 'application/vnd.ms-excel')
      } else {
        const withHeaders = fmt === 'csv'
        const lines: string[] = []
        if (withHeaders) lines.push(columns.map(csvEscape).join(','))
        for (const row of src) lines.push(row.map((v) => csvEscape(cellRaw(v))).join(','))
        // BOM UTF-8 → Excel lit correctement les accents.
        download(`${name}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8')
      }
      setMenu(null)
    },
    [columns, rows, rowColor, name]
  )

  // Ctrl/Cmd+C copie la sélection quand aucune sélection de texte n'est active.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) return // laisser copier le texte sélectionné
        e.preventDefault()
        void doCopy(e.shiftKey)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [doCopy])

  // ─── Virtualisation : seules les lignes visibles (± OVERSCAN) sont créées ───
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  const [rowH, setRowH] = useState(24)
  const [charW, setCharW] = useState(7.2)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void =>
      setView((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight }
      )
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  // Police réelle de la grille (thème, densité) → largeur d'un caractère.
  useLayoutEffect(() => {
    if (tableRef.current) setCharW(charWidth(getComputedStyle(tableRef.current).font))
  }, [])

  // Hauteur réelle d'une ligne (dépend de la densité choisie dans Apparence).
  useLayoutEffect(() => {
    const tr = tableRef.current?.querySelector<HTMLTableRowElement>('tbody tr[data-row]')
    const h = tr?.getBoundingClientRect().height
    if (h && Math.abs(h - rowH) > 0.5) setRowH(h)
  })

  const colWidths = useMemo(() => {
    const sample = rows.length > WIDTH_SAMPLE ? rows.slice(0, WIDTH_SAMPLE) : rows
    const px = (chars: number): number =>
      Math.min(MAX_COL_PX, Math.max(48, Math.ceil(chars * charW) + CELL_EXTRA_PX))
    return {
      rownum: Math.max(40, Math.ceil(String(rows.length).length * charW) + CELL_EXTRA_PX),
      cols: columns.map((c, ci) => {
        let len = (c || `(col ${ci + 1})`).length + 1
        for (const r of sample) {
          const t = cellText(r[ci]).length
          if (t > len) len = t
          if (len * charW >= MAX_COL_PX) break
        }
        return px(len)
      })
    }
  }, [columns, rows, charW])

  const first = Math.max(0, Math.floor(view.top / rowH) - OVERSCAN)
  const last = Math.min(shown.length, Math.ceil((view.top + view.height) / rowH) + OVERSCAN)

  const menuTargets = (): number[] => {
    const marked = [...rowColor.keys()]
    if (marked.length > 0) return marked
    return menu?.row != null ? [menu.row] : []
  }

  return (
    <div className="grid-block" ref={wrapRef} tabIndex={0}>
      <div className="grid-scroll" ref={scrollRef}>
        <table
          ref={tableRef}
          className="data-grid virtual"
          style={{ width: colWidths.rownum + colWidths.cols.reduce((a, w) => a + w, 0) }}
          onContextMenu={(e) => {
            e.preventDefault()
            const tr = (e.target as HTMLElement).closest('tr[data-row]')
            const row = tr ? Number(tr.getAttribute('data-row')) : null
            setMenu({ x: e.clientX, y: e.clientY, row })
          }}
        >
          <colgroup>
            <col style={{ width: colWidths.rownum }} />
            {colWidths.cols.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="grid-rownum clickable"
                title="Tout sélectionner / désélectionner"
                onClick={() => {
                  setSelectedCol(null)
                  toggleAll()
                }}
              >
                #
              </th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  title={`${c} — cliquer pour sélectionner la colonne`}
                  className={`clickable${selectedCol === i ? ' col-selected' : ''}`}
                  onClick={() => {
                    setRowColor(new Map())
                    setSelectedCol((cur) => (cur === i ? null : i))
                  }}
                >
                  {c || `(col ${i + 1})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr className="grid-spacer" aria-hidden="true" style={{ height: first * rowH }}>
                <td colSpan={columns.length + 1} />
              </tr>
            )}
            {shown.slice(first, last).map((row, k) => (
              <GridRow
                key={first + k}
                row={row}
                ri={first + k}
                color={rowColor.get(first + k)}
                selectedCol={selectedCol}
                onRowNum={cycleRow}
              />
            ))}
            {last < shown.length && (
              <tr className="grid-spacer" aria-hidden="true" style={{ height: (shown.length - last) * rowH }}>
                <td colSpan={columns.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalRows !== undefined && totalRows > rows.length && (
        <p className="hint grid-more">
          … {totalRows - rows.length} ligne(s) non conservée(s) : l&apos;historique garde les{' '}
          {rows.length} premières. Réexécutez pour tout voir et tout exporter.
        </p>
      )}

      {menu && (
        <>
          <div className="ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button className="ctx-item" onClick={() => void doCopy(false)}>
              Copier <span className="ctx-key">Ctrl+C</span>
            </button>
            <button className="ctx-item" onClick={() => void doCopy(true)}>
              Copier avec en-têtes <span className="ctx-key">Ctrl+Maj+C</span>
            </button>
            <div className="ctx-sep" />
            <div className="ctx-label">Couleur de ligne</div>
            <div className="ctx-swatches">
              {PALETTE.map((c, i) => (
                <button
                  key={i}
                  className="ctx-swatch"
                  style={{ background: c }}
                  title={`Colorer (${i + 1})`}
                  onClick={() => {
                    setColor(menuTargets(), i)
                    setMenu(null)
                  }}
                />
              ))}
              <button
                className="ctx-swatch none"
                title="Aucune couleur"
                onClick={() => {
                  setColor(menuTargets(), null)
                  setMenu(null)
                }}
              >
                ✕
              </button>
            </div>
            <button className="ctx-item" onClick={() => { setRowColor(new Map()); setMenu(null) }}>
              Effacer toutes les couleurs
            </button>
            <div className="ctx-sep" />
            <div className="ctx-label">Exporter</div>
            <button className="ctx-item" onClick={() => doExport('xlsx')}>
              Excel (.xls)
            </button>
            <button className="ctx-item" onClick={() => doExport('csv')}>
              CSV (avec en-têtes)
            </button>
            <button className="ctx-item" onClick={() => doExport('csvNoHead')}>
              CSV (sans en-têtes)
            </button>
            <button className="ctx-item" onClick={() => doExport('json')}>
              JSON
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(DataGrid)
