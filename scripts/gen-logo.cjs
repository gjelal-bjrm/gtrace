#!/usr/bin/env node
/**
 * Génère les icônes de GTrace à partir de l'image source du logo
 * (build/logo-source.jpg : le G en points crème sur fond anthracite mat).
 *
 * L'image est recadrée sur le G puis posée sur un carreau arrondi. En grand
 * (96 px et plus) elle reste telle quelle ; en dessous, ses points sont grossis
 * pour que le G reste lisible (bureau, barre des tâches, barre de titre).
 *
 * Par défaut (npm run gen:icon), écrit les fichiers du programme :
 *   - build/icon.ico : icône Windows multi-tailles — exécutable, installateur,
 *                      fenêtre ; Windows choisit l'image adaptée à l'endroit ;
 *   - build/icon.png : 512 px ;
 *   - src/renderer/src/assets/logo-ui.png : logo de l'interface (barre de
 *     menus, Nouveautés), version aux points grossis.
 *
 * Avec --preview <dossier> : toutes les tailles et une planche de contrôle
 * (taille réelle sur fond clair et sombre), sans toucher au programme.
 *
 *   npx electron scripts/gen-logo.cjs [--preview <dossier>]
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
const UI_SIZE = 64

const root = path.join(__dirname, '..')
const source = path.join(root, 'build', 'logo-source.jpg')
const previewArg = process.argv.indexOf('--preview')
const preview = previewArg > 0 ? path.resolve(process.argv[previewArg + 1]) : null
const outDir = preview ?? path.join(root, 'build')

/** Icône Windows : en-tête + répertoire + images PNG (format accepté depuis Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

/**
 * Dessin dans une page hors écran (canvas). Les paramètres :
 *   - crop : le carré autour du G, en fraction de l'image (le G remplit ~80 % du carreau) ;
 *   - grossissement des points selon la taille, en pixels de l'image 1024 px.
 */
const RENDER = `(async ({ src, sizes, uiSize }) => {
  const img = new Image(); img.src = src; await img.decode()
  const W = img.naturalWidth
  const crop = { x: 0.051 * W, y: 0.054 * W, s: 0.869 * W }
  const base = document.createElement('canvas'); base.width = base.height = 1024
  base.getContext('2d').drawImage(img, crop.x, crop.y, crop.s, crop.s, 0, 0, 1024, 1024)

  // Points grossis : l'image superposée à elle-même, décalée en cercle (le plus clair l'emporte).
  const fatten = (r) => {
    const c = document.createElement('canvas'); c.width = c.height = 1024
    const g = c.getContext('2d'); g.drawImage(base, 0, 0); g.globalCompositeOperation = 'lighten'
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2
      g.drawImage(base, Math.cos(t) * r, Math.sin(t) * r)
    }
    return c
  }
  const levels = { large: base, small: fatten(10), tiny: fatten(22) }
  const levelFor = (size) => (size >= 96 ? 'large' : size >= 32 ? 'small' : 'tiny')

  // Réduction par paliers de moitié (bien plus net qu'en une fois), puis carreau arrondi.
  const tile = (src, size) => {
    let s = src
    let w = 1024
    while (w / 2 >= size) {
      const t = document.createElement('canvas'); t.width = t.height = w / 2
      const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(s, 0, 0, w / 2, w / 2)
      s = t; w /= 2
    }
    const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d'); const r = size * 0.2
    g.beginPath(); g.roundRect(0, 0, size, size, r); g.clip()
    g.imageSmoothingQuality = 'high'; g.drawImage(s, 0, 0, size, size)
    // Liseré discret : détache le carreau sombre d'une barre des tâches sombre.
    const lw = Math.max(1, size / 128)
    g.lineWidth = lw; g.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    g.beginPath(); g.roundRect(lw / 2, lw / 2, size - lw, size - lw, r); g.stroke()
    return c.toDataURL('image/png')
  }

  const out = {}
  for (const size of sizes) out[size] = tile(levels[levelFor(size)], size)
  out.ui = tile(levels.tiny, uiSize)
  return out
})`

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(outDir, { recursive: true })
    const src = `data:image/jpeg;base64,${fs.readFileSync(source).toString('base64')}`
    const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: true } })
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><body></body>')
    const rendered = await win.webContents.executeJavaScript(
      `${RENDER}(${JSON.stringify({ src, sizes: SIZES, uiSize: UI_SIZE })})`
    )
    const png = (key) => Buffer.from(rendered[key].split(',')[1], 'base64')

    fs.writeFileSync(
      path.join(outDir, 'icon.ico'),
      buildIco(ICO_SIZES.map((size) => ({ size, data: png(size) })))
    )

    if (!preview) {
      fs.writeFileSync(path.join(outDir, 'icon.png'), png(512))
      const assets = path.join(root, 'src', 'renderer', 'src', 'assets')
      fs.mkdirSync(assets, { recursive: true })
      fs.writeFileSync(path.join(assets, 'logo-ui.png'), png('ui'))
      console.log('[logo] build/icon.ico, build/icon.png, assets/logo-ui.png')
      app.exit(0)
      return
    }

    for (const size of SIZES) fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png(size))
    // Planche de contrôle : grand format, puis chaque petite taille à taille réelle.
    const row = (bg, fg) =>
      [16, 20, 24, 32, 40, 48, 64]
        .map(
          (s) =>
            `<figure style="color:${fg}"><div style="height:64px;display:flex;align-items:center;justify-content:center"><img src="${rendered[s]}" width="${s}" height="${s}"></div><figcaption>${s} px</figcaption></figure>`
        )
        .join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:13px 'Segoe UI',sans-serif;background:#E8EEE5;color:#1E2A24;padding:18px;width:760px}
      .strip{display:flex;gap:18px;align-items:flex-end;padding:10px 14px;border-radius:8px;margin-top:10px}
      figure{margin:0;text-align:center;font-size:11px}
    </style></head><body>
      <img src="${rendered[256]}" width="256" height="256">
      <div class="strip" style="background:#1B1F22">${row('#1B1F22', '#cfd6d2')}</div>
      <div class="strip" style="background:#F3F3F3">${row('#F3F3F3', '#333')}</div>
    </body></html>`
    const board = new BrowserWindow({ width: 800, height: 700, show: false, webPreferences: { offscreen: true } })
    await board.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 400))
    const h = await board.webContents.executeJavaScript('document.body.scrollHeight')
    board.setContentSize(800, Math.min(1200, h + 20))
    await new Promise((r) => setTimeout(r, 300))
    fs.writeFileSync(path.join(outDir, 'planche.png'), (await board.webContents.capturePage()).toPNG())
    console.log(`[logo] ${SIZES.length} tailles + icon.ico + planche.png -> ${outDir}`)
    app.exit(0)
  })
  .catch((e) => {
    console.error('[logo] échec :', e)
    app.exit(1)
  })
