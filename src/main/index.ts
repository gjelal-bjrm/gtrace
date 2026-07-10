import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { SidecarService } from './services/SidecarService'
import { DebugService } from './services/DebugService'
import { DebugSessionManager } from './services/DebugSessionManager'
import { XEventsProfiler } from './services/XEventsService'
import { ConnectionStore } from './services/ConnectionStore'
import { HistoryStore } from './services/HistoryStore'
import { McpConnectionStore } from './services/McpConnectionStore'
import { McpAudit } from './mcp/audit'
import { AiDiagnosisService } from './ai/AiDiagnosisService'
import { WorkspaceStore } from './services/WorkspaceStore'
import { closeAllPools } from './services/SqlService'
import { registerIpcHandlers } from './ipc/handlers'

let sidecar: SidecarService | null = null
let sessions: DebugSessionManager | null = null
let profiler: XEventsProfiler | null = null

function sidecarExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sidecar', 'GTrace.Parser.exe')
    : join(app.getAppPath(), 'resources', 'sidecar', 'GTrace.Parser.exe')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  sidecar = new SidecarService(sidecarExePath())
  sessions = new DebugSessionManager(sidecar)
  profiler = new XEventsProfiler(sidecar)
  const userData = app.getPath('userData')
  registerIpcHandlers(
    sidecar,
    new DebugService(sidecar),
    sessions,
    profiler,
    new ConnectionStore(),
    new HistoryStore(join(userData, 'sessions')),
    new McpConnectionStore(userData, sidecar),
    new McpAudit(userData),
    new AiDiagnosisService(userData, sidecar),
    new WorkspaceStore(userData)
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  sidecar?.dispose()
  void sessions?.disposeAll()
  profiler?.disposeAll()
  void closeAllPools()
})
