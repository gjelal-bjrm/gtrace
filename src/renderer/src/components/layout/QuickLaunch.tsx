import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Search } from 'lucide-react'
import type { MenuDef } from './MenuBar'
import type { MenuItem } from '../connections/TreeMenu'

export interface Command {
  /** Libellé de la commande (« Exécuter ») */
  label: string
  /** Chemin dans les menus (« Requête › Exécuter ») */
  path: string
  shortcut?: string
  disabled?: boolean
  run: () => void
}

/** Sans accents ni casse : « executer » trouve « Exécuter ». */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const MAX_RESULTS = 9

/**
 * « Rechercher une commande » (Ctrl+Q), à l'emplacement du Lancement rapide de
 * SSMS : on tape quelques lettres, toutes les commandes des menus sont
 * proposées avec leur raccourci, Entrée lance la première.
 */
export default function QuickLaunch({ commands }: { commands: Command[] }): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        e.stopPropagation()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    return commands
      .filter((c) => {
        const hay = fold(`${c.path} ${c.shortcut ?? ''}`)
        return words.every((w) => hay.includes(w))
      })
      .sort((a, b) => Number(a.disabled ?? false) - Number(b.disabled ?? false))
      .slice(0, MAX_RESULTS)
  }, [commands, query])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setIndex(0)
    inputRef.current?.blur()
  }

  const runAt = (i: number): void => {
    const cmd = results[i]
    if (!cmd || cmd.disabled) return
    close()
    cmd.run()
  }

  return (
    <div className="quick-launch">
      <Search size={14} className="quick-launch-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        placeholder="Rechercher une commande (Ctrl+Q)"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(i + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            runAt(index)
          }
        }}
      />
      {open && query.trim() !== '' && (
        <div className="quick-launch-results" role="listbox">
          {results.length === 0 ? (
            <div className="quick-launch-empty">Aucune commande ne correspond.</div>
          ) : (
            results.map((c, i) => (
              <button
                type="button"
                key={c.path}
                role="option"
                aria-selected={i === index}
                className={`quick-launch-item${i === index ? ' selected' : ''}${c.disabled ? ' is-disabled' : ''}`}
                onMouseEnter={() => setIndex(i)}
                // mousedown : avant que le champ perde le focus et ferme la liste.
                onMouseDown={(e) => {
                  e.preventDefault()
                  runAt(i)
                }}
              >
                <span className="quick-launch-label">{c.label}</span>
                <span className="quick-launch-path">{c.path}</span>
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Toutes les commandes des menus, à plat, pour la recherche : « Requête ›
 * Exécuter ». Les sous-menus (Connexion ›, Barres d'outils ›) sont dépliés.
 */
export function menuCommands(menus: MenuDef[]): Command[] {
  const out: Command[] = []
  const walk = (items: MenuItem[], path: string): void => {
    for (const item of items) {
      if (item === 'sep') continue
      const here = `${path} › ${item.label}`
      if (item.children) walk(item.children, here)
      else if (item.onClick) {
        out.push({
          label: item.label,
          path: here,
          shortcut: item.shortcut,
          disabled: item.disabled,
          run: item.onClick
        })
      }
    }
  }
  for (const m of menus) walk(m.items, m.label)
  return out
}
