import { app, BrowserWindow, ipcMain } from 'electron'
import type { UpdateStatus } from '@shared/types'

/**
 * Mises à jour automatiques via `electron-updater` (flux GitHub Releases,
 * même pipeline que GVue) :
 *   publish.bat → bump de version → build → release GitHub en BROUILLON →
 *   « Publish release » (1 clic) → les apps installées détectent la version,
 *   la téléchargent en arrière-plan et proposent « Redémarrer et installer ».
 *
 * La dépendance est chargée à la demande : absente ou en mode dev (non
 * empaqueté), l'auto-update est simplement inactif (état « unsupported »)
 * et l'application fonctionne normalement.
 */

let lastStatus: UpdateStatus = { state: 'idle' }
// Vérification déclenchée par l'utilisateur ? (les erreurs des vérifications
// automatiques en arrière-plan restent silencieuses)
let manualCheck = false

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:onStatus', status)
  }
}

// « Pas de release publiée » = rien à installer, pas une panne.
function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e)
  const noRelease = /no published versions|not found|404|cannot find|latest\.yml/i.test(msg)
  if (!manualCheck) {
    broadcast({ state: 'idle' })
    return
  }
  broadcast(
    noRelease
      ? {
          state: 'error',
          message:
            'Aucune release exploitable sur GitHub (latest.yml manquant ou release absente).'
        }
      : { state: 'error', message: msg }
  )
}

/** Type minimal d'electron-updater (évite d'exiger ses types à la compilation). */
interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, cb: (...args: never[]) => void): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

// Chargement indirect pour éviter une résolution statique à la compilation.
let cached: { autoUpdater: unknown } | null | undefined
function loadUpdater(): UpdaterLike | null {
  if (cached !== undefined) return cached ? (cached.autoUpdater as UpdaterLike) : null
  try {
    const moduleName = 'electron-updater'
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(moduleName)
    const u = mod.autoUpdater as UpdaterLike
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.on('checking-for-update', () => broadcast({ state: 'checking' }))
    u.on('update-available', (i: { version?: string }) =>
      broadcast({ state: 'available', version: i?.version ?? '' })
    )
    u.on('update-not-available', (i: { version?: string }) =>
      broadcast({ state: 'none', version: i?.version ?? app.getVersion() })
    )
    u.on('download-progress', (p: { percent?: number }) =>
      broadcast({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
    )
    u.on('update-downloaded', (i: { version?: string }) =>
      broadcast({ state: 'ready', version: i?.version ?? '' })
    )
    u.on('error', (e: Error) => reportError(e))
    cached = { autoUpdater: u }
    return u
  } catch {
    cached = null
    return null
  }
}

/** Lance une vérification (manuelle ou automatique). */
export function checkForUpdates(manual = false): void {
  if (!app.isPackaged) {
    if (manual) broadcast({ state: 'unsupported' })
    return
  }
  const u = loadUpdater()
  if (!u) {
    if (manual) broadcast({ state: 'unsupported' })
    return
  }
  manualCheck = manual
  if (manual) broadcast({ state: 'checking' })
  u.checkForUpdates().catch((e: unknown) => reportError(e))
}

/** Vérifie au démarrage puis toutes les 6 h. */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  checkForUpdates(false)
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000)
}

export function registerUpdateHandlers(): void {
  ipcMain.handle('update:check', () => checkForUpdates(true))
  ipcMain.handle('update:install', () => {
    const u = loadUpdater()
    if (u) u.quitAndInstall()
  })
  ipcMain.handle('update:get', () => ({ status: lastStatus, version: app.getVersion() }))
}
