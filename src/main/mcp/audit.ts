import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpAuditEntry } from '@shared/types'

/**
 * Journal d'audit des appels MCP (spec §3.4.4) : append-only JSONL dans userData,
 * écrit par le serveur MCP (potentiellement un autre process) et lu par le
 * panneau « Activité IA » de l'UI.
 */
export class McpAudit {
  private readonly file: string

  constructor(dir: string) {
    this.file = join(dir, 'mcp-audit.jsonl')
  }

  log(entry: Omit<McpAuditEntry, 'at'>): void {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry })
    try {
      appendFileSync(this.file, line + '\n', 'utf8')
    } catch {
      /* l'audit ne doit jamais faire échouer un appel */
    }
  }

  /** Dernières entrées (les plus récentes en premier). */
  read(limit = 200): McpAuditEntry[] {
    if (!existsSync(this.file)) return []
    const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean)
    const entries: McpAuditEntry[] = []
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as McpAuditEntry)
      } catch {
        /* ligne corrompue ignorée */
      }
    }
    return entries.reverse()
  }
}
