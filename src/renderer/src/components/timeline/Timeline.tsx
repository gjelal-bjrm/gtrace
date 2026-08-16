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
          step {currentStep + 1}/{run.steps.length} — ligne {current.startLine} — {currentType}
          {current.durationMs !== null ? ` — ${current.durationMs} ms` : ''}
          {current.rowCount !== null && current.rowCount >= 0 ? ` — ${current.rowCount} row(s)` : ''}
        </span>
      </div>
      <div className="steps-strip">
        {run.steps.map((s) => (
          <div
            key={s.stepIndex}
            className={`step-block${s.stepIndex === currentStep ? ' selected' : ''}`}
            style={{ background: heatColor(s.durationMs, maxMs, s.kind === 'catch') }}
            title={`#${s.stepIndex} — ligne ${s.startLine} — ${
              s.kind === 'catch'
                ? `CATCH : ${s.error?.message ?? ''}`
                : (run.instrument.statements[s.statementIndex]?.type ?? '')
            }${s.durationMs !== null ? ` (${s.durationMs} ms)` : ''}`}
            onClick={() => select(s.stepIndex)}
          />
        ))}
      </div>
    </footer>
  )
}
