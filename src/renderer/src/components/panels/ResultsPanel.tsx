import { memo } from 'react'
import { useReplayStore } from '../../stores/replayStore'
import DataGrid from './DataGrid'
import { Table2 } from 'lucide-react'
import EmptyState from '../ui/EmptyState'

function ResultsPanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)
  const select = useReplayStore((s) => s.select)

  if (!run) {
    return (
      <EmptyState icon={Table2} title="Aucun résultat pour l'instant">
        Exécutez la requête (F5) : les jeux de résultats de vos SELECT s&apos;afficheront ici.
      </EmptyState>
    )
  }
  if (run.resultsets.length === 0) {
    return (
      <EmptyState icon={Table2} title="La requête n'a renvoyé aucun jeu de résultats">
        Le détail de l&apos;exécution (lignes affectées, erreurs) est dans l&apos;onglet Messages.
      </EmptyState>
    )
  }

  return (
    <div className="tables">
      {run.resultsets.map((rs) => (
        <div
          key={rs.index}
          className={`resultset${rs.stepIndex === currentStep ? ' resultset-current' : ''}`}
        >
          <h3>
            Jeu de résultats {rs.index + 1} · {rs.totalRows ?? rs.rows.length} ligne
            {(rs.totalRows ?? rs.rows.length) > 1 ? 's' : ''}
            {rs.stepIndex !== null && (
              <button
                className="link-btn"
                onClick={() => select(rs.stepIndex!)}
                data-tip="Aller à l'étape qui a produit ces lignes dans la chronologie"
              >
                étape {rs.stepIndex + 1} ↗
              </button>
            )}
          </h3>
          <DataGrid
            columns={rs.columns}
            rows={rs.rows}
            totalRows={rs.totalRows}
            name={`gtrace-resultset-${rs.index + 1}`}
          />
        </div>
      ))}
    </div>
  )
}

/** Sans propriétés : ne se redessine que si l'exécution ou l'étape courante change. */
export default memo(ResultsPanel)
