import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Grille de données lisible et interactive.
 *
 * - En-tête et colonne de numéros figés ; colonnes bornées + info-bulle ; NULL
 *   grisé ; nombres alignés à droite.
 * - Clic sur le n° d'une ligne : cycle une couleur de fond (palette lisible) et
 *   marque la ligne comme sélectionnée ; re-cliquer fait défiler les couleurs
 *   puis revient à l'état d'origine.
 * - Clic sur la case « # » (en-tête) : (dé)sélectionne toutes les lignes.
 * - Copie (Ctrl+C ou clic droit → Copier) : lignes sélectionnées, sinon tout.
 * - Clic droit : menu (copier avec/sans en-têtes, colorer, exporter CSV/JSON/Excel).
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

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* repli ci-dessous */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    /* ignore */
  }
  ta.remove()
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

export default function DataGrid({
  columns,
  rows,
  maxRows = 500,
  name = 'resultset'
}: {
  columns: string[]
  rows: unknown[][]
  maxRows?: number
  name?: string
}): JSX.Element {
  const shown = rows.slice(0, maxRows)
  const [rowColor, setRowColor] = useState<Map<number, number>>(() => new Map())
  const [menu, setMenu] = useState<Menu | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  /** Indices ciblés par copie/export : lignes colorées, sinon toutes les lignes. */
  const targetIndices = useCallback((): number[] => {
    const marked = [...rowColor.keys()].filter((i) => i < shown.length).sort((a, b) => a - b)
    return marked.length > 0 ? marked : shown.map((_, i) => i)
  }, [rowColor, shown])

  const cycleRow = useCallback((i: number) => {
    setRowColor((prev) => {
      const next = new Map(prev)
      const cur = next.get(i)
      if (cur === undefined) next.set(i, 0)
      else if (cur + 1 < PALETTE.length) next.set(i, cur + 1)
      else next.delete(i)
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
      const idx = targetIndices()
      const lines: string[] = []
      if (withHeaders) lines.push(columns.join('\t'))
      for (const i of idx) lines.push(shown[i].map(cellRaw).join('\t'))
      await copyText(lines.join('\r\n'))
      setMenu(null)
    },
    [columns, shown, targetIndices]
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
        void doCopy(true)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [doCopy])

  const menuTargets = (): number[] => {
    const marked = [...rowColor.keys()]
    if (marked.length > 0) return marked
    return menu?.row != null ? [menu.row] : []
  }

  return (
    <div className="grid-block" ref={wrapRef} tabIndex={0}>
      <div className="grid-scroll">
        <table
          className="data-grid"
          onContextMenu={(e) => {
            e.preventDefault()
            const tr = (e.target as HTMLElement).closest('tr[data-row]')
            const row = tr ? Number(tr.getAttribute('data-row')) : null
            setMenu({ x: e.clientX, y: e.clientY, row })
          }}
        >
          <thead>
            <tr>
              <th
                className="grid-rownum clickable"
                title="Tout sélectionner / désélectionner"
                onClick={toggleAll}
              >
                #
              </th>
              {columns.map((c, i) => (
                <th key={i} title={c}>
                  {c || `(col ${i + 1})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, ri) => {
              const color = rowColor.get(ri)
              const bg = color !== undefined ? PALETTE[color] : undefined
              return (
                <tr key={ri} data-row={ri} className={color !== undefined ? 'row-marked' : ''}>
                  <td
                    className="grid-rownum clickable"
                    title="Colorer / sélectionner la ligne (re-cliquer pour changer / réinitialiser)"
                    onClick={() => cycleRow(ri)}
                  >
                    {ri + 1}
                  </td>
                  {row.map((cell, ci) => {
                    const t = cellText(cell)
                    return (
                      <td key={ci} className={cellClass(cell)} title={t} style={{ background: bg }}>
                        {t}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <p className="hint grid-more">
          … {rows.length - maxRows} ligne(s) non affichée(s) (l&apos;export inclut tout)
        </p>
      )}

      {menu && (
        <>
          <div className="ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button className="ctx-item" onClick={() => void doCopy(false)}>
              Copier
            </button>
            <button className="ctx-item" onClick={() => void doCopy(true)}>
              Copier avec en-têtes
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
