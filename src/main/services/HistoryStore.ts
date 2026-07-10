import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HistoryEntry, HistoryEntrySummary, HistorySaveInput } from '@shared/types'

const MAX_ENTRIES = 50

/**
 * Historique des sessions de debug (spec Phase 4) : un fichier JSON par session
 * dans userData/sessions — rejouer une session passée sans réexécuter.
 * (La spec prévoit SQLite ; le format fichier suffit au MVP et évite le build
 * natif better-sqlite3 — à migrer si le volume l'exige.)
 */
export class HistoryStore {
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
      run: input.run
    }
    writeFileSync(join(this.dir, `${entry.id}.json`), JSON.stringify(entry), 'utf8')
    this.prune()
    return this.toSummary(entry)
  }

  list(): HistoryEntrySummary[] {
    return this.readAll()
      .map((e) => this.toSummary(e))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  load(id: string): HistoryEntry {
    const file = join(this.dir, `${sanitize(id)}.json`)
    if (!existsSync(file)) throw new Error(`Session inconnue : ${id}`)
    return JSON.parse(readFileSync(file, 'utf8')) as HistoryEntry
  }

  delete(id: string): void {
    const file = join(this.dir, `${sanitize(id)}.json`)
    if (existsSync(file)) rmSync(file)
  }

  private prune(): void {
    const all = this.readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    for (const stale of all.slice(MAX_ENTRIES)) {
      this.delete(stale.id)
    }
  }

  private readAll(): HistoryEntry[] {
    const entries: HistoryEntry[] = []
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      try {
        entries.push(JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as HistoryEntry)
      } catch {
        /* fichier corrompu : ignoré */
      }
    }
    return entries
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

function countErrors(run: HistoryEntry['run']): number {
  return run.errors.length + run.steps.filter((s) => s.kind === 'catch').length
}

function sanitize(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Identifiant invalide : ${id}`)
  return id
}
