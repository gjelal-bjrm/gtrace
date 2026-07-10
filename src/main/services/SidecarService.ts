import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import type {
  InstrumentResult,
  ParseResult,
  PauseRequestOptions,
  SidecarStatus,
  ValidateResult
} from '@shared/types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

interface SidecarResponse {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Gère le processus sidecar .NET (ScriptDom) : spawn, protocole JSON ligne
 * par ligne sur stdin/stdout, corrélation requête/réponse par id.
 */
export class SidecarService {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private version: string | null = null

  constructor(private readonly exe: string) {}

  get exePath(): string {
    return this.exe
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null) return this.proc

    const exe = this.exePath
    if (!existsSync(exe)) {
      throw new Error(
        `Sidecar introuvable : ${exe}. Exécuter "npm run build:sidecar" pour le publier.`
      )
    }

    const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => this.onLine(line))

    proc.stderr.on('data', (chunk: Buffer) => {
      console.error(`[sidecar] ${chunk.toString().trimEnd()}`)
    })

    proc.on('exit', (code) => {
      const error = new Error(`Le sidecar s'est arrêté (code ${code})`)
      for (const req of this.pending.values()) {
        clearTimeout(req.timer)
        req.reject(error)
      }
      this.pending.clear()
      if (this.proc === proc) this.proc = null
    })

    return proc
  }

  private onLine(line: string): void {
    let response: SidecarResponse
    try {
      response = JSON.parse(line) as SidecarResponse
    } catch {
      console.error(`[sidecar] ligne non-JSON ignorée : ${line}`)
      return
    }
    const req = this.pending.get(response.id)
    if (!req) return
    this.pending.delete(response.id)
    clearTimeout(req.timer)
    if (response.error) {
      req.reject(new Error(`Sidecar [${response.error.code}] : ${response.error.message}`))
    } else {
      req.resolve(response.result)
    }
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const proc = this.ensureStarted()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Sidecar : pas de réponse pour "${method}" après ${REQUEST_TIMEOUT_MS} ms`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer })
      proc.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  async parse(sql: string, compatLevel = 150): Promise<ParseResult> {
    return this.request<ParseResult>('parse', { sql, compatLevel })
  }

  async instrument(
    sql: string,
    compatLevel = 150,
    pause?: PauseRequestOptions,
    snapshots?: string[]
  ): Promise<InstrumentResult> {
    return this.request<InstrumentResult>('instrument', { sql, compatLevel, pause, snapshots })
  }

  async validate(sql: string, compatLevel = 150, whitelist: string[] = []): Promise<ValidateResult> {
    return this.request<ValidateResult>('validate', { sql, compatLevel, whitelist })
  }

  async validateReadOnly(sql: string, compatLevel = 150): Promise<ValidateResult> {
    return this.request<ValidateResult>('validateReadOnly', { sql, compatLevel })
  }

  async dpapiProtect(plaintext: string): Promise<string> {
    return (await this.request<{ ciphertext: string }>('dpapiProtect', { plaintext })).ciphertext
  }

  async dpapiUnprotect(ciphertext: string): Promise<string> {
    return (await this.request<{ plaintext: string }>('dpapiUnprotect', { ciphertext })).plaintext
  }

  async status(): Promise<SidecarStatus> {
    try {
      const pong = await this.request<{ ok: boolean; version: string }>('ping', {})
      this.version = pong.version
      return { running: true, version: this.version, exePath: this.exePath }
    } catch {
      return { running: false, version: null, exePath: this.exePath }
    }
  }

  dispose(): void {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill()
    }
    this.proc = null
  }
}
