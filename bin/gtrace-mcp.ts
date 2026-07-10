/**
 * GTrace — serveur MCP (Phase 6, milestone 6.1).
 * Expose les sessions de debug enregistrées aux agents IA (Claude Code…),
 * en lecture seule, via stdio. Autonome : lit directement le répertoire de
 * sessions de l'app (l'app GTrace n'a pas besoin d'être ouverte).
 *
 *   npx tsx bin/gtrace-mcp.ts [--sessions-dir <dir>]
 *
 * ⚠ stdout est le transport MCP : tout diagnostic passe par stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HistoryStore } from '../src/main/services/HistoryStore'
import { SidecarService } from '../src/main/services/SidecarService'
import { McpConnectionStore } from '../src/main/services/McpConnectionStore'
import { closeAllPools } from '../src/main/services/SqlService'
import { McpAudit } from '../src/main/mcp/audit'
import { McpGateway } from '../src/main/mcp/McpGateway'
import { buildMarkdown } from '../src/main/services/ExportService'
import {
  executionPath,
  findVariableChanges,
  procSource,
  sessionSummary,
  stepsPage,
  variablesAtStep
} from '../src/main/mcp/summarizers'
import type { HistoryEntry } from '../src/shared/types'

function resolveSessionsDir(): string {
  const argIndex = process.argv.indexOf('--sessions-dir')
  if (argIndex >= 0 && process.argv[argIndex + 1]) return process.argv[argIndex + 1]
  if (process.env.GTRACE_SESSIONS_DIR) return process.env.GTRACE_SESSIONS_DIR
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(process.env.HOME ?? '', 'Library', 'Application Support')
      : join(process.env.HOME ?? '', '.config'))
  return join(appData, 'gtrace', 'sessions')
}

function sidecarExePath(): string {
  if (process.env.GTRACE_SIDECAR) return process.env.GTRACE_SIDECAR
  return join(__dirname, '..', 'resources', 'sidecar', 'GTrace.Parser.exe')
}

const sessionsDir = resolveSessionsDir()
if (!existsSync(sessionsDir)) {
  console.error(
    `[gtrace-mcp] répertoire de sessions introuvable : ${sessionsDir} — ` +
      'lancez au moins une exécution dans GTrace, ou passez --sessions-dir.'
  )
}
const store = new HistoryStore(sessionsDir)

// Le canal d'inspection (run_readonly_query / get_schema_info) partage le dossier
// userData avec l'app : mcp-connections.json (opt-in) + mcp-audit.jsonl y vivent.
const userDataDir = dirname(sessionsDir)
const sidecar = new SidecarService(sidecarExePath())
const mcpConnections = new McpConnectionStore(userDataDir, sidecar)
const audit = new McpAudit(userDataDir)
const gateway = new McpGateway(sidecar, mcpConnections, audit, sessionsDir)

/** Résout un id de session ('latest' accepté) en entrée complète. */
function loadSession(sessionId: string): HistoryEntry {
  if (sessionId === 'latest') {
    const first = store.list()[0]
    if (!first) throw new Error('Aucune session enregistrée.')
    return store.load(first.id)
  }
  return store.load(sessionId)
}

function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] }
}

const server = new McpServer({ name: 'gtrace', version: '0.6.1' })

server.tool(
  'list_sessions',
  'Liste les sessions de debug GTrace enregistrées (les plus récentes en premier).',
  {
    limit: z.number().int().min(1).max(50).optional().describe('Nombre max (défaut 20)'),
    status: z.enum(['ok', 'erreur']).optional().describe('Filtrer par statut'),
    procName: z.string().optional().describe('Filtrer par nom de procédure (contient)')
  },
  async ({ limit, status, procName }) => {
    const sessions = store
      .list()
      .filter((s) => {
        if (status === 'ok' && s.errorCount > 0) return false
        if (status === 'erreur' && s.errorCount === 0) return false
        if (procName && !s.title.toLowerCase().includes(procName.toLowerCase())) return false
        return true
      })
      .slice(0, limit ?? 20)
      .map((s) => ({
        sessionId: s.id,
        title: s.title,
        savedAt: s.savedAt,
        server: s.server,
        database: s.database,
        stepCount: s.stepCount,
        status: s.errorCount > 0 ? 'erreur' : 'ok',
        errorCount: s.errorCount
      }))
    return jsonResult({ sessions, hint: "utilisez get_session_summary(sessionId) pour démarrer un diagnostic ('latest' accepté)" })
  }
)

server.tool(
  'get_session_summary',
  "Résumé compact d'une session : paramètres, erreurs (lignes du source), chemin d'exécution agrégé, statements les plus lents, variables les plus modifiées. Point d'entrée du diagnostic.",
  { sessionId: z.string().describe("Id de session ou 'latest'") },
  async ({ sessionId }) => jsonResult(sessionSummary(loadSession(sessionId)))
)

