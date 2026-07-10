import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  AiConfigPatch,
  ConnectionConfig,
  ConnectionRef,
  DebugRequest,
  DebugSessionEvent,
  DebugStartRequest,
  HistorySaveInput,
  McpGrantInput,
  SaveConnectionInput,
  XeStartRequest,
  XEventsEvent
} from '@shared/types'
import type { SidecarService } from '../services/SidecarService'
import type { DebugService } from '../services/DebugService'
import type { DebugSessionManager } from '../services/DebugSessionManager'
import type { XEventsProfiler } from '../services/XEventsService'
import type { ConnectionStore } from '../services/ConnectionStore'
import type { HistoryStore } from '../services/HistoryStore'
import type { McpConnectionStore } from '../services/McpConnectionStore'
import type { McpAudit } from '../mcp/audit'
import type { AiDiagnosisService } from '../ai/AiDiagnosisService'
import type { WorkspaceStore } from '../services/WorkspaceStore'
import type { WorkspaceState } from '@shared/types'
import {
  inspectQuery,
  listColumns,
  listColumnNames,
  listDatabases,
  listObjects,
  listProcedures,
  loadProcedure,
  testConnection
} from '../services/SqlService'
import { controlStatus, createControl } from '../services/ControlService'
import { buildMarkdown } from '../services/ExportService'

