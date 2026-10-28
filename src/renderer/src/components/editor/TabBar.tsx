import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileCode2, LoaderCircle, Lock, Pin, X } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useConnectionsStore } from '../../stores/connectionsStore'
import { useExplorerStore } from '../../stores/explorerStore'
import { tabLabel } from '../../lib/tabLabel'
import TreeMenu from '../connections/TreeMenu'

interface Props {
  /** Session de debug ou profilage live : on gèle l'ouverture/fermeture/bascule d'onglets. */
  locked: boolean
  onSwitch: (id: string) => void
  /** Onglet dont l'exécution tourne (« Exécution… » après son nom, comme SSMS) */
  runningTabId: string | null
  onClose: (id: string) => void
  /** Clic droit sur un onglet (menu Fermer / Épingler / Copier le chemin…) */
  onTabMenu: (id: string, x: number, y: number) => void
}

/**
 * Onglets de documents, sur le bandeau de SSMS : l'onglet actif est coloré et
 * prolongé par un liseré sur toute la largeur ; « ▾ » à droite liste tous les
 * documents ouverts quand ils ne tiennent plus dans la largeur.
 */
export default function TabBar({
  locked,
  onSwitch,
  runningTabId,
  onClose,
  onTabMenu
}: Props): JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const connections = useConnectionsStore((s) => s.connections)
  // Comme SSMS, une seule zone « active » à la fois : quand l'explorateur a le
  // focus, l'onglet de document s'atténue.
  const inactive = useExplorerStore((s) => s.focusArea === 'explorer')
  const tabsRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLButtonElement>(null)
  const [list, setList] = useState<{ x: number; y: number } | null>(null)

  // L'onglet actif reste visible (un nouvel onglet s'ajoute à droite, souvent hors champ).
  useEffect(() => {
    tabsRef.current
      ?.querySelector('.doc-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  return (
    <div className={`doc-tabs${inactive ? ' inactive' : ''}`}>
      <div
        className="doc-tabs-scroll"
        ref={tabsRef}
        role="tablist"
        // Molette : défilement horizontal des onglets, comme les éditeurs à onglets.
        onWheel={(e) => {
          if (tabsRef.current && e.deltaY !== 0) tabsRef.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((t) => {
          const label = tabLabel(t, connections.find((c) => c.id === t.connectionId) ?? null)
          const running = t.id === runningTabId
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              className={`doc-tab${t.id === activeId ? ' active' : ''}${t.pinned ? ' pinned' : ''}`}
              onClick={() => onSwitch(t.id)}
              onAuxClick={(e) => {
                // Clic molette : ferme l'onglet (usage courant des éditeurs à onglets).
                if (e.button === 1 && !locked) onClose(t.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onTabMenu(t.id, e.clientX, e.clientY)
              }}
              data-tip={t.filePath ? `${label.full} — ${t.filePath}` : label.full}
            >
              {running ? (
                <LoaderCircle size={13} className="doc-tab-icon spin" aria-hidden="true" />
              ) : (
                <FileCode2 size={13} className="doc-tab-icon" aria-hidden="true" />
              )}
              <span className="doc-tab-title">
                <span className="doc-tab-name">{t.title}</span>
                <span className={`doc-tab-target${t.connectionId ? '' : ' off'}`}>
                  {' '}
                  - {label.target}
                </span>
                {t.dirty ? '*' : ''}
                {running && <span className="doc-tab-running"> Exécution…</span>}
              </span>
              {t.pinned && <Pin size={12} className="doc-tab-pin" aria-label="Onglet épinglé" />}
              <button
                type="button"
                className="doc-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.id)
                }}
                aria-label={`Fermer ${t.title}`}
                aria-disabled={locked || undefined}
                data-tip="Fermer"
                data-shortcut="Ctrl+W"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
      {locked && (
        <span
          className="doc-tabs-lock"
          data-tip="Exécution ou débogage en cours : les onglets sont gelés jusqu'à la fin"
          aria-label="Onglets gelés pendant l'exécution"
        >
          <Lock size={13} aria-hidden="true" />
        </span>
      )}
      <button
        ref={listRef}
        type="button"
        className="doc-tabs-list"
        data-tip="Tous les documents ouverts"
        onClick={() => {
          const r = listRef.current?.getBoundingClientRect()
          if (r) setList({ x: r.right - 280, y: r.bottom + 2 })
        }}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {list && (
        <TreeMenu
          x={list.x}
          y={list.y}
          onClose={() => setList(null)}
          items={tabs.map((t) => ({
            label: `${t.title}${t.dirty ? '*' : ''}`,
            checked: t.id === activeId,
            disabled: locked && t.id !== activeId,
            onClick: () => onSwitch(t.id)
          }))}
        />
      )}
    </div>
  )
}
