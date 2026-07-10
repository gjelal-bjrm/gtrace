import { formatSqlValue, useReplayStore, variablesAt } from '../../stores/replayStore'

export default function VariablesPanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)

  if (!run) return <p className="hint">Exécuter d&apos;abord (▶) pour inspecter les variables.</p>
  if (run.steps.length === 0) return <p className="hint">Aucun step capturé.</p>

  const variables = variablesAt(run, currentStep)
  const step = run.steps[currentStep]

  return (
    <div className="tables">
      {step.error && (
        <div className="error-box">
          Erreur {step.error.number}
          {step.error.line !== null ? ` — ligne ${step.error.line}` : ''} : {step.error.message}
        </div>
      )}
      {step.returnValue !== null && (
        <div className="return-box">RETURN → {formatSqlValue(step.returnValue)}</div>
      )}
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Valeur</th>
            <th>Écrite au step</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v) => (
            <tr key={v.name} className={v.changedNow ? 'var-changed' : ''}>
              <td className="vars">{v.name}</td>
              <td className="vars">
                {formatSqlValue(v.value)}
                {v.changedNow && v.hasPrevious && (
                  <span className="var-previous"> ← {formatSqlValue(v.previous)}</span>
                )}
              </td>
              <td>{v.changedAtStep}</td>
            </tr>
          ))}
          {variables.length === 0 && (
            <tr>
              <td colSpan={3} className="hint">
                Aucune variable écrite jusqu&apos;ici.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
