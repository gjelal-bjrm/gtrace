/**
 * Phase 6.4 — IA embarquée : contexte compact, backend Ollama (moqué par un
 * serveur HTTP local parlant le protocole /api/chat), garde-fous des requêtes
 * de vérification (lecture seule).
 * Lancer :  npx tsx --tsconfig tsconfig.node.json scripts/integration-ai.ts
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SidecarService } from '../src/main/services/SidecarService'
import { DebugService } from '../src/main/services/DebugService'
import { AiDiagnosisService } from '../src/main/ai/AiDiagnosisService'
import { buildDiagnosisPrompt } from '../src/main/ai/context'
import { closeAllPools } from '../src/main/services/SqlService'
import type { ConnectionConfig, HistoryEntry } from '../src/shared/types'

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
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 300)}`}`)
  if (!ok) failures++
}

const FAILING_SCRIPT = `DECLARE @stock int = 0;
DECLARE @demande int = 5;
DECLARE @ratio decimal(9,4);
SET @ratio = @demande / @stock;
SELECT @ratio AS Ratio;`

const CANNED_RESPONSE = `**Cause racine** : division par zéro ligne 4 — @stock vaut 0.

Vérification :
\`\`\`sql
SELECT 1 AS Ok;
\`\`\`

Correctif :
\`\`\`sql
UPDATE dbo.Stock SET Quantite = 1; -- ne sera jamais exécuté par le bouton (lecture seule)
\`\`\``

async function main(): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'gtrace-ai-'))
  const sidecar = new SidecarService(
    join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
  )

  // Mock Ollama : capture le prompt reçu, renvoie une réponse cannée.
  let receivedPrompt = ''
  let receivedModel = ''
  const mock = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; messages: Array<{ content: string }> }
      receivedModel = parsed.model
      receivedPrompt = parsed.messages[0].content
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ message: { role: 'assistant', content: CANNED_RESPONSE } }))
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const mockPort = (mock.address() as { port: number }).port

  try {
    // ── Session en échec réelle ───────────────────────────────────────────────
    const debug = new DebugService(sidecar)
    const run = await debug.run({ connection: CONNECTION, sql: FAILING_SCRIPT, compatLevel: 160 })
    const entry: HistoryEntry = {
      id: 'test',
      savedAt: new Date().toISOString(),
      title: 'script-ratio',
      server: CONNECTION.server,
      database: CONNECTION.database,
      stepCount: run.steps.length,
      errorCount: run.errors.length,
      sql: FAILING_SCRIPT,
      paramValues: {},
      run
    }
    check('session seed en erreur (8134)', run.errors[0]?.number === 8134, run.errors)

    // ── Contexte compact ──────────────────────────────────────────────────────
    const prompt = buildDiagnosisPrompt(entry)
    check('contexte : erreur remappée ligne 4 présente', prompt.includes('"line": 4'), prompt.slice(0, 200))
    check('contexte : source numéroté + variables des steps',
      prompt.includes('4 | SET @ratio = @demande / @stock;') && prompt.includes('@stock'), null)
    check('contexte : compact (< 8 000 caractères pour ce script)', prompt.length < 8000, prompt.length)

    // ── Diagnostic via le backend (mock Ollama) ───────────────────────────────
    const service = new AiDiagnosisService(userData, sidecar)
    await service.setConfig({ backend: 'ollama', ollamaUrl: `http://127.0.0.1:${mockPort}`, ollamaModel: 'test-model' })
    check('config persistée sans exposer de clé',
      service.getConfig().ollamaModel === 'test-model' && !service.getConfig().hasAnthropicKey)

    const diagnosis = await service.diagnose(entry)
    check('diagnostic retourné par le backend', diagnosis.text.includes('Cause racine'), diagnosis)
    check('le backend a reçu le bon modèle et le contexte complet',
      receivedModel === 'test-model' && receivedPrompt.includes('division') === false &&
        receivedPrompt.includes('SET @ratio = @demande / @stock'),
      { receivedModel, len: receivedPrompt.length })

    // ── Garde-fous des vérifications un-clic (même règle que MCP) ─────────────
    const selectOk = await sidecar.validateReadOnly('SELECT 1 AS Ok;')
    check('vérification SELECT : acceptée', selectOk.violations.length === 0)
    const updateKo = await sidecar.validateReadOnly(
      'UPDATE dbo.Stock SET Quantite = 1;'
    )
    check('vérification UPDATE (suggérée par l IA) : rejetée', updateKo.violations.length > 0,
      updateKo.violations)

    // ── Erreur claire si Ollama injoignable ───────────────────────────────────
    await service.setConfig({ ollamaUrl: 'http://127.0.0.1:1' })
    let unreachable = false
    try {
      await service.diagnose(entry)
    } catch (e) {
      unreachable = e instanceof Error && e.message.includes('injoignable')
    }
    check('Ollama injoignable : message explicite', unreachable)
  } finally {
    mock.close()
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