server.tool(
  'get_proc_source',
  'Source T-SQL original de la session, avec numéros de ligne (tel qu\'exécuté, versionné par hash). Les lignes des steps/erreurs se réfèrent à ce source.',
  { sessionId: z.string() },
  async ({ sessionId }) => jsonResult(procSource(loadSession(sessionId)))
)

server.tool(
  'get_steps',
  'Steps de la timeline, paginés (jamais la trace entière). Filtres par plage de steps ou par lignes du source.',
  {
    sessionId: z.string(),
    fromStep: z.number().int().min(0).optional(),
    toStep: z.number().int().min(0).optional(),
    onlyLines: z.array(z.number().int().min(1)).optional().describe('Ne renvoyer que les steps de ces lignes'),
    pageSize: z.number().int().min(1).max(500).optional().describe('Défaut 100')
  },
  async ({ sessionId, ...options }) => jsonResult(stepsPage(loadSession(sessionId), options))
)

server.tool(
  'get_variables_at_step',
  "État complet des variables au step donné (reconstruit en repliant les écritures des steps 0..N).",
  {
    sessionId: z.string(),
    stepIndex: z.number().int().min(0),
    names: z.array(z.string()).optional().describe('Limiter à ces variables')
  },
  async ({ sessionId, stepIndex, names }) =>
    jsonResult({ stepIndex, variables: variablesAtStep(loadSession(sessionId), stepIndex, names) })
)

server.tool(
  'find_variable_changes',
  "Tous les steps où une variable a changé de valeur, avec ancienne/nouvelle valeur — évite de paginer toute la trace.",
  { sessionId: z.string(), variableName: z.string().describe('ex. @Total') },
  async ({ sessionId, variableName }) => {
    const changes = findVariableChanges(loadSession(sessionId), variableName)
    return jsonResult({ variableName, changeCount: changes.length, changes })
  }
)

server.tool(
  'get_execution_path',
  "Chemin d'exécution compact : segments séquentiels, boucles agrégées avec compteurs d'itérations, entrées en CATCH.",
  { sessionId: z.string() },
  async ({ sessionId }) => {
    const path = executionPath(loadSession(sessionId))
    return jsonResult({ segments: path, hint: 'kind=loop : iterations passages ; kind=catch : gestion d erreur empruntée' })
  }
)

server.tool(
  'get_resultsets',
  "Resultsets métier produits par la session (tronqués à 50 lignes), optionnellement filtrés par step producteur.",
  { sessionId: z.string(), stepIndex: z.number().int().min(0).optional() },
  async ({ sessionId, stepIndex }) => {
    const entry = loadSession(sessionId)
    const sets = entry.run.resultsets
      .filter((rs) => stepIndex === undefined || rs.stepIndex === stepIndex)
      .map((rs) => ({
        index: rs.index,
        stepIndex: rs.stepIndex,
        columns: rs.columns,
        rowCount: rs.rows.length,
        rows: rs.rows.slice(0, 50),
        truncated: rs.rows.length > 50
      }))
    return jsonResult({ resultsets: sets })
  }
)

server.tool(
  'diff_table_snapshots',
  'Diff structuré entre deux snapshots de table de la session (lignes ajoutées/supprimées).',
  {
    sessionId: z.string(),
    snapshotA: z.number().int().min(0).describe('index du snapshot avant'),
    snapshotB: z.number().int().min(0).describe('index du snapshot après')
  },
  async ({ sessionId, snapshotA, snapshotB }) => {
    const entry = loadSession(sessionId)
    const a = entry.run.snapshots[snapshotA]
    const b = entry.run.snapshots[snapshotB]
    if (!a || !b) {
      const available = entry.run.snapshots.map((s) => ({
        index: s.index,
        table: s.table,
        stepIndex: s.stepIndex,
        rowCount: s.rows.length
      }))
      return jsonResult({ error: 'snapshot introuvable', available })
    }
    const key = (row: unknown[]): string => JSON.stringify(row)
    const counts = new Map<string, number>()
    for (const row of a.rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1)
    const added: unknown[][] = []
    for (const row of b.rows) {
      const k = key(row)
      const left = counts.get(k) ?? 0
      if (left > 0) counts.set(k, left - 1)
      else added.push(row)
    }
    const removed: unknown[][] = []
    for (const row of a.rows) {
      const k = key(row)
      const left = counts.get(k) ?? 0
      if (left > 0) {
        removed.push(row)
        counts.set(k, left - 1)
      }
    }
    return jsonResult({
      table: b.table,
      columns: b.columns,
      fromStep: a.stepIndex,
      toStep: b.stepIndex,
      added: added.slice(0, 50),
      removed: removed.slice(0, 50),
      truncated: added.length > 50 || removed.length > 50
    })
  }
)

