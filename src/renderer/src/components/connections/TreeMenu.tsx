import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Menu contextuel de l'explorateur d'objets (clic droit), avec sous-menus
 * au survol comme dans SSMS (« Générer un script en tant que ▸ SELECT ▸ … »).
 */
export type MenuItem =
  | 'sep'
  | {
      label: string
      onClick?: () => void
      /** Action du double-clic, affichée en gras (convention SSMS) */
      bold?: boolean
      disabled?: boolean
      children?: MenuItem[]
    }

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            className="ctx-entry"
            onMouseEnter={() => setOpen(item.children ? i : null)}
          >
            <button
              className={`ctx-item${item.bold ? ' ctx-bold' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.children) {
                  setOpen(i)
                  return
                }
                item.onClick?.()
                onDone()
              }}
            >
              {item.label}
              {item.children && <span className="ctx-arrow">▸</span>}
            </button>
            {item.children && open === i && (
              <div className="ctx-menu ctx-submenu">
                <MenuList items={item.children} onDone={onDone} />
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}

export default function TreeMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Reste dans la fenêtre : un menu ouvert en bas de l'arbre remonte.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8)
    })
  }, [x, y])

  return (
    <>
      <div
        className="ctx-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="ctx-menu tree-menu" ref={ref} style={pos}>
        <MenuList items={items} onDone={onClose} />
      </div>
    </>
  )
}
