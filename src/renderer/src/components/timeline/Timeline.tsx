import { useReplayStore } from '../../stores/replayStore'

/** Couleur d'un step selon sa durée relative (neutre → chaud → rouge, via le thème). */
function heatColor(durationMs: number | null, maxMs: number, isCatch: boolean): string {
  if (isCatch) return 'var(--error)'
  if (durationMs === null || maxMs <= 0) return 'var(--heat-0)'
  const ratio = Math.min(1, durationMs / maxMs)
  if (ratio < 0.25) return 'var(--heat-0)'
  if (ratio < 0.5) return 'var(--heat-1)'
  if (ratio < 0.75) return 'var(--heat-2)'
  return 'var(--heat-3)'
}

export default function Timeline(): JSX.Element | null {
  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)
  const { select, next, prev, first, last } = useReplayStore.getState()

  if (!run || run.steps.length === 0) return null

  const maxMs = Math.max(1, ...run.steps.map((s) => s.durationMs ?? 0))
  const current = run.steps[currentStep]
  const currentType =
    current.kind === 'catch'
      ? 'CATCH'
      : (run.instrument.statements[current.statementIndex]?.type ?? '?')

  return (
    <footer className="timeline-bar">
      <div className="transport">
        <button onClick={first} title="Premier step (Ctrl+←)">
          ⏮
        </button>
        <button onClick={prev} title="Step précédent (Shift+F10)">
          ◀
        </button>
        <button onClick={next} title="Step suivant (F10)">
          ▶
        </button>
        <button onClick={last} title="Dernier step (Ctrl+→)">
          ⏭
        </button>
        <span className="step-label">
          étape {currentStep + 1}/{run.steps.length} — ligne {current.startLine} — {currentType}
          {current.durationMs !== null ? ` — ${current.durationMs} ms` : ''}
          {current.rowCount !== null && current.rowCount >= 0 ? ` — ${current.rowCount} ligne(s)` : ''}
        </span>

        <span className="spacer" />

        {/* Sans légende, la bande colorée reste une énigme : on dit ce qu'elle
            représente et ce que veut dire chaque teinte. */}
        <span className="timeline-legend">
          <span className="legend-label">chaque case = une instruction exécutée · cliquez pour y revenir</span>
          <span className="legend-scale" title="Couleur selon le temps passé sur l'instruction">
            <i style={{ background: 'var(--heat-0)' }} />
            <i style={{ background: 'var(--heat-1)' }} />
            <i style={{ background: 'var(--heat-2)' }} />
            <i style={{ background: 'var(--heat-3)' }} />
            <span className="legend-ends">rapide → lent</span>
          </span>
          <span className="legend-err" title="Instruction ayant levé une erreur (bloc CATCH)">
            <i style={{ background: 'var(--error)' }} /> erreur
          </span>
        </span>
      </div>
      <div className="steps-strip">
        {run.steps.map((s) => (
          <div
            key={s.stepIndex}
            className={`step-block${s.stepIndex === currentStep ? ' selected' : ''}`}
            style={{ background: heatColor(s.durationMs, maxMs, s.kind === 'catch') }}
            title={[
              `Étape ${s.stepIndex + 1} sur ${run.steps.length} — ligne ${s.startLine}`,
              s.kind === 'catch'
                ? `⚠ Erreur interceptée : ${s.error?.message ?? ''}`
                : (run.instrument.statements[s.statementIndex]?.type ?? ''),
              s.durationMs !== null
                ? `Durée : ${s.durationMs} ms${
                    s.durationMs >= maxMs * 0.75
                      ? ' (parmi les plus lentes)'
                      : s.durationMs >= maxMs * 0.25
                        ? ' (moyenne)'
                        : ' (rapide)'
                  }`
                : 'Durée non mesurée',
              '',
              "Cliquez pour revenir à ce moment : l'éditeur surligne la ligne et",
              'les variables reprennent leur valeur d’alors.'
            ].join('\n')}
            onClick={() => select(s.stepIndex)}
          />
        ))}
      </div>
    </footer>
  )
}
