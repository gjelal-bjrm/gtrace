import { useCallback, useEffect, useState } from 'react'
import type { ConnectionConfig, ConnectionRef, SavedConnection } from '@shared/types'
import { useConnectionsStore, type OpenConnection } from '../../stores/connectionsStore'
import { useEscapeClose } from '../../lib/useEscapeClose'

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
            production: rememberProd
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
        defaultDatabase: database.trim() || 'master'
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [selectedSaved, password, server, port, database, user, rememberName, rememberProd, onConnected, onClose])

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
        <div className="modal-header">
          <span>🖥 Se connecter au serveur</span>
          <button className="btn btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>

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
                  <span className="saved-row-name">＋ Nouvelle connexion</span>
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
                      {c.production ? '⚠ ' : ''}
                      {c.name}
                    </span>
                    <span className="saved-row-meta">
                      {c.server}
                      {c.port ? `,${c.port}` : ''} · {c.user}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-icon saved-row-del"
                    title="Supprimer cette connexion enregistrée"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteSaved(c.id, c.name)
                    }}
                  >
                    🗑
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
