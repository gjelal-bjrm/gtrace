import { useCallback, useEffect, useState, type JSX } from 'react'
import type { McpAuditEntry, McpConnection } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'

interface Props {
  /** Connexion active (celle de l'onglet courant), ou null si non connecté. */
  activeConnection: OpenConnection | null
  onClose: () => void
}

/**
 * Catégories de colonnes sensibles proposées à cocher, plutôt qu'une liste de
 * mots à saisir. Chaque catégorie se traduit en motifs comparés en sous-chaîne
 * et sans casse au nom de colonne (cf. McpGateway.maskRow) : « nom » masque
 * donc « NomClient », « iban » masque « IBAN_Payeur », etc.
 */
const MASK_CATEGORIES: { id: string; label: string; example: string; patterns: string[] }[] = [
  {
    id: 'secrets',
    label: 'Mots de passe et secrets',
    example: 'Password, Token, Hash',
    patterns: ['password', 'passwd', 'pwd', 'mdp', 'secret', 'token', 'hash', 'salt']
  },
  {
    id: 'bank',
    label: 'Coordonnées bancaires',
    example: 'IBAN, BIC, NoCarte',
    patterns: ['iban', 'bic', 'swift', 'carte', 'card', 'compte', 'account']
  },
  {
    id: 'email',
    label: 'Adresses e-mail',
    example: 'MailClient, Courriel',
    patterns: ['mail', 'courriel']
  },
  {
    id: 'phone',
    label: 'Numéros de téléphone',
    example: 'TelPrivClient, Mobile',
    patterns: ['tel', 'phone', 'mobile', 'gsm']
  },
  {
    id: 'identity',
    label: 'Noms et prénoms',
    example: 'NomClient, PrenomClient',
    patterns: ['nom', 'prenom', 'name']
  },
  {
    id: 'address',
    label: 'Adresses postales',
    example: 'AdrClient, VilleClient',
    patterns: ['adr', 'adresse', 'rue', 'ville', 'npa', 'zip', 'street']
  },
  {
    id: 'birth',
    label: 'Dates de naissance',
    example: 'NaissanceClient',
    patterns: ['naissance', 'birth']
  }
]

/** Cochées par défaut : le strict minimum qu'on ne veut jamais voir sortir. */
const DEFAULT_MASKS = ['secrets', 'bank', 'email']

export default function AiActivityPanel({ activeConnection, onClose }: Props): JSX.Element {
  const [granted, setGranted] = useState<McpConnection[]>([])
  const [audit, setAudit] = useState<McpAuditEntry[]>([])
  const [masks, setMasks] = useState<Set<string>>(() => new Set(DEFAULT_MASKS))
  const [allowRuns, setAllowRuns] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setGranted(await window.gtrace.mcpList())
    setAudit(await window.gtrace.mcpAudit())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleMask = useCallback((id: string) => {
    setMasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const grant = useCallback(async () => {
    if (!activeConnection) return
    setError(null)
    const patterns = MASK_CATEGORIES.filter((c) => masks.has(c.id)).flatMap((c) => c.patterns)
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
  }, [activeConnection, masks, allowRuns, refresh])

  const revoke = useCallback(
    async (id: string) => {
      await window.gtrace.mcpRevoke(id)
      await refresh()
    },
    [refresh]
  )

  const isProd = activeConnection?.production === true

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-activity" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>🤖 Accès de l&apos;IA à vos données</span>
          <button className="btn btn-icon" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-box">{error}</div>}

          <p className="hint ai-intro">
            Par défaut, un assistant IA (Claude Code, etc.) n&apos;a <strong>aucun accès</strong> à
            vos bases. Vous pouvez lui ouvrir une connexion précise, en lecture seule : il pourra
            alors lire le schéma et lancer des <span className="vars">SELECT</span> pour vous aider
            à diagnostiquer. Toute écriture est refusée, et chaque appel est journalisé plus bas.
          </p>

          <div className="ai-grant-box">
            <div className="ai-grant-head">
              <span className="ai-grant-label">Connexion à autoriser</span>
              <span className="vars">
                {activeConnection
                  ? `${activeConnection.label}${isProd ? '  ⚠ PRODUCTION' : ''}`
                  : '(aucune connexion active — connectez-vous d’abord)'}
              </span>
            </div>

            <div className="ai-section-title">Ce que l&apos;IA pourra faire</div>
            <label className="ai-check">
              <input type="checkbox" checked disabled />
              <span>
                <strong>Lire</strong> le schéma et exécuter des <span className="vars">SELECT</span>{' '}
                <span className="ai-note">— toujours inclus, jamais d&apos;écriture</span>
              </span>
            </label>
            <label className="ai-check">
              <input
                type="checkbox"
                checked={allowRuns}
                onChange={(e) => setAllowRuns(e.target.checked)}
              />
              <span>
                <strong>Lancer des sessions de débogage</strong> sur cette connexion
                <span className="ai-note">
                  {' '}
                  — l&apos;IA peut exécuter une procédure et lire la trace, sans vous demander à
                  chaque fois. Nécessaire pour qu&apos;elle teste à votre place.
                </span>
              </span>
            </label>

            <div className="ai-section-title">
              Colonnes à masquer
              <span className="ai-note">
                {' '}
                — leurs valeurs sont remplacées par <span className="vars">***</span>. Le nom de la
                colonne reste visible, seule la donnée est cachée.
              </span>
            </div>
            <div className="ai-mask-grid">
              {MASK_CATEGORIES.map((c) => (
                <label key={c.id} className="ai-check">
                  <input
                    type="checkbox"
                    checked={masks.has(c.id)}
                    onChange={() => toggleMask(c.id)}
                  />
                  <span>
                    {c.label}
                    <span className="ai-note"> — ex. {c.example}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="ai-grant-actions">
              {isProd && (
                <span className="ai-refus">
                  Connexion marquée « production » : l&apos;accès IA est refusé par sécurité.
                </span>
              )}
              <button
                className="btn btn-primary"
                onClick={grant}
                disabled={!activeConnection || isProd}
              >
                Autoriser cette connexion
              </button>
            </div>
          </div>

          <h3>Connexions autorisées</h3>
          {granted.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Connexion</th>
                  <th>Serveur / base</th>
                  <th>Colonnes masquées</th>
                  <th>Débogage autonome</th>
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
                    <td>{c.maskPatterns.length > 0 ? `${c.maskPatterns.length} motif(s)` : 'aucune'}</td>
                    <td>{c.allowUnattendedRuns ? '▶ oui' : '—'}</td>
                    <td>
                      <button className="link-btn danger" onClick={() => revoke(c.id)}>
                        retirer l&apos;accès
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              Aucune connexion autorisée : l&apos;IA n&apos;a accès à aucune de vos bases.
            </p>
          )}

          <h3>
            Journal des appels ({audit.length})
            <button className="link-btn" onClick={() => void refresh()}>
              ↻
            </button>
          </h3>
          <p className="hint">
            Tout ce que l&apos;IA a demandé, avec le résultat. Rien n&apos;est effacé sans votre
            action.
          </p>
          {audit.length === 0 ? (
            <p className="hint">Aucun appel enregistré.</p>
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
