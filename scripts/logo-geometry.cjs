/**
 * Géométrie du logo GTrace : un « G » fait de points crème qui se dispersent
 * vers la gauche (le temps qu'on remonte) et se rangent en une grille de
 * cases à droite (les données, les étapes), sur un fond anthracite mat.
 *
 * Tout est calculé (graine fixe : le résultat est identique à chaque
 * génération). Quatre niveaux de détail, car une icône de 16 px ne peut pas
 * porter des centaines de points :
 *   full   ≥ 64 px  : tous les points, dispersion, grain du fond, relief
 *   medium   48 px  : trois anneaux de points plus gros
 *   small  24–40 px : un seul anneau de points, barre de deux cases
 *   tiny     16 px  : G plein, barre pleine
 * Coordonnées dans un carré de 1024.
 */

const CREAM = '#EED5A8'
const CREAM_SMALL = '#F5DFB5' // un cran plus clair : plus de contraste en petit

/** Générateur pseudo-aléatoire à graine fixe (mulberry32). */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const deg = (d) => (d * Math.PI) / 180
const f1 = (n) => Math.round(n * 10) / 10

// G elliptique (plus haut que large), ouvert en haut à droite.
const G = {
  cx: 540,
  cy: 502,
  outer: { rx: 362, ry: 380 },
  inner: { rx: 148, ry: 186 },
  from: 38, // départ en bas à droite (degrés, sens horaire depuis l'axe x)
  to: 326 // extrémité en haut à droite
}

/** Densité du G selon l'angle : 1 côté droit (net), 0 côté gauche (dispersé). */
function solidity(theta) {
  return (1 + Math.cos(deg(theta - 25))) / 2
}

/** Barre et jambage du G : cases arrondies alignées sur une grille. */
function barCells(cell, gap, rows, stemRows, stemCols) {
  const pitch = cell + gap
  const x0 = 584
  const y0 = 503
  const cols = Math.floor((838 - x0 + gap) / pitch)
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * pitch, y: y0 + r * pitch, w: cell })
  }
  for (let r = 0; r < stemRows; r++) {
    for (let c = cols - stemCols; c < cols; c++) {
      cells.push({ x: x0 + c * pitch, y: y0 + (rows + r) * pitch, w: cell, round: r === stemRows - 1 })
    }
  }
  return cells
}

/** La barre occupe-t-elle ce point (avec une marge) ? Évite les chevauchements. */
function insideBar(cells, x, y, margin) {
  return cells.some(
    (c) => x > c.x - margin && x < c.x + c.w + margin && y > c.y - margin && y < c.y + c.w + margin
  )
}

/**
 * Points posés le long d'anneaux elliptiques entre le bord intérieur et le
 * bord extérieur du G. Les anneaux « extra » prolongent la trame au-delà du
 * bord, côté gauche seulement : la dispersion s'y fait en rangées qui
 * s'estompent, comme une trame d'imprimerie, plutôt qu'en poussière au hasard.
 */
