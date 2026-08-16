import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionRef,
  DatabaseInfo,
  DebugRunResult,
  HistoryEntry,
  HistorySaveInput,
  InstrumentResult,
  PausedInfo,
  ResultSetData,
  SidecarStatus,
  StepError,
  XeLineStat
} from '@shared/types'
import CodeEditor, { type LineDecoration } from './components/editor/CodeEditor'
import Timeline from './components/timeline/Timeline'
import VariablesPanel from './components/panels/VariablesPanel'
import ResultsPanel from './components/panels/ResultsPanel'
import RunPanel from './components/panels/RunPanel'
import InspectPanel from './components/panels/InspectPanel'
import ProfilePanel from './components/panels/ProfilePanel'
import SnapshotsPanel from './components/panels/SnapshotsPanel'
import ObjectExplorer, { type OpenScript } from './components/connections/ObjectExplorer'
import HistoryPanel from './components/connections/HistoryPanel'
import ConnectDialog from './components/connections/ConnectDialog'
import AiActivityPanel from './components/panels/AiActivityPanel'
import DiagnosisModal from './components/panels/DiagnosisModal'
import TabBar from './components/editor/TabBar'
import Splitter from './components/layout/Splitter'
import { Wordmark } from './components/layout/Logo'
import UpdateBanner from './components/layout/UpdateBanner'
import StatusBar from './components/layout/StatusBar'
import ThemeDialog from './components/layout/ThemeDialog'
import { useAppearanceStore } from './stores/appearanceStore'
import WhatsNew from './components/layout/WhatsNew'
import { useUpdateStore } from './stores/updateStore'
import { setCompletionSchema } from './components/editor/completion'
import { useReplayStore } from './stores/replayStore'

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
function loadSize(key: string, def: number, min: number, max: number): number {
  const v = Number(localStorage.getItem(key))
  // Reborne à la lecture : une valeur héritée trop petite/grande est corrigée
  // (sinon un ancien redimensionnement peut rendre une zone illisible/rognée).
  return Number.isFinite(v) && v > 0 ? clamp(v, min, max) : def
}
import { useEditorStore } from './stores/editorStore'
import { useConnectionsStore, type OpenConnection } from './stores/connectionsStore'
import type { EditorTab } from './stores/editorStore'
import type { WorkspaceState } from '@shared/types'

interface SessionState {
  id: string
  status: 'running' | 'paused'
  paused: PausedInfo | null
}

interface XeState {
  id: string
  currentLine: number | null
  statements: number
}

interface XeResult {
  stats: XeLineStat[]
  elapsedMs: number
  resultsets: ResultSetData[]
  errors: StepError[]
}

type Tab = 'run' | 'variables' | 'results' | 'data' | 'inspect' | 'profile'

