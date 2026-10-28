import type { InstrumentResult } from '@shared/types'
import { formatSqlValue, useReplayStore } from '../../stores/replayStore'
import { Download, SlidersHorizontal, Stethoscope, TriangleAlert } from 'lucide-react'
import EmptyState from '../ui/EmptyState'

interface Props {
  instr: InstrumentResult | null
  paramValues: Record<string, string | null>
  onParamChange: (name: string, value: string | null) => void
  snapshotTargets: string
  onSnapshotTargetsChange: (value: string) => void
  readOnly: boolean
  onReadOnlyChange: (value: boolean) => void
  roWhitelist: string
  onRoWhitelistChange: (value: string) => void
  onExport: (format: 'md' | 'json') => void
  onDiagnose: () => void
}

export default function RunPanel({
  instr,
  paramValues,
  onParamChange,
  snapshotTargets,
  onSnapshotTargetsChange,
  readOnly,
  onReadOnlyChange,
  roWhitelist,
  onRoWhitelistChange,
  onExport,
  onDiagnose
}: Props): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const hasFailure =
    run !== null && (run.errors.length > 0 || run.steps.some((s) => s.kind === 'catch'))

  if (!instr) {
    return (
      <EmptyState icon={SlidersHorizontal} title="Paramètres de la procédure">
        Ouvrez une procédure (clic droit › Déboguer dans l&apos;explorateur) ou cliquez sur
        Analyser (Ctrl+F5) : ses paramètres apparaîtront ici, à remplir avant d&apos;exécuter.
      </EmptyState>
    )
  }

  const untraced = instr.statements.filter((s) => s.kind === 'statement' && !s.traced)

  return (
    <div className="tables">
      {instr.errors.length > 0 && (
        <div className="error-box">
          {instr.errors.map((e, i) => (
            <div key={i}>
              Erreur {e.number} — ligne {e.line}, col {e.column} : {e.message}
            </div>
          ))}
        </div>
      )}

      {run && run.errors.length > 0 && (
        <div className="error-box">
          {run.errors.map((e, i) => (
            <div key={i}>
              Erreur SQL {e.number}
              {e.line !== null ? ` — ligne ${e.line}` : ''} : {e.message}
            </div>
          ))}
        </div>
      )}

      {instr.procedureName && (
        <>
          <h3>Procédure {instr.procedureName}</h3>
          {instr.parameters.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Paramètre</th>
                  <th>Type</th>
                  <th>Valeur</th>
                </tr>
              </thead>
              <tbody>
                {instr.parameters.map((p) => (
                  <tr key={p.name}>
                    <td className="vars">
                      {p.name}
                      {p.isOutput ? ' (OUT)' : ''}
                    </td>
                    <td>{p.type}</td>
                    <td>
                      {p.isOutput ? (
                        <span className="vars">
                          {run ? formatSqlValue(run.outputValues[p.name]) : '—'}
                        </span>
                      ) : (
                        <input
                          className="param-input"
                          placeholder={p.hasDefault ? `défaut : ${p.defaultText}` : 'NULL'}
                          value={paramValues[p.name] ?? ''}
                          onChange={(e) =>
                            onParamChange(p.name, e.target.value === '' ? null : e.target.value)
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">Aucun paramètre.</p>
          )}
        </>
      )}

      <h3>Sécurité</h3>
      <label className="toggle readonly-toggle">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(e) => onReadOnlyChange(e.target.checked)}
        />
        Mode lecture seule strict
      </label>
      <p className="hint">
        Refuse d&apos;exécuter si l&apos;analyse détecte des écritures hors{' '}
        <span className="vars">#temp</span> / variables tables. Les EXEC (procs, SQL
        dynamique) sont considérés opaques.
      </p>
      {readOnly && (
        <>
          <input
            className="param-input snapshot-input"
            placeholder="liste blanche : dbo.MonJournal, dbo.ProcSure"
            value={roWhitelist}
            onChange={(e) => onRoWhitelistChange(e.target.value)}
          />
          <p className="hint">Tables/procédures autorisées en écriture malgré tout.</p>
        </>
      )}

      <h3>Snapshots de tables</h3>
      <input
        className="param-input snapshot-input"
        placeholder="#MaTemp, @MaVarTable, dbo.Table"
        value={snapshotTargets}
        onChange={(e) => onSnapshotTargetsChange(e.target.value)}
      />
      <p className="hint">
        Contenu capturé après chaque écriture (INSERT/UPDATE/DELETE/MERGE) — diff visible
        dans l&apos;onglet Données, y compris à travers les ROLLBACK.
      </p>

      {run && (
        <>
          <h3>
            Session
            <button className="link-btn" onClick={() => onExport('md')}>
              <Download size={13} aria-hidden="true" /> Markdown
            </button>
            <button className="link-btn" onClick={() => onExport('json')}>
              <Download size={13} aria-hidden="true" /> JSON
            </button>
            {hasFailure && (
              <button className="link-btn danger" onClick={onDiagnose}>
                <Stethoscope size={13} aria-hidden="true" /> Diagnostiquer
              </button>
            )}
          </h3>
          <table>
            <tbody>
              <tr>
                <td>Steps capturés</td>
                <td>{run.steps.length}</td>
              </tr>
              <tr>
                <td>Resultsets métier</td>
                <td>{run.resultsets.length}</td>
              </tr>
              <tr>
                <td>Session</td>
                <td className="vars">{run.sessionId}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {untraced.length > 0 && (
        <>
          <h3>
            <TriangleAlert size={13} aria-hidden="true" /> Instructions non tracées ({untraced.length})
          </h3>
          <table>
            <tbody>
              {untraced.map((s) => (
                <tr key={s.index}>
                  <td>ligne {s.startLine}</td>
                  <td>{s.type}</td>
                  <td className="hint">{s.skipReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
