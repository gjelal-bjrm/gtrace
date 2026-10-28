import { useEffect, useRef } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useConnectionsStore } from '../../stores/connectionsStore'
import { tabLabel } from '../../lib/tabLabel'
import { IconNewFile, IconOpenFolder, IconSave } from './icons'

interface Props {
  /** Session de debug ou profilage live : on gèle l'ouverture/fermeture/bascule d'onglets. */
  locked: boolean
  onSwitch: (id: string) => void
  /** Onglet dont l'exécution tourne (« Exécution… » après son nom, comme SSMS) */
  runningTabId: string | null
  onClose: (id: string) => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
}

export default function TabBar({
  locked,
  onSwitch,
  runningTabId,
  onClose,
  onNew,
  onOpen,
  onSave,
  onSaveAs
}: Props): JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const connections = useConnectionsStore((s) => s.connections)
  const tabsRef = useRef<HTMLDivElement>(null)

  // L'onglet actif reste visible (un nouvel onglet s'ajoute à droite, souvent hors champ).
  useEffect(() => {
    tabsRef.current
      ?.querySelector('.editor-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  return (
    <div className="tabbar">
      <div className="tabbar-actions">
        <button
          className="tab-action-btn"
          onClick={onNew}
          disabled={locked}
          title="Nouvel onglet (Ctrl+N)"
        >
          <IconNewFile />
        </button>
        <button
          className="tab-action-btn"
          onClick={onOpen}
          disabled={locked}
          title="Ouvrir un fichier (Ctrl+O)"
        >
          <IconOpenFolder />
        </button>
        <button className="tab-action-btn" onClick={onSave} title="Enregistrer (Ctrl+S)">
          <IconSave />
        </button>
        <button
          className="tab-action-btn tab-action-saveas"
          onClick={onSaveAs}
          title="Enregistrer sous… (Ctrl+Maj+S)"
        >
          <IconSave />
          <span className="sa-plus">+</span>
        </button>
      </div>
      <div className="tabbar-tabs" ref={tabsRef}>
        {tabs.map((t) => {
          const label = tabLabel(t, connections.find((c) => c.id === t.connectionId) ?? null)
          return (
          <div
            key={t.id}
            className={`editor-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => onSwitch(t.id)}
            title={t.filePath ? `${label.full}
${t.filePath}` : label.full}
          >
            <span className="tab-title">
              <span className="tab-name">{t.title}</span>
              <span className={`tab-target${t.connectionId ? '' : ' off'}`}> - {label.target}</span>
              {t.dirty ? '*' : ''}
              {t.id === runningTabId && <span className="tab-running"> Exécution…</span>}
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
              disabled={locked}
              title="Fermer"
            >
              ×
            </button>
          </div>
          )
        })}
      </div>
      {locked && <span className="tabbar-lock">session active — onglets gelés</span>}
    </div>
  )
}
