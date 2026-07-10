import sql from 'mssql'
import type { ResultSetData } from '@shared/types'
import type { SidecarService } from '../services/SidecarService'
import type { McpConnectionStore } from '../services/McpConnectionStore'
import type { McpAudit } from './audit'
import { buildSqlConfig } from '../services/SqlService'
import { runHeadless, type HeadlessRunOptions } from '../headless/runner'

const DEFAULT_MAX_ROWS = 200
const HARD_MAX_ROWS = 1000
const QUERY_TIMEOUT_MS = 15_000
const RATE_LIMIT_PER_MIN = 30

/**
 * Façade de sécurité entre les outils MCP et SQL Server (spec §3.4). Applique,
 * avant tout accès à la base cible : validation lecture seule (ScriptDom),
 * plafond de lignes, timeout, rate limit, masquage des colonnes sensibles, et
 * journalisation d'audit. Le seul chemin par lequel un outil MCP touche la base.
 */
export class McpGateway {
  private queryTimestamps: number[] = []

  constructor(
    private readonly sidecar: SidecarService,
    private readonly connections: McpConnectionStore,
    private readonly audit: McpAudit,
    private readonly sessionsDir: string
  ) {}

  /**
   * Lance une session de debug instrumentée (spec §4). Uniquement sur des
   * connexions opt-in porteuses du flag « runs autonomes » — un agent ne
   * déclenche jamais une exécution sur une connexion qui ne l'a pas
   * explicitement permis (et jamais sur une connexion « production », qui ne
   * peut pas entrer dans ce store).
   */
  async runDebugSession(
    connectionId: string,
    options: HeadlessRunOptions
  ): Promise<{ sessionId: string; status: string; summary: Record<string, unknown> }> {
    const label = options.proc ?? '(script)'
    try {
      this.checkRateLimit()
      const resolved = await this.connections.resolve(connectionId)
      if (!resolved.allowUnattendedRuns) {
        throw new Error(
          'Cette connexion n\'autorise pas les runs autonomes (flag « runs autonomes » désactivé dans le panneau Activité IA). ' +
            'Les outils de lecture de sessions restent disponibles.'
        )
      }
      const result = await runHeadless(this.sidecar, this.sessionsDir, resolved.config, options)
      this.audit.log({
        tool: 'run_debug_session',
        connectionId,
        sql: label,
        rows: result.entry.run.steps.length,
        ok: true,
        message: result.status
      })
      return { sessionId: result.sessionId, status: result.status, summary: result.summary }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.audit.log({ tool: 'run_debug_session', connectionId, sql: label, rows: -1, ok: false, message })
      throw e
    }
  }

  private checkRateLimit(): void {
    const now = Date.now()
    this.queryTimestamps = this.queryTimestamps.filter((t) => now - t < 60_000)
    if (this.queryTimestamps.length >= RATE_LIMIT_PER_MIN) {
      throw new Error(
        `Limite de ${RATE_LIMIT_PER_MIN} requêtes/minute atteinte (anti-boucle). Réessayez dans un instant.`
      )
    }
    this.queryTimestamps.push(now)
  }

  private maskRow(
    columns: string[],
    row: unknown[],
    patterns: string[]
  ): unknown[] {
    if (patterns.length === 0) return row
    return row.map((cell, i) => {
      const col = columns[i].toLowerCase()
      const masked = patterns.some((p) => col.includes(p.toLowerCase()))
      return masked && cell !== null ? '***' : cell
    })
  }

