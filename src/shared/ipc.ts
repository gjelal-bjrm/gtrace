import type {
  AiConfig,
  AiConfigPatch,
  AiDiagnosis,
  ColumnInfo,
  ConnectionRef,
  ControlStatus,
  DatabaseInfo,
  DbObjects,
  DebugRequest,
  DebugRunResult,
  DebugSessionEvent,
  DebugStartRequest,
  HistoryEntry,
  HistoryEntrySummary,
  HistorySaveInput,
  InstrumentResult,
  McpAuditEntry,
  McpConnection,
  McpGrantInput,
  ParseResult,
  ProcSource,
  ProcSummary,
  ResultSetData,
  SavedConnection,
  SaveConnectionInput,
  SidecarStatus,
  TestResult,
  WorkspaceLoadResult,
  WorkspaceState,
  XeStartRequest,
  XEventsEvent
} from './types'

/**
 * Contrat IPC typé — clé du canal → signature du handler.
 * Chaque entrée est implémentée via ipcMain.handle / ipcRenderer.invoke.
 * Le contrat s'étendra phase par phase (connection:*, proc:*, debug:*, replay:*…).
 */
export interface IpcContract {
  'sidecar:parse': (sql: string, compatLevel?: number) => Promise<ParseResult>
  'sidecar:instrument': (sql: string, compatLevel?: number) => Promise<InstrumentResult>
  'sidecar:status': () => Promise<SidecarStatus>
  'connection:test': (ref: ConnectionRef) => Promise<TestResult>
  'connection:list': () => Promise<SavedConnection[]>
  'connection:save': (input: SaveConnectionInput) => Promise<SavedConnection>
  'connection:delete': (id: string) => Promise<void>
  'db:list': (ref: ConnectionRef) => Promise<DatabaseInfo[]>
  'db:objects': (ref: ConnectionRef) => Promise<DbObjects>
  'db:columns': (ref: ConnectionRef, objectId: number) => Promise<ColumnInfo[]>
  'db:columnNames': (ref: ConnectionRef) => Promise<string[]>
  'proc:list': (ref: ConnectionRef) => Promise<ProcSummary[]>
  'proc:load': (ref: ConnectionRef, objectId: number) => Promise<ProcSource>
  'debug:run': (req: DebugRequest) => Promise<DebugRunResult>
  'debug:start': (req: DebugStartRequest) => Promise<{ sessionId: string; instrument: InstrumentResult }>
  'debug:continue': (sessionId: string) => Promise<void>
  'debug:stepOnce': (sessionId: string) => Promise<void>
  'debug:stop': (sessionId: string) => Promise<void>
  'control:status': (ref: ConnectionRef) => Promise<ControlStatus>
  'control:create': (ref: ConnectionRef) => Promise<void>
  'inspect:query': (ref: ConnectionRef, sql: string, readUncommitted: boolean) => Promise<ResultSetData[]>
  'xe:check': (ref: ConnectionRef) => Promise<boolean>
  'xe:start': (req: XeStartRequest) => Promise<{ profileId: string }>
  'xe:stop': (profileId: string) => Promise<void>
  'ai:getConfig': () => Promise<AiConfig>
  'ai:setConfig': (patch: AiConfigPatch) => Promise<AiConfig>
  'ai:diagnose': (input: HistorySaveInput) => Promise<AiDiagnosis>
  'ai:verify': (ref: ConnectionRef, sql: string) => Promise<ResultSetData[]>
  'mcp:list': () => Promise<McpConnection[]>
  'mcp:grant': (input: McpGrantInput) => Promise<McpConnection>
  'mcp:revoke': (connectionId: string) => Promise<void>
  'mcp:audit': () => Promise<McpAuditEntry[]>
  'file:open': () => Promise<Array<{ path: string; name: string; content: string }>>
  'file:save': (
    filePath: string | null,
    content: string,
    suggestedName: string
  ) => Promise<{ path: string; name: string } | null>
  'workspace:load': () => Promise<WorkspaceLoadResult>
  'workspace:save': (state: WorkspaceState) => Promise<void>
  'file:read': (path: string) => Promise<string | null>
  'session:export': (input: HistorySaveInput, format: 'md' | 'json') => Promise<string | null>
  'history:save': (input: HistorySaveInput) => Promise<HistoryEntrySummary>
  'history:list': () => Promise<HistoryEntrySummary[]>
  'history:load': (id: string) => Promise<HistoryEntry>
  'history:delete': (id: string) => Promise<void>
}

