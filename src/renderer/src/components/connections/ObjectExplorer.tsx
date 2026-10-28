import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent
} from 'react'
import type {
  ColumnInfo,
  ConnectionRef,
  DatabaseInfo,
  DbObjectInfo,
  DbObjects
} from '@shared/types'
import { useConnectionsStore, type OpenConnection } from '../../stores/connectionsStore'
import { useExplorerStore } from '../../stores/explorerStore'
import { copyText } from '../../lib/clipboard'
import {
  alterScript,
  createScript,
  deleteScript,
  executeScript,
  insertScript,
  qualify,
  selectScript,
  selectTopScript,
  updateScript
} from '../../lib/scriptGen'
import TreeMenu, { type MenuItem } from './TreeMenu'

/** Un script à ouvrir dans un nouvel onglet, lié à une connexion + base. */
export interface OpenScript {
  title: string
  sql: string
  connectionId: string
  database: string
  /** Analyser immédiatement (procédures) vs simple script (SELECT généré) */
  analyze: boolean
  /** Exécuter aussitôt (« Sélectionner les 1000 premières lignes », comme SSMS) */
  execute?: boolean
}

interface Props {
  onOpenScript: (script: OpenScript) => void
  onConnect: () => void
  onDisconnect: (connectionId: string) => void
  /** « Nouvelle requête » du clic droit : onglet connecté à ce serveur / cette base */
  onNewQuery: (connectionId: string, database: string | null) => void
  /** Message court (ex. « copié dans le presse-papiers ») */
  onNotice: (text: string) => void
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

/** Libellé d'une colonne façon SSMS : « color_id (PK, int, non NULL) ». */
function columnLabel(c: ColumnInfo): string {
  const parts = [c.isPrimaryKey ? 'PK' : null, c.dataType, c.isNullable ? 'NULL' : 'non NULL']
  return `${c.name} (${parts.filter(Boolean).join(', ')})`
}

/** Glisser un nœud vers l'éditeur insère son nom (comme SSMS). */
function dragText(text: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', text)
      e.dataTransfer.effectAllowed = 'copy'
    }
  }
}

interface Menu {
  x: number
  y: number
  items: MenuItem[]
}

