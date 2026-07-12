/**
 * Grille de données lisible : en-tête figé (scroll vertical), colonne de numéros
 * figée à gauche (scroll horizontal), cellules bornées avec info-bulle sur la
 * valeur complète, NULL grisé, nombres alignés à droite. Utilisée pour les
 * resultsets et les snapshots.
 */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '')
  return String(v)
}

function cellClass(v: unknown): string {
  if (v === null || v === undefined) return 'cell-null'
  if (typeof v === 'number' || typeof v === 'bigint') return 'cell-num'
  return ''
}

export default function DataGrid({
  columns,
  rows,
  maxRows = 500
}: {
  columns: string[]
  rows: unknown[][]
  maxRows?: number
}): JSX.Element {
  const shown = rows.slice(0, maxRows)
  return (
    <div className="grid-block">
      <div className="grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              <th className="grid-rownum">#</th>
              {columns.map((c, i) => (
                <th key={i} title={c}>
                  {c || `(col ${i + 1})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, ri) => (
              <tr key={ri}>
                <td className="grid-rownum">{ri + 1}</td>
                {row.map((cell, ci) => {
                  const t = cellText(cell)
                  return (
                    <td key={ci} className={cellClass(cell)} title={t}>
                      {t}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <p className="hint grid-more">… {rows.length - maxRows} ligne(s) supplémentaire(s) masquée(s)</p>
      )}
    </div>
  )
}
