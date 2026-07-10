import { useEditorStore } from '../../stores/editorStore'
import { IconNewFile, IconOpenFolder, IconSave } from './icons'

interface Props {
  /** Session de debug ou profilage live : on gèle l'ouverture/fermeture/bascule d'onglets. */
  locked: boolean
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
}

export default function TabBar({
  locked,
  onSwitch,
  onClose,
  onNew,
  onOpen,
  onSave,
  onSaveAs
}: Props): JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)

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
      <div className="tabbar-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`editor-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => onSwitch(t.id)}
            title={t.filePath ?? t.title}
          >
            <span className="tab-title">
              {t.dirty ? '● ' : ''}
              {t.title}
            </span>
            {t.database && <span className="tab-db">{t.database}</span>}
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
        ))}
      </div>
      {locked && <span className="tabbar-lock">session active — onglets gelés</span>}
    </div>
  )
}