// ─── Inspection lecture seule (milestone 6.2) ────────────────────────────────

server.tool(
  'list_readonly_connections',
  'Liste les connexions SQL autorisées (opt-in) pour les requêtes lecture seule via MCP.',
  {},
  async () => jsonResult({ connections: gateway.listConnections() })
)

server.tool(
  'run_readonly_query',
  "Exécute un SELECT en lecture seule sur une connexion autorisée. Rejette tout ce qui n'est pas un SELECT pur (validation ScriptDom). Résultats plafonnés et colonnes sensibles masquées. Le seul outil touchant la base cible.",
  {
    connectionId: z.string().describe('id d une connexion listée par list_readonly_connections'),
    sql: z.string().describe('requête SELECT'),
    maxRows: z.number().int().min(1).max(1000).optional().describe('Défaut 200, max 1000')
  },
  async ({ connectionId, sql, maxRows }) => {
    try {
      return jsonResult(await gateway.runReadonlyQuery(connectionId, sql, maxRows))
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
        isError: true
      }
    }
  }
)

server.tool(
  'get_schema_info',
  "Colonnes (types, nullabilité, identity) et index d'une table/vue sur une connexion autorisée.",
  {
    connectionId: z.string(),
    objectName: z.string().describe('ex. dbo.Client')
  },
  async ({ connectionId, objectName }) => {
    try {
      return jsonResult(await gateway.getSchemaInfo(connectionId, objectName))
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
        isError: true
      }
    }
  }
)

server.tool(
  'run_debug_session',
  "Lance une session de debug instrumentée (procédure en base ou script T-SQL) sur une connexion autorisant les runs autonomes. La session est enregistrée et immédiatement interrogeable (get_session_summary, find_variable_changes…). Boucle agentique : hypothèse → run → diagnostic → correctif → re-run.",
  {
    connectionId: z.string().describe('connexion avec flag « runs autonomes »'),
    proc: z.string().optional().describe('procédure en base, ex. dbo.CalculPaiement'),
    sql: z.string().optional().describe('ou script T-SQL direct'),
    params: z.record(z.string().nullable()).optional().describe('valeurs des paramètres, ex. {"@Id": "5"}'),
    snapshots: z.array(z.string()).optional().describe('tables à snapshotter (#temp, @var, dbo.T)'),
    readOnly: z.boolean().optional().describe('refuser toute écriture hors #temp/@var'),
    compatLevel: z.number().int().optional()
  },
  async ({ connectionId, proc, sql: sqlText, params, snapshots, readOnly, compatLevel }) => {
    try {
      return jsonResult(
        await gateway.runDebugSession(connectionId, {
          proc,
          sql: sqlText,
          paramValues: params,
          snapshots,
          readOnly,
          compatLevel
        })
      )
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
        isError: true
      }
    }
  }
)

server.resource(
  'session-report',
  'gtrace://sessions/latest/report',
  { description: 'Rapport Markdown compact de la dernière session', mimeType: 'text/markdown' },
  async (uri) => {
    const entry = loadSession('latest')
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: buildMarkdown(entry)
        }
      ]
    }
  }
)

server.prompt(
  'diagnose_session',
  'Diagnostic méthodique d une session de debug GTrace',
  { sessionId: z.string().describe("Id de session ou 'latest'") },
  ({ sessionId }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Diagnostique la session de debug GTrace « ${sessionId} » avec la méthode suivante :
1. get_session_summary : identifie le statut, les erreurs (avec leurs lignes) et les paramètres d'entrée.
2. get_proc_source : lis le source aux lignes concernées (les numéros de ligne des steps/erreurs s'y réfèrent directement).
3. get_execution_path : vérifie quel chemin a réellement été emprunté (branches, itérations, CATCH).
4. find_variable_changes sur les variables suspectes (celles des lignes en erreur, les plus modifiées, les OUTPUT).
5. get_variables_at_step au step fautif pour l'état exact au moment de l'erreur.
6. Si des snapshots existent : diff_table_snapshots pour l'évolution des données.
Conclus avec : la cause racine (ligne précise), la chaîne causale (valeurs → chemin → erreur), et un correctif proposé en T-SQL. Ne suppose rien qui contredise la trace.`
        }
      }
    ]
  })
)

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
  console.error(`[gtrace-mcp] démarré — sessions : ${sessionsDir}`)
}

process.on('SIGTERM', () => {
  void closeAllPools().finally(() => process.exit(0))
})

void main()
