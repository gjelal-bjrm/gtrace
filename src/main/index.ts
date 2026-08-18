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
import { initAutoUpdate, registerUpdateHandlers } from './services/UpdateService'
import { registerIpcHandlers } from './ipc/handlers'
import { connectionFromArgv } from './cli'

let sidecar: SidecarService | null = null
let sessions: DebugSessionManager | null = null
let profiler: XEventsProfiler | null = null
let mainWindow: BrowserWindow | null = null

function sidecarExePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sidecar', 'GTrace.Parser.exe')
    : join(app.getAppPath(), 'resources', 'sidecar', 'GTrace.Parser.exe')
}

function createWindow(connectionId?: string | null): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16181d',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Lancé avec « --connection <id|nom> » : le renderer s'y connecte une fois
  // l'espace de travail restauré (il ne le remplace pas, il s'y ajoute).
  if (connectionId) {
    win.webContents.once('did-finish-load', () =>
      win.webContents.send('connection:open', connectionId)
    )
  }

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

// Verrou d'instance unique : un seul processus GTrace, sinon deux instances
// écrivent le même workspace.json et se marchent dessus. Une seconde commande
// (« GTrace.exe --connection <id> » lancé par GRay) est redirigée vers la
// fenêtre existante au lieu d'ouvrir une seconde application.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
    const id = connectionFromArgv(argv, app.isPackaged)
    if (id) win.webContents.send('connection:open', id)
  })

  bootstrap()
}

function bootstrap(): void {
  void app.whenReady().then(() => {
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
    registerUpdateHandlers()
    createWindow(connectionFromArgv(process.argv, app.isPackaged))
    // Vérifie au lancement puis toutes les 6 h (inactif en dev).
    initAutoUpdate()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  sidecar?.dispose()
  void sessions?.disposeAll()
  profiler?.disposeAll()
  void closeAllPools()
})