  async runReadonlyQuery(
    connectionId: string,
    sqlText: string,
    maxRows?: number
  ): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean }> {
    const cap = Math.min(Math.max(maxRows ?? DEFAULT_MAX_ROWS, 1), HARD_MAX_ROWS)
    try {
      this.checkRateLimit()

      const validation = await this.sidecar.validateReadOnly(sqlText)
      if (validation.errors.length > 0) {
        throw new Error(`SQL invalide : ${validation.errors[0].message}`)
      }
      if (validation.violations.length > 0) {
        const v = validation.violations[0]
        throw new Error(
          `Rejeté (lecture seule) : ${v.type} — ${v.target}. Seuls les SELECT purs sont autorisés via MCP.`
        )
      }

      const { config, maskPatterns } = await this.connections.resolve(connectionId)
      const pool = await new sql.ConnectionPool({
        ...buildSqlConfig(config),
        pool: { max: 1, min: 0 },
        requestTimeout: QUERY_TIMEOUT_MS,
        options: {
          ...buildSqlConfig(config).options,
          readOnlyIntent: true
        }
      }).connect()
      try {
        await pool.request().batch('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;')
        const result = await pool.request().query(sqlText)
        const recordset =
          (result.recordsets as sql.IRecordSet<Record<string, unknown>>[])?.[0] ?? []
        const columns = Object.keys(recordset.columns ?? {})
        const allRows = [...recordset]
        const rows = allRows
          .slice(0, cap)
          .map((r) => this.maskRow(columns, columns.map((c) => r[c]), maskPatterns))
        const truncated = allRows.length > cap
        this.audit.log({
          tool: 'run_readonly_query',
          connectionId,
          sql: sqlText,
          rows: rows.length,
          ok: true
        })
        return { columns, rows, rowCount: rows.length, truncated }
      } finally {
        await pool.close().catch(() => undefined)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.audit.log({ tool: 'run_readonly_query', connectionId, sql: sqlText, rows: -1, ok: false, message })
      throw e
    }
  }

  async getSchemaInfo(connectionId: string, objectName: string): Promise<unknown> {
    try {
      this.checkRateLimit()
      if (!/^[\w.[\]]+$/.test(objectName)) {
        throw new Error(`Nom d'objet invalide : ${objectName}`)
      }
      const { config } = await this.connections.resolve(connectionId)
      const pool = await new sql.ConnectionPool({
        ...buildSqlConfig(config),
        pool: { max: 1, min: 0 },
        requestTimeout: QUERY_TIMEOUT_MS
      }).connect()
      try {
        const columns = await pool
          .request()
          .input('obj', sql.NVarChar(400), objectName)
          .query(
            `SELECT c.name AS columnName, t.name AS dataType, c.max_length AS maxLength,
                    c.is_nullable AS isNullable, c.is_identity AS isIdentity
             FROM sys.columns c
             JOIN sys.types t ON t.user_type_id = c.user_type_id
             WHERE c.object_id = OBJECT_ID(@obj)
             ORDER BY c.column_id`
        )
        if (columns.recordset.length === 0) {
          throw new Error(`Objet introuvable : ${objectName}`)
        }
        const indexes = await pool
          .request()
          .input('obj', sql.NVarChar(400), objectName)
          .query(
            `SELECT i.name AS indexName, i.is_primary_key AS isPrimaryKey, i.is_unique AS isUnique,
                    STRING_AGG(col.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
             FROM sys.indexes i
             JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
             WHERE i.object_id = OBJECT_ID(@obj) AND i.type > 0
             GROUP BY i.name, i.is_primary_key, i.is_unique`
        )
        this.audit.log({ tool: 'get_schema_info', connectionId, sql: objectName, rows: columns.recordset.length, ok: true })
        return { object: objectName, columns: columns.recordset, indexes: indexes.recordset }
      } finally {
        await pool.close().catch(() => undefined)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.audit.log({ tool: 'get_schema_info', connectionId, sql: objectName, rows: -1, ok: false, message })
      throw e
    }
  }

  listConnections(): Array<{ id: string; label: string; server: string; database: string }> {
    return this.connections.list().map((c) => ({
      id: c.id,
      label: c.label,
      server: c.server,
      database: c.database
    }))
  }
}

export type { ResultSetData }
