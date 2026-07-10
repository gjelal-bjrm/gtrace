import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiConfig, AiConfigPatch, AiDiagnosis, HistoryEntry } from '@shared/types'
import type { SidecarService } from '../services/SidecarService'
import { buildDiagnosisPrompt } from './context'

interface StoredAiConfig {
  backend: 'ollama' | 'anthropic'
  ollamaUrl: string
  ollamaModel: string
  anthropicModel: string
  /** clé API chiffrée DPAPI via sidecar — jamais en clair, jamais commitée */
  anthropicKeyEnc?: string
}

const DEFAULTS: StoredAiConfig = {
  backend: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3:14b',
  anthropicModel: 'claude-sonnet-5'
}

const REQUEST_TIMEOUT_MS = 120_000

/**
 * Diagnostic IA embarqué (spec Phase 6 §5, volontairement minimal) : assemble
 * le contexte compact et interroge un backend local (Ollama) ou l'API Anthropic
 * (clé fournie par l'utilisateur, chiffrée DPAPI). Le MCP reste la voie riche ;
 * ceci est le bouton « second avis » sans quitter GTrace.
 */
export class AiDiagnosisService {
  private readonly file: string

  constructor(
    dir: string,
    private readonly sidecar: SidecarService
  ) {
    this.file = join(dir, 'ai-config.json')
  }

  private loadStored(): StoredAiConfig {
    if (!existsSync(this.file)) return { ...DEFAULTS }
    try {
      return { ...DEFAULTS, ...(JSON.parse(readFileSync(this.file, 'utf8')) as StoredAiConfig) }
    } catch {
      return { ...DEFAULTS }
    }
  }

  getConfig(): AiConfig {
    const stored = this.loadStored()
    return {
      backend: stored.backend,
      ollamaUrl: stored.ollamaUrl,
      ollamaModel: stored.ollamaModel,
      anthropicModel: stored.anthropicModel,
      hasAnthropicKey: Boolean(stored.anthropicKeyEnc)
    }
  }

  async setConfig(patch: AiConfigPatch): Promise<AiConfig> {
    const stored = this.loadStored()
    if (patch.backend !== undefined) stored.backend = patch.backend
    if (patch.ollamaUrl !== undefined) stored.ollamaUrl = patch.ollamaUrl
    if (patch.ollamaModel !== undefined) stored.ollamaModel = patch.ollamaModel
    if (patch.anthropicModel !== undefined) stored.anthropicModel = patch.anthropicModel
    if (patch.anthropicKey !== undefined && patch.anthropicKey !== '') {
      stored.anthropicKeyEnc = await this.sidecar.dpapiProtect(patch.anthropicKey)
    }
    writeFileSync(this.file, JSON.stringify(stored, null, 2), 'utf8')
    return this.getConfig()
  }

  async diagnose(entry: HistoryEntry): Promise<AiDiagnosis> {
    const stored = this.loadStored()
    const prompt = buildDiagnosisPrompt(entry)
    const text =
      stored.backend === 'anthropic'
        ? await this.callAnthropic(stored, prompt)
        : await this.callOllama(stored, prompt)
    return {
      text,
      backend: stored.backend,
      model: stored.backend === 'anthropic' ? stored.anthropicModel : stored.ollamaModel
    }
  }

  private async callOllama(config: StoredAiConfig, prompt: string): Promise<string> {
    const response = await fetch(`${config.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }).catch((e) => {
      throw new Error(
        `Ollama injoignable (${config.ollamaUrl}) : ${e instanceof Error ? e.message : e}. ` +
          'Vérifiez qu\'Ollama tourne, ou basculez sur le backend Anthropic.'
      )
    })
    if (!response.ok) {
      throw new Error(`Ollama : HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`)
    }
    const data = (await response.json()) as { message?: { content?: string } }
    const text = data.message?.content
    if (!text) throw new Error('Ollama : réponse vide ou format inattendu.')
    return text
  }

  private async callAnthropic(config: StoredAiConfig, prompt: string): Promise<string> {
    if (!config.anthropicKeyEnc) {
      throw new Error('Aucune clé API Anthropic configurée (panneau Diagnostic).')
    }
    const key = await this.sidecar.dpapiUnprotect(config.anthropicKeyEnc)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`API Anthropic : HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`)
    }
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find((c) => c.type === 'text')?.text
    if (!text) throw new Error('API Anthropic : réponse vide ou format inattendu.')
    return text
  }
}
