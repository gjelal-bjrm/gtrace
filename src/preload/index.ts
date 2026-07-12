import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { GTraceApi } from '@shared/ipc'
import type { DebugSessionEvent, UpdateStatus, XEventsEvent } from '@shared/types'

const api: GTraceApi = {
  parse: (sql, compatLevel) => ipcRenderer.invoke('sidecar:parse', sql, compatLevel),
  instrument: (sql, compatLevel) => ipcRenderer.invoke('sidecar:instrument', sql, compatLevel),
  sidecarStatus: () => ipcRenderer.invoke('sidecar:status'),
  testConnection: (ref) => ipcRenderer.invoke('connection:test', ref),
  listConnections: () => ipcRenderer.invoke('connection:list'),
  saveConnection: (input) => ipcRenderer.invoke('connection:save', input),
  deleteConnection: (id) => ipcRenderer.invoke('connection:delete', id),
  listDatabases: (ref) => ipcRenderer.invoke('db:list', ref),
  listObjects: (ref) => ipcRenderer.invoke('db:objects', ref),
  listColumns: (ref, objectId) => ipcRenderer.invoke('db:columns', ref, objectId),
  listColumnNames: (ref) => ipcRenderer.invoke('db:columnNames', ref),
  listProcs: (ref) => ipcRenderer.invoke('proc:list', ref),
  loadProc: (ref, objectId) => ipcRenderer.invoke('proc:load', ref, objectId),
  debugRun: (req) => ipcRenderer.invoke('debug:run', req),
  debugStart: (req) => ipcRenderer.invoke('debug:start', req),
  debugContinue: (sessionId) => ipcRenderer.invoke('debug:continue', sessionId),
  debugStepOnce: (sessionId) => ipcRenderer.invoke('debug:stepOnce', sessionId),
  debugStop: (sessionId) => ipcRenderer.invoke('debug:stop', sessionId),
  controlStatus: (ref) => ipcRenderer.invoke('control:status', ref),
  controlCreate: (ref) => ipcRenderer.invoke('control:create', ref),
  inspectQuery: (ref, sql, readUncommitted) =>
    ipcRenderer.invoke('inspect:query', ref, sql, readUncommitted),
  xeCheck: (ref) => ipcRenderer.invoke('xe:check', ref),
  xeStart: (req) => ipcRenderer.invoke('xe:start', req),
  xeStop: (profileId) => ipcRenderer.invoke('xe:stop', profileId),
  aiGetConfig: () => ipcRenderer.invoke('ai:getConfig'),
  aiSetConfig: (patch) => ipcRenderer.invoke('ai:setConfig', patch),
  aiDiagnose: (input) => ipcRenderer.invoke('ai:diagnose', input),
  aiVerify: (ref, sql) => ipcRenderer.invoke('ai:verify', ref, sql),
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpGrant: (input) => ipcRenderer.invoke('mcp:grant', input),
  mcpRevoke: (connectionId) => ipcRenderer.invoke('mcp:revoke', connectionId),
  mcpAudit: () => ipcRenderer.invoke('mcp:audit'),
  openFiles: () => ipcRenderer.invoke('file:open'),
  saveFile: (filePath, content, suggestedName) =>
    ipcRenderer.invoke('file:save', filePath, content, suggestedName),
  workspaceLoad: () => ipcRenderer.invoke('workspace:load'),
  workspaceSave: (state) => ipcRenderer.invoke('workspace:save', state),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  exportSession: (input, format) => ipcRenderer.invoke('session:export', input, format),
  historySave: (input) => ipcRenderer.invoke('history:save', input),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyLoad: (id) => ipcRenderer.invoke('history:load', id),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateGet: () => ipcRenderer.invoke('update:get'),
  onUpdateStatus: (cb) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('update:onStatus', listener)
    return () => ipcRenderer.removeListener('update:onStatus', listener)
  },
  onDebugEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: DebugSessionEvent): void => cb(payload)
    ipcRenderer.on('debug:event', listener)
    return () => ipcRenderer.removeListener('debug:event', listener)
  },
  onXeEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: XEventsEvent): void => cb(payload)
    ipcRenderer.on('xe:event', listener)
    return () => ipcRenderer.removeListener('xe:event', listener)
  }
}

contextBridge.exposeInMainWorld('gtrace', api)
