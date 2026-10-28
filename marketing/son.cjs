#!/usr/bin/env node
/**
 * Bande-son de la vidéo de présentation, entièrement synthétisée (aucun
 * fichier extérieur) : nappe, basse, arpèges, percussions douces, et
 * bruitages calés sur les événements de composition.html (logo, transitions,
 * clic, défilement des étapes, bulles, coches, accord final).
 *
 * Écrit marketing/soundtrack.wav, puis assemble marketing/gtrace-presentation.mp4
 * (vidéo muette + son normalisé à -14 LUFS, le niveau des plateformes vidéo).
 *
 *   node marketing/son.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const SR = 48000
const DUR = 49
const N = SR * DUR
const OUT_WAV = path.join(__dirname, 'soundtrack.wav')
const MUTE = path.join(__dirname, 'gtrace-presentation-muette.mp4')
const FINAL = path.join(__dirname, 'gtrace-presentation.mp4')

// Bus : mix sec, envoi réverbération, nappe (filtrée), basse (compressée par la grosse caisse), écho des arpèges.
const bus = () => [new Float32Array(N), new Float32Array(N)]
const MIX = bus()
const VERB = bus()
const PAD = bus()
const BASS = new Float32Array(N)
const ECHO = bus()

const TAU = Math.PI * 2
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)
let seed = 7
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
/** Panoramique à puissance constante, p de -1 (gauche) à 1 (droite). */
const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)]

function put(target, i, v, p = 0, send = 0) {
  if (i < 0 || i >= N) return
  const [gl, gr] = pan(p)
  target[0][i] += v * gl
  target[1][i] += v * gr
  if (send) {
    VERB[0][i] += v * gl * send
    VERB[1][i] += v * gr * send
  }
}

/** Filtre biquadratique (formules RBJ). */
class Biquad {
  constructor(type, f, q = 0.707) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
    this.type = type
    this.set(f, q)
  }
  set(f, q = this.q) {
    this.q = q
    const w = (TAU * Math.min(Math.max(f, 20), SR * 0.45)) / SR
    const cs = Math.cos(w)
    const a = Math.sin(w) / (2 * q)
    let b0
    let b1
    let b2
    if (this.type === 'lp') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2]
    else if (this.type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2]
    else [b0, b1, b2] = [a, 0, -a]
    const a0 = 1 + a
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = (-2 * cs) / a0
    this.a2 = (1 - a) / a0
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

// ─── Instruments ───────────────────────────────────────────────────────────

/** Nappe : deux voix légèrement désaccordées par note, timbre « dent de scie » limité en harmoniques. */
function pad(t0, t1, notes, gain, attack = 0.7, release = 1.3) {
  const i0 = Math.floor(t0 * SR)
  const i1 = Math.min(N, Math.floor((t1 + release) * SR))
  for (const m of notes) {
    for (const [det, p] of [
      [-0.07, -0.55],
      [0.07, 0.55]
    ]) {
      const f = midi(m + det)
      const H = Math.max(1, Math.min(10, Math.floor(5000 / f)))
      const [gl, gr] = pan(p)
      let ph = (noise() + 1) * Math.PI
      const dph = (TAU * f) / SR
      for (let i = i0; i < i1; i++) {
        const t = i / SR
        const env = Math.min(1, (t - t0) / attack) * (t > t1 ? Math.max(0, 1 - (t - t1) / release) : 1)
        ph += dph
        if (env <= 0) continue
        let s = 0
        for (let h = 1; h <= H; h++) s += Math.sin(ph * h) / h
        const v = s * env * env * gain
        PAD[0][i] += v * gl
        PAD[1][i] += v * gr
      }
    }
  }
}

function bassNote(t0, dur, m, gain) {
  const f = midi(m)
  const i0 = Math.floor(t0 * SR)
  const i1 = Math.min(N, Math.floor((t0 + dur + 0.06) * SR))
  for (let i = i0; i < i1; i++) {
    const t = i / SR - t0
    const env = Math.min(1, t / 0.005) * (0.7 + 0.3 * Math.exp(-t / 0.08)) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.06) : 1)
    const ph = TAU * f * t
    BASS[i] += (Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph)) * env * gain
  }
}