export function registerIpcHandlers(
  sidecar: SidecarService,
  debug: DebugService,
  sessions: DebugSessionManager,
  profiler: XEventsProfiler,
  connections: ConnectionStore,
  history: HistoryStore,
  mcpConnections: McpConnectionStore,
  mcpAudit: McpAudit,
  aiDiagnosis: AiDiagnosisService,
  workspace: WorkspaceStore
): void {
  const resolveRef = (ref: ConnectionRef): ConnectionConfig => {
    const base = 'id' in ref ? connections.resolve(ref.id) : ref.config
    // Surcharge de base par onglet (sélecteur type SSMS) : appliquée ici,
    // donc respectée par exécution, profilage, inspection et explorateur.
    return ref.database ? { ...base, database: ref.database } : base
  }

  ipcMain.handle('sidecar:parse', (_event, sql: string, compatLevel?: number) =>
    sidecar.parse(sql, compatLevel)
  )
  ipcMain.handle('sidecar:instrument', (_event, sql: string, compatLevel?: number) =>
    sidecar.instrument(sql, compatLevel)
  )
  ipcMain.handle('sidecar:status', () => sidecar.status())

  ipcMain.handle('connection:test', (_event, ref: ConnectionRef) =>
    testConnection(resolveRef(ref))
  )
  ipcMain.handle('connection:list', () => connections.list())
  ipcMain.handle('connection:save', (_event, input: SaveConnectionInput) =>
    connections.save(input)
  )
  ipcMain.handle('connection:delete', (_event, id: string) => connections.delete(id))

  ipcMain.handle('db:list', (_event, ref: ConnectionRef) => listDatabases(resolveRef(ref)))
  ipcMain.handle('db:objects', (_event, ref: ConnectionRef) => listObjects(resolveRef(ref)))
  ipcMain.handle('db:columns', (_event, ref: ConnectionRef, objectId: number) =>
    listColumns(resolveRef(ref), objectId)
  )
  ipcMain.handle('db:columnNames', (_event, ref: ConnectionRef) =>
    listColumnNames(resolveRef(ref))
  )
  ipcMain.handle('proc:list', (_event, ref: ConnectionRef) => listProcedures(resolveRef(ref)))
  ipcMain.handle('proc:load', (_event, ref: ConnectionRef, objectId: number) =>
    loadProcedure(resolveRef(ref), objectId)
  )

  ipcMain.handle('debug:run', (_event, req: DebugRequest) =>
    debug.run({ ...req, connection: resolveRef(req.connection) })
  )

  ipcMain.handle('debug:start', (event, req: DebugStartRequest) => {
    const emit = (e: DebugSessionEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send('debug:event', e)
    }
    return sessions.start({ ...req, connection: resolveRef(req.connection) }, req.pause, emit)
  })
  ipcMain.handle('debug:continue', (_event, sessionId: string) => sessions.continue_(sessionId))
  ipcMain.handle('debug:stepOnce', (_event, sessionId: string) => sessions.stepOnce(sessionId))
  ipcMain.handle('debug:stop', (_event, sessionId: string) => sessions.stop(sessionId))

  ipcMain.handle('control:status', (_event, ref: ConnectionRef) => controlStatus(resolveRef(ref)))
  ipcMain.handle('control:create', (_event, ref: ConnectionRef) => createControl(resolveRef(ref)))

  ipcMain.handle(
    'inspect:query',
    (_event, ref: ConnectionRef, sqlText: string, readUncommitted: boolean) =>
      inspectQuery(resolveRef(ref), sqlText, readUncommitted)
  )

  ipcMain.handle('xe:check', (_event, ref: ConnectionRef) =>
    profiler.checkPermission(resolveRef(ref))
  )
  ipcMain.handle('xe:start', (event, req: XeStartRequest) => {
    const emit = (e: XEventsEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send('xe:event', e)
    }
    return profiler.start({ ...req, connection: resolveRef(req.connection) }, emit)
  })
  ipcMain.handle('xe:stop', (_event, profileId: string) => profiler.stop(profileId))

  ipcMain.handle(
    'session:export',
    async (event, input: HistorySaveInput, format: 'md' | 'json'): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const safeTitle = input.title.replace(/[^\w.-]+/g, '_')
      const result = await dialog.showSaveDialog(window!, {
        title: 'Exporter la session',
        defaultPath: `gtrace-${safeTitle}.${format}`,
        filters:
          format === 'md'
            ? [{ name: 'Markdown', extensions: ['md'] }]
            : [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      const content =
        format === 'md'
          ? buildMarkdown(input)
          : JSON.stringify({ ...input, exportedAt: new Date().toISOString() }, null, 2)
      writeFileSync(result.filePath, content, 'utf8')
      return result.filePath
    }
  )

  // ─── Accès IA / MCP (Phase 6.2) ────────────────────────────────────────────
  ipcMain.handle('mcp:list', () => mcpConnections.list())
  ipcMain.handle('mcp:grant', async (_event, input: McpGrantInput) => {
    let config: ConnectionConfig
    if (input.savedConnectionId) {
      // Connexions marquées « production » : jamais exposables (spec §3.4.3).
      if (connections.isProduction(input.savedConnectionId)) {
        throw new Error(
          'Refus : une connexion « production » ne peut pas être exposée à l\'accès MCP.'
        )
      }
      config = connections.resolve(input.savedConnectionId)
    } else if (input.config) {
      config = input.config
    } else {
      throw new Error('Aucune connexion fournie pour l\'octroi MCP.')
    }
    return mcpConnections.grant(
      config,
      input.label,
      input.maskPatterns ?? [],
      input.savedConnectionId,
      input.allowUnattendedRuns ?? false
    )
  })
  ipcMain.handle('mcp:revoke', (_event, connectionId: string) => mcpConnections.revoke(connectionId))
  ipcMain.handle('mcp:audit', () => mcpAudit.read())

  // ─── IA embarquée (Phase 6.4) ──────────────────────────────────────────────
  ipcMain.handle('ai:getConfig', () => aiDiagnosis.getConfig())
  ipcMain.handle('ai:setConfig', (_event, patch: AiConfigPatch) => aiDiagnosis.setConfig(patch))
  ipcMain.handle('ai:diagnose', (_event, input: HistorySaveInput) =>
    aiDiagnosis.diagnose({
      id: 'session-courante',
      savedAt: new Date().toISOString(),
      stepCount: input.run.steps.length,
      errorCount: input.run.errors.length + input.run.steps.filter((s) => s.kind === 'catch').length,
      ...input
    })
  )
  ipcMain.handle('ai:verify', async (_event, ref: ConnectionRef, sqlText: string) => {
    // Requêtes de vérification suggérées par l'IA : mêmes garde-fous lecture
    // seule que le canal MCP avant exécution sur le pool d'inspection.
    const validation = await sidecar.validateReadOnly(sqlText)
    if (validation.violations.length > 0) {
      const v = validation.violations[0]
      throw new Error(`Rejeté (lecture seule) : ${v.type} — ${v.target}`)
    }
    return inspectQuery(resolveRef(ref), sqlText, true)
  })

  // ─── Fichiers (éditeur multi-onglets) ──────────────────────────────────────
  ipcMain.handle('file:open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Ouvrir des fichiers SQL',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Scripts SQL', extensions: ['sql'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths.map((p) => ({
      path: p,
      name: basename(p),
      content: readFileSync(p, 'utf8')
    }))
  })

  ipcMain.handle(
    'file:save',
    async (event, filePath: string | null, content: string, suggestedName: string) => {
      let target = filePath
      if (!target) {
        const win = BrowserWindow.fromWebContents(event.sender)
        const base = (suggestedName || 'script').replace(/[^\w.-]+/g, '_')
        const result = await dialog.showSaveDialog(win!, {
          title: 'Enregistrer le script SQL',
          defaultPath: base.toLowerCase().endsWith('.sql') ? base : `${base}.sql`,
          filters: [{ name: 'Scripts SQL', extensions: ['sql'] }]
        })
        if (result.canceled || !result.filePath) return null
        target = result.filePath
      }
      writeFileSync(target, content, 'utf8')
      return { path: target, name: basename(target) }
    }
  )

  ipcMain.handle('workspace:load', () => workspace.load())
  ipcMain.handle('workspace:save', (_event, state: WorkspaceState) => workspace.save(state))
  ipcMain.handle('file:read', (_event, path: string): string | null => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('history:save', (_event, input: HistorySaveInput) => history.save(input))
  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:load', (_event, id: string) => history.load(id))
  ipcMain.handle('history:delete', (_event, id: string) => history.delete(id))
}
