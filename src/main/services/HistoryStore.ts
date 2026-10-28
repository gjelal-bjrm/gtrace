import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HistoryEntry, HistoryEntrySummary, HistorySaveInput } from '@shared/types'

const MAX_ENTRIES = 50
/**
 * Lignes conservées par jeu de résultats : la grille n'en affiche que 500, et
 * un SELECT de 100 000 lignes enregistré tel quel rendait chaque exécution
 * suivante lente (fichiers de plusieurs Mo écrits puis relus).
 */
const MAX_STORED_ROWS = 1000

interface CachedSummary {
  mtimeMs: number
  size: number
  summary: HistoryEntrySummary
}

/**
 * Historique des sessions de debug (spec Phase 4) : un fichier JSON par session
 * dans userData/sessions — rejouer une session passée sans réexécuter.
 * (La spec prévoit SQLite ; le format fichier suffit au MVP et évite le build
 * natif better-sqlite3 — à migrer si le volume l'exige.)
 *
 * Le résumé de chaque fichier est mis en cache, repéré par sa date et sa taille :
 * lister l'historique ne relit que les fichiers nouveaux ou modifiés (y compris
 * par un autre processus, comme le serveur MCP).
 */
export class HistoryStore {
  private readonly summaries = new Map<string, CachedSummary>()

  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  save(input: HistorySaveInput): HistoryEntrySummary {
    const entry: HistoryEntry = {
      id: randomUUID(),
      savedAt: new Date().toISOString(),
      title: input.title,
      server: input.server,
      database: input.database,
      stepCount: input.run.steps.length,
      errorCount: countErrors(input.run),
      sql: input.sql,
      paramValues: input.paramValues,
      run: { ...input.run, resultsets: input.run.resultsets.map(trimRows) }
    }
    const name = `${entry.id}.json`
    writeFileSync(join(this.dir, name), JSON.stringify(entry), 'utf8')
    const summary = this.toSummary(entry)
    this.remember(name, summary)
    this.prune()
    return summary
  }

  list(): HistoryEntrySummary[] {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    for (const known of this.summaries.keys()) {
      if (!files.includes(known)) this.summaries.delete(known)
    }
    const out: HistoryEntrySummary[] = []
    for (const file of files) {
      const path = join(this.dir, file)
      try {
        const st = statSync(path)
        const cached = this.summaries.get(file)
        if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
          out.push(cached.summary)
          continue
        }
        const summary = this.toSummary(JSON.parse(readFileSync(path, 'utf8')) as HistoryEntry)
        this.summaries.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary })
        out.push(summary)
      } catch {
        /* fichier corrompu ou supprimé entre-temps : ignoré */
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  load(id: string): HistoryEntry {
    const file = join(this.dir, `${sanitize(id)}.json`)
    if (!existsSync(file)) throw new Error(`Session inconnue : ${id}`)
    return JSON.parse(readFileSync(file, 'utf8')) as HistoryEntry
  }

  /**
   * Signets du Déroulé (noms donnés aux étapes). Réécrit l'entrée via un
   * fichier temporaire : une coupure en pleine écriture ne la corrompt pas.
   * Entrée disparue entre-temps (purge des plus anciennes) : rien à faire.
   */
  setBookmarks(id: string, bookmarks: Record<number, string>): void {
    const file = join(this.dir, `${sanitize(id)}.json`)
    if (!existsSync(file)) return
    const entry = JSON.parse(readFileSync(file, 'utf8')) as HistoryEntry
    const clean: Record<number, string> = {}
    for (const [key, name] of Object.entries(bookmarks ?? {})) {
      const index = Number(key)
      if (!Number.isInteger(index) || index < 0 || index >= entry.run.steps.length) continue
      if (typeof name !== 'string' || !name.trim()) continue
      clean[index] = name.trim().slice(0, 80)
    }
    entry.bookmarks = clean
    writeFileSync(`${file}.tmp`, JSON.stringify(entry), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  delete(id: string): void {
    const file = join(this.dir, `${sanitize(id)}.json`)
    if (existsSync(file)) rmSync(file)
  }

  private prune(): void {
    for (const stale of this.list().slice(MAX_ENTRIES)) {
      this.delete(stale.id)
    }
  }

  private remember(file: string, summary: HistoryEntrySummary): void {
    try {
      const st = statSync(join(this.dir, file))
      this.summaries.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary })
    } catch {
      /* relu au prochain list() */
    }
  }

  private toSummary(entry: HistoryEntry): HistoryEntrySummary {
    return {
      id: entry.id,
      savedAt: entry.savedAt,
      title: entry.title,
      server: entry.server,
      database: entry.database,
      stepCount: entry.stepCount,
      errorCount: entry.errorCount ?? countErrors(entry.run)
    }
  }
}

function trimRows(rs: HistoryEntry['run']['resultsets'][number]): HistoryEntry['run']['resultsets'][number] {
  if (rs.rows.length <= MAX_STORED_ROWS) return rs
  return { ...rs, rows: rs.rows.slice(0, MAX_STORED_ROWS), totalRows: rs.totalRows ?? rs.rows.length }
}

function countErrors(run: HistoryEntry['run']): number {
  return run.errors.length + run.steps.filter((s) => s.kind === 'catch').length
}

function sanitize(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Identifiant invalide : ${id}`)
  return id
}