const kicks = []
function kick(t0, gain) {
  kicks.push(t0)
  const i0 = Math.floor(t0 * SR)
  let ph = 0
  for (let i = i0; i < Math.min(N, i0 + 0.45 * SR); i++) {
    const t = i / SR - t0
    const f = 44 + 115 * Math.exp(-t / 0.032)
    ph += (TAU * f) / SR
    const env = Math.min(1, t / 0.0015) * Math.exp(-t / 0.24)
    const click = noise() * Math.exp(-t / 0.0025) * 0.25
    put(MIX, i, (Math.sin(ph) * env + click) * gain)
  }
}

function hat(t0, gain, p = 0.25) {
  const hp = new Biquad('hp', 7500, 0.8)
  const i0 = Math.floor(t0 * SR)
  for (let i = i0; i < Math.min(N, i0 + 0.12 * SR); i++) {
    const t = i / SR - t0
    put(MIX, i, hp.run(noise()) * Math.exp(-t / 0.028) * gain, p)
  }
}

function clap(t0, gain) {
  const bp = new Biquad('bp', 1500, 1.1)
  const i0 = Math.floor(t0 * SR)
  for (let i = i0; i < Math.min(N, i0 + 0.5 * SR); i++) {
    const t = i / SR - t0
    let env = Math.exp(-Math.max(0, t - 0.022) / 0.13) * (t >= 0.022 ? 1 : 0)
    for (const d of [0, 0.011, 0.022]) if (t >= d) env += Math.exp(-(t - d) / 0.006) * 0.8
    put(MIX, i, bp.run(noise()) * env * gain, 0, 0.45)
  }
}

/** Pincé : timbre doux (fondamentale + octave), envoyé à l'écho et à la réverbération. */
function pluck(t0, m, gain, p) {
  const f = midi(m)
  const i0 = Math.floor(t0 * SR)
  const [gl, gr] = pan(p)
  for (let i = i0; i < Math.min(N, i0 + 0.7 * SR); i++) {
    const t = i / SR - t0
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.17)
    const ph = TAU * f * t
    const v = (Math.sin(ph) + 0.45 * Math.sin(2 * ph) * Math.exp(-t / 0.05)) * env * gain
    MIX[0][i] += v * gl
    MIX[1][i] += v * gr
    ECHO[0][i] += v * gl
    ECHO[1][i] += v * gr
    VERB[0][i] += v * gl * 0.3
    VERB[1][i] += v * gr * 0.3
  }
}

/** Cloche FM (modulateur inharmonique) : notes de logo, coches, accord final. */
function bell(t0, m, gain, decay = 1.4, p = 0, send = 0.55) {
  const f = midi(m)
  const i0 = Math.floor(t0 * SR)
  for (let i = i0; i < Math.min(N, i0 + decay * 4.5 * SR); i++) {
    const t = i / SR - t0
    const index = 2.2 * Math.exp(-t / 0.22) + 0.5
    const v =
      (Math.sin(TAU * f * t + index * Math.sin(TAU * f * 3.5 * t)) +
        0.25 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / (decay * 0.4))) *
      Math.min(1, t / 0.002) *
      Math.exp(-t / decay) *
      gain
    put(MIX, i, v, p, send)
  }
}

/** Souffle filtré qui balaie les fréquences : transitions. */
function whoosh(t0, dur, gain, p0 = -0.5, p1 = 0.5, f0 = 400, f1 = 4500) {
  const bp = new Biquad('bp', f0, 0.9)
  const i0 = Math.floor(t0 * SR)
  for (let i = i0; i < Math.min(N, i0 + dur * SR); i++) {
    const x = (i - i0) / (dur * SR)
    if ((i - i0) % 32 === 0) bp.set(f0 * Math.pow(f1 / f0, x))
    const env = Math.pow(Math.sin(Math.PI * x), 2)
    put(MIX, i, bp.run(noise()) * env * gain, L_(p0, p1, x), 0.25)
  }
}
const L_ = (a, b, x) => a + (b - a) * x

