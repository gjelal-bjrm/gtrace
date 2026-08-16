import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, SavedConnection, SaveConnectionInput } from '@shared/types'

interface StoredConnection {
  id: string
  name: string
  server: string
  port?: number
  database: string
  user: string
  /** base64 du mot de passe chiffré par safeStorage (DPAPI sous Windows) */
  passwordEnc: string | null
  production?: boolean
}

/**
 * Persistance des connexions dans userData/connections.json. Le mot de passe est
 * chiffré via safeStorage et n'est jamais renvoyé au renderer : les exécutions
 * passent par une référence { id } résolue ici, côté main.
 */
export class ConnectionStore {
  private readonly file = join(app.getPath('userData'), 'connections.json')
  private items: StoredConnection[] = []

  constructor() {
    if (existsSync(this.file)) {
      try {
        this.items = JSON.parse(readFileSync(this.file, 'utf8')) as StoredConnection[]
      } catch (e) {
        console.error(`[connections] fichier illisible, réinitialisé : ${String(e)}`)
        this.items = []
      }
    }
  }

  list(): SavedConnection[] {
    return this.items.map((c) => ({
      id: c.id,
      name: c.name,
      server: c.server,
      port: c.port,
      database: c.database,
      user: c.user,
      hasPassword: c.passwordEnc !== null,
      production: c.production
    }))
  }

  save(input: SaveConnectionInput): SavedConnection {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage indisponible : impossible de chiffrer le mot de passe.')
    }
    // Sans id explicite, on réutilise l'entrée visant déjà la même cible
    // (serveur + port + base + utilisateur) : enregistrer deux fois le même
    // serveur ne doit pas créer deux entrées jumelles dans la liste.
    const norm = (s: string): string => s.trim().toLowerCase()
    const isSameTarget = (c: StoredConnection): boolean =>
      norm(c.server) === norm(input.config.server) &&
      (c.port ?? null) === (input.config.port ?? null) &&
      norm(c.database) === norm(input.config.database) &&
      norm(c.user) === norm(input.config.user)

    const existing = input.id
      ? this.items.find((c) => c.id === input.id)
      : this.items.find(isSameTarget)
    const stored: StoredConnection = {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      server: input.config.server,
      port: input.config.port,
      database: input.config.database,
      user: input.config.user,
      // mot de passe vide en mise à jour = conserver l'existant
      passwordEnc: input.config.password
        ? safeStorage.encryptString(input.config.password).toString('base64')
        : (existing?.passwordEnc ?? null),
      production: input.production
    }
    if (existing) {
      this.items[this.items.indexOf(existing)] = stored
    } else {
      this.items.push(stored)
    }
    this.persist()
    return this.list().find((c) => c.id === stored.id)!
  }

  delete(id: string): void {
    this.items = this.items.filter((c) => c.id !== id)
    this.persist()
  }

  resolve(id: string): ConnectionConfig {
    const stored = this.items.find((c) => c.id === id)
    if (!stored) throw new Error(`Connexion inconnue : ${id}`)
    return {
      server: stored.server,
      port: stored.port,
      database: stored.database,
      user: stored.user,
      password: stored.passwordEnc
        ? safeStorage.decryptString(Buffer.from(stored.passwordEnc, 'base64'))
        : '',
      trustServerCertificate: true
    }
  }

  isProduction(id: string): boolean {
    return this.items.find((c) => c.id === id)?.production === true
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8')
  }
}
