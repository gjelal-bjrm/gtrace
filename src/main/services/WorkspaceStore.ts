import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PersistedConnection,
  PersistedTab,
  WorkspaceLoadResult,
  WorkspaceState
} from '@shared/types'

const EMPTY: WorkspaceState = { connections: [], tabs: [], activeTabId: null }

/**
 * Persistance de l'espace de travail (onglets ouverts + connexions ouvertes)
 * dans userData/workspace.json. Ne contient AUCUN mot de passe : connexions
 * référencées par savedId (chiffré ailleurs via safeStorage).
 *
 * Durabilité : écriture atomique (fichier .tmp → rename) + copie .bak de la
 * version précédente, pour ne jamais perdre l'espace de travail sur un crash en
 * cours d'écriture ou un fichier corrompu. `load()` distingue « échec de lecture »
 * (ok=false → le renderer n'écrase pas) de « fichier absent/vide » (ok=true).
 */
export class WorkspaceStore {
  private readonly file: string
  private readonly bak: string
  private readonly tmp: string

  constructor(dir: string) {
    this.file = join(dir, 'workspace.json')
    this.bak = join(dir, 'workspace.json.bak')
    this.tmp = join(dir, 'workspace.json.tmp')
  }

  load(): WorkspaceLoadResult {
    if (!existsSync(this.file)) {
      // Fichier principal absent : tenter une sauvegarde .bak, sinon état vide légitime.
      const fromBak = this.tryRead(this.bak)
      return fromBak ? { state: fromBak, ok: true } : { state: EMPTY, ok: true }
    }
    const main = this.tryRead(this.file)
    if (main) return { state: main, ok: true }
    // Fichier principal illisible/corrompu : tenter la sauvegarde .bak.
    const fromBak = this.tryRead(this.bak)
    if (fromBak) return { state: fromBak, ok: true }
    // Échec réel : signaler pour que le renderer n'écrase pas le fichier.
    return { state: EMPTY, ok: false }
  }

  save(state: WorkspaceState): void {
    try {
      writeFileSync(this.tmp, JSON.stringify(state), 'utf8')
      if (existsSync(this.file)) {
        try {
          copyFileSync(this.file, this.bak)
        } catch {
          /* backup best-effort */
        }
      }
      renameSync(this.tmp, this.file) // remplacement atomique (écrase sous Windows)
    } catch {
      /* écriture non bloquante */
    }
  }

  private tryRead(path: string): WorkspaceState | null {
    if (!existsSync(path)) return null
    try {
      return sanitize(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }
}

/** Valide/nettoie chaque élément — un élément malformé est écarté, jamais propagé. */
function sanitize(raw: unknown): WorkspaceState {
  const obj = (raw ?? {}) as Record<string, unknown>
  const connections = Array.isArray(obj.connections)
    ? (obj.connections.filter(
        (c) => c && typeof c === 'object' && typeof (c as PersistedConnection).savedId === 'string'
      ) as PersistedConnection[])
    : []
  const tabs = Array.isArray(obj.tabs)
    ? (obj.tabs.filter(
        (t) =>
          t &&
          typeof t === 'object' &&
          typeof (t as PersistedTab).id === 'string' &&
          typeof (t as PersistedTab).content === 'string'
      ) as PersistedTab[])
    : []
  const activeTabId = typeof obj.activeTabId === 'string' ? obj.activeTabId : null
  return { connections, tabs, activeTabId }
}