/** Montée : souffle et note qui glissent vers le haut, coupés net à la fin. */
function riser(t0, t1, gain) {
  const bp = new Biquad('bp', 300, 1.4)
  const i0 = Math.floor(t0 * SR)
  const i1 = Math.floor(t1 * SR)
  let ph = 0
  for (let i = i0; i < Math.min(N, i1); i++) {
    const x = (i - i0) / (i1 - i0)
    if ((i - i0) % 32 === 0) bp.set(300 * Math.pow(25, x))
    ph += (TAU * midi(50 + 24 * x)) / SR
    const env = Math.pow(x, 2.4) * Math.min(1, (i1 - i) / (0.01 * SR))
    put(MIX, i, (bp.run(noise()) * 0.9 + Math.sin(ph) * 0.25) * env * gain, 0, 0.3)
  }
}

/** Impact : coup grave et souffle sourd (apparition du logo, fin). */
function impact(t0, gain) {
  const lp = new Biquad('lp', 180, 0.8)
  const i0 = Math.floor(t0 * SR)
  let ph = 0
  for (let i = i0; i < Math.min(N, i0 + 2.6 * SR); i++) {
    const t = i / SR - t0
    ph += (TAU * (32 + 46 * Math.exp(-t / 0.16))) / SR
    const v = Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t / 0.85) + lp.run(noise()) * Math.exp(-t / 0.22) * 0.9
    put(MIX, i, v * gain, 0, 0.2)
  }
}

function tick(t0, gain, f = 3300, p = 0.15) {
  const i0 = Math.floor(t0 * SR)
  for (let i = i0; i < Math.min(N, i0 + 0.05 * SR); i++) {
    const t = i / SR - t0
    put(MIX, i, Math.sin(TAU * f * t) * Math.min(1, t / 0.0008) * Math.exp(-t / 0.007) * gain, p, 0.1)
  }
}

function pop(t0, gain) {
  const i0 = Math.floor(t0 * SR)
  let ph = 0
  for (let i = i0; i < Math.min(N, i0 + 0.3 * SR); i++) {
    const t = i / SR - t0
    ph += (TAU * (950 + 650 * Math.min(1, t / 0.045))) / SR
    put(MIX, i, Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.065) * gain, 0.1, 0.35)
  }
}

// ─── Partition (temps en secondes ; temps fort toutes les 0,5 s) ───────────
// L'accroche dure SHIFT secondes de plus que dans le premier montage : tout ce
// qui la suit est décalé d'autant (mêmes valeurs que composition.html).
const SHIFT = 1

/** Frappe au clavier : petit clic sec (bruit filtré) et léger choc grave. */
function keyClick(t0, gain) {
  const bp = new Biquad('bp', 2400 + noise() * 500, 1.6)
  const i0 = Math.floor(t0 * SR)
  const p = noise() * 0.3
  for (let i = i0; i < Math.min(N, i0 + 0.04 * SR); i++) {
    const t = i / SR - t0
    const v = bp.run(noise()) * Math.exp(-t / 0.006) + Math.sin(TAU * 150 * t) * Math.exp(-t / 0.012) * 0.35
    put(MIX, i, v * gain, p, 0.05)
  }
}
function typing(t0, t1, gain, every = 0.075) {
  for (let t = t0; t < t1; t += every * (0.75 + 0.5 * Math.abs(noise()))) keyClick(t, gain * (0.75 + 0.35 * Math.abs(noise())))
}

const CHORDS = {
  Dm9: { pad: [50, 57, 60, 64, 65], bass: 38, arp: [74, 77, 81, 84, 88, 84, 81, 77] },
  Bbmaj9: { pad: [46, 53, 57, 60, 62], bass: 34, arp: [70, 74, 77, 81, 84, 81, 77, 74] },
  Fadd9: { pad: [53, 60, 67, 69, 72], bass: 41, arp: [72, 77, 79, 81, 84, 81, 79, 77] },
  C69: { pad: [48, 55, 57, 62, 64], bass: 36, arp: [72, 74, 76, 79, 81, 79, 76, 74] },
  Fmaj9: { pad: [53, 57, 60, 64, 67], bass: 29, arp: [] }
}
const PROGRESSION = ['Dm9', 'Bbmaj9', 'Fadd9', 'C69']
const LOGO = 3.5 + SHIFT
const OUTRO = 41.5 + SHIFT

