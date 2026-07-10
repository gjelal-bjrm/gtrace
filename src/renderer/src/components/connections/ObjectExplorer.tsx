import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type {
  ColumnInfo,
  ConnectionRef,
  DatabaseInfo,
  DbObjectInfo,
  DbObjects
} from '@shared/types'
import { useConnectionsStore, type OpenConnection } from '../../stores/connectionsStore'

/** Un script à ouvrir dans un nouvel onglet, lié à une connexion + base. */
export interface OpenScript {
  title: string
  sql: string
  connectionId: string
  database: string
  /** Analyser immédiatement (procédures) vs simple script (SELECT généré) */
  analyze: boolean
}

interface Props {
  onOpenScript: (script: OpenScript) => void
  onConnect: () => void
  onDisconnect: (connectionId: string) => void
  locked: boolean
}

type ObjKind = 'tables' | 'views' | 'procedures' | 'functions'

const FOLDERS: { kind: ObjKind; label: string; icon: string }[] = [
  { kind: 'tables', label: 'Tables', icon: '▦' },
  { kind: 'views', label: 'Vues', icon: '◫' },
  { kind: 'procedures', label: 'Procédures stockées', icon: '⚙' },
  { kind: 'functions', label: 'Fonctions', icon: 'ƒ' }
]

/** Référence serveur ciblant une base précise (surcharge résolue côté main). */
function refFor(conn: OpenConnection, database: string): ConnectionRef {
  return { ...conn.ref, database }
}

/** Identifiant délimité SQL Server : les `]` internes doivent être doublés. */
function bracket(id: string): string {
  return `[${id.replace(/]/g, ']]')}]`
}

function qualify(schema: string, name: string): string {
  return `${bracket(schema)}.${bracket(name)}`
}