export default function ObjectExplorer({
  onOpenScript,
  onConnect,
  onDisconnect,
  onNewQuery,
  onNotice,
  locked
}: Props): JSX.Element {
  const connections = useConnectionsStore((s) => s.connections)

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [databases, setDatabases] = useState<Record<string, DatabaseInfo[] | 'loading'>>({})
  const [objects, setObjects] = useState<Record<string, DbObjects | 'loading'>>({})
  const [columns, setColumns] = useState<Record<string, ColumnInfo[] | 'loading'>>({})
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  /** Filtre par dossier (clé du dossier → texte cherché dans « schéma.nom ») */
  const [filters, setFilters] = useState<Record<string, string>>({})
  /** Dossier dont le filtre est en cours de saisie */
  const [editingFilter, setEditingFilter] = useState<string | null>(null)

  const selectedKey = useExplorerStore((s) => s.selection?.key ?? null)
  const select = useExplorerStore((s) => s.select)

  // Actualisation par nœud : remplie pendant le rendu, appelée par F5 / le menu.
  const refreshers = useRef<Record<string, () => void>>({})
  refreshers.current = {}

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

  const expand = useCallback((key: string) => {
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  // ─── Chargements paresseux (force = actualiser) ────────────────────────────
  const loadDatabases = useCallback(
    async (conn: OpenConnection, force = false) => {
      if (databases[conn.id] && !force) return
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
    },
    [databases]
  )

  const loadObjects = useCallback(
    async (conn: OpenConnection, db: string, force = false) => {
      const key = `${conn.id}/${db}`
      if (objects[key] && !force) return
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

  const fetchColumns = useCallback(
    async (conn: OpenConnection, db: string, objectId: number): Promise<ColumnInfo[]> => {
      const key = `${conn.id}/${db}/${objectId}`
      const cached = columns[key]
      if (Array.isArray(cached)) return cached
      const cols = await window.gtrace.listColumns(refFor(conn, db), objectId)
      setColumns((p) => ({ ...p, [key]: cols }))
      return cols
    },
    [columns]
  )

  const loadColumns = useCallback(
    async (conn: OpenConnection, db: string, objectId: number, force = false) => {
      const key = `${conn.id}/${db}/${objectId}`
      if (columns[key] && !force) return
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

  /** Vide les colonnes en cache sous un préfixe (base ou serveur actualisé). */
  const dropColumns = useCallback((prefix: string) => {
    setColumns((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith(prefix))))
  }, [])

  // F5 quand l'explorateur a le focus : actualise le nœud sélectionné.
  const refreshTick = useExplorerStore((s) => s.refreshTick)
  useEffect(() => {
    if (refreshTick === 0) return
    const key = useExplorerStore.getState().selection?.key
    if (key) refreshers.current[key]?.()
  }, [refreshTick])

  // ─── Actions ───────────────────────────────────────────────────────────────
  const fail = (e: unknown): void => setError(e instanceof Error ? e.message : String(e))

  const selectTop = useCallback(
    async (conn: OpenConnection, db: string, o: DbObjectInfo) => {
      try {
        const cols = await fetchColumns(conn, db, o.objectId)
        onOpenScript({
          title: `SELECT ${o.name}`,
          sql: selectTopScript(db, o.schema, o.name, cols),
          connectionId: conn.id,
          database: db,
          analyze: false,
          execute: true
        })
      } catch (e) {
        fail(e)
      }
    },
    [fetchColumns, onOpenScript]
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
        fail(e)
      }
    },
    [onOpenScript]
  )

  /** Script généré vers un nouvel onglet ou le presse-papiers (les deux cibles SSMS). */
  const scriptTargets = (
    conn: OpenConnection,
    db: string,
    title: string,
    build: () => Promise<string>
  ): MenuItem[] => [
    {
      label: "Nouvelle fenêtre d'éditeur de requête",
      disabled: locked,
      onClick: () =>
        void build()
          .then((sql) =>
            onOpenScript({ title, sql, connectionId: conn.id, database: db, analyze: false })
          )
          .catch(fail)
    },
    {
      label: 'Presse-papiers',
      onClick: () =>
        void build()
          .then((sql) => copyText(sql))
          .then(() => onNotice('Script copié dans le presse-papiers.'))
          .catch(fail)
    }
  ]

  const definition = async (conn: OpenConnection, db: string, o: DbObjectInfo): Promise<string> =>
    (await window.gtrace.loadProc(refFor(conn, db), o.objectId)).definition

  const objectMenu = (conn: OpenConnection, db: string, o: DbObjectInfo, kind: ObjKind): MenuItem[] => {
    const cols = (): Promise<ColumnInfo[]> => fetchColumns(conn, db, o.objectId)
    const t = (verb: string): string => `${verb} ${o.name}`
    const copyName: MenuItem = {
      label: 'Copier le nom',
      onClick: () => void copyText(qualify(o.schema, o.name)).then(() => onNotice('Nom copié.'))
    }
    if (kind === 'tables' || kind === 'views') {
      const scripts: MenuItem[] =
        kind === 'tables'
          ? [
              { label: 'SELECT vers', children: scriptTargets(conn, db, t('SELECT'), async () => selectScript(db, o.schema, o.name, await cols())) },
              { label: 'INSERT vers', children: scriptTargets(conn, db, t('INSERT'), async () => insertScript(db, o.schema, o.name, await cols())) },
              { label: 'UPDATE vers', children: scriptTargets(conn, db, t('UPDATE'), async () => updateScript(db, o.schema, o.name, await cols())) },
              { label: 'DELETE vers', children: scriptTargets(conn, db, t('DELETE'), async () => deleteScript(db, o.schema, o.name)) }
            ]
          : [
              { label: 'CREATE vers', children: scriptTargets(conn, db, t('CREATE'), async () => createScript(db, await definition(conn, db, o))) },
              { label: 'ALTER vers', children: scriptTargets(conn, db, t('ALTER'), async () => alterScript(db, await definition(conn, db, o))) },
              { label: 'SELECT vers', children: scriptTargets(conn, db, t('SELECT'), async () => selectScript(db, o.schema, o.name, await cols())) }
            ]
      return [
        { label: 'Sélectionner les 1000 premières lignes', disabled: locked, onClick: () => void selectTop(conn, db, o) },
        'sep',
        { label: `Générer un script ${kind === 'tables' ? 'de la table' : 'de la vue'} en tant que`, children: scripts },
        'sep',
        copyName
      ]
    }
    const moduleScripts: MenuItem[] = [
      { label: 'CREATE vers', children: scriptTargets(conn, db, t('CREATE'), async () => createScript(db, await definition(conn, db, o))) },
      { label: 'ALTER vers', children: scriptTargets(conn, db, t('ALTER'), async () => alterScript(db, await definition(conn, db, o))) }
    ]
    if (kind === 'procedures') {
      moduleScripts.push({
        label: 'EXECUTE vers',
        children: scriptTargets(conn, db, t('EXEC'), async () => {
          const def = await definition(conn, db, o)
          const params = (await window.gtrace.instrument(def)).parameters
          return executeScript(db, o.schema, o.name, params)
        })
      })
      return [
        { label: 'Déboguer', bold: true, disabled: locked, onClick: () => void openSource(conn, db, o, true) },
        { label: 'Voir le code', disabled: locked, onClick: () => void openSource(conn, db, o, false) },
        'sep',
        { label: 'Générer un script de la procédure stockée en tant que', children: moduleScripts },
        'sep',
        copyName
      ]
    }
    return [
      { label: 'Voir le code', bold: true, disabled: locked, onClick: () => void openSource(conn, db, o, false) },
      'sep',
      { label: 'Générer un script de la fonction en tant que', children: moduleScripts },
      'sep',
      copyName
    ]
  }

  /** Clic droit : sélectionne le nœud puis ouvre son menu (comme SSMS). */
  const contextMenu =
    (key: string, connectionId: string, database: string | null, items: () => MenuItem[]) =>
    (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      select({ key, connectionId, database })
      setMenu({ x: e.clientX, y: e.clientY, items: items() })
    }

  /** Props d'une ligne sélectionnable : le clic la sélectionne (base héritée par Ctrl+N). */
  const rowSel = (key: string, connectionId: string, database: string | null) => ({
    'data-selected': key === selectedKey || undefined,
    onClick: () => select({ key, connectionId, database })
  })

  // ─── Rendu de l'arbre (récursif, aplati en lignes indentées) ───────────────
  const renderColumns = (conn: OpenConnection, db: string, o: DbObjectInfo): JSX.Element[] => {
    const key = `${conn.id}/${db}/${o.objectId}`
    if (!isOpen(key)) return []
    const cols = columns[key]
    if (cols === 'loading') return [<div key={`${key}-l`} className="tree-loading" style={indent(5)}>chargement…</div>]
    if (!Array.isArray(cols)) return []
    const colsKey = `${key}/__cols__`
    return [
      // Le dossier « Colonnes » se glisse vers l'éditeur : liste des colonnes.
      <div
        key={colsKey}
        className="tree-row"
        style={indent(5)}
        title="Glisser vers l'éditeur pour insérer la liste des colonnes"
        {...rowSel(colsKey, conn.id, db)}
        {...dragText(cols.map((c) => c.name).join(', '))}
        onContextMenu={contextMenu(colsKey, conn.id, db, () => [
          {
            label: 'Copier la liste des colonnes',
            onClick: () => void copyText(cols.map((c) => c.name).join(', ')).then(() => onNotice('Colonnes copiées.'))
          }
        ])}
      >
        <span className="tree-twisty" />
        <span className="tree-icon">📁</span>
        <span className="tree-label tree-group">Colonnes</span>
      </div>,
      ...cols.map((c) => {
        const ck = `${key}/${c.name}`
        return (
          <div
            key={ck}
            className="tree-row tree-leaf"
            style={indent(6)}
            title={columnLabel(c)}
            {...rowSel(ck, conn.id, db)}
            {...dragText(c.name)}
            onContextMenu={contextMenu(ck, conn.id, db, () => [
              { label: 'Copier le nom', onClick: () => void copyText(c.name).then(() => onNotice('Nom copié.')) }
            ])}
          >
            <span className="tree-icon">{c.isPrimaryKey ? '🔑' : '▪'}</span>
            <span className="tree-label">{columnLabel(c)}</span>
          </div>
        )
      })
    ]
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
    const toggleCols = (): void => toggle(key, () => void loadColumns(conn, db, o.objectId))
    if (hasColumns) refreshers.current[key] = () => void loadColumns(conn, db, o.objectId, true)
    return (
      <div key={key}>
        <div
          className="tree-row"
          style={indent(4)}
          {...rowSel(key, conn.id, db)}
          {...dragText(qualify(o.schema, o.name))}
          onDoubleClick={() => {
            if (hasColumns) toggleCols()
            else if (!locked) void openSource(conn, db, o, kind === 'procedures')
          }}
          onContextMenu={contextMenu(key, conn.id, db, () => objectMenu(conn, db, o, kind))}
        >
          {hasColumns ? (
            <button className="tree-twisty" onClick={toggleCols}>
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
        </div>
        {hasColumns && renderColumns(conn, db, o)}
      </div>
    )
  }

  const renderFolder = (conn: OpenConnection, db: string, kind: ObjKind, label: string, icon: string): JSX.Element => {
    const dbKey = `${conn.id}/${db}`
    const folderKey = `${dbKey}/${kind}`
    const objs = objects[dbKey]
    const all = objs && objs !== 'loading' ? objs[kind] : []
    const filter = filters[folderKey]?.trim().toLowerCase() ?? ''
    const list = filter ? all.filter((o) => `${o.schema}.${o.name}`.toLowerCase().includes(filter)) : all
    const startFilter = (): void => {
      expand(folderKey)
      setEditingFilter(folderKey)
    }
    const clearFilter = (): void => {
      setFilters((p) => {
        const n = { ...p }
        delete n[folderKey]
        return n
      })
      setEditingFilter(null)
    }
    refreshers.current[folderKey] = () => {
      dropColumns(`${dbKey}/`)
      void loadObjects(conn, db, true)
    }
    return (
      <div key={folderKey}>
        <div
          className="tree-row"
          style={indent(3)}
          {...rowSel(folderKey, conn.id, db)}
          onDoubleClick={() => toggle(folderKey)}
          onContextMenu={contextMenu(folderKey, conn.id, db, () => [
            { label: 'Filtrer…', onClick: startFilter },
            { label: 'Supprimer le filtre', disabled: !filters[folderKey], onClick: clearFilter },
            'sep',
            { label: 'Actualiser', onClick: () => refreshers.current[folderKey]?.() }
          ])}
        >
          <button className="tree-twisty" onClick={() => toggle(folderKey)}>
            {isOpen(folderKey) ? '▾' : '▸'}
          </button>
          <span className="tree-icon">{filter ? '⏷' : icon}</span>
          <span className="tree-label">
            {label}
            {filter ? ' (filtré)' : ''}
          </span>
          <span className="tree-meta">
            {objs === 'loading' ? '…' : filter ? `${list.length}/${all.length}` : all.length}
          </span>
        </div>
        {editingFilter === folderKey && (
          <div className="tree-filter" style={indent(4)}>
            <input
              autoFocus
              placeholder="Le nom contient…"
              value={filters[folderKey] ?? ''}
              onChange={(e) => setFilters((p) => ({ ...p, [folderKey]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingFilter(null)
                if (e.key === 'Escape') clearFilter()
              }}
              onBlur={() => setEditingFilter(null)}
            />
          </div>
        )}
        {isOpen(folderKey) && objs !== 'loading' && list.map((o) => renderObject(conn, db, o, kind))}
      </div>
    )
  }

  const renderDatabase = (conn: OpenConnection, db: DatabaseInfo): JSX.Element => {
    const dbKey = `${conn.id}/${db.name}`
    const toggleDb = (): void => toggle(dbKey, () => void loadObjects(conn, db.name))
    refreshers.current[dbKey] = () => {
      dropColumns(`${dbKey}/`)
      void loadObjects(conn, db.name, true)
    }
    return (
      <div key={dbKey}>
        <div
          className="tree-row"
          style={indent(2)}
          {...rowSel(dbKey, conn.id, db.name)}
          onDoubleClick={() => db.online && toggleDb()}
          onContextMenu={contextMenu(dbKey, conn.id, db.name, () => [
            { label: 'Nouvelle requête', bold: true, disabled: locked, onClick: () => onNewQuery(conn.id, db.name) },
            'sep',
            { label: 'Actualiser', disabled: !db.online, onClick: () => refreshers.current[dbKey]?.() }
          ])}
        >
          <button className="tree-twisty" disabled={!db.online} onClick={toggleDb}>
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
    const toggleServer = (): void => toggle(conn.id, () => void loadDatabases(conn))
    refreshers.current[conn.id] = () => {
      dropColumns(`${conn.id}/`)
      setObjects((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith(`${conn.id}/`))))
      void loadDatabases(conn, true)
    }
    return (
      <div key={conn.id} className="tree-server">
        <div
          className="tree-row tree-root"
          style={indent(0)}
          {...rowSel(conn.id, conn.id, null)}
          onDoubleClick={toggleServer}
          onContextMenu={contextMenu(conn.id, conn.id, null, () => [
            { label: 'Nouvelle requête', bold: true, disabled: locked, onClick: () => onNewQuery(conn.id, null) },
            'sep',
            { label: 'Connecter…', onClick: onConnect },
            { label: 'Déconnexion', disabled: locked, onClick: () => onDisconnect(conn.id) },
            'sep',
            { label: 'Actualiser', onClick: () => refreshers.current[conn.id]?.() }
          ])}
        >
          <button className="tree-twisty" onClick={toggleServer}>
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
                <div className="tree-row" style={indent(1)} onDoubleClick={() => toggle(sysKey)}>
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
        <button
          className="btn btn-sm btn-icon"
          onClick={() => {
            const key = useExplorerStore.getState().selection?.key
            if (key) refreshers.current[key]?.()
          }}
          title="Actualiser l'élément sélectionné (F5 quand l'explorateur a le focus)"
        >
          ⟳
        </button>
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
      {menu && <TreeMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

function indent(depth: number): CSSProperties {
  return { paddingLeft: `${6 + depth * 14}px` }
}