// Introduction : nappe sombre (le filtre s'ouvre à l'apparition du logo)
pad(0, LOGO, [38, 45, 50, 57, 64], 0.05, 1.2, 1.6)
// Suite d'accords, une mesure (2 s) chacune, jusqu'à la conclusion
const bars = []
for (let t = LOGO, k = 0; t < OUTRO; t += 2, k++) bars.push({ t, chord: CHORDS[PROGRESSION[k % 4]] })
for (const b of bars) pad(b.t, Math.min(b.t + 2, OUTRO), b.chord.pad, 0.045)
// Résolution finale, tenue jusqu'au noir
pad(OUTRO, DUR, CHORDS.Fmaj9.pad, 0.05, 0.25, 1.5)

// Rythmique : démonstrations, pause pendant le MCP, reprise pour les thèmes
const groove = (t) => (t >= 7.5 + SHIFT && t < 27.5 + SHIFT) || (t >= 31.5 + SHIFT && t < 37.5 + SHIFT)
for (const b of bars) {
  for (let beat = 0; beat < 4; beat++) {
    const t = b.t + beat * 0.5
    if (!groove(t)) continue
    const full = t >= 15.5 + SHIFT
    if (full || beat % 2 === 0) kick(t, 0.5)
    if (full && (beat === 1 || beat === 3)) clap(t, 0.14)
    hat(t + 0.25, 0.07 + (beat % 2) * 0.01)
    if (full) {
      bassNote(t, 0.22, b.chord.bass, 0.19)
      bassNote(t + 0.25, 0.2, b.chord.bass + (beat === 3 ? 12 : 0), 0.14)
    } else bassNote(t, 0.42, b.chord.bass, 0.19)
  }
  // Arpèges : croches puis doubles croches ; plus discrets pendant le MCP
  const step = b.t >= 15.5 + SHIFT ? 0.125 : 0.25
  for (let k = 0; k * step < 2; k++) {
    const t = b.t + k * step
    if (t < 7.5 + SHIFT || t >= 37.5 + SHIFT) continue
    const soft = t >= 27.5 + SHIFT && t < 31.5 + SHIFT ? 0.6 : 1
    pluck(t, b.chord.arp[k % b.chord.arp.length], (k % 4 === 0 ? 0.07 : 0.045) * soft, k % 2 ? 0.35 : -0.35)
  }
}

