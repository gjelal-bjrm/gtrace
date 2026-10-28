import { useMemo, useState, type JSX } from 'react'
import { ArrowLeftRight, ArrowRight, Flag } from 'lucide-react'
import { formatSqlValue, useReplayStore } from '../../stores/replayStore'
import { CATEGORIES, getRunModel } from '../../lib/runModel'
import { compareMoments, type TableDiff, type VariableDiff } from '../../lib/compareModel'
import EmptyState from '../ui/EmptyState'

/** Lignes de table affichées au plus par table (le reste est résumé). */
const MAX_ROWS = 200

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`

/**
 * Onglet « Comparer » : ce qui a changé entre le moment épinglé dans le
 * Déroulé (A) et l'étape courante (B) — variables, puis contenu des tables
 * suivies. On se déplace dans le Déroulé, la comparaison suit.
 */
export default function ComparePanel(): JSX.Element {
  const run = useReplayStore((s) => s.run)
  const source = useReplayStore((s) => s.source)
  const currentStep = useReplayStore((s) => s.currentStep)
  const pinned = useReplayStore((s) => s.compareFrom)
  const bookmarks = useReplayStore((s) => s.bookmarks)
  const setCompareFrom = useReplayStore((s) => s.setCompareFrom)
  const [showSame, setShowSame] = useState(false)

  const model = useMemo(() => (run ? getRunModel(run, source) : null), [run, source])
  const comparison = useMemo(() => {
    if (!run || !model || pinned === null || pinned >= model.steps.length) return null
    return compareMoments(model, run, pinned, Math.min(currentStep, model.steps.length - 1))
  }, [run, model, pinned, currentStep])

  if (!model || model.steps.length === 0) {
    return (
      <EmptyState icon={ArrowLeftRight} title="Comparer deux moments">
        Exécutez une requête : vous pourrez ensuite choisir deux étapes du Déroulé et voir ce qui a
        changé entre elles.
      </EmptyState>
    )
  }
  if (!comparison || pinned === null) {
    return (
      <EmptyState icon={ArrowLeftRight} title="Comparer deux moments">
        Dans le Déroulé, cliquez sur « Comparer » (ou clic droit sur une étape › Comparer avec
        l&apos;étape courante), puis déplacez-vous : cet onglet montre ce qui a changé entre les deux
        moments — variables et contenu des tables suivies.
      </EmptyState>
    )
  }

  const { from, to } = comparison
  const current = Math.min(currentStep, model.steps.length - 1)
  const moment = (step: number): JSX.Element => {
    const info = model.steps[step]
    const role = step === pinned ? 'A' : 'B'
    return (
      <span className={`cmp-moment ${role === 'A' ? 'a' : 'b'}`}>
        <span className="cmp-role">{role}</span>
        étape {step + 1} · ligne {info.line}
        {bookmarks[step] && (
          <span className="dr-mark">
            <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
            {bookmarks[step]}
          </span>
        )}
        <span className="cmp-moment-hint">{step === pinned ? 'épinglée' : 'étape courante'}</span>
      </span>
    )
  }

  const between = CATEGORIES.filter((c) => comparison.counts[c.id]).map(
    (c) => `${comparison.counts[c.id]} ${(comparison.counts[c.id] ?? 0) > 1 ? c.plural.toLowerCase() : c.label.toLowerCase()}`
  )
  const executed = to - from
  const changedVars = comparison.variables.filter((v) => v.changed)
  const sameVars = comparison.variables.filter((v) => !v.changed)

  return (
    <div className="compare">
      <div className="cmp-head">
        <div className="cmp-moments">
          {moment(from)}
          <ArrowRight size={14} aria-hidden="true" />
          {moment(to)}
        </div>
        <button type="button" className="dr-btn" onClick={() => setCompareFrom(null)}>
          Arrêter la comparaison
        </button>
      </div>

      {from === to ? (
        <p className="hint">
          Les deux moments sont la même étape : déplacez-vous dans le Déroulé (F10, clic sur la
          piste ou dans le journal) pour comparer l&apos;étape {pinned + 1} à une autre.
        </p>
      ) : (
        <p className="cmp-summary">
          Entre les deux : {plural(executed, 'instruction')} exécutée{executed > 1 ? 's' : ''}
          {between.length > 0 && ` (${between.join(', ')})`} · {comparison.durationMs} ms
          {current !== to && ' · en remontant le temps depuis le point A'}
        </p>
      )}

      <section className="cmp-section">
        <h3>
          Variables
          <span className="cmp-count">
            {changedVars.length === 0 ? 'aucune modifiée' : `${plural(changedVars.length, 'modifiée')}`}
          </span>
          {sameVars.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setShowSame((v) => !v)}>
              {showSame ? 'Masquer les inchangées' : `Afficher aussi les inchangées (${sameVars.length})`}
            </button>
          )}
        </h3>
        {comparison.variables.length === 0 ? (
          <p className="hint">Aucune variable écrite dans cette exécution.</p>
        ) : (
          <table className="cmp-vars">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Étape {from + 1}</th>
                <th>Étape {to + 1}</th>
                <th>Écart</th>
                <th>Écritures entre les deux</th>
              </tr>
            </thead>
            <tbody>
              {[...changedVars, ...(showSame ? sameVars : [])].map((v) => (
                <VariableRow key={v.name} v={v} />
              ))}
              {changedVars.length === 0 && !showSame && (
                <tr>
                  <td colSpan={5} className="hint">
                    Aucune variable n&apos;a changé de valeur entre ces deux moments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="cmp-section">
        <h3>Tables suivies</h3>
        {comparison.tables.length === 0 ? (
          <p className="hint">
            Aucune table suivie dans cette exécution. Pour comparer aussi le contenu des tables,
            indiquez-les dans l&apos;onglet Paramètres › Snapshots de tables (ex.{' '}
            <span className="vars">#MaTemp, @MaVarTable</span>), puis exécutez à nouveau.
          </p>
        ) : (
          comparison.tables.map((t) => <TableBlock key={t.table} t={t} />)
        )}
      </section>
    </div>
  )
}

function VariableRow({ v }: { v: VariableDiff }): JSX.Element {
  return (
    <tr className={v.changed ? 'cmp-var-changed' : ''}>
      <td className="vars">{v.name}</td>
      <td className="cmp-value">{v.hadBefore ? formatSqlValue(v.before) : <span className="hint">pas encore écrite</span>}</td>
      <td className="cmp-value">{v.hadAfter ? formatSqlValue(v.after) : <span className="hint">pas encore écrite</span>}</td>
      <td className={`cmp-delta${v.delta !== null ? (v.delta > 0 ? ' up' : ' down') : ''}`}>
        {v.delta === null ? '' : `${v.delta > 0 ? '+' : '−'}${Math.abs(v.delta)}`}
      </td>
      <td className="cmp-writes">{v.writes === 0 ? '—' : `${v.writes} fois`}</td>
    </tr>
  )
}

function TableBlock({ t }: { t: TableDiff }): JSX.Element {
  const columns = (t.after ?? t.before)?.columns ?? []
  const count = (kind: 'added' | 'removed' | 'modified'): number =>
    t.changes.filter((c) => c.kind === kind).length
  const parts = [
    count('added') && plural(count('added'), 'ajoutée'),
    count('removed') && plural(count('removed'), 'supprimée'),
    count('modified') && plural(count('modified'), 'modifiée'),
    t.unchanged && plural(t.unchanged, 'inchangée')
  ].filter(Boolean)

  return (
    <div className="cmp-table">
      <h4>
        <span className="vars">{t.table}</span>
        <span className="cmp-count">
          {!t.after
            ? 'pas encore capturée à ces moments'
            : t.changes.length === 0
              ? `aucun changement (${plural(t.after.rows.length, 'ligne')})`
              : parts.join(' · ')}
        </span>
      </h4>
      {!t.before && t.after && t.changes.length > 0 && (
        <p className="hint">Pas de capture avant ce moment : son contenu apparaît comme ajouté.</p>
      )}
      {t.changes.length > 0 && (
        <div className="grid-scroll">
          <table className="data-grid snap-grid cmp-grid">
            <thead>
              <tr>
                <th className="cmp-kind-col" />
                {columns.map((c, i) => (
                  <th key={i} title={c}>
                    {c || `(col ${i + 1})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.changes.slice(0, MAX_ROWS).map((c, ri) => (
                <tr key={ri} className={`cmp-${c.kind}`}>
                  <td className="cmp-kind-col">
                    {c.kind === 'added' ? 'ajoutée' : c.kind === 'removed' ? 'supprimée' : 'modifiée'}
                  </td>
                  {c.row.map((cell, ci) => {
                    const changed = c.kind === 'modified' && c.changed?.includes(ci)
                    const text = formatSqlValue(cell)
                    return (
                      <td key={ci} className={changed ? 'cmp-cell-changed' : undefined} title={text}>
                        {changed && (
                          <span className="cmp-old">{formatSqlValue(c.before?.[ci])}</span>
                        )}
                        {changed && ' → '}
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {t.changes.length > MAX_ROWS && (
            <p className="hint">… et {t.changes.length - MAX_ROWS} autres lignes changées.</p>
          )}
        </div>
      )}
    </div>
  )
}