export default function App(): JSX.Element {
  // ─── Onglets d'édition (chaque onglet = un document lié à une connexion) ───
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const sql = activeTab.content
  const compatLevel = activeTab.compatLevel
  const paramValues = activeTab.paramValues
  const snapshotTargets = activeTab.snapshotTargets
  const readOnly = activeTab.readOnly
  const roWhitelist = activeTab.roWhitelist
  const breakpoints = useMemo(() => new Set(activeTab.breakpoints), [activeTab.breakpoints])

  const setCompatLevel = useCallback(
    (v: number) => useEditorStore.getState().patchActive({ compatLevel: v }),
    []
  )
  const setSnapshotTargets = useCallback(
    (v: string) => useEditorStore.getState().patchActive({ snapshotTargets: v }),
    []
  )
  const setReadOnly = useCallback(
    (v: boolean) => useEditorStore.getState().patchActive({ readOnly: v }),
    []
  )
  const setRoWhitelist = useCallback(
    (v: string) => useEditorStore.getState().patchActive({ roWhitelist: v }),
    []
  )
  type ParamMap = Record<string, string | null>
  const setParamValues = useCallback((next: ParamMap | ((prev: ParamMap) => ParamMap)) => {
    const st = useEditorStore.getState()
    const cur = (st.tabs.find((t) => t.id === st.activeId) ?? st.tabs[0]).paramValues
    st.patchActive({ paramValues: typeof next === 'function' ? next(cur) : next })
  }, [])

  // ─── Connexions ouvertes (instances SQL Server, comme SSMS) ────────────────
  const connections = useConnectionsStore((s) => s.connections)
  const addConnection = useConnectionsStore((s) => s.add)
  const removeConnection = useConnectionsStore((s) => s.remove)
  const setAllConnections = useConnectionsStore((s) => s.setAll)
  const [restored, setRestored] = useState(false)
  const activeConn = useMemo<OpenConnection | null>(
    () => connections.find((c) => c.id === activeTab.connectionId) ?? null,
    [connections, activeTab.connectionId]
  )
  const tabDatabase = activeTab.database

  /** Référence d'exécution : connexion de l'onglet + base choisie (ou null si non connecté). */
  const activeRef = useMemo<ConnectionRef | null>(() => {
    if (!activeConn) return null
    return tabDatabase ? { ...activeConn.ref, database: tabDatabase } : activeConn.ref
  }, [activeConn, tabDatabase])

  const [instr, setInstr] = useState<InstrumentResult | null>(null)
  const [status, setStatus] = useState<SidecarStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('run')
  const [showExplorer, setShowExplorer] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  /** Résultats agrandis : masque l'éditeur pour donner toute la place aux données. */
  const [focusMode, setFocusMode] = useState(false)
  const [showTheme, setShowTheme] = useState(false)
  // Applique le thème enregistré au démarrage (variables CSS sur :root).
  useEffect(() => {
    useAppearanceStore.getState().init()
  }, [])
  // Tailles redimensionnables des zones (mémorisées entre sessions)
  const [explorerWidth, setExplorerWidth] = useState(() => loadSize('gtrace.explorerW', 288, 190, 640))
  /** Hauteur du panneau de résultats (en bas, disposition SSMS). */
  const [resultsHeight, setResultsHeight] = useState(() => loadSize('gtrace.resultsH', 300, 140, 900))
  const [timelineHeight, setTimelineHeight] = useState(() => loadSize('gtrace.timelineH', 132, 96, 480))
  useEffect(() => {
    localStorage.setItem('gtrace.explorerW', String(explorerWidth))
  }, [explorerWidth])
  useEffect(() => {
    localStorage.setItem('gtrace.resultsH', String(resultsHeight))
  }, [resultsHeight])
  useEffect(() => {
    localStorage.setItem('gtrace.timelineH', String(timelineHeight))
  }, [timelineHeight])
  const [session, setSession] = useState<SessionState | null>(null)
  /** Timeout de sécurité des sessions breakpoint (minutes). */
  const timeoutMin = 10
  const [xe, setXe] = useState<XeState | null>(null)
  const [xeResult, setXeResult] = useState<XeResult | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [showAiActivity, setShowAiActivity] = useState(false)
  const [showDiagnosis, setShowDiagnosis] = useState(false)
  /** Nouveautés : depuis quelle version montrer les notes (null = fermé). */
  const [whatsNewSince, setWhatsNewSince] = useState<string | null>(null)
  const appVersion = useUpdateStore((s) => s.version)
  // Échap quitte le mode plein écran données (filet de sécurité).
  useEffect(() => {
    if (!focusMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusMode])
  // Abonnement au statut de mise à jour + pop-up Nouveautés une fois par version.
  useEffect(() => {
    const unsub = useUpdateStore.getState().init()
    void window.gtrace.updateGet().then(({ version }) => {
      const last = localStorage.getItem('gtrace.lastSeenVersion')
      if (last && last !== version) setWhatsNewSince(last)
      if (last !== version) localStorage.setItem('gtrace.lastSeenVersion', version)
    })
    return unsub
  }, [])
  /** Bases par connexion (pour le sélecteur de base de la barre d'outils). */
  const [dbCache, setDbCache] = useState<Record<string, DatabaseInfo[]>>({})
  const dbCacheRef = useRef(dbCache)
  dbCacheRef.current = dbCache
  /** Connexions dont la liste des bases est en cours de chargement (dédup). */
  const dbLoadingRef = useRef<Set<string>>(new Set())

  const activeDatabases = activeConn ? dbCache[activeConn.id] : undefined

  const ensureDatabases = useCallback((conn: OpenConnection) => {
    if (dbCacheRef.current[conn.id] || dbLoadingRef.current.has(conn.id)) return
    dbLoadingRef.current.add(conn.id)
    void window.gtrace
      .listDatabases(conn.ref)
      .then((dbs) => setDbCache((p) => ({ ...p, [conn.id]: dbs })))
      .catch(() => undefined)
      .finally(() => dbLoadingRef.current.delete(conn.id))
  }, [])

  useEffect(() => {
    if (activeConn) void ensureDatabases(activeConn)
  }, [activeConn, ensureDatabases])

  // Auto-complétion : charge objets + colonnes de la base active (cache par
  // connexion+base) et alimente le provider Monaco.
  const completionCacheRef = useRef<Record<string, { objects: string[]; columns: string[] }>>({})
  useEffect(() => {
    if (!activeConn || !activeRef) {
      setCompletionSchema([], [])
      return
    }
    const key = `${activeConn.id}/${tabDatabase ?? activeConn.defaultDatabase}`
    const cached = completionCacheRef.current[key]
    if (cached) {
      setCompletionSchema(cached.objects, cached.columns)
      return
    }
    let cancelled = false
    void Promise.all([
      window.gtrace.listObjects(activeRef),
      window.gtrace.listColumnNames(activeRef).catch(() => [] as string[])
    ])
      .then(([objs, columns]) => {
        if (cancelled) return
        const objects = [
          ...objs.tables,
          ...objs.views,
          ...objs.procedures,
          ...objs.functions
        ].map((o) => `${o.schema}.${o.name}`)
        completionCacheRef.current[key] = { objects, columns }
        setCompletionSchema(objects, columns)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeConn, activeRef, tabDatabase])

  // Réfs pour la sauvegarde d'historique depuis les handlers d'événements
  const sqlRef = useRef(sql)
  const instrRef = useRef<InstrumentResult | null>(null)
  const connMetaRef = useRef({ server: '', database: '' })
  sqlRef.current = sql
  instrRef.current = instr
  connMetaRef.current = {
    server: activeConn?.server ?? '',
    database: tabDatabase ?? activeConn?.defaultDatabase ?? ''
  }

  const paramValuesRef = useRef(paramValues)
  paramValuesRef.current = paramValues

  // Sélection courante dans l'éditeur + SQL réellement exécuté (sélection ou tout).
  const selectionRef = useRef<{ text: string; startLine: number; startColumn: number } | null>(null)
  /** Nb de lignes sélectionnées (0 = aucune) — sert à l'affichage du bouton Exécuter. */
  const [selectionLines, setSelectionLines] = useState(0)
  const onEditorSelection = useCallback(
    (sel: { text: string; startLine: number; startColumn: number } | null) => {
      selectionRef.current = sel
      const lines = sel ? sel.text.split('\n').length : 0
      // setState seulement si la valeur change (évite les rendus à chaque frappe).
      setSelectionLines((cur) => (cur === lines ? cur : lines))
    },
    []
  )
  /** SQL du dernier run (sélection éventuelle, sinon tout) — pour historique/diagnostic/export. */
  const execSqlRef = useRef<string | null>(null)

  /**
   * SQL à exécuter : la sélection si non vide, sinon tout le contenu. La
   * sélection est rembourrée de lignes/colonnes vides pour conserver ses
   * numéros de ligne d'origine → erreurs, breakpoints et décorations restent
   * alignés sur le document.
   */
  const getExecutionSql = useCallback((): string => {
    const sel = selectionRef.current
    if (sel && sel.text.trim()) {
      return (
        '\n'.repeat(Math.max(0, sel.startLine - 1)) +
        ' '.repeat(Math.max(0, sel.startColumn - 1)) +
        sel.text
      )
    }
    return useEditorStore.getState().active().content
  }, [])

  const saveHistory = useCallback((run: DebugRunResult) => {
    if (run.steps.length === 0) return
    void window.gtrace
      .historySave({
        title: run.instrument.procedureName ?? instrRef.current?.procedureName ?? 'script',
        server: connMetaRef.current.server,
        database: connMetaRef.current.database,
        sql: execSqlRef.current ?? sqlRef.current,
        paramValues: paramValuesRef.current,
        run
      })
      .then(() => setHistoryVersion((v) => v + 1))
      .catch(() => undefined)
  }, [])

  const parsedSnapshotTargets = useMemo(
    () => snapshotTargets.split(',').map((t) => t.trim()).filter(Boolean),
    [snapshotTargets]
  )
  const parsedRoWhitelist = useMemo(
    () => roWhitelist.split(',').map((t) => t.trim()).filter(Boolean),
    [roWhitelist]
  )

  /** Avertissement avant toute exécution sur une connexion marquée production (spec §9.6). */
  const confirmProduction = useCallback((): boolean => {
    if (!activeConn?.production) return true
    return window.confirm(
      `⚠ La connexion « ${activeConn.label} » est marquée PRODUCTION.\n\n` +
        'Exécuter quand même ? (pensez au mode lecture seule)'
    )
  }, [activeConn])

  const buildDiagnosisInput = useCallback((): HistorySaveInput | null => {
    const currentRun = useReplayStore.getState().run
    if (!currentRun) return null
    return {
      title: currentRun.instrument.procedureName ?? 'script',
      server: connMetaRef.current.server,
      database: connMetaRef.current.database,
      sql: execSqlRef.current ?? sqlRef.current,
      paramValues: paramValuesRef.current,
      run: currentRun
    }
  }, [])

  const onExport = useCallback((format: 'md' | 'json') => {
    const currentRun = useReplayStore.getState().run
    if (!currentRun) return
    void window.gtrace
      .exportSession(
        {
          title: currentRun.instrument.procedureName ?? 'script',
          server: connMetaRef.current.server,
          database: connMetaRef.current.database,
          sql: execSqlRef.current ?? sqlRef.current,
          run: currentRun
        },
        format
      )
      .then((path) => {
        if (path) setNotice(`exporté : ${path}`)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const run = useReplayStore((s) => s.run)
  const currentStep = useReplayStore((s) => s.currentStep)
  const setRun = useReplayStore((s) => s.setRun)

  useEffect(() => {
    window.gtrace.sidecarStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // ─── Restauration de l'espace de travail (au lancement, une fois) ──────────
  useEffect(() => {
    let cancelled = false
    async function restore(): Promise<void> {
      const res = await window.gtrace.workspaceLoad()
      if (cancelled) return
      if (!res.ok) {
        // Lecture échouée (fichier verrouillé/corrompu) : on NE restaure PAS et on
        // laisse la sauvegarde DÉSACTIVÉE pour ne jamais écraser le fichier existant.
        setNotice('Espace de travail illisible — restauration ignorée (fichier préservé).')
        return
      }
      const ws = res.state

      // Réconciliation : ne restaurer que les connexions dont l'enregistrement
      // existe encore (une connexion supprimée entre deux sessions est écartée).
      const saved = await window.gtrace.listConnections().catch(() => [])
      if (cancelled) return
      const savedIds = new Set(saved.map((s) => s.id))
      const savedToUi = new Map<string, string>()
      const conns: OpenConnection[] = ws.connections
        .filter((c) => savedIds.has(c.savedId))
        .map((c) => {
          const uiId = crypto.randomUUID()
          savedToUi.set(c.savedId, uiId)
          return {
            id: uiId,
            // La surcharge de base est restaurée sur la référence → exécution
            // sur la base réellement affichée (pas de divergence UI/exécution).
            ref: c.overrideDatabase
              ? { id: c.savedId, database: c.overrideDatabase }
              : { id: c.savedId },
            label: c.label,
            server: c.server,
            user: c.user,
            version: c.version,
            production: c.production,
            defaultDatabase: c.database
          }
        })
      setAllConnections(conns)

      // Anti-course : ne remplacer les onglets que si l'utilisateur n'a pas déjà
      // commencé à travailler (onglet initial vierge et non modifié).
      const cur = useEditorStore.getState()
      const pristine =
        cur.tabs.length === 1 && !cur.tabs[0].dirty && cur.tabs[0].filePath === null

      if (ws.tabs.length > 0 && pristine) {
        // Relit sur disque le contenu des onglets liés à un fichier et non modifiés,
        // pour ne pas restaurer un instantané périmé (et écraser une version plus récente).
        const tabs: EditorTab[] = await Promise.all(
          ws.tabs.map(async (t) => {
            let content = t.content
            if (t.filePath && !t.dirty) {
              const disk = await window.gtrace.readFile(t.filePath).catch(() => null)
              if (disk !== null) content = disk
            }
            return {
              id: t.id,
              title: t.title,
              filePath: t.filePath,
              content,
              dirty: t.dirty,
              connectionId: t.connectionSavedId ? (savedToUi.get(t.connectionSavedId) ?? null) : null,
              database: t.database,
              compatLevel: t.compatLevel,
              paramValues: t.paramValues ?? {},
              breakpoints: t.breakpoints ?? [],
              snapshotTargets: t.snapshotTargets ?? '',
              readOnly: t.readOnly ?? false,
              roWhitelist: t.roWhitelist ?? ''
            }
          })
        )
        if (!cancelled) useEditorStore.getState().restore(tabs, ws.activeTabId)
      }
    }
    void restore().finally(() => {
      if (!cancelled) setRestored(true)
    })
    return () => {
      cancelled = true
    }
  }, [setAllConnections])

  /** Sérialise l'état courant de l'espace de travail (sans mot de passe). */
  const buildWorkspaceState = useCallback((): WorkspaceState => {
    const st = useEditorStore.getState()
    const conns = useConnectionsStore.getState().connections
    // Seules les connexions référençant une connexion enregistrée sont persistées.
    const restorable = conns.filter((c) => 'id' in c.ref) as (OpenConnection & {
      ref: { id: string; database?: string }
    })[]
    const uiToSaved = new Map(restorable.map((c) => [c.id, c.ref.id]))
    return {
      connections: restorable.map((c) => ({
        savedId: c.ref.id,
        label: c.label,
        server: c.server,
        user: c.user,
        database: c.defaultDatabase,
        overrideDatabase: c.ref.database ?? null,
        production: c.production,
        version: c.version
      })),
      tabs: st.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        filePath: t.filePath,
        content: t.content,
        dirty: t.dirty,
        connectionSavedId: t.connectionId ? (uiToSaved.get(t.connectionId) ?? null) : null,
        database: t.database,
        compatLevel: t.compatLevel,
        paramValues: t.paramValues,
        breakpoints: t.breakpoints,
        snapshotTargets: t.snapshotTargets,
        readOnly: t.readOnly,
        roWhitelist: t.roWhitelist
      })),
      activeTabId: st.activeId
    }
  }, [])

  // Sauvegarde debouncée sur changement (uniquement après une restauration réussie).
  useEffect(() => {
    if (!restored) return
    const timer = setTimeout(() => {
      void window.gtrace.workspaceSave(buildWorkspaceState())
    }, 800)
    return () => clearTimeout(timer)
  }, [restored, tabs, activeId, connections, buildWorkspaceState])

  // Flush à la fermeture : ne pas perdre les <800ms de la dernière modification.
  useEffect(() => {
    const flush = (): void => {
      if (restored) void window.gtrace.workspaceSave(buildWorkspaceState())
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [restored, buildWorkspaceState])

  // Événements de session interactive (breakpoints)
  useEffect(() => {
    return window.gtrace.onDebugEvent((event) => {
      const store = useReplayStore.getState()
      switch (event.type) {
        case 'started':
          store.beginLive(event.sessionId, event.instrument)
          setInstr(event.instrument)
          setSession({ id: event.sessionId, status: 'running', paused: null })
          break
        case 'step':
          store.appendStep(event.step)
          break
        case 'paused':
          setSession((s) =>
            s && s.id === event.sessionId ? { ...s, status: 'paused', paused: event.info } : s
          )
          setTab('variables')
          break
        case 'resumed':
          setSession((s) =>
            s && s.id === event.sessionId ? { ...s, status: 'running', paused: null } : s
          )
          break
        case 'done':
          store.endLive(event.result)
          setSession(null)
          saveHistory(event.result)
          break
        case 'stopped':
          setError(
            event.reason === 'timeout'
              ? 'Timeout de sécurité atteint : exécution annulée et transaction rollbackée.'
              : null
          )
          setSession(null)
          break
        case 'error':
          setError(event.message)
          break
      }
    })
  }, [saveHistory])

  // Événements de profilage XEvents
  useEffect(() => {
    return window.gtrace.onXeEvent((event) => {
      switch (event.type) {
        case 'xe-started':
          setXe({ id: event.profileId, currentLine: null, statements: 0 })
          setXeResult(null)
          break
        case 'xe-progress':
          setXe((x) =>
            x && x.id === event.profileId
              ? { ...x, currentLine: event.currentLine, statements: event.statements }
              : x
          )
          break
        case 'xe-done':
          setXe(null)
          setXeResult({
            stats: event.stats,
            elapsedMs: event.elapsedMs,
            resultsets: event.resultsets,
            errors: event.errors
          })
          setTab('profile')
          break
        case 'xe-error':
          setXe(null)
          setError(event.message)
          break
      }
    })
  }, [])

  // Navigation clavier replay : F10 / Shift+F10 / Ctrl+← / Ctrl+→
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const store = useReplayStore.getState()
      if (!store.run) return
      if (e.key === 'F10') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) store.prev()
        else store.next()
      } else if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        store.first()
      } else if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault()
        store.last()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  /**
   * Verrou UI : on gèle la bascule/ouverture d'onglets ET tout changement de
   * contexte (connexion, base, déconnexion, historique) pendant une session live
   * (breakpoints/profilage) OU une exécution `busy` en cours. Sans le `busy`, un
   * debugRun lent sans breakpoint laissait changer d'onglet et appliquait son
   * résultat au mauvais onglet (historique corrompu, décorations incohérentes).
   */
  const locked = session !== null || xe !== null || busy

  const resetDerived = useCallback(() => {
    setInstr(null)
    setRun(null)
    setXeResult(null)
    setError(null)
    execSqlRef.current = null
  }, [setRun])

  const onSqlChange = useCallback(
    (value: string) => {
      useEditorStore.getState().editContent(value)
      resetDerived()
    },
    [resetDerived]
  )

  // ─── Onglets & fichiers ────────────────────────────────────────────────────
  const switchToTab = useCallback(
    (id: string) => {
      if (locked || id === useEditorStore.getState().activeId) return
      useEditorStore.getState().setActive(id)
      resetDerived()
    },
    [locked, resetDerived]
  )

  const doNew = useCallback(() => {
    if (locked) return
    // Un nouvel onglet hérite de la connexion active (pratique, comme SSMS).
    const st = useEditorStore.getState()
    st.newTab()
    if (activeConn) st.patchActive({ connectionId: activeConn.id })
    resetDerived()
  }, [locked, activeConn, resetDerived])

  const doOpen = useCallback(async () => {
    if (locked) return
    try {
      const files = await window.gtrace.openFiles()
      if (files.length === 0) return
      const st = useEditorStore.getState()
      for (const f of files) {
        st.openFile(f.path, f.name, f.content)
        if (activeConn) st.patchActive({ connectionId: activeConn.id })
      }
      resetDerived()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [locked, activeConn, resetDerived])

  const doSave = useCallback(async (saveAs = false) => {
    const st = useEditorStore.getState()
    const t = st.tabs.find((x) => x.id === st.activeId) ?? st.tabs[0]
    try {
      const res = await window.gtrace.saveFile(saveAs ? null : t.filePath, t.content, t.title)
      if (res) {
        st.markSaved(t.id, res.path, res.name)
        setNotice(`enregistré : ${res.path}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const doCloseTab = useCallback(
    (id: string) => {
      if (locked) return
      const st = useEditorStore.getState()
      const t = st.tabs.find((x) => x.id === id)
      if (
        t?.dirty &&
        !window.confirm(`« ${t.title} » a des modifications non enregistrées. Fermer quand même ?`)
      ) {
        return
      }
      const wasActive = id === st.activeId
      st.closeTab(id)
      if (wasActive) resetDerived()
    },
    [locked, resetDerived]
  )

  // Raccourcis fichier : Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Maj+S / Ctrl+W
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void doSave(e.shiftKey)
      } else if (k === 'o') {
        e.preventDefault()
        void doOpen()
      } else if (k === 'n') {
        e.preventDefault()
        doNew()
      } else if (k === 'w') {
        e.preventDefault()
        doCloseTab(useEditorStore.getState().activeId)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [doSave, doOpen, doNew, doCloseTab])

  // ─── Connexions ────────────────────────────────────────────────────────────
  const onConnected = useCallback(
    (conn: OpenConnection) => {
      addConnection(conn)
      // Lie l'onglet actif à la nouvelle connexion (comme ouvrir une requête dans SSMS).
      useEditorStore.getState().patchActive({ connectionId: conn.id, database: null })
      void ensureDatabases(conn)
      setNotice(`connecté : ${conn.label} — ${conn.version}`)
    },
    [addConnection, ensureDatabases]
  )

  const onDisconnect = useCallback(
    (connectionId: string) => {
      if (locked) return
      removeConnection(connectionId)
      useEditorStore.getState().detachConnection(connectionId)
      setDbCache((prev) => {
        const next = { ...prev }
        delete next[connectionId]
        return next
      })
    },
    [locked, removeConnection]
  )

  const pickConnection = useCallback(
    (connectionId: string) => {
      if (locked) return
      useEditorStore.getState().patchActive({ connectionId: connectionId || null, database: null })
    },
    [locked]
  )

  const pickDatabase = useCallback(
    (database: string) => {
      if (locked) return
      useEditorStore.getState().patchActive({ database: database || null })
    },
    [locked]
  )

  const analyzeText = useCallback(
    async (text: string) => {
      setBusy(true)
      setError(null)
      setRun(null)
      try {
        const result = await window.gtrace.instrument(text, useEditorStore.getState().active().compatLevel)
        setInstr(result)
        setTab('run')
        setStatus((s) => (s ? { ...s, running: true } : s))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setInstr(null)
      } finally {
        setBusy(false)
      }
    },
    [setRun]
  )

  const analyze = useCallback(() => analyzeText(sql), [analyzeText, sql])

  /** Ouvre un script/procédure depuis l'explorateur (lié à sa connexion + base). */
  const onOpenScript = useCallback(
    (s: OpenScript) => {
      if (locked) return
      useEditorStore.getState().openVirtual(s.title, s.sql, s.database, s.connectionId)
      resetDerived()
      if (s.analyze) void analyzeText(s.sql)
    },
    [locked, analyzeText, resetDerived]
  )

  const execute = useCallback(async () => {
    if (!activeRef) {
      setError('Aucune connexion active : cliquez « Connecter » pour choisir un serveur.')
      return
    }
    if (!confirmProduction()) return
    // SQL à exécuter : sélection (rembourrée) sinon tout le contenu (comportement SSMS).
    const execSql = getExecutionSql()
    execSqlRef.current = execSql
    setBusy(true)
    setError(null)
    try {
      if (breakpoints.size === 0) {
        const outcome = await window.gtrace.debugRun({
          connection: activeRef,
          sql: execSql,
          compatLevel,
          paramValues,
          snapshots: parsedSnapshotTargets,
          readOnly,
          readOnlyWhitelist: parsedRoWhitelist
        })
        setInstr(outcome.instrument)
        setRun(outcome)
        // Choix de l'onglet le plus utile : un simple SELECT (resultsets, aucune
        // variable écrite) montre directement les Résultats ; une proc avec des
        // variables montre les Variables ; sinon la vue Exécution.
        const wroteVars = outcome.steps.some((s) => Object.keys(s.variables).length > 0)
        setTab(
          outcome.resultsets.length > 0 && !wroteVars
            ? 'results'
            : outcome.steps.length > 0
              ? 'variables'
              : outcome.resultsets.length > 0
                ? 'results'
                : 'run'
        )
        saveHistory(outcome)
        return
      }

      const control = await window.gtrace.controlStatus(activeRef)
      if (!control.databaseExists || !control.tableExists) {
        const accepted = window.confirm(
          'Les breakpoints nécessitent une base de contrôle « GTraceDB » sur le serveur ' +
            '(une table ControlSignal, rien dans vos bases). La créer maintenant ?'
        )
        if (!accepted) {
          setError('Breakpoints annulés : GTraceDB non créée.')
          return
        }
        await window.gtrace.controlCreate(activeRef)
      }

      // Breakpoints : instrumenter le SQL réellement exécuté (rembourré → lignes alignées).
      const analysis = await window.gtrace.instrument(execSql, compatLevel)
      const indexes = new Set<number>()
      for (const line of breakpoints) {
        const target = analysis.statements.find(
          (s) => s.kind === 'statement' && s.traced && s.startLine >= line
        )
        if (target) indexes.add(target.index)
      }
      if (indexes.size === 0) {
        setError('Aucun breakpoint ne correspond à un statement traçable dans ce qui est exécuté.')
        return
      }

      await window.gtrace.debugStart({
        connection: activeRef,
        sql: execSql,
        compatLevel,
        paramValues,
        snapshots: parsedSnapshotTargets,
        readOnly,
        readOnlyWhitelist: parsedRoWhitelist,
        pause: {
          breakpoints: [...indexes],
          stopOnEntry: false,
          timeoutMs: Math.max(1, timeoutMin) * 60_000
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRun(null)
    } finally {
      setBusy(false)
    }
  }, [
    activeRef,
    getExecutionSql,
    compatLevel,
    paramValues,
    breakpoints,
    timeoutMin,
    parsedSnapshotTargets,
    readOnly,
    parsedRoWhitelist,
    confirmProduction,
    saveHistory,
    setRun
  ])

  const startProfiling = useCallback(async () => {
    if (!activeRef) {
      setError('Aucune connexion active.')
      return
    }
    if (!confirmProduction()) return
    const execSql = getExecutionSql()
    execSqlRef.current = execSql
    setBusy(true)
    setError(null)
    try {
      await window.gtrace.xeStart({
        connection: activeRef,
        sql: execSql,
        compatLevel,
        paramValues,
        timeoutMs: Math.max(1, timeoutMin) * 60_000
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [activeRef, getExecutionSql, compatLevel, paramValues, timeoutMin, confirmProduction])

  // F5 / Ctrl+Entrée : exécuter (raccourcis SSMS). Ignoré si une session tourne.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault()
        if (!busy && !locked) void execute()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [execute, busy, locked])

  /** Rejouer une session passée sans réexécuter (historique) : onglet virtuel + replay. */
  const onLoadHistory = useCallback(
    (entry: HistoryEntry) => {
      if (locked) return
      useEditorStore.getState().openVirtual(entry.title, entry.sql)
      setInstr(entry.run.instrument)
      setRun(entry.run)
      setXeResult(null)
      setError(null)
      setTab('variables')
    },
    [locked, setRun]
  )

  const toggleBreakpoint = useCallback((line: number) => {
    const st = useEditorStore.getState()
    const cur = (st.tabs.find((t) => t.id === st.activeId) ?? st.tabs[0]).breakpoints
    const next = cur.includes(line) ? cur.filter((l) => l !== line) : [...cur, line]
    st.patchActive({ breakpoints: next })
  }, [])

  const decorations = useMemo<LineDecoration[]>(() => {
    const decs: LineDecoration[] = []
    if (instr) {
      for (const s of instr.statements) {
        if (s.kind === 'statement' && !s.traced) {
          decs.push({
            kind: 'warn',
            startLine: s.startLine,
            endLine: s.startLine,
            message: `Non tracé : ${s.skipReason ?? ''}`
          })
        }
      }
      for (const e of instr.errors) {
        decs.push({ kind: 'error', startLine: e.line, endLine: e.line, message: `Erreur ${e.number} : ${e.message}` })
      }
    }
    if (run) {
      for (const e of run.errors) {
        if (e.line !== null) {
          decs.push({ kind: 'error', startLine: e.line, endLine: e.line, message: `Erreur ${e.number} : ${e.message}` })
        }
      }
      const step = run.steps[currentStep]
      if (step && step.startLine > 0) {
        decs.push({
          kind: step.kind === 'catch' ? 'catch' : 'current',
          startLine: step.startLine,
          endLine: step.endLine,
          message: step.error ? `${step.error.number} : ${step.error.message}` : undefined
        })
      }
    }
    if (session?.status === 'paused' && session.paused && session.paused.startLine > 0) {
      decs.push({
        kind: 'current',
        startLine: session.paused.startLine,
        endLine: session.paused.startLine,
        message: 'Prochain statement (en pause)'
      })
    }
    if (xeResult && xeResult.stats.length > 0) {
      const maxUs = Math.max(1, ...xeResult.stats.map((s) => s.totalDurationUs))
      for (const s of xeResult.stats) {
        const ratio = s.totalDurationUs / maxUs
        const kind = ratio >= 0.75 ? 'heat4' : ratio >= 0.5 ? 'heat3' : ratio >= 0.25 ? 'heat2' : 'heat1'
        decs.push({
          kind,
          startLine: s.line,
          endLine: s.line,
          message: `${s.count} exécution(s) — total ${(s.totalDurationUs / 1000).toFixed(1)} ms — max ${(s.maxDurationUs / 1000).toFixed(1)} ms${s.rowCount ? ` — ${s.rowCount} rows` : ''}`
        })
      }
    }
    if (xe?.currentLine) {
      decs.push({ kind: 'current', startLine: xe.currentLine, endLine: xe.currentLine })
    }
    return decs
  }, [instr, run, currentStep, session, xe, xeResult])

  const revealLine =
    xe?.currentLine ??
    (session?.status === 'paused' && session.paused
      ? session.paused.startLine
      : (run?.steps[currentStep]?.startLine ?? null))

  const canRun = activeRef !== null && !busy && !locked

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <button
            className="btn btn-icon"
            onClick={() => setShowExplorer((v) => !v)}
            title="Afficher/masquer l'explorateur"
          >
            ☰
          </button>
          <Wordmark />
        </span>
        <span className="topbar-right">
          <button className="btn btn-ghost" onClick={() => setShowAiActivity(true)} title="Accès IA / MCP">
            🤖 Activité IA
          </button>
          <span className={`sidecar-status ${status?.running ? 'ok' : 'ko'}`}>
            sidecar {status?.running ? `ScriptDom ${status.version ?? '?'}` : 'inactif'}
          </span>
          <button
            className="btn btn-ghost app-version"
            onClick={() => setWhatsNewSince('')}
            title="Voir les nouveautés"
          >
            v{appVersion || '…'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setShowTheme(true)}
            title="Apparence : thèmes (dont SSMS clair), taille du texte, densité"
          >
            🎨 Thème
          </button>
          <button
            className="btn btn-icon"
            onClick={() => useUpdateStore.getState().check()}
            title="Vérifier les mises à jour"
          >
            ⟳
          </button>
        </span>
      </header>
      <UpdateBanner />

      {showConnect && (
        <ConnectDialog onConnected={onConnected} onClose={() => setShowConnect(false)} />
      )}
      {whatsNewSince !== null && (
        <WhatsNew since={whatsNewSince} onClose={() => setWhatsNewSince(null)} />
      )}
      {showTheme && <ThemeDialog onClose={() => setShowTheme(false)} />}
      {showAiActivity && (
        <AiActivityPanel activeConnection={activeConn} onClose={() => setShowAiActivity(false)} />
      )}
      {showDiagnosis && (
        <DiagnosisModal
          activeRef={activeRef}
          buildInput={buildDiagnosisInput}
          onClose={() => setShowDiagnosis(false)}
        />
      )}

      {/* ─── Barre d'outils ─────────────────────────────────────────────── */}
      <div className="toolbar">
        <div className="toolbar-group">
          <select
            className="conn-picker"
            value={activeTab.connectionId ?? ''}
            disabled={locked}
            onChange={(e) => pickConnection(e.target.value)}
            title="Connexion de l'onglet actif"
          >
            <option value="">(non connecté)</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.production ? '⚠ ' : ''}
                {c.label}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => setShowConnect(true)} title="Se connecter à un serveur">
            🔌 Connecter
          </button>
          <select
            className="db-picker"
            value={tabDatabase ?? ''}
            disabled={!activeConn || locked}
            onChange={(e) => pickDatabase(e.target.value)}
            title="Base d'exécution de l'onglet actif"
          >
            <option value="">
              {activeConn ? `${activeConn.defaultDatabase} (défaut)` : '—'}
            </option>
            {activeDatabases
              ?.filter((d) => d.online && d.name !== activeConn?.defaultDatabase)
              .map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
          </select>
          {activeConn?.production && <span className="prod-badge">⚠ PROD</span>}
          {readOnly && <span className="ro-badge">🔒 lecture seule</span>}
        </div>

        <span className="spacer" />

        {session ? (
          <div className="toolbar-group">
            <button
              className="btn btn-primary"
              onClick={() => void window.gtrace.debugContinue(session.id)}
              disabled={session.status !== 'paused'}
              title="Continuer jusqu'au prochain breakpoint"
            >
              ⏵ Continuer
            </button>
            <button
              className="btn"
              onClick={() => void window.gtrace.debugStepOnce(session.id)}
              disabled={session.status !== 'paused'}
              title="Exécuter un statement (pas à pas)"
            >
              ⤵ Step
            </button>
            <button
              className="btn btn-danger"
              onClick={() => void window.gtrace.debugStop(session.id)}
              title="Annuler l'exécution et rollbacker"
            >
              ⏹ Stop
            </button>
          </div>
        ) : (
          <div className="toolbar-group">
            <select
              className="compat-select"
              value={compatLevel}
              onChange={(e) => setCompatLevel(Number(e.target.value))}
              title="Niveau de compatibilité (parsing)"
            >
              <option value={160}>SQL 2022</option>
              <option value={150}>SQL 2019</option>
              <option value={140}>SQL 2017</option>
              <option value={130}>SQL 2016</option>
            </select>
            <button
              className="btn"
              onClick={analyze}
              disabled={busy}
              title="Vérifie la syntaxe et liste les statements et paramètres — SANS rien exécuter sur le serveur."
            >
              {busy ? '…' : '🔍 Analyser'}
            </button>
            {xe ? (
              <button className="btn btn-danger" onClick={() => void window.gtrace.xeStop(xe.id)}>
                ⏹ Stop profil
              </button>
            ) : (
              <button
                className="btn"
                onClick={startProfiling}
                disabled={!canRun}
                title="Exécute tel quel et mesure le temps passé sur chaque ligne, pour trouver les lenteurs (Extended Events, sans instrumentation)."
              >
                ⚡ Profiler
              </button>
            )}
            <button
              className="btn btn-primary btn-run"
              onClick={execute}
              disabled={!canRun}
              title={
                breakpoints.size > 0
                  ? `Exécute pas à pas en s'arrêtant sur ${breakpoints.size} breakpoint(s) (F5)`
                  : selectionLines > 0
                    ? 'Exécute UNIQUEMENT le texte sélectionné (F5)'
                    : "Exécute tout le contenu de l'onglet (F5). Sélectionnez du texte pour n'exécuter que celui-ci."
              }
            >
              {busy
                ? 'Exécution…'
                : breakpoints.size > 0
                  ? `▶ Déboguer (${breakpoints.size})`
                  : selectionLines > 0
                    ? '▶ Exécuter la sélection'
                    : '▶ Exécuter'}
            </button>
          </div>
        )}
      </div>

      {xe && (
        <div className="session-banner running">
          ⚡ Profilage XEvents en cours — {xe.statements} statement(s)
          {xe.currentLine ? ` — ligne courante ${xe.currentLine}` : ''}
        </div>
      )}
      {session && (
        <div className={`session-banner ${session.status}`}>
          {session.status === 'paused' && session.paused ? (
            <>
              ⏸ En pause avant la ligne {session.paused.startLine} — TRANCOUNT{' '}
              {session.paused.tranCount}
              {session.paused.isolationLevel ? ` — ${session.paused.isolationLevel}` : ''}
              {session.paused.lockCount !== null ? ` — ${session.paused.lockCount} lock(s)` : ''}
              {session.paused.tranCount > 0 &&
                ' — ⚠ transaction ouverte : une inspection depuis une autre connexion peut être bloquée (onglet Inspect → READ UNCOMMITTED)'}
            </>
          ) : (
            <>▶ Exécution en cours… (F10 indisponible tant que la session tourne)</>
          )}
        </div>
      )}
      {error && (
        <div className="error-toast" onClick={() => setError(null)} title="Cliquer pour masquer">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="notice-toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <main className="workspace">
        {showExplorer && (
          <>
            <aside className="explorer-pane" style={{ width: explorerWidth }}>
              <ObjectExplorer
                onOpenScript={onOpenScript}
                onConnect={() => setShowConnect(true)}
                onDisconnect={onDisconnect}
                locked={locked}
              />
              <HistoryPanel
                onLoadHistory={onLoadHistory}
                version={historyVersion}
                locked={locked}
              />
            </aside>
            <Splitter
              axis="x"
              onDrag={(d) => setExplorerWidth((w) => clamp(w + d, 190, 640))}
            />
          </>
        )}

        {/* Colonne principale, disposition SSMS : éditeur en haut, résultats en
            bas sur toute la largeur (tables larges lisibles sans scroll latéral). */}
        <section className="main-area">
          {!focusMode && (
            <>
              <section className="editor-pane">
                <TabBar
                  locked={locked}
                  onSwitch={switchToTab}
                  onClose={doCloseTab}
                  onNew={doNew}
                  onOpen={() => void doOpen()}
                  onSave={() => void doSave(false)}
                  onSaveAs={() => void doSave(true)}
                />
                <div className="editor-body">
                  <CodeEditor
                    value={sql}
                    onChange={onSqlChange}
                    decorations={decorations}
                    revealLine={revealLine}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                    onSelectionChange={onEditorSelection}
                  />
                </div>
              </section>

              <Splitter axis="y" onDrag={(d) => setResultsHeight((h) => clamp(h - d, 140, 900))} />
            </>
          )}

          <section
            className={`results-pane${focusMode ? ' maximized' : ''}`}
            style={focusMode ? undefined : { height: resultsHeight }}
          >
          <nav className="tabs">
            <button className={tab === 'run' ? 'active' : ''} onClick={() => setTab('run')}>
              Exécution
            </button>
            <button className={tab === 'variables' ? 'active' : ''} onClick={() => setTab('variables')}>
              Variables
            </button>
            <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>
              Résultats
              {run && run.resultsets.length > 0 && (
                <span className="tab-count">{run.resultsets.length}</span>
              )}
            </button>
            <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
              Données
              {run && run.snapshots.length > 0 && (
                <span className="tab-count">{run.snapshots.length}</span>
              )}
            </button>
            <button className={tab === 'inspect' ? 'active' : ''} onClick={() => setTab('inspect')}>
              Inspect
            </button>
            <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
              Profil
            </button>
            <button
              className={`focus-toggle${focusMode ? ' active' : ''}`}
              onClick={() => setFocusMode((f) => !f)}
              title={
                focusMode
                  ? "Réafficher l'éditeur SQL (Échap)"
                  : "Agrandir les résultats en masquant l'éditeur"
              }
            >
              {focusMode ? '⤡ Réafficher l’éditeur' : '⤢ Agrandir'}
            </button>
          </nav>
          <div className="tab-content">
            {tab === 'run' && (
              <RunPanel
                instr={instr}
                paramValues={paramValues}
                onParamChange={(name, value) => setParamValues((prev) => ({ ...prev, [name]: value }))}
                snapshotTargets={snapshotTargets}
                onSnapshotTargetsChange={setSnapshotTargets}
                readOnly={readOnly}
                onReadOnlyChange={setReadOnly}
                roWhitelist={roWhitelist}
                onRoWhitelistChange={setRoWhitelist}
                onExport={onExport}
                onDiagnose={() => setShowDiagnosis(true)}
              />
            )}
            {tab === 'variables' && <VariablesPanel />}
            {tab === 'results' && <ResultsPanel />}
            {tab === 'data' && <SnapshotsPanel />}
            {tab === 'inspect' && (
              <InspectPanel
                activeRef={activeRef}
                sessionActive={session?.status === 'paused'}
                pauseSeq={session?.paused?.seq ?? null}
              />
            )}
            {tab === 'profile' && (
              <ProfilePanel
                stats={xeResult?.stats ?? null}
                elapsedMs={xeResult?.elapsedMs ?? null}
                resultsets={xeResult?.resultsets ?? []}
                errors={xeResult?.errors ?? []}
              />
            )}
          </div>
          </section>
        </section>
      </main>

      {run && (
        <>
          <Splitter axis="y" onDrag={(d) => setTimelineHeight((h) => clamp(h - d, 96, 480))} />
          <div className="timeline-container" style={{ height: timelineHeight }}>
            <Timeline />
          </div>
        </>
      )}

      <StatusBar
        connection={activeConn}
        database={activeRef?.database ?? activeConn?.defaultDatabase ?? null}
        run={run}
        busy={busy}
        sessionStatus={session?.status ?? null}
        selectionLines={selectionLines}
      />
    </div>
  )
}