// ─── Bruitages calés sur l'image ───────────────────────────────────────────
// Accroche : un souffle par ligne, montée, impact du logo
whoosh(0.25, 0.7, 0.05, -0.4, 0.2, 700, 3200)
whoosh(1.35, 0.7, 0.05, 0.2, -0.2, 700, 3200)
whoosh(2.5, 0.75, 0.06, -0.2, 0.3, 600, 3600)
riser(2.0 + SHIFT, 3.55 + SHIFT, 0.16)
impact(3.55 + SHIFT, 0.55)
;[74, 77, 81, 88].forEach((m, i) => bell(3.55 + SHIFT + i * 0.05, m, 0.06, 1.6, (i - 1.5) * 0.3))
whoosh(4.55 + SHIFT, 0.5, 0.035, -0.3, 0.3, 900, 4000)
// 1 · Requête : arrivée de la fenêtre, frappe, clic sur Exécuter, résultats
whoosh(6.2 + SHIFT, 0.8, 0.1, -0.6, 0.5, 350, 5000)
typing(7.0 + SHIFT, 9.6 + SHIFT, 0.09)
tick(10.1 + SHIFT, 0.15, 2400, 0.2)
tick(10.11 + SHIFT, 0.08, 1200, 0.2)
pop(10.25 + SHIFT, 0.06)
// 2 · Procédure : transition, clics et saisie des paramètres, exécution, Déroulé
whoosh(12.55 + SHIFT, 0.7, 0.07, 0.5, -0.5, 400, 4500)
tick(14.0 + SHIFT, 0.13, 2400, 0.25)
typing(14.1 + SHIFT, 14.95 + SHIFT, 0.08, 0.085)
tick(15.1 + SHIFT, 0.13, 2400, 0.25)
typing(15.2 + SHIFT, 15.6 + SHIFT, 0.08, 0.1)
tick(16.5 + SHIFT, 0.15, 2400, 0.2)
tick(16.51 + SHIFT, 0.08, 1200, 0.2)
whoosh(16.55 + SHIFT, 0.6, 0.06, -0.3, 0.3, 500, 5000)
pop(17.05 + SHIFT, 0.06)
// 3 · Remonter le temps : on saisit la tête de lecture, une étape par cran, repères
whoosh(19.25 + SHIFT, 0.6, 0.06, -0.5, 0.4, 400, 4500)
tick(19.45 + SHIFT, 0.12, 2200, 0)
for (let k = 1; k <= 16; k++) tick(19.4 + SHIFT + (k * 3.6) / 17, 0.035, 3400, 0.2)
pop(21.95 + SHIFT, 0.07)
whoosh(22.95 + SHIFT, 0.5, 0.045, 0.4, -0.3, 500, 4000)
pop(23.55 + SHIFT, 0.07)
whoosh(25.35 + SHIFT, 0.5, 0.045, -0.3, 0.4, 500, 4000)
pop(25.95 + SHIFT, 0.07)
// 4 · MCP : la fenêtre s'efface, impulsions de données entre GTrace et l'assistant
whoosh(27.4 + SHIFT, 0.8, 0.08, 0.5, -0.5, 350, 4500)
for (let t = 28.95 + SHIFT; t < 31.0 + SHIFT; t += 0.36) tick(t, 0.03, 1800 + ((t * 7) % 1) * 600, Math.sin(t * 3) * 0.6)
;[79, 81, 84, 86].forEach((m, i) => bell(29.1 + SHIFT + i * 0.18, m, 0.035, 0.5, (i - 1.5) * 0.3, 0.4))
// 5 · Thèmes : retour de la fenêtre, clics, bascule en sombre
whoosh(31.25 + SHIFT, 0.7, 0.08, -0.5, 0.5, 350, 4500)
tick(32.7 + SHIFT, 0.13, 2400, 0.4)
whoosh(32.75 + SHIFT, 0.4, 0.04, 0.2, -0.2, 800, 4000)
tick(34.0 + SHIFT, 0.13, 2400, 0)
whoosh(34.05 + SHIFT, 0.7, 0.07, 0.4, -0.4, 2500, 300)
tick(35.3 + SHIFT, 0.12, 2400, 0.2)
whoosh(35.35 + SHIFT, 0.4, 0.035, 0, 0.3, 800, 3000)
// Conclusion : récapitulatif (notes montantes), montée, impact, accord final
whoosh(37.35 + SHIFT, 0.9, 0.08, 0.6, -0.4, 350, 4000)
;[77, 81, 84, 86, 89].forEach((m, i) => bell(37.8 + SHIFT + i * 0.5, m, 0.05, 0.8, (i - 2) * 0.2, 0.45))
riser(40.4 + SHIFT, OUTRO - 0.05, 0.1)
impact(OUTRO - 0.05, 0.5)
;[65, 69, 72, 76, 79].forEach((m, i) => bell(OUTRO + i * 0.07, m + 12, 0.05, 2.4, (i - 2) * 0.25, 0.6))

// ─── Mixage ────────────────────────────────────────────────────────────────

// Compression de la basse et de la nappe par la grosse caisse (effet « respiration »)
kicks.sort((a, b) => a - b)
const duck = new Float32Array(N).fill(1)
for (let i = 0, k = -1; i < N; i++) {
  const t = i / SR
  while (k + 1 < kicks.length && kicks[k + 1] <= t) k++
  if (k >= 0) duck[i] = 1 - Math.exp(-(t - kicks[k]) / 0.12)
}
// Filtre de la nappe : sombre dans l'introduction, ouvert ensuite, refermé à la fin
const padLp = [new Biquad('lp', 500, 0.7), new Biquad('lp', 500, 0.7)]
const cutoff = (t) =>
  t < LOGO ? 380 + 420 * (t / LOGO) : t < OUTRO ? Math.min(2600, 800 + 1800 * Math.min(1, (t - LOGO) / 0.6)) : 2600 - 1500 * Math.min(1, (t - OUTRO) / 6.5)
