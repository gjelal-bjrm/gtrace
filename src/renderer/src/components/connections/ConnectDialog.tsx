import { useCallback, useEffect, useState } from 'react'
import type { ConnectionConfig, ConnectionRef, SavedConnection } from '@shared/types'
import { useConnectionsStore, type OpenConnection } from '../../stores/connectionsStore'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { CONNECTION_COLORS } from '../../lib/connectionColors'
import { Plus, Server, Trash2 } from 'lucide-react'
import ModalHeader from '../ui/ModalHeader'

interface Props {
  onConnected: (connection: OpenConnection) => void
  onClose: () => void
}

/** Dialogue « Se connecter au serveur », sur le modèle de SSMS. */
export default function ConnectDialog({ onConnected, onClose }: Props): JSX.Element {
  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [savedId, setSavedId] = useState<string>('')
  const [server, setServer] = useState('localhost')
  const [port, setPort] = useState('14333')
  const [database, setDatabase] = useState('master')
  const [user, setUser] = useState('sa')
  const [password, setPassword] = useState('')
  const [rememberName, setRememberName] = useState('')
  const [rememberProd, setRememberProd] = useState(false)
  /** Couleur de la barre d'état (null = celle du thème) */
  const [color, setColor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshSaved = useCallback(async () => {
    setSaved(await window.gtrace.listConnections())
  }, [])

  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  const selectedSaved = saved.find((c) => c.id === savedId) ?? null

  // Sélection d'une connexion enregistrée : remplit les champs (mot de passe géré côté main).
  useEffect(() => {
    if (!selectedSaved) return
    setServer(selectedSaved.server)
    setPort(selectedSaved.port ? String(selectedSaved.port) : '')
    setDatabase(selectedSaved.database)
    setUser(selectedSaved.user)
    setPassword('')
    setColor(selectedSaved.color ?? null)
  }, [selectedSaved])

  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      let ref: ConnectionRef
      let label: string
      let production = false
      const chosenDatabase = database.trim() || 'master'

      if (selectedSaved && password === '') {
        // Connexion enregistrée : mot de passe résolu/déchiffré côté main.
        // La base éditée est portée en surcharge sur la référence pour que
        // l'exécution cible bien la base affichée (et non la base stockée).
        ref =
          chosenDatabase !== selectedSaved.database
            ? { id: selectedSaved.id, database: chosenDatabase }
            : { id: selectedSaved.id }
        label = selectedSaved.name
        production = selectedSaved.production === true
        // Couleur modifiée : on la mémorise avec la connexion (mot de passe
        // vide = conservé côté main).
        if ((selectedSaved.color ?? null) !== color) {
          await window.gtrace.saveConnection({
            id: selectedSaved.id,
            name: selectedSaved.name,
            production: selectedSaved.production,
            color,
            config: {
              server: selectedSaved.server,
              port: selectedSaved.port,
              database: selectedSaved.database,
              user: selectedSaved.user,
              password: ''
            }
          })
        }
      } else {
        const config: ConnectionConfig = {
          server: server.trim(),
          port: port.trim() ? Number(port.trim()) : undefined,
          database: database.trim() || 'master',
          user: user.trim(),
          password,
          trustServerCertificate: true
        }
        if (rememberName.trim()) {
          const entry = await window.gtrace.saveConnection({
            name: rememberName.trim(),
            config,
            production: rememberProd,
            color
          })
          ref = { id: entry.id }
          label = entry.name
          production = rememberProd
        } else {
          ref = { config }
          label = `${config.server}${config.port ? `,${config.port}` : ''} (${config.user})`
        }
      }

      const test = await window.gtrace.testConnection(ref)
      if (!test.ok) {
        setError(test.error ?? 'Connexion impossible.')
        return
      }

      onConnected({
        id: crypto.randomUUID(),
        ref,
        label,
        server: server.trim(),
        user: user.trim(),
        version: test.serverVersion?.split('\n')[0]?.trim() ?? 'SQL Server',
        production,
        color,
        defaultDatabase: database.trim() || 'master'
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [selectedSaved, password, server, port, database, user, rememberName, rememberProd, color, onConnected, onClose])

  const deleteSaved = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Supprimer la connexion enregistrée « ${name} » ?`)) return
      await window.gtrace.deleteConnection(id)
      setSavedId((cur) => (cur === id ? '' : cur))
      await refreshSaved()
    },
    [refreshSaved]
  )

  const alreadyOpen = useConnectionsStore((s) => s.connections)

  useEscapeClose(onClose)


  return (
    <div className="modal-overlay">
      <div className="modal connect-dialog">
        <ModalHeader icon={Server} title="Se connecter au serveur" onClose={onClose} />

        <div className="modal-body">
          {error && <div className="error-box">{error}</div>}

          {saved.length > 0 && (
            <div className="saved-list">
              <button
                type="button"
                className={`saved-row${savedId === '' ? ' active' : ''}`}
                onClick={() => setSavedId('')}
              >
                <span className="saved-row-main">
                  <span className="saved-row-name">
                    <Plus size={14} aria-hidden="true" /> Nouvelle connexion
                  </span>
                </span>
              </button>
              {saved.map((c) => (
                <div
                  key={c.id}
                  className={`saved-row${savedId === c.id ? ' active' : ''}`}
                  onClick={() => setSavedId(c.id)}
                >
                  <span className="saved-row-main">
                    <span className="saved-row-name">
                      <Server size={14} aria-hidden="true" />
                      {c.name}
                      {c.production && <span className="prod-pill">PROD</span>}
                    </span>
                    <span className="saved-row-meta">
                      {c.server}
                      {c.port ? `,${c.port}` : ''} · {c.user}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-icon saved-row-del"
                    data-tip="Supprimer cette connexion enregistrée"
                    aria-label="Supprimer cette connexion enregistrée"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteSaved(c.id, c.name)
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="form-grid">
            <label>Nom du serveur</label>
            <div className="form-inline">
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="localhost" />
              <input
                className="input-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="1433"
                title="Port"
              />
            </div>

            <label>Base par défaut</label>
            <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="master" />

            <label>Authentification</label>
            <select disabled value="sql">
              <option value="sql">Authentification SQL Server</option>
            </select>

            <label>Connexion</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="sa" />

            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={selectedSaved ? '(enregistré — laisser vide)' : ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect()
              }}
            />

            <label>Couleur</label>
            <div
              className="color-swatches"
              title="Couleur de la barre d'état pour cette connexion — pour repérer la production d'un coup d'œil"
            >
              <button
                type="button"
                className={`color-swatch none${color === null ? ' active' : ''}`}
                onClick={() => setColor(null)}
                title="Couleur du thème (rouge si « prod »)"
              >
                ✕
              </button>
              {CONNECTION_COLORS.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  className={`color-swatch${color === c.value ? ' active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>

            {!selectedSaved && (
              <>
                <label>Mémoriser sous</label>
                <div className="form-inline">
                  <input
                    value={rememberName}
                    onChange={(e) => setRememberName(e.target.value)}
                    placeholder="(optionnel — mot de passe chiffré)"
                  />
                  <label className="toggle" title="Avertir avant toute exécution">
                    <input
                      type="checkbox"
                      checked={rememberProd}
                      onChange={(e) => setRememberProd(e.target.checked)}
                    />
                    prod
                  </label>
                </div>
              </>
            )}
          </div>

          {alreadyOpen.length > 0 && (
            <p className="hint">
              Déjà connecté : {alreadyOpen.map((c) => c.label).join(', ')}
            </p>
          )}

          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
