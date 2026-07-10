import { useEffect, useState } from 'react'
import type { HistoryEntry, HistoryEntrySummary } from '@shared/types'

interface Props {
  onLoadHistory: (entry: HistoryEntry) => void
  /** Incrémenté à chaque nouvelle session sauvegardée → rafraîchit la liste */
  version: number
  /** Session/exécution en cours : replay et suppression gelés. */
  locked: boolean
}

/** Sessions de debug enregistrées — rejouables sans réexécuter (bas du panneau gauche). */
export default function HistoryPanel({ onLoadHistory, version, locked }: Props): JSX.Element {
  const [history, setHistory] = useState<HistoryEntrySummary[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    void window.gtrace.historyList().then(setHistory)
  }, [version])

  return (
    <div className="history-panel">
      <button className="section-header" onClick={() => setOpen((v) => !v)}>
        <span className="tree-twisty">{open ? '▾' : '▸'}</span> 🕘 Historique ({history.length})
      </button>
      {open && (
        <ul className="history-list">
          {history.length === 0 && (
            <li className="hint">Les sessions exécutées se rejouent d&apos;ici.</li>
          )}
          {history.map((h) => (
            <li key={h.id}>
              <button
                className="history-item"
                disabled={locked}
                onClick={() => void window.gtrace.historyLoad(h.id).then(onLoadHistory)}
                title={`${h.server}/${h.database} — ${new Date(h.savedAt).toLocaleString()}`}
              >
                <span className="history-title">
                  {h.errorCount > 0 ? '⚠ ' : ''}
                  {h.title}
                </span>
                <span className="history-meta">
                  {h.stepCount} steps · {new Date(h.savedAt).toLocaleTimeString()}
                </span>
              </button>
              <button
                className="btn btn-icon"
                title="Supprimer"
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
          ))}
        </ul>
      )}
    </div>
  )
}
