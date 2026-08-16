import type { JSX } from 'react'
import { formatSqlValue, useReplayStore, variablesAt } from '../../stores/replayStore'

export default function VariablesPanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)

  if (!run) return <p className="hint">Exécuter d&apos;abord (▶) pour inspecter les variables.</p>
  if (run.steps.length === 0) return <p className="hint">Aucun step capturé.</p>

  const variables = variablesAt(run, currentStep)
  const step = run.steps[currentStep]

  /*
   * Cas très déroutant : on lance « ma_procedure 123 » depuis un script. GTrace
   * trace le script APPELANT — donc une seule instruction EXEC, sans aucune
   * variable — et l'utilisateur croit que rien ne s'est passé. On explique donc
   * ici comment voir l'intérieur de la procédure.
   */
  const appelDeProcedure =
    run.steps.length === 1 &&
    run.steps.every((s) => Object.keys(s.variables).length === 0) &&
    (run.instrument.statements[run.steps[0].statementIndex]?.type ?? '').includes('Execute')

  if (appelDeProcedure) {
    return (
      <div className="proc-call-hint">
        <p>
          <strong>Cette exécution ne contient qu&apos;un appel de procédure.</strong> GTrace a tracé
          le script que vous avez lancé — soit une seule instruction — et non l&apos;intérieur de la
          procédure. C&apos;est pour cela qu&apos;aucune variable n&apos;apparaît ici.
        </p>
        <p className="hint">
          Pour suivre les variables <em>à l&apos;intérieur</em> de la procédure, ouvrez son code :
          explorateur à gauche → <strong>Procédures stockées</strong> → icône{' '}
          <strong>🐞</strong>. Renseignez ensuite ses paramètres dans l&apos;onglet{' '}
          <em>Exécution</em>, puis relancez.
        </p>
        <p className="hint">
          Ce que la procédure a <em>renvoyé</em> reste visible dans l&apos;onglet{' '}
          <strong>Résultats</strong>.
        </p>
      </div>
    )
  }

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