export default function ObjectExplorer({
  onOpenScript,
  onConnect,
  onDisconnect,
  locked
}: Props): JSX.Element {
  const connections = useConnectionsStore((s) => s.connections)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [databases, setDatabases] = useState<Record<string, DatabaseInfo[] | 'loading'>>({})
  const [objects, setObjects] = useState<Record<string, DbObjects | 'loading'>>({})
  const [columns, setColumns] = useState<Record<string, ColumnInfo[] | 'loading'>>({})
  const [error, setError] = useState<string | null>(null)

  // Purge des caches d'arbre pour les connexions fermées (évite une fuite
  // mémoire d'état sur les cycles connexion/déconnexion).
  const liveIds = connections.map((c) => c.id).join(',')
  useEffect(() => {
    const live = new Set(connections.map((c) => c.id))
    const prune = <T,>(rec: Record<string, T>): Record<string, T> => {
      const kept = Object.entries(rec).filter(([k]) => live.has(k.split('/')[0]))
      return kept.length === Object.keys(rec).length ? rec : Object.fromEntries(kept)
    }
    setExpanded((prev) => {
      const kept = [...prev].filter((k) => live.has(k.split('/')[0]))
      return kept.length === prev.size ? prev : new Set(kept)
    })
    setDatabases((p) => prune(p))
    setObjects((p) => prune(p))
    setColumns((p) => prune(p))
  }, [liveIds, connections])

  const isOpen = (key: string): boolean => expanded.has(key)

  const toggle = useCallback((key: string, onFirstOpen?: () => void) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        onFirstOpen?.()
      }
      return next
    })
  }, [])

  // ─── Chargements paresseux ─────────────────────────────────────────────────
  const loadDatabases = useCallback(async (conn: OpenConnection) => {
    if (databases[conn.id]) return
    setDatabases((p) => ({ ...p, [conn.id]: 'loading' }))
    try {
      const dbs = await window.gtrace.listDatabases(conn.ref)
      setDatabases((p) => ({ ...p, [conn.id]: dbs }))
      setError(null)
    } catch (e) {
      setDatabases((p) => {
        const n = { ...p }
        delete n[conn.id]
        return n
      })
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [databases])

  const loadObjects = useCallback(
    async (conn: OpenConnection, db: string) => {
      const key = `${conn.id}/${db}`
      if (objects[key]) return
      setObjects((p) => ({ ...p, [key]: 'loading' }))
      try {
        const objs = await window.gtrace.listObjects(refFor(conn, db))
        setObjects((p) => ({ ...p, [key]: objs }))
        setError(null)
      } catch (e) {
        setObjects((p) => {
          const n = { ...p }
          delete n[key]
          return n
        })
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [objects]
  )

  const loadColumns = useCallback(
    async (conn: OpenConnection, db: string, objectId: number) => {
      const key = `${conn.id}/${db}/${objectId}`
      if (columns[key]) return
      setColumns((p) => ({ ...p, [key]: 'loading' }))
      try {
        const cols = await window.gtrace.listColumns(refFor(conn, db), objectId)
        setColumns((p) => ({ ...p, [key]: cols }))
      } catch (e) {
        setColumns((p) => {
          const n = { ...p }
          delete n[key]
          return n
        })
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [columns]
  )

  // ─── Actions (SSMS) ────────────────────────────────────────────────────────
  const selectTop = useCallback(
    (conn: OpenConnection, db: string, o: DbObjectInfo) => {
      onOpenScript({
        title: `SELECT ${o.name}`,
        sql: `SELECT TOP (1000) *\nFROM ${qualify(o.schema, o.name)};`,
        connectionId: conn.id,
        database: db,
        analyze: false
      })
    },
    [onOpenScript]
  )

  const openSource = useCallback(
    async (conn: OpenConnection, db: string, o: DbObjectInfo, analyze: boolean) => {
      try {
        const src = await window.gtrace.loadProc(refFor(conn, db), o.objectId)
        onOpenScript({
          title: `${src.schema}.${src.name}`,
          sql: src.definition,
          connectionId: conn.id,
          database: db,
          analyze
        })
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [onOpenScript]
  )

  // ─── Rendu de l'arbre (récursif, aplati en lignes indentées) ───────────────
  const renderColumns = (conn: OpenConnection, db: string, o: DbObjectInfo): JSX.Element[] => {
    const key = `${conn.id}/${db}/${o.objectId}`
    if (!isOpen(key)) return []
    const cols = columns[key]
    if (cols === 'loading') return [<div key={`${key}-l`} className="tree-loading" style={indent(5)}>chargement…</div>]
    if (!Array.isArray(cols)) return []
    return cols.map((c) => (
      <div key={`${key}-${c.name}`} className="tree-row tree-leaf" style={indent(5)} title={c.dataType}>
        <span className="tree-icon">{c.isPrimaryKey ? '🔑' : '▪'}</span>
        <span className="tree-label">{c.name}</span>
        <span className="tree-meta">
          {c.dataType}
          {c.isNullable ? ' · null' : ''}
        </span>
      </div>
    ))
  }

  const renderObject = (
    conn: OpenConnection,
    db: string,
    o: DbObjectInfo,
    kind: ObjKind
  ): JSX.Element => {
    const hasColumns = kind === 'tables' || kind === 'views'
    const key = `${conn.id}/${db}/${o.objectId}`
    const label = `${o.schema}.${o.name}`
    return (
      <div key={key}>
        <div className="tree-row" style={indent(4)}>
          {hasColumns ? (
            <button
              className="tree-twisty"
              onClick={() => toggle(key, () => void loadColumns(conn, db, o.objectId))}
            >
              {isOpen(key) ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree-twisty" />
          )}
          <span className="tree-icon">
            {kind === 'tables' ? '▦' : kind === 'views' ? '◫' : kind === 'procedures' ? '⚙' : 'ƒ'}
          </span>
          <span className="tree-label" title={label}>
            {label}
          </span>
          <span className="tree-actions">
            {hasColumns ? (
              <button
                className="tree-action"
                title="SELECT TOP 1000 dans un nouvel onglet"
                onClick={() => selectTop(conn, db, o)}
                disabled={locked}
              >
                ▶
              </button>
            ) : (
              <button
                className="tree-action"
                title={kind === 'procedures' ? 'Charger et analyser' : 'Voir la définition'}
                onClick={() => void openSource(conn, db, o, kind === 'procedures')}
                disabled={locked}
              >
                {kind === 'procedures' ? '🐞' : '⧉'}
              </button>
            )}
          </span>
        </div>
        {hasColumns && renderColumns(conn, db, o)}
      </div>
    )
  }

  const renderFolder = (conn: OpenConnection, db: string, kind: ObjKind, label: string, icon: string): JSX.Element => {
    const dbKey = `${conn.id}/${db}`
    const folderKey = `${dbKey}/${kind}`
    const objs = objects[dbKey]
    const list = objs && objs !== 'loading' ? objs[kind] : []
    return (
      <div key={folderKey}>
        <div className="tree-row" style={indent(3)}>
          <button className="tree-twisty" onClick={() => toggle(folderKey)}>
            {isOpen(folderKey) ? '▾' : '▸'}
          </button>
          <span className="tree-icon">{icon}</span>
          <span className="tree-label">{label}</span>
          <span className="tree-meta">{objs === 'loading' ? '…' : list.length}</span>
        </div>
        {isOpen(folderKey) &&
          objs !== 'loading' &&
          list.map((o) => renderObject(conn, db, o, kind))}
      </div>
    )
  }

  const renderDatabase = (conn: OpenConnection, db: DatabaseInfo): JSX.Element => {
    const dbKey = `${conn.id}/${db.name}`
    return (
      <div key={dbKey}>
        <div className="tree-row" style={indent(2)}>
          <button
            className="tree-twisty"
            disabled={!db.online}
            onClick={() => toggle(dbKey, () => void loadObjects(conn, db.name))}
          >
            {isOpen(dbKey) ? '▾' : '▸'}
          </button>
          <span className="tree-icon">🗄</span>
          <span className={`tree-label${db.name === conn.defaultDatabase ? ' tree-default' : ''}`}>
            {db.name}
          </span>
          {!db.online && <span className="tree-meta">hors ligne</span>}
        </div>
        {isOpen(dbKey) &&
          objects[dbKey] === 'loading' && (
            <div className="tree-loading" style={indent(3)}>chargement…</div>
          )}
        {isOpen(dbKey) &&
          objects[dbKey] &&
          objects[dbKey] !== 'loading' &&
          FOLDERS.map((f) => renderFolder(conn, db.name, f.kind, f.label, f.icon))}
      </div>
    )
  }

  const renderServer = (conn: OpenConnection): JSX.Element => {
    const dbs = databases[conn.id]
    const user = dbs && dbs !== 'loading' ? dbs.filter((d) => !d.system) : []
    const system = dbs && dbs !== 'loading' ? dbs.filter((d) => d.system) : []
    const sysKey = `${conn.id}/__system__`
    return (
      <div key={conn.id} className="tree-server">
        <div className="tree-row tree-root" style={indent(0)}>
          <button className="tree-twisty" onClick={() => toggle(conn.id, () => void loadDatabases(conn))}>
            {isOpen(conn.id) ? '▾' : '▸'}
          </button>
          <span className="tree-icon">{conn.production ? '⚠' : '🖥'}</span>
          <span className="tree-label" title={`${conn.version} — ${conn.user}`}>
            {conn.label}
          </span>
          <span className="tree-actions">
            <button
              className="tree-action"
              title={locked ? 'Session active — déconnexion gelée' : 'Se déconnecter'}
              disabled={locked}
              onClick={() => onDisconnect(conn.id)}
            >
              ⏏
            </button>
          </span>
        </div>
        {isOpen(conn.id) && dbs === 'loading' && (
          <div className="tree-loading" style={indent(1)}>chargement des bases…</div>
        )}
        {isOpen(conn.id) && dbs && dbs !== 'loading' && (
          <>
            <div className="tree-row" style={indent(1)}>
              <span className="tree-twisty" />
              <span className="tree-icon">📁</span>
              <span className="tree-label tree-group">Bases de données ({user.length})</span>
            </div>
            {user.map((d) => renderDatabase(conn, d))}
            {system.length > 0 && (
              <div key={sysKey}>
                <div className="tree-row" style={indent(1)}>
                  <button className="tree-twisty" onClick={() => toggle(sysKey)}>
                    {isOpen(sysKey) ? '▾' : '▸'}
                  </button>
                  <span className="tree-icon">📁</span>
                  <span className="tree-label tree-group">Bases système ({system.length})</span>
                </div>
                {isOpen(sysKey) && system.map((d) => renderDatabase(conn, d))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="object-explorer">
      <div className="explorer-toolbar">
        <span className="explorer-title">Explorateur d&apos;objets</span>
        <button className="btn btn-sm btn-primary" onClick={onConnect} title="Se connecter à un serveur">
          🔌 Connecter
        </button>
      </div>
      {error && <div className="error-box explorer-error">{error}</div>}
      <div className="tree">
        {connections.length === 0 ? (
          <p className="hint tree-empty">
            Aucune connexion. Cliquez « Connecter » pour vous connecter à une instance SQL Server.
          </p>
        ) : (
          connections.map(renderServer)
        )}
      </div>
    </div>
  )
}

function indent(depth: number): CSSProperties {
  return { paddingLeft: `${6 + depth * 14}px` }
}
