/**
 * Phase 6.3 — mode headless : CLI `gtrace-run` + outil MCP `run_debug_session`,
 * et la boucle agentique complète run → diagnostic → fix → re-run (critère du
 * milestone), le tout contre SQL Server réel.
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-headless.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SidecarService } from '../src/main/services/SidecarService'
import { McpConnectionStore } from '../src/main/services/McpConnectionStore'
import { getPool, closeAllPools } from '../src/main/services/SqlService'
import type { ConnectionConfig } from '../src/shared/types'

const CONNECTION: ConnectionConfig = {
  server: 'localhost',
  port: 14333,
  database: 'master',
  user: 'sa',
  password: 'GTrace!Dev2026',
  trustServerCertificate: true
}
const ROOT = join(__dirname, '..')
const sidecarExe = join(ROOT, 'resources', 'sidecar', 'GTrace.Parser.exe')

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`)
  if (!ok) failures++
}

const BUGGY_PROC = `CREATE OR ALTER PROCEDURE dbo.CalculPaiement
  @Montant decimal(18,2),
  @NbEcheances int,
  @Mensualite decimal(18,2) OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @taux decimal(9,6) = 0.02;
  SET @Mensualite = (@Montant * (1 + @taux)) / @NbEcheances;
  SELECT @Mensualite AS Mensualite;
END`

const FIXED_PROC = BUGGY_PROC.replace(
  '  SET @Mensualite = (@Montant * (1 + @taux)) / @NbEcheances;',
  `  IF @NbEcheances < 1
  BEGIN
    SET @NbEcheances = 1;
  END
  SET @Mensualite = (@Montant * (1 + @taux)) / @NbEcheances;`
)

async function main(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'gtrace-headless-'))
  const sessionsDir = join(userData, 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  const sidecar = new SidecarService(sidecarExe)
  const env = { ...process.env, GTRACE_SIDECAR: sidecarExe, GTRACE_SESSIONS_DIR: sessionsDir }

  try {
    // ── Seed : proc boguée + connexions MCP (avec et sans runs autonomes) ─────
    const pool = await getPool(CONNECTION)
    await pool.request().batch(BUGGY_PROC)
    const store = new McpConnectionStore(userData, sidecar)
    const runnable = await store.grant(CONNECTION, 'dev-runs', [], undefined, true)
    const readOnlyOnly = await store.grant(CONNECTION, 'dev-lecture', [], undefined, false)
    await closeAllPools()

    // ── CLI : run headless d'un script avec erreur ────────────────────────────
    const summaryFile = join(userData, 'summary.json')
    const paramsFile = join(userData, 'params.json')
    writeFileSync(paramsFile, JSON.stringify({ '@Montant': '1200', '@NbEcheances': '0' }), 'utf8')
    const cli = spawnSync(
      process.execPath,
      [
        '--import', 'tsx', 'bin/gtrace-run.ts',
        '--connection', 'dev-runs',
        '--proc', 'dbo.CalculPaiement',
        '--params', paramsFile,
        '--output', summaryFile
      ],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 }
    )
    check('CLI : exit code 1 (session en erreur)', cli.status === 1, { status: cli.status, stderr: cli.stderr?.slice(-300) })
    const summary = JSON.parse(readFileSync(summaryFile, 'utf8'))
    check('CLI : résumé écrit, statut erreur, division par zéro ligne 9',
      summary.status === 'erreur' && summary.errors?.[0]?.number === 8134 && summary.errors?.[0]?.line === 9,
      summary.errors)
    check('CLI : session persistée (interrogeable via MCP)', readdirSync(sessionsDir).length === 1)

    // ── CLI : connexion sans flag runs autonomes refusée ──────────────────────
    const cliRefused = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'bin/gtrace-run.ts', '--connection', 'dev-lecture', '--sql', 'SELECT 1;'],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 }
    )
    check('CLI : refus sans flag « runs autonomes » (exit 2)',
      cliRefused.status === 2 && cliRefused.stderr.includes('runs autonomes'), cliRefused.stderr?.slice(-200))

    // ── Boucle agentique via MCP : run → diagnostic → fix → re-run ────────────
    const client = new Client({ name: 'gtrace-headless-test', version: '0.0.1' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'bin/gtrace-mcp.ts', '--sessions-dir', sessionsDir],
        cwd: ROOT,
        env
      })
    )
    const call = async (name: string, args: Record<string, unknown>): Promise<{ json: any; isError: boolean }> => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ text: string }>
        isError?: boolean
      }
      let json: unknown = res.content[0].text
      try {
        json = JSON.parse(res.content[0].text)
      } catch { /* texte brut */ }
      return { json, isError: res.isError === true }
    }

    // Refus sur connexion sans flag
    const refused = await call('run_debug_session', {
      connectionId: readOnlyOnly.id,
      sql: 'SELECT 1;'
    })
    check('MCP : run refusé sans flag, message explicite',
      refused.isError && String(refused.json).includes('runs autonomes'), refused.json)

    // 1. RUN (reproduction du bug)
    const run1 = await call('run_debug_session', {
      connectionId: runnable.id,
      proc: 'dbo.CalculPaiement',
      params: { '@Montant': '1200', '@NbEcheances': '0' }
    })
    check('MCP run 1 : statut erreur + sessionId', !run1.isError && run1.json.status === 'erreur', run1.json)

    // 2. DIAGNOSTIC (mêmes outils que 6.1, sur la session fraîche)
    const diag = await call('get_session_summary', { sessionId: run1.json.sessionId })
    check('diagnostic : erreur 8134 remappée ligne 9 (la division)',
      diag.json.errors?.[0]?.number === 8134 && diag.json.errors?.[0]?.line === 9, diag.json.errors)
    check('diagnostic : @NbEcheances = 0 dans les paramètres d entrée',
      diag.json.parameters?.some((p: { name: string; inputValue: string | null }) =>
        p.name === '@NbEcheances' && p.inputValue === '0'), diag.json.parameters)

    // 3. FIX (le développeur/agent applique le correctif)
    const pool2 = await getPool(CONNECTION)
    await pool2.request().batch(FIXED_PROC)
    await closeAllPools()

    // 4. RE-RUN de validation
    const run2 = await call('run_debug_session', {
      connectionId: runnable.id,
      proc: 'dbo.CalculPaiement',
      params: { '@Montant': '1200', '@NbEcheances': '0' }
    })
    check('MCP run 2 (après fix) : statut ok', !run2.isError && run2.json.status === 'ok', run2.json)
    check('boucle fermée : la mensualité est calculée (1224)',
      run2.json.summary?.parameters?.some(
        (p: { name: string; outputValue?: unknown }) =>
          p.name === '@Mensualite' && Number(p.outputValue) === 1224
      ),
      run2.json.summary?.parameters)

    await client.close()

    // Nettoyage
    const cleanup = await getPool(CONNECTION)
    await cleanup.request().batch('DROP PROCEDURE dbo.CalculPaiement;')
    await closeAllPools()
  } finally {
    rmSync(userData, { recursive: true, force: true })
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
