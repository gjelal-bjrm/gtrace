import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionRef, ResultSetData } from '@shared/types'
import { formatSqlValue } from '../../stores/replayStore'

interface Props {
  activeRef: ConnectionRef | null
  sessionActive: boolean
  /** seq de la pause courante : les watches sont réévaluées à chaque changement */
  pauseSeq: number | null
}

interface WatchResult {
  ok: boolean
  text: string
}

export default function InspectPanel({ activeRef, sessionActive, pauseSeq }: Props): JSX.Element {
  const [watches, setWatches] = useState<string[]>([])
  const [newWatch, setNewWatch] = useState('')
  const [watchResults, setWatchResults] = useState<WatchResult[]>([])
  const watchesRef = useRef(watches)
  watchesRef.current = watches
  const [sqlText, setSqlText] = useState('SELECT TOP (20) * FROM ')
  const [readUncommitted, setReadUncommitted] = useState(true)
  const [results, setResults] = useState<ResultSetData[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    if (!activeRef) {
      setError('Aucune connexion active : connectez-vous à un serveur pour interroger.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setResults(await window.gtrace.inspectQuery(activeRef, sqlText, readUncommitted))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResults(null)
    } finally {
      setBusy(false)
    }
  }, [activeRef, sqlText, readUncommitted])

  const evalWatches = useCallback(async () => {
    if (!activeRef) return
    const expressions = watchesRef.current
    const outcomes = await Promise.all(
      expressions.map(async (expr): Promise<WatchResult> => {
        try {
          const rs = (await window.gtrace.inspectQuery(activeRef, expr, true))[0]
          if (!rs || rs.rows.length === 0) return { ok: true, text: '(vide)' }
          if (rs.rows.length === 1 && rs.rows[0].length === 1) {
            return { ok: true, text: formatSqlValue(rs.rows[0][0]) }
          }
          return {
            ok: true,
            text: `${rs.rows.length} ligne(s) — ` +
              rs.rows.slice(0, 3).map((r) => r.map(formatSqlValue).join(' | ')).join(' ; ')
          }
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) }
        }
      })
    )
    // Fraîcheur : si la liste des watches a changé pendant les requêtes en vol
    // (ex. suppression), on n'écrase pas avec des résultats désalignés.
    if (watchesRef.current === expressions) setWatchResults(outcomes)
  }, [activeRef])

  // Réévaluation automatique à chaque pause de la session de debug
  useEffect(() => {
    if (pauseSeq !== null && watchesRef.current.length > 0) void evalWatches()
  }, [pauseSeq, evalWatches])

  return (
    <div className="inspect">
      <p className="hint">
        Requêtes ad hoc sur une <strong>connexion séparée</strong> de la session déboguée.
        {sessionActive && (
          <>
            {' '}
            ⚠ La session en pause peut tenir des locks : sans READ UNCOMMITTED, cette requête
            peut se bloquer ; avec, elle lit des données non commitées.
          </>
        )}
      </p>

      <div className="tables">
        <h3>
          Watch ({watches.length})
          {watches.length > 0 && (
            <button className="link-btn" onClick={() => void evalWatches()}>
              ↻ réévaluer
            </button>
          )}
        </h3>
        {watches.map((expr, i) => (
          <div key={i} className="watch-row">
            <span className="vars watch-expr" title={expr}>
              {expr}
            </span>
            <span className={watchResults[i]?.ok === false ? 'watch-error' : 'watch-value'}>
              {watchResults[i]?.text ?? '—'}
            </span>
            <button
              className="link-btn"
              onClick={() => {
                setWatches((w) => w.filter((_, j) => j !== i))
                setWatchResults((r) => r.filter((_, j) => j !== i))
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="watch-row">
          <input
            className="watch-input"
            placeholder="expression SQL, ex. SELECT COUNT(*) FROM ventes.Commande"
            value={newWatch}
            onChange={(e) => setNewWatch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newWatch.trim()) {
                setWatches((w) => [...w, newWatch.trim()])
                setNewWatch('')
              }
            }}
          />
        </div>
        <p className="hint">
          Réévaluées à chaque pause (READ UNCOMMITTED : voit l&apos;état non commité de la
          session déboguée). Les variables locales ne sont pas visibles ici — elles sont dans
          l&apos;onglet Variables.
        </p>
      </div>
      <textarea
        className="inspect-input"
        spellCheck={false}
        value={sqlText}
        onChange={(e) => setSqlText(e.target.value)}
      />
      <div className="inspect-controls">
        <label className="toggle">
          <input
            type="checkbox"
            checked={readUncommitted}
            onChange={(e) => setReadUncommitted(e.target.checked)}
          />
          READ UNCOMMITTED
        </label>
        <button onClick={run} disabled={busy || !sqlText.trim()}>
          {busy ? '…' : 'Exécuter'}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {results?.map((rs) => (
        <div key={rs.index} className="tables">
          <h3>Resultset {rs.index + 1} — {rs.rows.length} ligne(s)</h3>
          <table>
            <thead>
              <tr>
                {rs.columns.map((c, i) => (
                  <th key={i}>{c || `(col ${i + 1})`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rs.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{formatSqlValue(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {results && results.length === 0 && <p className="hint">Aucun resultset.</p>}
    </div>
  )
}
