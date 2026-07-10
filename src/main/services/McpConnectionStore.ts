import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, McpConnection } from '@shared/types'
import type { SidecarService } from './SidecarService'

interface StoredMcpConnection {
  id: string
  label: string
  server: string
  port?: number
  database: string
  user: string
  /** mot de passe chiffré DPAPI (via sidecar) — jamais en clair */
  passwordEnc: string
  maskPatterns: string[]
  allowUnattendedRuns?: boolean
}

/**
 * Connexions explicitement exposées à l'accès MCP lecture seule (spec §3.4.3).
 * Fichier séparé de ConnectionStore : opt-in distinct, off par défaut. Le mot de
 * passe est chiffré DPAPI par le sidecar (le serveur MCP autonome peut le
 * déchiffrer, contrairement au format safeStorage d'Electron). Les connexions
 * « production » ne sont jamais exposables (refus à l'octroi, spec §3.4.3).
 */
export class McpConnectionStore {
  private readonly file: string
  private items: StoredMcpConnection[] = []

  constructor(
    dir: string,
    private readonly sidecar: SidecarService
  ) {
    this.file = join(dir, 'mcp-connections.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      this.items = JSON.parse(readFileSync(this.file, 'utf8')) as StoredMcpConnection[]
    } catch {
      this.items = []
    }
  }

  list(): McpConnection[] {
    return this.items.map((c) => ({
      id: c.id,
      label: c.label,
      server: c.server,
      port: c.port,
      database: c.database,
      user: c.user,
      maskPatterns: c.maskPatterns,
      allowUnattendedRuns: c.allowUnattendedRuns === true
    }))
  }

  /** Résolution par id ou label (confort CLI). Relit le disque. */
  findByIdOrLabel(idOrLabel: string): McpConnection | null {
    this.load()
    const found =
      this.items.find((c) => c.id === idOrLabel) ??
      this.items.find((c) => c.label === idOrLabel)
    return found ? this.list().find((c) => c.id === found.id)! : null
  }

  async grant(
    config: ConnectionConfig,
    label: string,
    maskPatterns: string[],
    reuseId?: string,
    allowUnattendedRuns = false
  ): Promise<McpConnection> {
    const passwordEnc = await this.sidecar.dpapiProtect(config.password)
    const existing = reuseId ? this.items.find((c) => c.id === reuseId) : undefined
    const stored: StoredMcpConnection = {
      id: existing?.id ?? reuseId ?? randomUUID(),
      label,
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      passwordEnc,
      maskPatterns,
      allowUnattendedRuns
    }
    if (existing) this.items[this.items.indexOf(existing)] = stored
    else this.items.push(stored)
    this.persist()
    return this.list().find((c) => c.id === stored.id)!
  }

  revoke(connectionId: string): void {
    this.items = this.items.filter((c) => c.id !== connectionId)
    this.persist()
  }

  /** Résout un connectionId opaque en config complète (mot de passe déchiffré). */
  async resolve(connectionId: string): Promise<{
    config: ConnectionConfig
    maskPatterns: string[]
    allowUnattendedRuns: boolean
  }> {
    // Relecture disque : une révocation depuis l'UI prend effet immédiatement.
    this.load()
    const stored = this.items.find((c) => c.id === connectionId)
    if (!stored) throw new Error(`Connexion MCP non autorisée ou révoquée : ${connectionId}`)
    const password = await this.sidecar.dpapiUnprotect(stored.passwordEnc)
    return {
      config: {
        server: stored.server,
        port: stored.port,
        database: stored.database,
        user: stored.user,
        password,
        trustServerCertificate: true
      },
      maskPatterns: stored.maskPatterns,
      allowUnattendedRuns: stored.allowUnattendedRuns === true
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8')
  }
}
