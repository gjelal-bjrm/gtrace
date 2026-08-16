import type { JSX } from 'react'
import { formatSqlValue, useReplayStore, variablesAt } from '../../stores/replayStore'
import { useWatchStore } from '../../stores/watchStore'

export default function VariablesPanel({
  onOpenProcedure
}: {
  /** Ouvre le corps de la procédure appelée, paramètres repris de l'appel. */
  onOpenProcedure?: () => void
} = {}): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)
  const colorOf = useWatchStore((s) => s.colorOf)
  const cycle = useWatchStore((s) => s.cycle)
  useWatchStore((s) => s.marked) // re-rendu au changement de marquage

  if (!run) return <p className="hint">Exécuter d&apos;abord (▶) pour inspecter les variables.</p>
  if (run.steps.length === 0) return <p className="hint">Aucun step capturé.</p>

  const variables = variablesAt(run, currentStep)
  const step = run.steps[currentStep]
  // Les variables suivies remontent en tête : on les garde sous les yeux même
  // quand la procédure en déclare quarante.
  const sorted = [...variables].sort((a, b) => {
    const wa = colorOf(a.name) ? 0 : 1
    const wb = colorOf(b.name) ? 0 : 1
    return wa - wb || a.name.localeCompare(b.name)
  })

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
        {onOpenProcedure && (
          <div className="proc-call-action">
            <button className="btn btn-primary" onClick={onOpenProcedure}>
              📂 Ouvrir la procédure et suivre ses variables
            </button>
            <span className="hint">
              GTrace va chercher son code en base, l&apos;ouvre dans un onglet et reprend
              automatiquement les valeurs de votre appel comme paramètres.
            </span>
          </div>
        )}
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
            <th className="var-mark-col" title="Suivre une variable : elle passe en tête et ses étapes sont repérées dans la chronologie">
              ★
            </th>
            <th>Variable</th>
            <th>Valeur</th>
            <th>Écrite à l&apos;étape</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((v) => {
            const color = colorOf(v.name)
            return (
              <tr
                key={v.name}
                className={`${v.changedNow ? 'var-changed' : ''}${color ? ' var-watched' : ''}`}
                style={color ? { borderLeft: `3px solid ${color}` } : undefined}
              >
                <td className="var-mark-col">
                  <button
                    className="var-mark"
                    onClick={() => cycle(v.name)}
                    title={
                      color
                        ? 'Changer de couleur, puis arrêter de suivre'
                        : 'Suivre cette variable : repères colorés dans la chronologie'
                    }
                    style={color ? { color, opacity: 1 } : undefined}
                  >
                    {color ? '★' : '☆'}
                  </button>
                </td>
                <td className="vars">{v.name}</td>
                <td className="vars">
                  {formatSqlValue(v.value)}
                  {v.changedNow && v.hasPrevious && (
                    <span className="var-previous"> ← {formatSqlValue(v.previous)}</span>
                  )}
                </td>
                <td>{v.changedAtStep}</td>
              </tr>
            )
          })}
          {variables.length === 0 && (
            <tr>
              <td colSpan={4} className="hint">
                Aucune variable écrite jusqu&apos;ici.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
