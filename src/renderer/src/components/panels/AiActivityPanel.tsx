import { useCallback, useEffect, useState } from 'react'
import type { McpAuditEntry, McpConnection } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'

interface Props {
  /** Connexion active (celle de l'onglet courant), ou null si non connecté. */
  activeConnection: OpenConnection | null
  onClose: () => void
}

export default function AiActivityPanel({ activeConnection, onClose }: Props): JSX.Element {
  const [granted, setGranted] = useState<McpConnection[]>([])
  const [audit, setAudit] = useState<McpAuditEntry[]>([])
  const [maskPatterns, setMaskPatterns] = useState('email, iban, password')
  const [allowRuns, setAllowRuns] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setGranted(await window.gtrace.mcpList())
    setAudit(await window.gtrace.mcpAudit())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const grant = useCallback(async () => {
    if (!activeConnection) return
    setError(null)
    const patterns = maskPatterns
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    try {
      const ref = activeConnection.ref
      await window.gtrace.mcpGrant({
        ...('id' in ref ? { savedConnectionId: ref.id } : { config: ref.config }),
        label: activeConnection.label,
        maskPatterns: patterns,
        allowUnattendedRuns: allowRuns
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeConnection, maskPatterns, allowRuns, refresh])

  const revoke = useCallback(
    async (id: string) => {
      await window.gtrace.mcpRevoke(id)
      await refresh()
    },
    [refresh]
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-activity" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Activité IA — accès MCP</span>
          <button className="link-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-box">{error}</div>}

          <h3>Connexions exposées à l&apos;IA (lecture seule)</h3>
          <p className="hint">
            Opt-in explicite. Le serveur MCP (Claude Code…) ne peut interroger que ces
            connexions, en SELECT uniquement. Les connexions « production » sont refusées.
          </p>
          <div className="grant-row">
            <span className="vars">
              {activeConnection
                ? `${activeConnection.label}${activeConnection.production ? ' ⚠ PROD' : ''}`
                : '(aucune connexion active)'}
            </span>
            <input
              className="watch-input"
              placeholder="masquer colonnes : email, iban…"
              value={maskPatterns}
              onChange={(e) => setMaskPatterns(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={grant}
              disabled={!activeConnection || activeConnection.production}
              title={
                activeConnection?.production
                  ? 'Connexion production : non exposable'
                  : 'Autoriser la connexion active'
              }
            >
              Autoriser
            </button>
          </div>
          <label className="toggle prod-toggle">
            <input
              type="checkbox"
              checked={allowRuns}
              onChange={(e) => setAllowRuns(e.target.checked)}
            />
            autoriser les runs autonomes (l&apos;IA peut lancer des sessions de debug sur cette
            connexion via run_debug_session / gtrace-run)
          </label>

          {granted.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Serveur / base</th>
                  <th>Masquage</th>
                  <th>Runs autonomes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {granted.map((c) => (
                  <tr key={c.id}>
                    <td className="vars">{c.label}</td>
                    <td>
                      {c.server}/{c.database}
                    </td>
                    <td>{c.maskPatterns.join(', ') || '—'}</td>
                    <td>{c.allowUnattendedRuns ? '▶ oui' : '—'}</td>
                    <td>
                      <button className="link-btn danger" onClick={() => revoke(c.id)}>
                        révoquer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">Aucune connexion exposée.</p>
          )}

          <h3>
            Journal des appels ({audit.length})
            <button className="link-btn" onClick={() => void refresh()}>
              ↻
            </button>
          </h3>
          {audit.length === 0 ? (
            <p className="hint">Aucun appel MCP enregistré.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Outil</th>
                  <th>Requête</th>
                  <th>Lignes</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e, i) => (
                  <tr key={i} className={e.ok ? '' : 'step-error'}>
                    <td>{new Date(e.at).toLocaleTimeString()}</td>
                    <td className="vars">{e.tool}</td>
                    <td className="audit-sql" title={e.sql ?? ''}>
                      {e.sql ?? ''}
                    </td>
                    <td>{e.rows >= 0 ? e.rows : '—'}</td>
                    <td>{e.ok ? 'ok' : `rejeté : ${e.message ?? ''}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
