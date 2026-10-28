import { memo, useMemo } from 'react'
import type { TableSnapshot } from '@shared/types'
import { formatSqlValue, useReplayStore } from '../../stores/replayStore'
import { Camera } from 'lucide-react'
import EmptyState from '../ui/EmptyState'
import { multisetDiff, rowKey } from '../../lib/tableDiff'

interface DiffedSnapshot {
  snapshot: TableSnapshot
  previous: TableSnapshot | null
  addedKeys: Map<string, number>
  removedRows: unknown[][]
}

/** Lignes ajoutées/supprimées entre deux snapshots de la même table. */
function diff(current: TableSnapshot, previous: TableSnapshot | null): DiffedSnapshot {
  return { snapshot: current, previous, ...multisetDiff(current.rows, previous?.rows ?? []) }
}

function SnapshotsPanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)

  const byTable = useMemo(() => {
    const groups = new Map<string, TableSnapshot[]>()
    for (const snap of run?.snapshots ?? []) {
      const list = groups.get(snap.table) ?? []
      list.push(snap)
      groups.set(snap.table, list)
    }
    return groups
  }, [run])

  if (!run) {
    return (
      <EmptyState icon={Camera} title="Aucune donnée suivie">
        Indiquez des tables à suivre dans l&apos;onglet Paramètres puis exécutez : leur contenu
        est capturé après chaque écriture — y compris <span className="vars">#temp</span> et
        variables tables, et même à travers un ROLLBACK.
      </EmptyState>
    )
  }
  if (byTable.size === 0) {
    return (
      <p className="hint">
        Aucun snapshot dans cette session. Saisissez les tables à suivre dans l&apos;onglet
        Exécution (ex. <span className="vars">#Candidates, @Erreurs</span>) avant d&apos;exécuter.
      </p>
    )
  }

  return (
    <div className="tables">
      {[...byTable.entries()].map(([table, snaps]) => {
        // Snapshot courant : le dernier pris à un step <= step courant du replay
        let idx = -1
        for (let i = snaps.length - 1; i >= 0; i--) {
          if (snaps[i].stepIndex <= currentStep) {
            idx = i
            break
          }
        }
        if (idx < 0) {
          return (
            <div key={table}>
              <h3>{table}</h3>
              <p className="hint">Pas encore de snapshot à ce point du replay.</p>
            </div>
          )
        }
        const { snapshot, previous, addedKeys, removedRows } = diff(
          snaps[idx],
          idx > 0 ? snaps[idx - 1] : null
        )
        const seen = new Map<string, number>()
        return (
          <div key={table}>
            <h3>
              {table} — step {snapshot.stepIndex} ({snapshot.rows.length} ligne(s)
              {previous ? `, +${[...addedKeys.values()].reduce((a, b) => a + b, 0)} / −${removedRows.length} vs step ${previous.stepIndex}` : ''}
              )
            </h3>
            <div className="grid-scroll">
              <table className="data-grid snap-grid">
                <thead>
                  <tr>
                    {snapshot.columns.map((c, i) => (
                      <th key={i} title={c}>
                        {c || `(col ${i + 1})`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((row, ri) => {
                    const k = rowKey(row)
                    const used = seen.get(k) ?? 0
                    const isAdded = used < (addedKeys.get(k) ?? 0)
                    seen.set(k, used + 1)
                    return (
                      <tr key={ri} className={isAdded ? 'row-added' : ''}>
                        {row.map((cell, ci) => {
                          const t = formatSqlValue(cell)
                          return (
                            <td key={ci} title={t}>
                              {t}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {removedRows.map((row, ri) => (
                    <tr key={`del-${ri}`} className="row-removed">
                      {row.map((cell, ci) => {
                        const t = formatSqlValue(cell)
                        return (
                          <td key={ci} title={t}>
                            {t}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Points de capture : {snaps.map((s) => `step ${s.stepIndex}`).join(' → ')}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export default memo(SnapshotsPanel)
