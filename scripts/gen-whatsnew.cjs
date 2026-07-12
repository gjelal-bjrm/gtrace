#!/usr/bin/env node
/**
 * Génère les notes de version (« Nouveautés ») à partir des messages de commit
 * depuis la dernière release, et les écrit dans
 * src/renderer/src/data/whatsNew.json pour la version courante (package.json).
 *
 * Lancé automatiquement par publish.bat (après le bump de version, avant le build).
 * Marqueur : scripts/.last-release stocke le SHA du dernier commit publié, pour
 * délimiter la plage à chaque fois (pas besoin de tags git).
 */
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const root = path.join(__dirname, '..')
const jsonPath = path.join(root, 'src', 'renderer', 'src', 'data', 'whatsNew.json')
const markerPath = path.join(__dirname, '.last-release')
const version = require(path.join(root, 'package.json')).version

function git(args) {
  try {
    return cp.execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return ''
  }
}

// Plage de commits : depuis le dernier release marqué, sinon les 25 derniers.
let range = '-25'
try {
  const last = fs.readFileSync(markerPath, 'utf8').trim()
  if (last) range = `${last}..HEAD`
} catch {
  /* pas de marqueur */
}

const raw = git(`log ${range} --no-merges --pretty=format:%s`)
const SKIP = /^(merge|chore|wip|bump|release|GTrace v\d|version\b|docs: README|maj\b|app commit)/i
const seen = new Set()
const notes = []
for (let s of raw.split('\n').map((x) => x.trim()).filter(Boolean)) {
  if (SKIP.test(s)) continue
  s = s.replace(/^(GTrace|docs|feat|fix|build|refactor|chore|style|test)\s*:\s*/i, '').trim()
  if (!s) continue
  s = s.charAt(0).toUpperCase() + s.slice(1)
  const key = s.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  notes.push(s)
}

let data = []
try {
  data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
} catch {
  /* fichier absent/va être créé */
}

if (notes.length > 0) {
  const entry = { version, notes }
  const idx = data.findIndex((e) => e.version === version)
  if (idx >= 0) data[idx] = entry
  else data.unshift(entry)
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n')
  console.log(`[whatsNew] v${version} : ${notes.length} note(s) générée(s).`)
} else {
  console.log('[whatsNew] aucune nouveauté détectée (pas de modification du changelog).')
}

// Met à jour le marqueur sur le HEAD courant.
const head = git('rev-parse HEAD').trim()
if (head) fs.writeFileSync(markerPath, head + '\n')
