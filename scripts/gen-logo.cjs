#!/usr/bin/env node
/**
 * Génère le logo GTrace à toutes les tailles d'icône Windows, avec le niveau
 * de détail adapté à chaque taille (voir logo-geometry.cjs).
 *
 * Par défaut (npm run gen:icon), écrit les fichiers du programme :
 *   - build/icon.ico  : icône Windows multi-tailles — exécutable, installateur,
 *                       fenêtre ; Windows choisit l'image adaptée à l'endroit
 *                       (titre de fenêtre, barre des tâches, bureau…) ;
 *   - build/icon.png  : 512 px, version complète ;
 *   - build/icon.svg  : dessin vectoriel de référence ;
 *   - src/renderer/src/assets/logo-small.svg : logo de l'interface (petites tailles).
 *
 * Avec --preview <dossier> : toutes les tailles, les quatre dessins et une
 * planche de contrôle (aperçu avant intégration), sans toucher au programme.
 *
 *   npx electron scripts/gen-logo.cjs [--preview <dossier>] [--compare <logo.jpg>] [--taskbar <capture.png>]
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { logoSvg, levelFor } = require('./logo-geometry.cjs')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}

const root = path.join(__dirname, '..')
const preview = arg('--preview', null)
const outDir = preview ? path.resolve(preview) : path.join(root, 'build')
const compare = arg('--compare', null)
const taskbar = arg('--taskbar', null)

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

const dataUrl = (file) =>
  `data:image/${path.extname(file).slice(1).replace('jpg', 'jpeg')};base64,${fs
    .readFileSync(file)
    .toString('base64')}`

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(outDir, { recursive: true })
    if (preview) {
      for (const level of ['full', 'medium', 'small', 'tiny']) {
        fs.writeFileSync(path.join(outDir, `logo-${level}.svg`), logoSvg(level))
      }
    }

    // 1) Chaque taille est dessinée par le navigateur à sa taille exacte.
    const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: true } })
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><body></body>')
    const jobs = SIZES.map((size) => ({
      size,
      svg: logoSvg(levelFor(size)).replace('width="1024" height="1024"', `width="${size}" height="${size}"`)
    }))
    const rendered = await win.webContents.executeJavaScript(`(async () => {
      const out = {}
      for (const { size, svg } of ${JSON.stringify(jobs)}) {
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        await img.decode()
        const c = document.createElement('canvas')
        c.width = c.height = size
        c.getContext('2d').drawImage(img, 0, 0, size, size)
        out[size] = c.toDataURL('image/png')
      }
      return out
    })()`)
    const pngs = {}
    for (const size of SIZES) {
      pngs[size] = Buffer.from(rendered[size].split(',')[1], 'base64')
      if (preview) fs.writeFileSync(path.join(outDir, `icon-${size}.png`), pngs[size])
    }
    fs.writeFileSync(
      path.join(outDir, 'icon.ico'),
      buildIco(ICO_SIZES.map((size) => ({ size, data: pngs[size] })))
    )
    if (!preview) {
      fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[512])
      fs.writeFileSync(path.join(outDir, 'icon.svg'), logoSvg('full'))
      const assets = path.join(root, 'src', 'renderer', 'src', 'assets')
      fs.mkdirSync(assets, { recursive: true })
      fs.writeFileSync(path.join(assets, 'logo-small.svg'), logoSvg('small'))
      console.log('[logo] build/icon.ico, build/icon.png, build/icon.svg, assets/logo-small.svg')
      app.exit(0)
      return
    }
    console.log(`[logo] ${SIZES.length} tailles + icon.ico -> ${outDir}`)

    // 2) Planche de contrôle.
    const png = (size) => `data:image/png;base64,${pngs[size].toString('base64')}`
    const row = (bg, fg) =>
      [16, 20, 24, 32, 40, 48, 64]
        .map(
          (s) =>
            `<figure style="color:${fg}"><div style="height:64px;display:flex;align-items:center;justify-content:center"><img src="${png(s)}" width="${s}" height="${s}"></div><figcaption>${s} px</figcaption></figure>`
        )
        .join('')
    const zoom = (src, crop) =>
      crop
        ? `<div style="width:120px;height:120px;overflow:hidden;position:relative"><img src="${src}" style="position:absolute;image-rendering:pixelated;width:${101 * 5}px;height:${41 * 5}px;left:${-crop * 5}px;top:-45px"></div>`
        : `<img src="${src}" width="120" height="120" style="image-rendering:pixelated">`
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:13px 'Segoe UI',sans-serif;background:#E8EEE5;color:#1E2A24;padding:18px;width:1144px}
      h2{font-size:14px;font-weight:600;margin:16px 0 8px}
      .row{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap}
      figure{margin:0;text-align:center;font-size:11px}
      .strip{display:flex;gap:18px;align-items:center;padding:10px 14px;border-radius:8px}
    </style></head><body>
      ${
        compare
          ? `<h2>Grande taille : original de ChatGPT (gauche) et reconstruction vectorielle (droite)</h2>
      <div class="row"><img src="${dataUrl(compare)}" width="300" height="300" style="border-radius:8px"><img src="${png(1024)}" width="300" height="300"></div>`
          : `<div class="row"><img src="${png(1024)}" width="300" height="300"></div>`
      }
      <h2>Barre des tâches, taille réelle (24 px), puis agrandie x5</h2>
      <div class="strip" style="background:#1B1F22">
        ${taskbar ? `<div style="width:24px;height:24px;overflow:hidden;position:relative"><img src="${dataUrl(taskbar)}" style="position:absolute;left:-15px;top:-9px"></div><div style="width:24px;height:24px;overflow:hidden;position:relative"><img src="${dataUrl(taskbar)}" style="position:absolute;left:-63px;top:-9px"></div>` : ''}
        <img src="${png(24)}" width="24" height="24">
        <span style="width:24px"></span>
        ${taskbar ? zoom(dataUrl(taskbar), 15) + zoom(dataUrl(taskbar), 63) : ''}
        ${zoom(png(24))}
        ${compare ? `<span style="color:#9aa">ancien rendu :</span><img src="${dataUrl(compare)}" width="24" height="24" style="image-rendering:auto">` : ''}
      </div>
      <h2>Toutes les petites tailles, sur fond sombre puis clair</h2>
      <div class="strip" style="background:#1B1F22">${row('#1B1F22', '#cfd6d2')}</div>
      <div class="strip" style="background:#F3F3F3;margin-top:8px">${row('#F3F3F3', '#333')}</div>
    </body></html>`
    const board = new BrowserWindow({ width: 1180, height: 900, show: false, webPreferences: { offscreen: true } })
    await board.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 400))
    const h = await board.webContents.executeJavaScript('document.body.scrollHeight')
    board.setContentSize(1180, Math.min(1400, h + 20))
    await new Promise((r) => setTimeout(r, 300))
    const shot = await board.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, 'planche.png'), shot.toPNG())
    console.log(`[logo] planche -> ${path.join(outDir, 'planche.png')}`)
    app.exit(0)
  })
  .catch((e) => {
    console.error('[logo] échec :', e)
    app.exit(1)
  })