export type IpcChannel = keyof IpcContract

/** API exposée au renderer via contextBridge (préload). */
export interface GTraceApi {
  parse: (sql: string, compatLevel?: number) => Promise<ParseResult>
  instrument: (sql: string, compatLevel?: number) => Promise<InstrumentResult>
  sidecarStatus: () => Promise<SidecarStatus>
  testConnection: (ref: ConnectionRef) => Promise<TestResult>
  listConnections: () => Promise<SavedConnection[]>
  saveConnection: (input: SaveConnectionInput) => Promise<SavedConnection>
  deleteConnection: (id: string) => Promise<void>
  listDatabases: (ref: ConnectionRef) => Promise<DatabaseInfo[]>
  listObjects: (ref: ConnectionRef) => Promise<DbObjects>
  listColumns: (ref: ConnectionRef, objectId: number) => Promise<ColumnInfo[]>
  listColumnNames: (ref: ConnectionRef) => Promise<string[]>
  listProcs: (ref: ConnectionRef) => Promise<ProcSummary[]>
  loadProc: (ref: ConnectionRef, objectId: number) => Promise<ProcSource>
  debugRun: (req: DebugRequest) => Promise<DebugRunResult>
  debugStart: (req: DebugStartRequest) => Promise<{ sessionId: string; instrument: InstrumentResult }>
  debugContinue: (sessionId: string) => Promise<void>
  debugStepOnce: (sessionId: string) => Promise<void>
  debugStop: (sessionId: string) => Promise<void>
  controlStatus: (ref: ConnectionRef) => Promise<ControlStatus>
  controlCreate: (ref: ConnectionRef) => Promise<void>
  inspectQuery: (ref: ConnectionRef, sql: string, readUncommitted: boolean) => Promise<ResultSetData[]>
  xeCheck: (ref: ConnectionRef) => Promise<boolean>
  xeStart: (req: XeStartRequest) => Promise<{ profileId: string }>
  xeStop: (profileId: string) => Promise<void>
  aiGetConfig: () => Promise<AiConfig>
  aiSetConfig: (patch: AiConfigPatch) => Promise<AiConfig>
  aiDiagnose: (input: HistorySaveInput) => Promise<AiDiagnosis>
  aiVerify: (ref: ConnectionRef, sql: string) => Promise<ResultSetData[]>
  mcpList: () => Promise<McpConnection[]>
  mcpGrant: (input: McpGrantInput) => Promise<McpConnection>
  mcpRevoke: (connectionId: string) => Promise<void>
  mcpAudit: () => Promise<McpAuditEntry[]>
  openFiles: () => Promise<Array<{ path: string; name: string; content: string }>>
  saveFile: (
    filePath: string | null,
    content: string,
    suggestedName: string
  ) => Promise<{ path: string; name: string } | null>
  workspaceLoad: () => Promise<WorkspaceLoadResult>
  workspaceSave: (state: WorkspaceState) => Promise<void>
  readFile: (path: string) => Promise<string | null>
  exportSession: (input: HistorySaveInput, format: 'md' | 'json') => Promise<string | null>
  historySave: (input: HistorySaveInput) => Promise<HistoryEntrySummary>
  historyList: () => Promise<HistoryEntrySummary[]>
  historyLoad: (id: string) => Promise<HistoryEntry>
  historyDelete: (id: string) => Promise<void>
  /** Abonnement aux événements de session ; renvoie la fonction de désabonnement. */
  onDebugEvent: (cb: (event: DebugSessionEvent) => void) => () => void
  onXeEvent: (cb: (event: XEventsEvent) => void) => () => void
}
