#!/usr/bin/env node
/**
 * Publie une release DÉJÀ CONSTRUITE (le contenu de dist/) sur un dépôt GitHub,
 * sans rien reconstruire : l'installeur, son blockmap et latest.yml partent
 * tels quels, dans UNE release publiée d'emblée.
 *
 * C'est l'outil de publication de GTrace (repris de GVue). Il remplace le
 * téléversement par electron-builder, qui créait des BROUILLONS et laissait une
 * étape manuelle facile à oublier (une version restée en brouillon est invisible
 * pour les applications installées).
 *
 * Téléverser les octets exacts de dist/ n'est pas un détail : latest.yml
 * contient le sha512 de l'installeur. Reconstruire pour republier donnerait un
 * binaire différent, donc une signature qui ne correspond plus.
 *
 * Migration en cours (depuis le 28/10/2026) : les versions partent sur
 * « gtrace-releases » (dépôt public dédié aux installeurs) ET sur l'ancien dépôt
 * « gtrace », que les installations existantes surveillent encore. Une fois
 * qu'elles ont toutes reçu une version construite pour « gtrace-releases »,
 * retirer le second envoi de publish.bat.
 *
 * Usage :
 *   set GH_TOKEN=ghp_...
 *   node scripts/relay-release.cjs gjelal-bjrm/gtrace-releases [--dry-run] [--draft]
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const root = path.join(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const target = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
const draft = process.argv.includes('--draft')

if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
  console.error('Usage : node scripts/relay-release.cjs <proprietaire>/<depot> [--dry-run] [--draft]')
  process.exit(1)
}
const [owner, repo] = target.split('/')
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token && !dryRun) {
  console.error('GH_TOKEN absent. Definissez-le : set GH_TOKEN=ghp_...')
  process.exit(1)
}

// --- Les fichiers à relayer, tels quels ---
const dist = path.join(root, 'dist')
const files = [`GTrace-Setup-${version}.exe`, `GTrace-Setup-${version}.exe.blockmap`, 'latest.yml']
for (const f of files) {
  if (!fs.existsSync(path.join(dist, f))) {
    console.error(`Fichier manquant : dist/${f}\nConstruisez d'abord (publish.bat) — ce script ne compile rien.`)
    process.exit(1)
  }
}

// Garde-fou : le latest.yml doit décrire CETTE version, sinon les clients
// téléchargeraient un installeur qui ne correspond pas à ce qu'il annonce.
const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8')
const declared = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim()
if (declared !== version) {
  console.error(`Incoherence : package.json annonce ${version}, dist/latest.yml annonce ${declared}.`)
  console.error("Reconstruisez avant de relayer (le sha512 du latest.yml doit correspondre a l'exe).")
  process.exit(1)
}

/** Corps de la release : les notes de version déjà générées. */
function notes() {
  try {
    const all = require(path.join(root, 'src', 'renderer', 'src', 'data', 'whatsNew.json'))
    const entry = all.find((e) => e.version === version)
    if (entry?.notes?.length) return entry.notes.map((n) => `- ${n}`).join('\n')
  } catch {
    /* pas de notes : ce n'est pas bloquant */
  }
  return `GTrace v${version}`
}

function api(method, host, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        host,
        path: urlPath,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'gtrace-relay-release',
          Accept: 'application/vnd.github+json',
          ...headers
        }
      },
      (res) => {
        let data = ''
        res.on('data', (d) => (data += d))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch {
            /* corps vide ou non-JSON */
          }
          resolve({ status: res.statusCode, body: parsed, raw: data })
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** Téléverse un fichier en flux (89 Mo : jamais en mémoire). */
function upload(uploadUrl, file) {
  const full = path.join(dist, file)
  const size = fs.statSync(full).size
  const base = uploadUrl.replace(/\{\?[^}]*\}$/, '')
  const u = new URL(`${base}?name=${encodeURIComponent(file)}`)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: u.host,
        path: u.pathname + u.search,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'gtrace-relay-release',
          'Content-Type': 'application/octet-stream',
          'Content-Length': size
        }
      },
      (res) => {
        let data = ''
        res.on('data', (d) => (data += d))
        res.on('end', () => resolve({ status: res.statusCode, raw: data }))
      }
    )
    req.on('error', reject)
    fs.createReadStream(full).pipe(req)
  })
}

async function main() {
  const tag = `v${version}`
  console.log(`Relais de GTrace ${tag} vers ${owner}/${repo}${draft ? ' (brouillon)' : ''}`)
  for (const f of files) {
    console.log(`  - ${f} (${(fs.statSync(path.join(dist, f)).size / 1048576).toFixed(1)} Mo)`)
  }
  if (dryRun) {
    console.log('\n--dry-run : rien n’a été envoyé.')
    return
  }

  // Release existante (relance du script) ou création.
  let rel = await api('GET', 'api.github.com', `/repos/${owner}/${repo}/releases/tags/${tag}`)
  if (rel.status === 404) {
    rel = await api('POST', 'api.github.com', `/repos/${owner}/${repo}/releases`, {
      body: JSON.stringify({ tag_name: tag, name: tag, body: notes(), draft, prerelease: false }),
      headers: { 'Content-Type': 'application/json' }
    })
    if (rel.status >= 300) {
      console.error(`Echec de creation de la release (${rel.status}) : ${rel.raw.slice(0, 300)}`)
      process.exit(1)
    }
    console.log(`Release ${tag} creee.`)
  } else if (rel.status >= 300) {
    console.error(`Lecture de la release impossible (${rel.status}) : ${rel.raw.slice(0, 300)}`)
    process.exit(1)
  } else {
    console.log(`Release ${tag} deja presente : mise a jour des fichiers.`)
  }

  for (const f of files) {
    // Un asset de même nom bloque le téléversement : on remplace.
    const old = (rel.body.assets ?? []).find((a) => a.name === f)
    if (old) {
      await api('DELETE', 'api.github.com', `/repos/${owner}/${repo}/releases/assets/${old.id}`)
      console.log(`  ancien ${f} retire`)
    }
    process.stdout.write(`  envoi de ${f}… `)
    const up = await upload(rel.body.upload_url, f)
    if (up.status >= 300) {
      console.error(`\nEchec (${up.status}) : ${up.raw.slice(0, 300)}`)
      process.exit(1)
    }
    console.log('ok')
  }

  console.log(`\nTermine : https://github.com/${owner}/${repo}/releases/tag/${tag}`)
  if (draft) console.log('La release est en BROUILLON : publiez-la sur GitHub pour que les apps la voient.')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
