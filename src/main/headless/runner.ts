import type { ConnectionConfig, HistoryEntry } from '@shared/types'
import type { SidecarService } from '../services/SidecarService'
import { DebugService } from '../services/DebugService'
import { loadProcedureByName } from '../services/SqlService'
import { HistoryStore } from '../services/HistoryStore'
import { sessionSummary } from '../mcp/summarizers'

export interface HeadlessRunOptions {
  /** Nom qualifié d'une procédure en base (chargée via sys.sql_modules)… */
  proc?: string
  /** …ou source T-SQL direct */
  sql?: string
  compatLevel?: number
  paramValues?: Record<string, string | null>
  snapshots?: string[]
  readOnly?: boolean
  readOnlyWhitelist?: string[]
}

export interface HeadlessRunResult {
  sessionId: string
  status: 'ok' | 'erreur'
  summary: Record<string, unknown>
  entry: HistoryEntry
}

/**
 * Exécution instrumentée sans fenêtre Electron (spec Phase 6 §4) : charge le
 * source (proc en base ou SQL fourni), exécute via le pipeline de replay
 * standard, persiste la session dans l'historique (interrogeable ensuite via
 * MCP) et renvoie le résumé compressé.
 */
export async function runHeadless(
  sidecar: SidecarService,
  sessionsDir: string,
  config: ConnectionConfig,
  options: HeadlessRunOptions
): Promise<HeadlessRunResult> {
  let source: string
  let title: string
  if (options.proc) {
    const proc = await loadProcedureByName(config, options.proc)
    source = proc.definition
    title = `${proc.schema}.${proc.name}`
  } else if (options.sql) {
    source = options.sql
    title = 'script (headless)'
  } else {
    throw new Error('Fournir --proc <schema.nom> ou --sql/--file.')
  }

  const debug = new DebugService(sidecar)
  const run = await debug.run({
    connection: config,
    sql: source,
    compatLevel: options.compatLevel ?? 160,
    paramValues: options.paramValues,
    snapshots: options.snapshots,
    readOnly: options.readOnly,
    readOnlyWhitelist: options.readOnlyWhitelist
  })

  const store = new HistoryStore(sessionsDir)
  const saved = store.save({
    title,
    server: config.server,
    database: config.database,
    sql: source,
    paramValues: options.paramValues,
    run
  })
  const entry = store.load(saved.id)

  return {
    sessionId: saved.id,
    status: saved.errorCount > 0 ? 'erreur' : 'ok',
    summary: sessionSummary(entry),
    entry
  }
}
