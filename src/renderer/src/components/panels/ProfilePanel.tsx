import type { ResultSetData, StepError, XeLineStat } from '@shared/types'
import { formatSqlValue } from '../../stores/replayStore'

interface Props {
  stats: XeLineStat[] | null
  elapsedMs: number | null
  resultsets: ResultSetData[]
  errors: StepError[]
}

const formatUs = (us: number): string => (us >= 1000 ? `${(us / 1000).toFixed(1)} ms` : `${us} µs`)

export default function ProfilePanel({ stats, elapsedMs, resultsets, errors }: Props): JSX.Element {
  if (!stats) {
    return (
      <p className="hint">
        « ⚡ Profiler » exécute le code <strong>sans instrumentation</strong> et capture durées et
        rowcounts par ligne via Extended Events (permission ALTER ANY EVENT SESSION requise).
        La heatmap colore les lignes lentes dans l&apos;éditeur.
      </p>
    )
  }

  return (
    <div className="tables">
      {errors.length > 0 && (
        <div className="error-box">
          {errors.map((e, i) => (
            <div key={i}>
              Erreur {e.number}
              {e.line !== null ? ` — ligne ${e.line}` : ''} : {e.message}
            </div>
          ))}
        </div>
      )}

      <h3>
        Profil ({stats.length} lignes{elapsedMs !== null ? ` — ${elapsedMs} ms au total` : ''})
      </h3>
      <table>
        <thead>
          <tr>
            <th>Ligne</th>
            <th>Exécutions</th>
            <th>Total</th>
            <th>Max</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.line}>
              <td>{s.line}</td>
              <td>{s.count}</td>
              <td className="vars">{formatUs(s.totalDurationUs)}</td>
              <td>{formatUs(s.maxDurationUs)}</td>
              <td>{s.rowCount || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {resultsets.map((rs) => (
        <div key={rs.index}>
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
    </div>
  )
}