function ringDots({ rings, extra = 0, pitch, rMin, rMax, jitter, cells, rand }) {
  const dots = []
  const unit = rings === 1 ? 0 : 1 / (rings - 1)
  for (let k = 0; k < rings + extra; k++) {
    const t = rings === 1 ? 0.5 : k * unit
    const beyond = Math.max(0, t - 1)
    const rx = G.inner.rx + t * (G.outer.rx - G.inner.rx)
    const ry = G.inner.ry + t * (G.outer.ry - G.inner.ry)
    // Pas angulaire constant en longueur d'arc (approximation par le rayon moyen).
    const step = pitch / ((rx + ry) / 2)
    const span = deg(G.to - G.from)
    const n = Math.max(2, Math.floor(span / step))
    for (let i = 0; i <= n; i++) {
      const th = G.from + ((G.to - G.from) * i) / n + (k % 2 ? (step * 90) / Math.PI / 2 : 0)
      if (th > G.to) continue
      const s = solidity(th)
      const loose = 1 - s
      if (beyond > 0) {
        // Au-delà du bord : côté gauche seulement, de plus en plus étroit et clairsemé.
        if (loose < 0.42 + beyond * 0.62) continue
        if (rand() < 0.15 + beyond * 0.75) continue
      }
      let x = G.cx + rx * Math.cos(deg(th))
      let y = G.cy + ry * Math.sin(deg(th))
      if (jitter) {
        const amp = jitter * loose * (1 + beyond * 5)
        x += (rand() - 0.5) * amp
        y += (rand() - 0.5) * amp
      }
      if (cells && insideBar(cells, x, y, pitch * 0.45)) continue
      // Côté gauche, les anneaux extérieurs ont des points un peu plus petits.
      const shrink = jitter ? 1 - loose * Math.min(t, 1) * 0.3 : 1
      const fade = beyond > 0 ? 1 - beyond / 0.95 : 1
      const r = (rMin + (rMax - rMin) * Math.pow(s, 0.8)) * shrink * fade
      if (r < 2.4) continue
      // Dans la dispersion, à hauteur du centre, certains points s'étirent : le mouvement.
      const stretch = beyond > 0 && th > 150 && th < 212 && rand() < 0.45 ? 1.3 + rand() * 0.9 : 1
      dots.push({ x, y, rx: r * stretch, ry: stretch > 1 ? r * 0.72 : r })
    }
  }
  return dots
}

/** Quelques particules isolées plus loin encore : la poussière du mouvement. */
function scatter(count, rand) {
  const out = []
  for (let i = 0; i < count; i++) {
    const th = 118 + rand() * 140
    const loose = 1 - solidity(th)
    if (rand() > loose) continue
    const d = 150 + Math.pow(rand(), 1.3) * 120
    const x = G.cx + (G.outer.rx + d) * Math.cos(deg(th))
    const y = G.cy + (G.outer.ry + d) * Math.sin(deg(th))
    const r = 2.6 + rand() * 2.4
    const horiz = th > 155 && th < 208 && rand() < 0.6
    out.push({ x, y, rx: horiz ? r * (1.5 + rand()) : r, ry: horiz ? r * 0.7 : r })
  }
  return out
}

/**
 * Le point reste-t-il à distance du bord du carré arrondi (coins compris) une
 * fois le G mis à l'échelle ? Sinon il frôlerait le bord et ferait désordre.
 */
function insideTile(d, scale, margin) {
  const x = 512 + (d.x - 512) * scale
  const y = 512 + (d.y - 512) * scale
  const r = Math.max(d.rx, d.ry) * scale
  const lo = margin + r
  const hi = 1024 - margin - r
  if (x < lo || y < lo || x > hi || y > hi) return false
  const R = 205
  const cx = x < R ? R : x > 1024 - R ? 1024 - R : null
  const cy = y < R ? R : y > 1024 - R ? 1024 - R : null
  if (cx === null || cy === null) return true
  return Math.hypot(x - cx, y - cy) + r < R - margin
}

function shape(d, fill) {
  return Math.abs(d.rx - d.ry) < 0.01
    ? `<circle cx="${f1(d.x)}" cy="${f1(d.y)}" r="${f1(d.rx)}" fill="${fill}"/>`
    : `<ellipse cx="${f1(d.x)}" cy="${f1(d.y)}" rx="${f1(d.rx)}" ry="${f1(d.ry)}" fill="${fill}"/>`
}

function cellsSvg(cells, radius, fill) {
  return cells
    .map(
      (c) =>
        `<rect x="${f1(c.x)}" y="${f1(c.y)}" width="${f1(c.w)}" height="${f1(c.w)}" rx="${f1(
          c.round ? c.w * 0.42 : radius
        )}" fill="${fill}"/>`
    )
    .join('')
}

/** Fond anthracite mat : dégradé, lumière douce en haut à droite, grain, liseré. */
function background(level) {
  const grain =
    level === 'full'
      ? `<rect width="1024" height="1024" rx="205" filter="url(#grain)" opacity="0.55"/>`
      : ''
  const edge = level === 'full' ? 0.07 : 0.2
  const stroke = level === 'full' ? 3 : 30
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2A2A2A"/>
      <stop offset="0.55" stop-color="#1B1B1B"/>
      <stop offset="1" stop-color="#111111"/>
    </linearGradient>
    <radialGradient id="light" cx="0.78" cy="0.08" r="0.75">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/>
    </filter>
    <clipPath id="tile"><rect width="1024" height="1024" rx="205"/></clipPath>
    <filter id="relief" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="205" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="205" fill="url(#light)"/>
  ${grain}
  <rect x="${stroke / 2}" y="${stroke / 2}" width="${1024 - stroke}" height="${1024 - stroke}" rx="${
    205 - stroke / 2
  }" fill="none" stroke="#FFFFFF" stroke-opacity="${edge}" stroke-width="${stroke}"/>`
}

