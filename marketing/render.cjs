#!/usr/bin/env node
/**
 * Rend marketing/composition.html en vidéo MP4 (1920×1080, 30 images/s) :
 * chaque image est dessinée hors écran à l'instant t, puis envoyée à ffmpeg.
 *
 *   npx electron marketing/render.cjs                      → marketing/gtrace-presentation-muette.mp4 (puis node marketing/son.cjs)
 *   npx electron marketing/render.cjs --stills 2,5,9.5     → images de contrôle (marketing/stills)
 */
const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const FPS = 30
const DURATION = 49
const W = 1920
const H = 1080

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: W,
      height: H,
      show: false,
      useContentSize: true,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const wc = win.webContents
    wc.setFrameRate(60)
    await win.loadFile(path.join(__dirname, 'composition.html'))
    await wc.executeJavaScript('window.ready')

    // Image à l'instant t. Le rendu hors écran peut livrer une image en
    // retard : la page peint dans le coin bas-droit un pixel témoin qui porte
    // le numéro de l'image ; on attend celle qui porte le bon numéro, puis on
    // efface le témoin (il reprend la couleur de son voisin).
    let latest = null
    wc.on('paint', (_event, _dirty, image) => {
      latest = image
    })
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const frame = async (t) => {
      const f = Math.round(t * FPS)
      // Les images filmées sont chargées à la demande : on les prépare avant de dessiner.
      await wc.executeJavaScript(`(window.prepare ? prepare(${t}) : Promise.resolve()).then(() => { render(${t}); return true })`)
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        wc.invalidate()
        await sleep(15)
        if (!latest) continue
        const { width, height } = latest.getSize()
        const bitmap = latest.toBitmap()
        const at = ((height - 1) * width + (width - 1)) * 4
        // BGRA : bleu, vert, rouge, alpha
        if (bitmap[at + 2] === (f & 255) && bitmap[at + 1] === ((f >> 8) & 255) && bitmap[at] === 77) {
          bitmap.copy(bitmap, at, at - 4, at)
          return { width, height, bitmap }
        }
      }
      throw new Error(`image ${f} introuvable (témoin)`)
    }

    const stills = arg('--stills')
    if (stills) {
      const dir = arg('--out') ?? path.join(__dirname, 'stills')
      fs.mkdirSync(dir, { recursive: true })
      const { nativeImage } = require('electron')
      for (const t of stills.split(',').map(Number)) {
        const { width, height, bitmap } = await frame(t)
        const png = nativeImage.createFromBitmap(bitmap, { width, height }).toPNG()
        fs.writeFileSync(path.join(dir, `t${String(t).replace('.', '_')}.png`), png)
        console.log('image', t)
      }
      app.exit(0)
      return
    }

    const out = arg('--out') ?? path.join(__dirname, 'gtrace-presentation-muette.mp4')
    const ffmpeg = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    )
    const total = Math.round(DURATION * FPS)
    for (let f = 0; f < total; f++) {
      const { width, height, bitmap } = await frame(f / FPS)
      if (width !== W || height !== H) throw new Error(`taille inattendue : ${width}×${height}`)
      if (!ffmpeg.stdin.write(bitmap)) await new Promise((r) => ffmpeg.stdin.once('drain', r))
      if (f % 90 === 0) console.log(`image ${f} / ${total}`)
    }
    ffmpeg.stdin.end()
    await new Promise((r) => ffmpeg.on('close', r))
    console.log('vidéo :', out)
    app.exit(0)
  })
  .catch((e) => {
    console.error('[vidéo] échec :', e)
    app.exit(1)
  })
