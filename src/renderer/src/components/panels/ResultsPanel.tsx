import { formatSqlValue, useReplayStore } from '../../stores/replayStore'

export default function ResultsPanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)
  const select = useReplayStore((s) => s.select)

  if (!run) return <p className="hint">Exécuter d&apos;abord (▶) pour voir les resultsets.</p>
  if (run.resultsets.length === 0) return <p className="hint">Aucun resultset métier produit.</p>

  return (
    <div className="tables">
      {run.resultsets.map((rs) => (
        <div
          key={rs.index}
          className={`resultset${rs.stepIndex === currentStep ? ' resultset-current' : ''}`}
        >
          <h3>
            Resultset {rs.index + 1} — {rs.rows.length} ligne(s)
            {rs.stepIndex !== null && (
              <button className="link-btn" onClick={() => select(rs.stepIndex!)}>
                step {rs.stepIndex} ↗
              </button>
            )}
          </h3>
          <table>
            <thead>
              <tr>
                {rs.columns.map((c, i) => (
                  <th key={i}>{c || `(col ${i + 1})`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rs.rows.slice(0, 200).map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{formatSqlValue(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rs.rows.length > 200 && <p className="hint">… {rs.rows.length - 200} lignes masquées</p>}
        </div>
      ))}
    </div>
  )
}
