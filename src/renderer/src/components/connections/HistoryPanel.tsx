import { useEffect, useState, type JSX } from 'react'
import type { HistoryEntry, HistoryEntrySummary } from '@shared/types'

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
export default function HistoryPanel({ onLoadHistory, version, locked }: Props): JSX.Element {
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
    <div className="history-panel">
      <button
        className="section-header"
        onClick={toggle}
        title="Chaque exécution est enregistrée avec sa trace : on peut la rouvrir et la rejouer sans relancer la requête sur le serveur."
      >
        <span className="tree-twisty">{open ? '▾' : '▸'}</span> 🕘 Exécutions passées
        {history.length > 0 && <span className="history-count">{history.length}</span>}
      </button>
      {open && (
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
                  title={`Rouvrir cette exécution (sans la relancer)\n${h.server} / ${h.database}\n${new Date(h.savedAt).toLocaleString()}`}
                >
                  <span className="history-title">
                    {h.errorCount > 0 ? '⚠ ' : ''}
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
                </button>
                <button
                  className="btn btn-icon"
                  title="Supprimer cette exécution enregistrée"
                  disabled={locked}
                  onClick={() =>
                    void window.gtrace
                      .historyDelete(h.id)
                      .then(() => window.gtrace.historyList())
                      .then(setHistory)
                  }
                >
                  ✕
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
