/**
 * Phase 6.1 — serveur MCP : un client MCP réel (SDK) se connecte au serveur
 * gtrace-mcp spawné en stdio et déroule le workflow de diagnostic complet sur
 * une session en échec enregistrée au préalable.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-mcp.ts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugService } from '../src/main/services/DebugService'
import { HistoryStore } from '../src/main/services/HistoryStore'
import { closeAllPools } from '../src/main/services/SqlService'
import type { ConnectionConfig } from '../src/shared/types'

const CONNECTION: ConnectionConfig = {
  server: 'localhost',
  port: 14333,
  database: 'master',
  user: 'sa',
  password: 'GTrace!Dev2026',
  trustServerCertificate: true
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`)
  if (!ok) failures++
}

// Scénario d'échec réaliste : boucle, #temp, division par zéro attrapée en CATCH.
const FAILING_SCRIPT = `DECLARE @i int = 0;
DECLARE @total decimal(18,2) = 0;
DECLARE @div int = 0;
CREATE TABLE #calc (Id int, Val decimal(18,2));
WHILE @i < 3
BEGIN
  SET @i = @i + 1;
  INSERT INTO #calc VALUES (@i, @i * 10);
  SET @total = @total + @i * 10;
END
BEGIN TRY
  SET @total = @total / @div;
END TRY
BEGIN CATCH
  SET @total = -1;
END CATCH
SELECT @total AS Total;`

interface ToolText {
  content: Array<{ type: string; text: string }>
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gtrace-mcp-'))
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )

  try {
    // ── Seed : exécuter et enregistrer la session en échec ────────────────────
    const debug = new DebugService(sidecar)
    const run = await debug.run({
      connection: CONNECTION,
      sql: FAILING_SCRIPT,
      compatLevel: 160,
      snapshots: ['#calc']
    })
    const store = new HistoryStore(dir)
    const saved = store.save({
      title: 'script-division-zero',
      server: CONNECTION.server,
      database: CONNECTION.database,
      sql: FAILING_SCRIPT,
      paramValues: {},
      run
    })
    check('session seed en erreur (CATCH présent)', saved.errorCount > 0, saved)
    await closeAllPools()

    // ── Client MCP réel sur le serveur spawné ────────────────────────────────
    const client = new Client({ name: 'gtrace-mcp-test', version: '0.0.1' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'bin/gtrace-mcp.ts', '--sessions-dir', dir],
        cwd: join(__dirname, '..')
      })
    )
    const callJson = async (name: string, args: Record<string, unknown>): Promise<any> => {
      const result = (await client.callTool({ name, arguments: args })) as unknown as ToolText
      return JSON.parse(result.content[0].text)
    }

    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name).sort()
    check(
      'les 9 outils exposés',
      [
        'diff_table_snapshots',
        'find_variable_changes',
        'get_execution_path',
        'get_proc_source',
        'get_resultsets',
        'get_session_summary',
        'get_steps',
        'get_variables_at_step',
        'list_sessions'
      ].every((n) => names.includes(n)),
      names
    )

    const list = await callJson('list_sessions', { status: 'erreur' })
    check('list_sessions filtre par statut erreur',
      list.sessions.length === 1 && list.sessions[0].sessionId === saved.id, list)

    const summary = await callJson('get_session_summary', { sessionId: 'latest' })
    check('résumé : statut erreur + CATCH localisé ligne 15',
      summary.status === 'erreur' && summary.catchSteps[0]?.line === 15, summary.catchSteps)
    check('résumé : erreur 8134 (division par zéro) remappée ligne 12',
      summary.catchSteps[0]?.error?.number === 8134 && summary.catchSteps[0]?.error?.line === 12,
      summary.catchSteps[0]?.error)
    check('résumé : variables les plus modifiées présentes',
      summary.mostChangedVariables.some((v: { name: string }) => v.name === '@total'),
      summary.mostChangedVariables)

    const source = await callJson('get_proc_source', { sessionId: saved.id })
    check('source numéroté (ligne 12 = division)',
      source.lineCount === 17 && source.source.includes('12 |   SET @total = @total / @div;'),
      source.lineCount)

    const steps = await callJson('get_steps', { sessionId: saved.id, onlyLines: [8] })
    check('get_steps filtré sur la ligne 8 : 3 INSERT (boucle)',
      steps.total === 3 && steps.steps.every((s: { line: number }) => s.line === 8), steps.total)

    const changes = await callJson('find_variable_changes', {
      sessionId: saved.id,
      variableName: '@total'
    })
    check('find_variable_changes @total : progression 0→10→30→60→-1',
      JSON.stringify(changes.changes.map((c: { value: unknown }) => Number(c.value))) ===
        '[0,10,30,60,-1]',
      changes.changes)

    const lastStep = summary.stepCount - 1
    const vars = await callJson('get_variables_at_step', { sessionId: saved.id, stepIndex: lastStep })
    check('variables au dernier step : @total = -1, @i = 3',
      Number(vars.variables['@total']) === -1 && Number(vars.variables['@i']) === 3, vars.variables)

    const path = await callJson('get_execution_path', { sessionId: saved.id })
    check('chemin : boucle agrégée (≥ 2 itérations) + segment catch',
      path.segments.some((s: { kind: string; iterations?: number }) => s.kind === 'loop' && (s.iterations ?? 0) >= 2) &&
        path.segments.some((s: { kind: string }) => s.kind === 'catch'),
      path.segments)

    const snaps = await callJson('diff_table_snapshots', { sessionId: saved.id, snapshotA: 0, snapshotB: 2 })
    check('diff snapshots #calc : 2 lignes ajoutées entre 1re et 3e itération',
      snaps.added.length === 2 && snaps.removed.length === 0, snaps)

    const resultsets = await callJson('get_resultsets', { sessionId: saved.id })
    check('resultset final : Total = -1',
      Number(resultsets.resultsets[0]?.rows[0]?.[0]) === -1, resultsets)

    const report = await client.readResource({ uri: 'gtrace://sessions/latest/report' })
    check('ressource rapport Markdown',
      String(report.contents[0]?.text).includes('# GTrace — session de debug : script-division-zero'))

    const prompt = await client.getPrompt({ name: 'diagnose_session', arguments: { sessionId: 'latest' } })
    check('prompt diagnose_session disponible',
      String((prompt.messages[0]?.content as { text?: string }).text).includes('get_session_summary'))

    await client.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    sidecar.dispose()
    await closeAllPools().catch(() => undefined)
  }

  console.log(`\n${failures === 0 ? 'SUCCÈS' : `${failures} ÉCHEC(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('ERREUR FATALE :', e)
  await closeAllPools().catch(() => undefined)
  process.exit(2)
})
