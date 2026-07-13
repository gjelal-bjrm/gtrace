import { useReplayStore } from '../../stores/replayStore'
import DataGrid from './DataGrid'

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
          <DataGrid columns={rs.columns} rows={rs.rows} name={`gtrace-resultset-${rs.index + 1}`} />
        </div>
      ))}
    </div>
  )
}