for (let i = 0; i < N; i++) {
  if (i % 64 === 0) for (const f of padLp) f.set(cutoff(i / SR))
  const d = 1 - 0.3 * (1 - duck[i])
  for (const c of [0, 1]) {
    const v = padLp[c].run(PAD[c][i]) * d
    MIX[c][i] += v
    VERB[c][i] += v * 0.35
  }
  const bv = BASS[i] * (1 - 0.6 * (1 - duck[i]))
  MIX[0][i] += bv
  MIX[1][i] += bv
}
// Écho ping-pong des arpèges (3 doubles croches)
const D = Math.round(0.375 * SR)
const echoLp = [new Biquad('lp', 3500), new Biquad('lp', 3500)]
const eL = new Float32Array(N)
const eR = new Float32Array(N)
for (let i = D; i < N; i++) {
  eL[i] = echoLp[0].run(ECHO[0][i - D] * 0.5 + eR[i - D] * 0.45)
  eR[i] = echoLp[1].run(ECHO[1][i - D] * 0.5 + eL[i - D] * 0.45)
  MIX[0][i] += eL[i] * 0.3
  MIX[1][i] += eR[i] * 0.3
}
// Réverbération (Freeverb)
function freeverb(input, room = 0.86, damp = 0.3, spread = 0) {
  const scale = SR / 44100
  const make = (len) => ({ buf: new Float32Array(Math.round(len * scale)), i: 0, store: 0 })
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => make(d + spread))
  const aps = [556, 441, 341, 225].map((d) => make(d + spread))
  const out = new Float32Array(N)
  for (let n = 0; n < N; n++) {
    const x = input[n] * 0.015
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.store = y * (1 - damp) + c.store * damp
      c.buf[c.i] = x + c.store * room
      if (++c.i === c.buf.length) c.i = 0
      acc += y
    }
    for (const a of aps) {
      const b = a.buf[a.i]
      a.buf[a.i] = acc + b * 0.5
      if (++a.i === a.buf.length) a.i = 0
      acc = b - acc
    }
    out[n] = acc
  }
  return out
}
const wetL = freeverb(VERB[0], 0.86, 0.3, 0)
const wetR = freeverb(VERB[1], 0.86, 0.3, 23)

// Somme, fondus de début et de fin, écrêtage doux
const outL = new Float32Array(N)
const outR = new Float32Array(N)
let peak = 0
for (let i = 0; i < N; i++) {
  const t = i / SR
  // Fondu final calé sur le fondu au noir de l'image (47,5 → 49 s)
  const fade = Math.min(1, t / 0.05) * (t > 47.2 ? Math.max(0, 1 - (t - 47.2) / 1.8) : 1)
  outL[i] = Math.tanh((MIX[0][i] + wetL[i] * 2.2) * 1.1) * fade
  outR[i] = Math.tanh((MIX[1][i] + wetR[i] * 2.2) * 1.1) * fade
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
}

// WAV 32 bits flottants, stéréo
const data = Buffer.alloc(N * 8)
for (let i = 0; i < N; i++) {
  data.writeFloatLE(outL[i], i * 8)
  data.writeFloatLE(outR[i], i * 8 + 4)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(3, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 8, 28)
header.writeUInt16LE(8, 32)
header.writeUInt16LE(32, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)
fs.writeFileSync(OUT_WAV, Buffer.concat([header, data]))
console.log(`[son] ${path.basename(OUT_WAV)} écrit (crête avant normalisation : ${peak.toFixed(3)})`)

// ─── Assemblage : normalisation en deux passes puis multiplexage ──────────
if (!fs.existsSync(MUTE)) {
  console.log(`[son] vidéo muette absente (${path.basename(MUTE)}) : rendez-la d'abord avec render.cjs`)
  process.exit(0)
}
const probe = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-i', OUT_WAV, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
  { encoding: 'utf8' }
)
// loudnorm écrit sa mesure (JSON) sur la sortie d'erreur.
const json = JSON.parse(probe.stderr.slice(probe.stderr.lastIndexOf('{'), probe.stderr.lastIndexOf('}') + 1))
const filter =
  `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${json.input_i}:measured_TP=${json.input_tp}` +
  `:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true`
execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', '-i', MUTE, '-i', OUT_WAV, '-filter_complex', `[1:a]${filter},aresample=48000[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', FINAL],
  { stdio: 'inherit' }
)
console.log(`[son] mesure avant : ${json.input_i} LUFS, crête ${json.input_tp} dBTP → vidéo : ${path.basename(FINAL)}`)