/** SVG du logo pour un niveau de détail donné (viewBox 1024). */
function logoSvg(level) {
  const rand = rng(20261028)
  // En grand, le G est un peu réduit pour que la dispersion tienne dans le
  // carré arrondi ; en petit, il occupe toute la place (lisibilité d'abord).
  const scale = level === 'full' ? 0.88 : level === 'medium' ? 0.94 : 1
  const keep = (d) => insideTile(d, scale, 46)
  let body = ''
  if (level === 'full' || level === 'medium') {
    // 48 px : même dessin, sans dispersion ni grain ni relief, points un peu
    // plus gros — à cette taille il se lit comme un G plein à texture de points.
    const full = level === 'full'
    const cells = barCells(27, 5, 3, 3, 4)
    const dots = ringDots({
      rings: 7,
      extra: full ? 4 : 0,
      pitch: 32,
      rMin: full ? 6.5 : 9,
      rMax: full ? 15.2 : 15.8,
      jitter: full ? 6 : 0,
      cells,
      rand
    })
    const fill = full ? CREAM : CREAM_SMALL
    const marks =
      cellsSvg(cells, 7, fill) +
      dots
        .filter(keep)
        .map((d) => shape(d, fill))
        .join('')
    body = full
      ? `<g filter="url(#relief)">${marks}${scatter(60, rand)
          .filter(keep)
          .map((d) => shape(d, fill))
          .join('')}</g>`
      : marks
  } else {
    // 16 à 40 px : G plein côté droit qui se défait en quelques gros points
    // côté gauche (la dispersion reste lisible), barre et jambage pleins.
    const r = { rx: (G.inner.rx + G.outer.rx) / 2, ry: (G.inner.ry + G.outer.ry) / 2 }
    const p = (th) => `${f1(G.cx + r.rx * Math.cos(deg(th)))} ${f1(G.cy + r.ry * Math.sin(deg(th)))}`
    const w = level === 'tiny' ? 158 : 150
    const arc = (a, b) =>
      `<path d="M ${p(a)} A ${r.rx} ${r.ry} 0 ${b - a > 180 ? 1 : 0} 1 ${p(b)}" fill="none" stroke="${CREAM_SMALL}" stroke-width="${w}" stroke-linecap="round"/>`
    const leftDots =
      level === 'tiny'
        ? ''
        : [
            [134, 70],
            [157, 62],
            [180, 56],
            [203, 62],
            [226, 70]
          ]
            .map(([th, rad]) => {
              const x = G.cx + r.rx * Math.cos(deg(th))
              const y = G.cy + r.ry * Math.sin(deg(th))
              return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${rad}" fill="${CREAM_SMALL}"/>`
            })
            .join('')
    body =
      (level === 'tiny' ? arc(G.from + 6, G.to) : arc(G.from + 6, 118) + arc(242, G.to)) +
      leftDots +
      `<rect x="584" y="440" width="276" height="148" rx="34" fill="${CREAM_SMALL}"/>
      <rect x="712" y="548" width="148" height="196" rx="34" fill="${CREAM_SMALL}"/>`
  }
  const fit = scale === 1 ? '' : ` transform="translate(512 512) scale(${scale}) translate(-512 -512)"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${background(
    level
  )}<g clip-path="url(#tile)"><g${fit}>${body}</g></g></svg>`
}

/** Niveau de détail adapté à une taille en pixels. */
function levelFor(size) {
  if (size >= 64) return 'full'
  if (size >= 48) return 'medium'
  if (size >= 20) return 'small'
  return 'tiny'
}

module.exports = { logoSvg, levelFor }
