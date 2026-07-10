import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiConfig, ConnectionRef, HistorySaveInput, ResultSetData } from '@shared/types'
import { formatSqlValue } from '../../stores/replayStore'

interface Props {
  activeRef: ConnectionRef | null
  buildInput: () => HistorySaveInput | null
  onClose: () => void
}

interface VerifyState {
  busy: boolean
  error: string | null
  results: ResultSetData[] | null
}

/** Bouton « Diagnostiquer » (spec Phase 6 §5) : IA embarquée Ollama/Anthropic. */
export default function DiagnosisModal({ activeRef, buildInput, onClose }: Props): JSX.Element {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<{ text: string; backend: string; model: string } | null>(null)
  const [verifications, setVerifications] = useState<Record<number, VerifyState>>({})

  useEffect(() => {
    void window.gtrace.aiGetConfig().then(setConfig)
  }, [])

  const patchConfig = useCallback(async (patch: Parameters<typeof window.gtrace.aiSetConfig>[0]) => {
    setConfig(await window.gtrace.aiSetConfig(patch))
  }, [])

  const runDiagnosis = useCallback(async () => {
    const input = buildInput()
    if (!input) {
      setError('Aucune session à diagnostiquer.')
      return
    }
    setBusy(true)
    setError(null)
    setDiagnosis(null)
    setVerifications({})
    try {
      if (anthropicKey.trim()) {
        await patchConfig({ anthropicKey: anthropicKey.trim() })
        setAnthropicKey('')
      }
      setDiagnosis(await window.gtrace.aiDiagnose(input))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [buildInput, anthropicKey, patchConfig])

  /** Blocs ```sql extraits de la réponse : vérifications exécutables en un clic. */
  const sqlBlocks = useMemo(() => {
    if (!diagnosis) return []
    return [...diagnosis.text.matchAll(/```sql\s*\n([\s\S]*?)```/g)].map((m) => m[1].trim())
  }, [diagnosis])

  const runVerification = useCallback(
    async (index: number, sql: string) => {
      if (!activeRef) {
        setVerifications((v) => ({
          ...v,
          [index]: { busy: false, error: 'Aucune connexion active.', results: null }
        }))
        return
      }
      setVerifications((v) => ({ ...v, [index]: { busy: true, error: null, results: null } }))
      try {
        const results = await window.gtrace.aiVerify(activeRef, sql)
        setVerifications((v) => ({ ...v, [index]: { busy: false, error: null, results } }))
      } catch (e) {
        setVerifications((v) => ({
          ...v,
          [index]: { busy: false, error: e instanceof Error ? e.message : String(e), results: null }
        }))
      }
    },
    [activeRef]
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-activity" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>🩺 Diagnostic IA de la session</span>
          <button className="link-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {config && (
            <div className="tables">
              <h3>Backend</h3>
              <div className="grant-row">
                <select
                  value={config.backend}
                  onChange={(e) =>
                    void patchConfig({ backend: e.target.value as 'ollama' | 'anthropic' })
                  }
                >
                  <option value="ollama">Ollama (local)</option>
                  <option value="anthropic">API Anthropic</option>
                </select>
                {config.backend === 'ollama' ? (
                  <>
                    <input
                      className="watch-input"
                      value={config.ollamaUrl}
                      onChange={(e) => void patchConfig({ ollamaUrl: e.target.value })}
                      title="URL Ollama"
                    />
                    <input
                      className="watch-input"
                      value={config.ollamaModel}
                      onChange={(e) => void patchConfig({ ollamaModel: e.target.value })}
                      title="modèle"
                    />
                  </>
                ) : (
                  <>
                    <input
                      className="watch-input"
                      value={config.anthropicModel}
                      onChange={(e) => void patchConfig({ anthropicModel: e.target.value })}
                      title="modèle"
                    />
                    <input
                      className="watch-input"
                      type="password"
                      placeholder={config.hasAnthropicKey ? '(clé enregistrée)' : 'clé API sk-ant-…'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                    />
                  </>
                )}
                <button className="btn btn-primary" onClick={runDiagnosis} disabled={busy}>
                  {busy ? 'Diagnostic…' : 'Diagnostiquer'}
                </button>
              </div>
              <p className="hint">
                Le contexte envoyé est compact : statement fautif, chemin d&apos;exécution,
                derniers steps avec variables, source.
                {config.backend === 'anthropic' &&
                  ' ⚠ Backend cloud : les données de la session partent vers l’API Anthropic.'}
              </p>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          {diagnosis && (
            <div className="tables">
              <h3>
                Hypothèse ({diagnosis.backend} — {diagnosis.model})
              </h3>
              <pre className="json diagnosis-text">{diagnosis.text}</pre>

              {sqlBlocks.length > 0 && <h3>Vérifications proposées (lecture seule)</h3>}
              {sqlBlocks.map((sql, i) => (
                <div key={i} className="verification">
                  <pre className="json">{sql}</pre>
                  <button onClick={() => void runVerification(i, sql)} disabled={verifications[i]?.busy}>
                    {verifications[i]?.busy ? '…' : '▶ Exécuter (inspect, lecture seule)'}
                  </button>
                  {verifications[i]?.error && <div className="error-box">{verifications[i].error}</div>}
                  {verifications[i]?.results?.map((rs) => (
                    <table key={rs.index}>
                      <thead>
                        <tr>
                          {rs.columns.map((c, ci) => (
                            <th key={ci}>{c || `(col ${ci + 1})`}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rs.rows.slice(0, 20).map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci}>{formatSqlValue(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
