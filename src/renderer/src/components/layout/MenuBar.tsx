import { useRef, useState } from 'react'
import TreeMenu, { type MenuItem } from '../connections/TreeMenu'

export interface MenuDef {
  label: string
  items: MenuItem[]
}

/**
 * Barre de menus Fichier / Édition / Affichage / Requête / Outils / Aide,
 * comme SSMS. Un clic ouvre un menu ; tant qu'un menu est ouvert, survoler
 * un autre titre bascule dessus ; Échap ou un clic à côté referme.
 */
export default function MenuBar({ menus }: { menus: MenuDef[] }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const pos = (i: number): { x: number; y: number } => {
    const r = refs.current[i]?.getBoundingClientRect()
    return { x: r?.left ?? 0, y: r?.bottom ?? 0 }
  }

  return (
    <nav
      className={`menubar${open !== null ? ' open' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(null)
      }}
    >
      {menus.map((m, i) => (
        <button
          key={m.label}
          ref={(el) => (refs.current[i] = el)}
          className={`menubar-item${open === i ? ' active' : ''}`}
          onClick={() => setOpen((o) => (o === i ? null : i))}
          onMouseEnter={() => open !== null && setOpen(i)}
        >
          {m.label}
        </button>
      ))}
      {open !== null && (
        <TreeMenu
          key={open}
          {...pos(open)}
          items={menus[open].items}
          onClose={() => setOpen(null)}
          className="menubar-menu"
        />
      )}
    </nav>
  )
}
