import type { HistorySaveInput, ResultSetData, TraceStep } from '@shared/types'

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return v.toISOString()
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function variablesText(step: TraceStep): string {
  return Object.entries(step.variables)
    .map(([k, v]) => `${k} = ${fmt(v)}`)
    .join(', ')
}

function resultsetTable(rs: ResultSetData, maxRows = 20): string {
  const lines: string[] = []
  lines.push(`| ${rs.columns.map((c) => c || '(col)').join(' | ')} |`)
  lines.push(`|${rs.columns.map(() => '---').join('|')}|`)
  for (const row of rs.rows.slice(0, maxRows)) {
    lines.push(`| ${row.map(fmt).join(' | ')} |`)
  }
  if (rs.rows.length > maxRows) lines.push(`\n_… ${rs.rows.length - maxRows} lignes omises_`)
  return lines.join('\n')
}

/** Export Markdown d'une session de debug (spec Phase 5) — partage/archivage. */
export function buildMarkdown(entry: HistorySaveInput): string {
  const { run } = entry
  const out: string[] = []

  out.push(`# GTrace — session de debug : ${entry.title}`)
  out.push('')
  out.push(`- **Serveur** : ${entry.server} / ${entry.database}`)
  out.push(`- **Exporté le** : ${new Date().toISOString()}`)
  out.push(`- **Steps** : ${run.steps.length} — **Resultsets** : ${run.resultsets.length} — **Snapshots** : ${run.snapshots.length}`)
  out.push('')

  if (run.instrument.parameters.length > 0) {
    out.push('## Paramètres')
    out.push('')
    out.push('| Paramètre | Type | Valeur finale (OUTPUT) |')
    out.push('|---|---|---|')
    for (const p of run.instrument.parameters) {
      out.push(
        `| ${p.name} | ${p.type} | ${p.isOutput ? fmt(run.outputValues[p.name]) : ''} |`
      )
    }
    out.push('')
  }

  if (run.errors.length > 0) {
    out.push('## Erreurs')
    out.push('')
    for (const e of run.errors) {
      out.push(`- Erreur ${e.number}${e.line !== null ? ` (ligne ${e.line})` : ''} : ${e.message}`)
    }
    out.push('')
  }

  out.push('## Timeline')
  out.push('')
  out.push('| # | Ligne | Statement | Durée | Rows | Variables / erreur |')
  out.push('|---|---|---|---|---|---|')
  for (const step of run.steps) {
    const type =
      step.kind === 'catch'
        ? '⚡ CATCH'
        : (run.instrument.statements[step.statementIndex]?.type ?? '?')
    const detail = step.error
      ? `${step.error.number} : ${fmt(step.error.message)}`
      : variablesText(step) + (step.returnValue !== null ? ` RETURN ${fmt(step.returnValue)}` : '')
    out.push(
      `| ${step.stepIndex} | ${step.startLine} | ${type} | ${step.durationMs ?? ''}${step.durationMs !== null ? ' ms' : ''} | ${step.rowCount ?? ''} | ${detail} |`
    )
  }
  out.push('')

  for (const rs of run.resultsets) {
    out.push(`## Resultset ${rs.index + 1}${rs.stepIndex !== null ? ` (step ${rs.stepIndex})` : ''}`)
    out.push('')
    out.push(resultsetTable(rs))
    out.push('')
  }

  if (run.snapshots.length > 0) {
    out.push('## Snapshots')
    out.push('')
    for (const snap of run.snapshots) {
      out.push(`### ${snap.table} — step ${snap.stepIndex} (${snap.rows.length} ligne(s))`)
      out.push('')
      out.push(
        resultsetTable(
          { index: 0, columns: snap.columns, rows: snap.rows, stepIndex: null },
          10
        )
      )
      out.push('')
    }
  }

  out.push('## Source')
  out.push('')
  out.push('```sql')
  out.push(entry.sql)
  out.push('```')
  out.push('')

  return out.join('\n')
}
