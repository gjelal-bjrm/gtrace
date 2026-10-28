import { memo, useEffect, useState, type JSX } from 'react'
import { History, TriangleAlert, X } from 'lucide-react'
import type { HistoryEntry, HistoryEntrySummary } from '@shared/types'
import DockPanel from '../layout/DockPanel'

interface Props {
  onLoadHistory: (entry: HistoryEntry) => void
  /** Incrémenté à chaque nouvelle session sauvegardée → rafraîchit la liste */
  version: number
  /** Session/exécution en cours : replay et suppression gelés. */
  locked: boolean
}

/**
 * Exécutions passées : chaque lancement est enregistré avec sa trace complète
 * et peut être rouvert plus tard **sans relancer la requête**.
 *
 * Replié par défaut : c'est un outil qu'on va chercher, pas une information
 * dont on a besoin en permanence. L'état d'ouverture est mémorisé.
 */
function HistoryPanel({ onLoadHistory, version, locked }: Props): JSX.Element {
  const [history, setHistory] = useState<HistoryEntrySummary[]>([])
  const [open, setOpen] = useState(() => localStorage.getItem('gtrace.historyOpen') === '1')

  useEffect(() => {
    void window.gtrace.historyList().then(setHistory)
  }, [version])

  const toggle = (): void =>
    setOpen((v) => {
      localStorage.setItem('gtrace.historyOpen', v ? '0' : '1')
      return !v
    })

  return (
    <DockPanel
      title="Exécutions passées"
      className="history-panel"
      collapsible
      open={open}
      onToggle={toggle}
      badge={history.length > 0 ? <span className="dock-badge">{history.length}</span> : undefined}
    >
      <ul className="history-list">
        {history.length === 0 ? (
          <li className="hint history-empty">
            Rien pour l&apos;instant. Chaque exécution viendra s&apos;ajouter ici et pourra être
            rouverte telle quelle, sans relancer la requête.
          </li>
        ) : (
          history.map((h) => (
            <li key={h.id}>
              <button
                className="history-item"
                disabled={locked}
                onClick={() => void window.gtrace.historyLoad(h.id).then(onLoadHistory)}
                data-tip={`Rouvrir cette exécution, sans la relancer — ${h.server} / ${h.database}`}
              >
                <History size={14} className="history-icon" aria-hidden="true" />
                <span className="history-text">
                  <span className="history-title">
                    {h.errorCount > 0 && (
                      <TriangleAlert size={12} className="history-warn" aria-label="Avec erreurs" />
                    )}
                    {h.title}
                  </span>
                  <span className="history-meta">
                    {h.database} · {h.stepCount} étapes ·{' '}
                    {new Date(h.savedAt).toLocaleString(undefined, {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </span>
              </button>
              <button
                className="history-delete"
                data-tip="Supprimer cette exécution enregistrée"
                aria-label="Supprimer cette exécution enregistrée"
                disabled={locked}
                onClick={() =>
                  void window.gtrace
                    .historyDelete(h.id)
                    .then(() => window.gtrace.historyList())
                    .then(setHistory)
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>
    </DockPanel>
  )
}

export default memo(HistoryPanel)
