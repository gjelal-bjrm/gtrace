#!/usr/bin/env node
/**
 * Rasterise build/icon.svg en PNG (256 et 512 px, fond transparent) pour
 * electron-builder (icône NSIS/exe) et l'icône de fenêtre.
 *
 * Utilise Electron en mode offscreen (aucune dépendance supplémentaire) :
 *   npx electron scripts/gen-icon.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    const size = 512
    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true }
    })
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg}</body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Laisse les filtres (ombres portées) se peindre avant capture.
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.toPNG())
    console.log('[icon] build/icon.png (512x512)')
    // Les tailles réduites dérivent de la capture 512 (une seule fenêtre).
    fs.writeFileSync(
      path.join(root, 'build', 'icon-256.png'),
      image.resize({ width: 256, height: 256, quality: 'best' }).toPNG()
    )
    console.log('[icon] build/icon-256.png (256x256)')
    win.destroy()
    app.exit(0)
  })
  .catch((e) => {
    console.error('[icon] échec :', e)
    app.exit(1)
  })
