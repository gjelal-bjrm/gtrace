import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToDot,
  Bot,
  Camera,
  Check,
  CircleDot,
  CircleHelp,
  CirclePause,
  ClipboardPaste,
  Copy,
  Database,
  Expand,
  FilePlus,
  FolderOpen,
  Gauge,
  Info,
  LayoutTemplate,
  LoaderCircle,
  Maximize2,
  MessageSquareCode,
  MessageSquareOff,
  MessageSquareText,
  Minimize2,
  Palette,
  PanelBottom,
  PanelLeft,
  Play,
  Plug,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  SaveAll,
  ScanSearch,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Table2,
  TriangleAlert,
  Undo2,
  Variable,
  X,
  type LucideIcon
} from 'lucide-react'
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
import CodeEditor, { type LineDecoration, type LinePasses } from './components/editor/CodeEditor'
import Timeline from './components/timeline/Timeline'
import VariablesPanel from './components/panels/VariablesPanel'
import MessagesPanel from './components/panels/MessagesPanel'
import ResultsPanel from './components/panels/ResultsPanel'
import RunPanel from './components/panels/RunPanel'
import InspectPanel from './components/panels/InspectPanel'
import ProfilePanel from './components/panels/ProfilePanel'
import SnapshotsPanel from './components/panels/SnapshotsPanel'
import CodePeek from './components/panels/CodePeek'
import ObjectExplorer, { type OpenScript } from './components/connections/ObjectExplorer'
import HistoryPanel from './components/connections/HistoryPanel'
import ConnectDialog from './components/connections/ConnectDialog'
import AiActivityPanel from './components/panels/AiActivityPanel'
import DiagnosisModal from './components/panels/DiagnosisModal'
import TabBar from './components/editor/TabBar'
import SaveChangesDialog, { type SaveChoice } from './components/editor/SaveChangesDialog'
import { editorAction, editorPaste } from './components/editor/CodeEditor'
import MenuBar, { type MenuDef } from './components/layout/MenuBar'
import QuickLaunch, { menuCommands } from './components/layout/QuickLaunch'
import { StandardToolbar, SqlToolbar } from './components/layout/Toolbars'
import MainStatusBar from './components/layout/MainStatusBar'
import TooltipLayer from './components/ui/TooltipLayer'
import TreeMenu, { type MenuItem } from './components/connections/TreeMenu'
import { copyText } from './lib/clipboard'
import Breadcrumb from './components/editor/Breadcrumb'
import { breadcrumbFor, deadRanges, executedStatements, lastExecutedUse } from './lib/executionPath'
import { tabLabel } from './lib/tabLabel'
import { buildMessages } from './lib/messages'
import { mapArgsToParams, parseProcCall } from './lib/procCall'
import { isolateProcedureBatch } from './lib/sqlBatches'
import Splitter from './components/layout/Splitter'
import { LogoIcon } from './components/layout/Logo'
import UpdateBanner from './components/layout/UpdateBanner'
import QueryStatusBar from './components/layout/QueryStatusBar'
import ThemeDialog from './components/layout/ThemeDialog'
import HelpDialog from './components/layout/HelpDialog'
import { useAppearanceStore } from './stores/appearanceStore'
import WhatsNew from './components/layout/WhatsNew'
import { useUpdateStore } from './stores/updateStore'
import { setCompletionSchema } from './components/editor/completion'
import { useReplayStore } from './stores/replayStore'

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
/** Barres d'outils affichées (Affichage › Barres d'outils), mémorisées. */
interface ToolbarsVisibility {
  standard: boolean
  sql: boolean
}
function loadToolbars(): ToolbarsVisibility {
  try {
    return { standard: true, sql: true, ...JSON.parse(localStorage.getItem('gtrace.toolbars') ?? '{}') }
  } catch {
    return { standard: true, sql: true }
  }
}
function loadSize(key: string, def: number, min: number, max: number): number {
  const v = Number(localStorage.getItem(key))
  // Reborne à la lecture : une valeur héritée trop petite/grande est corrigée
  // (sinon un ancien redimensionnement peut rendre une zone illisible/rognée).
  return Number.isFinite(v) && v > 0 ? clamp(v, min, max) : def
}
import { useEditorStore } from './stores/editorStore'
import { useConnectionsStore, type OpenConnection } from './stores/connectionsStore'
import { useExplorerStore } from './stores/explorerStore'
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

type Tab = 'run' | 'variables' | 'results' | 'messages' | 'data' | 'inspect' | 'profile'

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
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const [busy, setBusy] = useState(false)
  // Comme SSMS, le volet s'ouvre sur les Résultats.
  const [tab, setTab] = useState<Tab>('results')
  /** Fin de la dernière exécution (ligne « Heure de fin » des Messages). */
  const [runFinishedAt, setRunFinishedAt] = useState<Date | null>(null)
  /** Début de la dernière exécution (chronomètre de la barre d'état). */
  const [runStartedAt, setRunStartedAt] = useState<Date | null>(null)
  /** Dernière exécution arrêtée par l'utilisateur (« Requête annulée. »). */
  const [cancelled, setCancelled] = useState(false)
  /** Position du curseur dans l'éditeur (Ln / Col de la barre d'état). */
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null)
  /** Échec avant tout résultat (syntaxe, connexion…) : affiché dans Messages. */
  const [execError, setExecError] = useState<string | null>(null)
  /** Double-clic sur une erreur → sélection de la ligne dans l'éditeur. */
  const [selectLineReq, setSelectLineReq] = useState<{ line: number; seq: number } | null>(null)
  const goToLine = useCallback(
    (line: number) => setSelectLineReq((p) => ({ line, seq: (p?.seq ?? 0) + 1 })),
    []
  )
  const onCursorChange = useCallback(
    (line: number, column: number) => setCursor({ line, column }),
    []
  )
  /** Ctrl+R : volet de résultats masqué (l'éditeur prend toute la hauteur). */
  const [resultsHidden, setResultsHidden] = useState(false)
  const [showExplorer, setShowExplorer] = useState(true)
  const [toolbars, setToolbars] = useState<ToolbarsVisibility>(loadToolbars)
  useEffect(() => {
    localStorage.setItem('gtrace.toolbars', JSON.stringify(toolbars))
  }, [toolbars])
  const [showConnect, setShowConnect] = useState(false)
  /** Résultats agrandis : masque l'éditeur pour donner toute la place aux données. */
  const [focusMode, setFocusMode] = useState(false)
  const [showTheme, setShowTheme] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  /** Replie les branches jamais atteintes par la derniere execution. */
  const [foldDead, setFoldDead] = useState(false)
  /** Saut ponctuel vers une ligne (fil d'Ariane) — prioritaire sur le replay. */
  const [jumpLine, setJumpLine] = useState<number | null>(null)
  const jumpToLine = useCallback((line: number) => setJumpLine(line), [])
  // Le repli ne survit ni au changement d onglet ni a une nouvelle execution :
  // du code masque herite donne l impression que le fichier est tronque ou
  // que la saisie ne repond plus.
  useEffect(() => {
    setFoldDead(false)
  }, [activeId])
  // Applique le thème enregistré au démarrage (variables CSS sur :root).
  useEffect(() => {
    useAppearanceStore.getState().init()
  }, [])
  // Tailles redimensionnables des zones (mémorisées entre sessions)
  const [explorerWidth, setExplorerWidth] = useState(() => loadSize('gtrace.explorerW', 288, 190, 640))
  /** Hauteur du panneau de résultats (en bas, disposition SSMS). */
  const [resultsHeight, setResultsHeight] = useState(() => loadSize('gtrace.resultsH', 300, 140, 900))
  /** Hauteur du Déroulé quand son journal est affiché (replié, il prend sa hauteur naturelle). */
  const [timelineHeight, setTimelineHeight] = useState(() => loadSize('gtrace.derouleH', 320, 220, 640))
  const [journalOpen, setJournalOpen] = useState(() => localStorage.getItem('gtrace.deroule.journal') !== '0')
  useEffect(() => {
    localStorage.setItem('gtrace.deroule.journal', journalOpen ? '1' : '0')
  }, [journalOpen])
  useEffect(() => {
    localStorage.setItem('gtrace.explorerW', String(explorerWidth))
  }, [explorerWidth])
  useEffect(() => {
    localStorage.setItem('gtrace.resultsH', String(resultsHeight))
  }, [resultsHeight])
  useEffect(() => {
    localStorage.setItem('gtrace.derouleH', String(timelineHeight))
  }, [timelineHeight])
  const [session, setSession] = useState<SessionState | null>(null)
  // Lu par les raccourcis clavier (F5 = Continuer, F10 = Pas à pas pendant une pause).
  const sessionRef = useRef(session)
  sessionRef.current = session
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
      .then((summary) => {
        // Les signets posés sur cette exécution seront enregistrés avec elle.
        const replay = useReplayStore.getState()
        if (replay.run === run) replay.attachHistory(summary.id)
        setHistoryVersion((v) => v + 1)
      })
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
            // La couleur vit avec la connexion enregistrée (connections.json).
            color: saved.find((x) => x.id === c.savedId)?.color ?? null,
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
              roWhitelist: t.roWhitelist ?? '',
              pinned: t.pinned ?? false
            }
          })
        )
        if (!cancelled) useEditorStore.getState().restore(tabs, ws.activeTabId)
      } else if (ws.tabs.length > 0 && !pristine) {
        // On ne détruit jamais un travail commencé, mais on le dit : sans ça,
        // l'utilisateur croit avoir perdu ses fichiers alors qu'ils sont intacts.
        setNotice('Onglets précédents non restaurés : vous aviez déjà commencé à écrire.')
      }

      // Une connexion restaurée mais rattachée à aucun onglet donnait une barre
      // d'outils « non connecté » — on croit la connexion perdue alors qu'elle
      // est bien là. Quand il n'y en a qu'une, on rattache l'onglet actif.
      if (!cancelled && conns.length === 1) {
        const st = useEditorStore.getState()
        const act = st.tabs.find((t) => t.id === st.activeId)
        if (act && !act.connectionId) st.patchActive({ connectionId: conns[0].id })
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
        roWhitelist: t.roWhitelist,
        pinned: t.pinned
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
          store.beginLive(event.sessionId, event.instrument, execSqlRef.current ?? '')
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
          setRunFinishedAt(new Date())
          if (event.result.errors.length > 0) setTab('messages')
          setSession(null)
          saveHistory(event.result)
          break
        case 'stopped':
          setRunFinishedAt(new Date())
          setCancelled(event.reason === 'user')
          if (event.reason === 'user') setTab('messages')
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
      const live = sessionRef.current
      if (e.key === 'F10' && !e.shiftKey && live?.status === 'paused') {
        // Session en pause : F10 exécute l'instruction suivante (comme un débogueur).
        e.preventDefault()
        e.stopPropagation()
        void window.gtrace.debugStepOnce(live.id)
        return
      }
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
    setExecError(null)
    setRunFinishedAt(null)
    setRunStartedAt(null)
    setCancelled(false)
    execSqlRef.current = null
  }, [setRun])

  const onSqlChange = useCallback(
    (value: string) => {
      // Changer d'onglet recharge l'éditeur avec le texte de l'onglet : ce
      // n'est pas une frappe, l'onglet ne doit pas passer « modifié ».
      if (value === useEditorStore.getState().active().content) return
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

  /**
   * Contexte hérité par une nouvelle requête, comme SSMS : l'élément
   * sélectionné dans l'explorateur s'il a le focus, sinon la connexion et la
   * base courante de l'onglet actif.
   */
  const inheritedTarget = useCallback((): { connectionId: string; database: string | null } | null => {
    const { selection, focusArea } = useExplorerStore.getState()
    if (focusArea === 'explorer' && selection && useConnectionsStore.getState().get(selection.connectionId)) {
      return { connectionId: selection.connectionId, database: selection.database }
    }
    if (activeConn) return { connectionId: activeConn.id, database: tabDatabase }
    return null
  }, [activeConn, tabDatabase])

  const doNew = useCallback(() => {
    if (locked) return
    const target = inheritedTarget()
    const st = useEditorStore.getState()
    st.newTab()
    if (target) st.patchActive(target)
    resetDerived()
  }, [locked, inheritedTarget, resetDerived])

  const doOpen = useCallback(async () => {
    if (locked) return
    try {
      const files = await window.gtrace.openFiles()
      if (files.length === 0) return
      // Comme SSMS, un fichier .sql ne mémorise pas sa connexion : il s'ouvre
      // sur le serveur et la base de l'onglet actif au moment de l'ouverture.
      const target = activeConn ? { connectionId: activeConn.id, database: tabDatabase } : null
      const st = useEditorStore.getState()
      for (const f of files) {
        const alreadyOpen = st.tabs.some((t) => t.filePath === f.path)
        st.openFile(f.path, f.name, f.content)
        if (target && !alreadyOpen) st.patchActive(target)
      }
      resetDerived()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [locked, activeConn, tabDatabase, resetDerived])

  /** Enregistre tous les onglets modifiés (demande où pour les nouveaux), comme SSMS. */
  const doSaveAll = useCallback(async () => {
    let saved = 0
    for (const t of useEditorStore.getState().tabs.filter((x) => x.dirty)) {
      try {
        const res = await window.gtrace.saveFile(t.filePath, t.content, t.title)
        if (res) {
          useEditorStore.getState().markSaved(t.id, res.path, res.name)
          saved += 1
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setNotice(saved > 0 ? `${saved} fichier(s) enregistré(s).` : 'Aucune modification à enregistrer.')
  }, [])

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

  /** Dialogue « Voulez-vous enregistrer les modifications… ? » en attente de réponse. */
  const [savePrompt, setSavePrompt] = useState<{
    titles: string[]
    resolve: (choice: SaveChoice) => void
  } | null>(null)
  const askSave = useCallback(
    (titles: string[]) =>
      new Promise<SaveChoice>((resolve) => setSavePrompt({ titles, resolve })),
    []
  )

  /**
   * Ferme des onglets comme SSMS : s'il y a des modifications non
   * enregistrées, une seule question Oui / Non / Annuler pour tous. Oui
   * enregistre (ou demande où pour un nouveau fichier) ; renoncer à un
   * enregistrement annule toute la fermeture.
   */
  const closeTabs = useCallback(
    async (ids: string[]) => {
      if (locked || ids.length === 0) return
      const st = useEditorStore.getState()
      const targets = st.tabs.filter((t) => ids.includes(t.id))
      const dirty = targets.filter((t) => t.dirty)
      if (dirty.length > 0) {
        const choice = await askSave(dirty.map((t) => t.title))
        if (choice === 'cancel') return
        if (choice === 'yes') {
          for (const t of dirty) {
            try {
              const res = await window.gtrace.saveFile(t.filePath, t.content, t.title)
              if (!res) return
              useEditorStore.getState().markSaved(t.id, res.path, res.name)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
              return
            }
          }
        }
      }
      const wasActive = ids.includes(useEditorStore.getState().activeId)
      for (const id of ids) useEditorStore.getState().closeTab(id)
      if (wasActive) resetDerived()
    },
    [locked, askSave, resetDerived]
  )

  const doCloseTab = useCallback((id: string) => void closeTabs([id]), [closeTabs])

  /** Clic droit sur un onglet. */
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  // Raccourcis fichier : Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Maj+S / Ctrl+W / Ctrl+Tab
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        // Ctrl+Maj+S = Enregistrer tout, comme SSMS.
        e.preventDefault()
        if (e.shiftKey) void doSaveAll()
        else void doSave(false)
      } else if (e.key === 'Tab') {
        // Ctrl+Tab / Ctrl+Maj+Tab : onglet suivant / précédent.
        e.preventDefault()
        e.stopPropagation()
        const st = useEditorStore.getState()
        const i = st.tabs.findIndex((t) => t.id === st.activeId)
        const next = st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length]
        if (next) switchToTab(next.id)
      } else if (k === 'o') {
        e.preventDefault()
        void doOpen()
      } else if (k === 'n') {
        e.preventDefault()
        doNew()
      } else if (k === 'w' || e.key === 'F4') {
        // Ctrl+W, ou Ctrl+F4 comme SSMS : fermer l'onglet.
        e.preventDefault()
        doCloseTab(useEditorStore.getState().activeId)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [doSave, doSaveAll, doOpen, doNew, doCloseTab, switchToTab])

  // ─── Connexions ────────────────────────────────────────────────────────────
  const onConnected = useCallback(
    (conn: OpenConnection) => {
      // Pas de doublon : si ce serveur/base est déjà ouvert, on réutilise la
      // connexion existante au lieu d'ajouter une racine identique dans l'arbre.
      const existing = useConnectionsStore.getState().findSame(conn)
      const target = existing ?? conn
      if (!existing) addConnection(conn)
      // Déjà ouverte : la couleur choisie dans le dialogue s'applique quand même.
      else if ((existing.color ?? null) !== (conn.color ?? null)) {
        useConnectionsStore.getState().update(existing.id, { color: conn.color ?? null })
      }
      // Lie l'onglet actif à la connexion (comme ouvrir une requête dans SSMS).
      useEditorStore.getState().patchActive({ connectionId: target.id, database: null })
      void ensureDatabases(target)
      setNotice(
        existing
          ? `déjà connecté à ${target.label} — cet onglet y est rattaché`
          : `connecté : ${target.label} — ${target.version}`
      )
    },
    [addConnection, ensureDatabases]
  )

  // « GTrace.exe --connection <id|nom> » (lancé par GRay) : on ouvre la
  // connexion enregistrée demandée. On attend que l'espace de travail soit
  // restauré, sinon setAll() écraserait la connexion qu'on vient d'ajouter.
  // Le nom est accepté en plus de l'id : les UUID sont locaux à la machine,
  // seul le nom est stable d'un poste à l'autre.
  useEffect(() => {
    if (!restored) return
    return window.gtrace.onOpenConnection(async (idOrName) => {
      try {
        const saved = await window.gtrace.listConnections()
        const match =
          saved.find((c) => c.id === idOrName) ??
          saved.find((c) => c.name.toLowerCase() === idOrName.toLowerCase())
        if (!match) {
          setNotice(`connexion introuvable : ${idOrName}`)
          return
        }
        const ref = { id: match.id }
        const test = await window.gtrace.testConnection(ref)
        if (!test.ok) {
          setNotice(`connexion impossible : ${test.error ?? match.name}`)
          return
        }
        onConnected({
          id: crypto.randomUUID(),
          ref,
          label: match.name,
          server: match.server,
          user: match.user,
          version: test.serverVersion?.split('\n')[0]?.trim() ?? 'SQL Server',
          production: match.production ?? false,
          color: match.color ?? null,
          defaultDatabase: match.database || 'master'
        })
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
      }
    })
  }, [restored, onConnected])

  const onDisconnect = useCallback(
    (connectionId: string) => {
      if (locked) return
      removeConnection(connectionId)
      useEditorStore.getState().detachConnection(connectionId)
      useExplorerStore.getState().forget(connectionId)
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
      const def = useConnectionsStore.getState().get(useEditorStore.getState().active().connectionId)
      const db = database || null
      // La base par défaut reste « null » : l'onglet suit alors la connexion.
      useEditorStore.getState().patchActive({ database: db && db === def?.defaultDatabase ? null : db })
    },
    [locked]
  )

  // Zone qui a le focus (explorateur ou éditeur) : décide de ce dont hérite Ctrl+N.
  useEffect(() => {
    const track = (e: Event): void => {
      const el = e.target as Element | null
      if (!el?.closest) return
      if (el.closest('.object-explorer')) useExplorerStore.getState().setFocusArea('explorer')
      else if (el.closest('.editor-body')) useExplorerStore.getState().setFocusArea('editor')
    }
    window.addEventListener('mousedown', track, true)
    window.addEventListener('focusin', track, true)
    return () => {
      window.removeEventListener('mousedown', track, true)
      window.removeEventListener('focusin', track, true)
    }
  }, [])

  // Ctrl+R : masquer / réafficher le volet de résultats (raccourci SSMS).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        e.stopPropagation()
        setResultsHidden((h) => !h)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Ctrl+U : aller à la liste des bases (raccourci SSMS).
  const dbPickerRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    // Ctrl+K, Ctrl+U (décommenter) finit par Ctrl+U : juste après un Ctrl+K,
    // la touche appartient à l'éditeur, pas à la liste des bases.
    let ctrlKAt = 0
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') ctrlKAt = Date.now()
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {
        if (Date.now() - ctrlKAt < 2000) return
        e.preventDefault()
        e.stopPropagation()
        dbPickerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Titre de la fenêtre = nom complet de l'onglet actif, comme SSMS.
  const activeLabel = tabLabel(activeTab, activeConn)
  useEffect(() => {
    document.title = `${activeLabel.full}${activeTab.dirty ? '*' : ''} - GTrace`
  }, [activeLabel.full, activeTab.dirty])

  const analyzeText = useCallback(
    async (text: string) => {
      setBusy(true)
      setError(null)
      setRun(null)
      try {
        const prepared = isolateProcedureBatch(text)
        const result = await window.gtrace.instrument(prepared.sql, useEditorStore.getState().active().compatLevel)
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
      // « 1000 premières lignes » : exécuté dès que l'onglet est actif (voir plus bas).
      if (s.execute) setPendingRun(useEditorStore.getState().activeId)
    },
    [locked, analyzeText, resetDerived]
  )

  /** « Nouvelle requête » du clic droit : onglet vierge connecté à ce serveur / cette base. */
  const onNewQuery = useCallback(
    (connectionId: string, database: string | null) => {
      if (locked) return
      const st = useEditorStore.getState()
      st.newTab()
      st.patchActive({ connectionId, database })
      resetDerived()
    },
    [locked, resetDerived]
  )

  /** Onglet à exécuter dès qu'il est actif et connecté (script généré + exécuté). */
  const [pendingRun, setPendingRun] = useState<string | null>(null)

  const execute = useCallback(async () => {
    if (!activeRef) {
      // Comme SSMS : exécuter un onglet non connecté ouvre le dialogue de
      // connexion, puis la requête part d'elle-même une fois connecté.
      setPendingRun(useEditorStore.getState().activeId)
      setShowConnect(true)
      return
    }
    if (!confirmProduction()) return
    // SQL à exécuter : sélection (rembourrée) sinon tout le contenu (comportement SSMS).
    const prepared = isolateProcedureBatch(getExecutionSql())
    const execSql = prepared.sql
    execSqlRef.current = execSql
    if (prepared.isolated) {
      setNotice(
        prepared.procedureName
          ? `Script de déploiement détecté : seule ${prepared.procedureName} est instrumentée (blocs DROP/GRANT ignorés).`
          : 'Séparateurs GO neutralisés pour permettre une exécution en un seul lot.'
      )
    }
    setBusy(true)
    setError(null)
    setExecError(null)
    setCancelled(false)
    setRunStartedAt(new Date())
    setRunFinishedAt(null)
    // Comme SSMS : exécuter réaffiche le volet de résultats masqué par Ctrl+R.
    setResultsHidden(false)
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
        setRun(outcome, { source: execSql })
        setRunFinishedAt(new Date())
        // Onglet le plus utile, comme SSMS : une erreur montre les Messages ;
        // un simple SELECT, les Résultats ; une proc qui écrit des variables,
        // les Variables ; une instruction sans résultat (UPDATE…), les Messages.
        const wroteVars = outcome.steps.some((s) => Object.keys(s.variables).length > 0)
        const singleCall =
          outcome.steps.length === 1 &&
          outcome.instrument.statements.find((st) => st.index === outcome.steps[0].statementIndex)
            ?.type === 'ExecuteStatement'
        setTab(
          outcome.errors.length > 0
            ? 'messages'
            : outcome.resultsets.length > 0 && !wroteVars
              ? 'results'
              : wroteVars || singleCall
                ? 'variables'
                : outcome.resultsets.length > 0
                  ? 'results'
                  : 'messages'
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
      // L'échec s'affiche dans Messages, là où SSMS le montre.
      setRun(null)
      setExecError(e instanceof Error ? e.message : String(e))
      setRunFinishedAt(new Date())
      setTab('messages')
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

  useEffect(() => {
    if (!pendingRun || pendingRun !== activeId || !activeRef || busy || locked) return
    setPendingRun(null)
    void execute()
  }, [pendingRun, activeId, activeRef, busy, locked, execute])

  // F5 / Ctrl+Entrée : exécuter (raccourcis SSMS). Ignoré si une session tourne.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (e.key === 'F5' && e.ctrlKey) {
        // Ctrl+F5 : Analyser (vérifier la syntaxe sans exécuter), comme SSMS.
        e.preventDefault()
        e.stopPropagation()
        if (!busy && !locked) void analyze()
      } else if (
        e.key === 'F5' &&
        !e.shiftKey &&
        !e.altKey &&
        useExplorerStore.getState().focusArea === 'explorer'
      ) {
        // F5 dans l'explorateur : actualiser le nœud sélectionné (comme SSMS).
        e.preventDefault()
        e.stopPropagation()
        useExplorerStore.getState().requestRefresh()
      } else if (
        (e.key === 'F5' && !e.shiftKey && !e.altKey) ||
        (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'Enter' || k === 'e'))
      ) {
        // F5 / Ctrl+E (SSMS) / Ctrl+Entrée : exécuter ; pendant une pause, continuer.
        e.preventDefault()
        e.stopPropagation()
        if (session?.status === 'paused') void window.gtrace.debugContinue(session.id)
        else if (!busy && !locked) void execute()
      } else if (e.key === 'Pause' || e.key === 'Cancel') {
        // Alt+Pause (SSMS) : arrêter la session de débogage ou le profilage.
        e.preventDefault()
        if (session) void window.gtrace.debugStop(session.id)
        else if (xe) void window.gtrace.xeStop(xe.id)
      } else if (e.key === 'F1') {
        // stopPropagation : l'éditeur ouvrirait sinon aussi sa propre palette (F1).
        e.preventDefault()
        e.stopPropagation()
        setShowHelp(true)
      } else if (e.key === 'F8' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        // F8 (SSMS) : afficher / masquer l'explorateur d'objets (l'éditeur, lui,
        // y verrait « erreur suivante »).
        e.preventDefault()
        e.stopPropagation()
        setShowExplorer((v) => !v)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [execute, analyze, busy, locked, session, xe])

  /** Rejouer une session passée sans réexécuter (historique) : onglet virtuel + replay. */
  const onLoadHistory = useCallback(
    (entry: HistoryEntry) => {
      if (locked) return
      useEditorStore.getState().openVirtual(entry.title, entry.sql)
      setInstr(entry.run.instrument)
      setRun(entry.run, { source: entry.sql, bookmarks: entry.bookmarks ?? {}, historyId: entry.id })
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

  // F9 : poser / retirer un point d'arrêt sur la ligne du curseur.
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const toggleBreakpointAtCursor = useCallback(() => {
    const line = cursorRef.current?.line
    if (line) toggleBreakpoint(line)
  }, [toggleBreakpoint])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F9' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        toggleBreakpointAtCursor()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggleBreakpointAtCursor])

  /**
   * L'utilisateur a lancé « ma_procedure 1374 » : on va chercher le corps de la
   * procédure en base, on l'ouvre dans un onglet et on reprend les arguments de
   * l'appel comme valeurs de paramètres. Évite de refaire à la main le chemin
   * explorateur → Procédures stockées → 🐞 → ressaisir les paramètres.
   */
  const openCalledProcedure = useCallback(async () => {
    if (!activeRef) return
    const call = parseProcCall(execSqlRef.current ?? sqlRef.current)
    if (!call) {
      setError('Impossible de reconnaître un appel de procédure dans ce script.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const procs = await window.gtrace.listProcs(activeRef)
      const wanted = call.name.toLowerCase()
      const found =
        procs.find((p) => `${p.schema}.${p.name}`.toLowerCase() === wanted) ??
        procs.find((p) => p.name.toLowerCase() === wanted) ??
        procs.find((p) => p.name.toLowerCase() === wanted.split('.').pop())
      if (!found) {
        setError(`Procédure « ${call.name} » introuvable sur ${activeConn?.label ?? 'cette base'}.`)
        return
      }
      const src = await window.gtrace.loadProc(activeRef, found.objectId)
      useEditorStore
        .getState()
        .openVirtual(`${src.schema}.${src.name}`, src.definition, tabDatabase, activeTab.connectionId)
      resetDerived()

      // Analyse immédiate : donne les paramètres, qu'on pré-remplit avec les
      // arguments de l'appel d'origine.
      const analysis = await window.gtrace.instrument(src.definition, compatLevel)
      setInstr(analysis)
      if (analysis.parameters.length > 0 && call.args.length > 0) {
        const values = mapArgsToParams(call.args, analysis.parameters)
        if (Object.keys(values).length > 0) {
          useEditorStore.getState().patchActive({ paramValues: values })
          setNotice(
            `${src.schema}.${src.name} ouverte — paramètres repris de votre appel. Posez un point d'arrêt dans la marge, puis ▶ Déboguer.`
          )
        }
      } else {
        setNotice(`${src.schema}.${src.name} ouverte.`)
      }
      setTab('run')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [activeRef, activeConn, activeTab.connectionId, tabDatabase, compatLevel, resetDerived])

  // Un « USE MaBase » exécuté change la base de l'onglet, comme dans SSMS :
  // la liste des bases et les exécutions suivantes suivent.
  useEffect(() => {
    // run.instrument et non l'état `instr` : celui-ci peut arriver un rendu
    // plus tard (deux stores distincts) et serait encore vide au premier run.
    if (!run || !activeConn) return
    const db = lastExecutedUse(execSqlRef.current ?? sqlRef.current, run.instrument.statements, run)
    if (!db) return
    const known = dbCacheRef.current[activeConn.id]?.find(
      (d) => d.name.toLowerCase() === db.toLowerCase()
    )
    const name = known?.name ?? db
    const next = name === activeConn.defaultDatabase ? null : name
    if (next !== useEditorStore.getState().active().database) {
      useEditorStore.getState().patchActive({ database: next })
    }
    // Volontairement limité au changement de run : changer d'onglet le remet à null.
  }, [run])

  const messages = useMemo(
    () => buildMessages(run, runFinishedAt, execError, cancelled),
    [run, runFinishedAt, execError, cancelled]
  )
  const messageErrors = messages.filter((m) => m.kind === 'error').length

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
      // Marge colorée : ce qui a réellement tourné. Sur une longue procédure,
      // c'est ce qui distingue d'un coup d'œil le chemin pris du code mort.
      if (instr) {
        const done = executedStatements(run)
        for (const s of instr.statements) {
          if (s.kind === 'statement' && done.has(s.index)) {
            decs.push({ kind: 'executed', startLine: s.startLine, endLine: s.endLine })
          }
        }
      }
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

  // Reprendre le replay annule le saut : la ligne courante redevient maîtresse.
  useEffect(() => {
    setJumpLine(null)
  }, [currentStep, session?.status])

  /** Lignes exécutées plusieurs fois (boucles) : étapes de chaque passage. */
  const passesByLine = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const s of run?.steps ?? []) {
      // L'entrée dans un CATCH porte la ligne de l'instruction qui la suit : pas un passage.
      if (s.startLine <= 0 || s.kind === 'catch') continue
      const list = map.get(s.startLine)
      if (list) list.push(s.stepIndex)
      else map.set(s.startLine, [s.stepIndex])
    }
    return map
  }, [run])
  const linePasses = useMemo<LinePasses[]>(() => {
    const out: LinePasses[] = []
    for (const [line, steps] of passesByLine) {
      if (steps.length < 2) continue
      const k = steps.indexOf(currentStep)
      out.push({ line, count: steps.length, current: k >= 0 ? k + 1 : null })
    }
    return out
  }, [passesByLine, currentStep])
  const goToNextPass = useCallback(
    (line: number) => {
      const steps = passesByLine.get(line)
      if (!steps) return
      const replay = useReplayStore.getState()
      replay.select(steps.find((i) => i > replay.currentStep) ?? steps[0])
    },
    [passesByLine]
  )

  const revealLine =
    jumpLine ??
    xe?.currentLine ??
    (session?.status === 'paused' && session.paused
      ? session.paused.startLine
      : (run?.steps[currentStep]?.startLine ?? null))

  const canRun = activeRef !== null && !busy && !locked
  /** Exécuter reste disponible sans connexion : il propose alors de se connecter (SSMS). */
  const canExecute = !busy && !locked

  /** Branches jamais atteintes, repliables à la demande (procédures longues). */
  const hiddenRanges = useMemo(
    () => (foldDead && run && instr ? deadRanges(instr.statements, run) : []),
    [foldDead, run, instr]
  )

  /** Imbrications autour de la ligne courante du replay (fil d'Ariane). */
  const crumbs = useMemo(() => {
    if (!instr) return []
    const line =
      session?.status === 'paused' && session.paused
        ? session.paused.startLine
        : (run?.steps[currentStep]?.startLine ?? 0)
    return line > 0 ? breadcrumbFor(instr.statements, line) : []
  }, [instr, run, currentStep, session])


  const toggleFullScreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  /** Fenêtre › Rétablir la disposition : tailles et panneaux d'origine. */
  const resetLayout = (): void => {
    setExplorerWidth(288)
    setResultsHeight(300)
    setTimelineHeight(320)
    setJournalOpen(true)
    setShowExplorer(true)
    setResultsHidden(false)
    setFocusMode(false)
    setToolbars({ standard: true, sql: true })
  }

  const paused = session?.status === 'paused'
  const running = busy || session?.status === 'running' || xe !== null
  const stopAll = (): void => {
    if (session) void window.gtrace.debugStop(session.id)
    else if (xe) void window.gtrace.xeStop(xe.id)
  }
  const continueSession = (): void => {
    if (session) void window.gtrace.debugContinue(session.id)
  }
  const stepSession = (): void => {
    if (session) void window.gtrace.debugStepOnce(session.id)
  }
  const runLabel = paused
    ? 'Continuer'
    : running
      ? 'Exécution…'
      : breakpoints.size > 0
        ? `Déboguer (${breakpoints.size})`
        : selectionLines > 0
          ? 'Exécuter la sélection'
          : 'Exécuter'
  const runTip = paused
    ? "Continuer jusqu'au prochain point d'arrêt"
    : breakpoints.size > 0
      ? `Exécuter pas à pas en s'arrêtant sur ${breakpoints.size} point(s) d'arrêt`
      : selectionLines > 0
        ? 'Exécuter uniquement le texte sélectionné'
        : "Exécuter tout l'onglet — sélectionnez du texte pour n'exécuter que celui-ci"

  /** Barre de menus façon SSMS : chaque commande à un seul endroit prévisible. */
  const menus: MenuDef[] = [
    {
      label: 'Fichier',
      items: [
        { label: 'Nouvelle requête', icon: FilePlus, shortcut: 'Ctrl+N', disabled: locked, onClick: doNew },
        { label: 'Ouvrir…', icon: FolderOpen, shortcut: 'Ctrl+O', disabled: locked, onClick: () => void doOpen() },
        'sep',
        { label: `Enregistrer ${activeTab.title}`, icon: Save, shortcut: 'Ctrl+S', onClick: () => void doSave(false) },
        { label: `Enregistrer ${activeTab.title} sous…`, onClick: () => void doSave(true) },
        { label: 'Enregistrer tout', icon: SaveAll, shortcut: 'Ctrl+Maj+S', onClick: () => void doSaveAll() },
        'sep',
        { label: 'Fermer', shortcut: 'Ctrl+W', disabled: locked, onClick: () => doCloseTab(activeId) },
        { label: 'Fermer tous les documents', disabled: locked, onClick: () => void closeTabs(tabs.map((t) => t.id)) },
        'sep',
        { label: 'Quitter', shortcut: 'Alt+F4', onClick: () => window.close() }
      ]
    },
    {
      label: 'Édition',
      items: [
        { label: 'Annuler', icon: Undo2, shortcut: 'Ctrl+Z', onClick: () => editorAction('undo') },
        { label: 'Rétablir', icon: Redo2, shortcut: 'Ctrl+Y', onClick: () => editorAction('redo') },
        'sep',
        { label: 'Couper', icon: Scissors, shortcut: 'Ctrl+X', onClick: () => editorAction('editor.action.clipboardCutAction') },
        { label: 'Copier', icon: Copy, shortcut: 'Ctrl+C', onClick: () => editorAction('editor.action.clipboardCopyAction') },
        { label: 'Coller', icon: ClipboardPaste, shortcut: 'Ctrl+V', onClick: () => void editorPaste() },
        { label: 'Sélectionner tout', shortcut: 'Ctrl+A', onClick: () => editorAction('editor.action.selectAll') },
        'sep',
        { label: 'Rechercher', icon: Search, shortcut: 'Ctrl+F', onClick: () => editorAction('actions.find') },
        { label: 'Remplacer', icon: Replace, shortcut: 'Ctrl+H', onClick: () => editorAction('editor.action.startFindReplaceAction') },
        { label: 'Atteindre la ligne…', shortcut: 'Ctrl+G', onClick: () => editorAction('editor.action.gotoLine') },
        'sep',
        { label: 'Commenter les lignes', icon: MessageSquareCode, shortcut: 'Ctrl+K, Ctrl+C', onClick: () => editorAction('editor.action.addCommentLine') },
        { label: 'Décommenter les lignes', icon: MessageSquareOff, shortcut: 'Ctrl+K, Ctrl+U', onClick: () => editorAction('editor.action.removeCommentLine') },
        { label: 'Mettre en majuscules', shortcut: 'Ctrl+Maj+U', onClick: () => editorAction('editor.action.transformToUppercase') },
        { label: 'Mettre en minuscules', shortcut: 'Ctrl+Maj+L', onClick: () => editorAction('editor.action.transformToLowercase') }
      ]
    },
    {
      label: 'Affichage',
      items: [
        { label: "Explorateur d'objets", icon: PanelLeft, shortcut: 'F8', checked: showExplorer, onClick: () => setShowExplorer((v) => !v) },
        { label: 'Volet de résultats', icon: PanelBottom, shortcut: 'Ctrl+R', checked: !resultsHidden, onClick: () => setResultsHidden((h) => !h) },
        { label: 'Agrandir les résultats', icon: Maximize2, checked: focusMode, onClick: () => setFocusMode((f) => !f) },
        {
          label: "Barres d'outils",
          children: [
            { label: 'Standard', checked: toolbars.standard, onClick: () => setToolbars((t) => ({ ...t, standard: !t.standard })) },
            { label: 'Éditeur SQL', checked: toolbars.sql, onClick: () => setToolbars((t) => ({ ...t, sql: !t.sql })) }
          ]
        },
        'sep',
        { label: 'Plein écran', icon: Expand, shortcut: 'F11', onClick: toggleFullScreen },
        { label: 'Apparence…', icon: Palette, onClick: () => setShowTheme(true) }
      ]
    },
    {
      label: 'Requête',
      items: [
        {
          label: paused ? 'Continuer' : breakpoints.size > 0 ? `Déboguer (${breakpoints.size} point(s) d'arrêt)` : selectionLines > 0 ? 'Exécuter la sélection' : 'Exécuter',
          icon: Play,
          shortcut: 'F5',
          bold: true,
          disabled: paused ? false : !canExecute,
          onClick: paused ? continueSession : () => void execute()
        },
        { label: 'Arrêter', icon: Square, shortcut: 'Alt+Pause', disabled: !session && !xe, onClick: stopAll },
        { label: 'Analyser', icon: Check, shortcut: 'Ctrl+F5', disabled: busy || locked, onClick: () => void analyze() },
        { label: 'Profiler (temps par ligne)', icon: Gauge, disabled: !canRun, onClick: () => void startProfiling() },
        'sep',
        { label: 'Pas à pas', icon: ArrowDownToDot, shortcut: 'F10', disabled: !paused, onClick: stepSession },
        { label: "Poser / retirer un point d'arrêt", icon: CircleDot, shortcut: 'F9', onClick: toggleBreakpointAtCursor },
        'sep',
        {
          label: 'Connexion',
          icon: Plug,
          children: [
            { label: 'Connecter…', icon: Plug, onClick: () => setShowConnect(true) },
            {
              label: "Déconnecter l'onglet",
              disabled: !activeConn || locked,
              onClick: () => useEditorStore.getState().patchActive({ connectionId: null, database: null })
            }
          ]
        },
        { label: 'Changer de base', icon: Database, shortcut: 'Ctrl+U', disabled: !activeConn || locked, onClick: () => dbPickerRef.current?.focus() }
      ]
    },
    {
      label: 'Outils',
      items: [
        { label: 'Accès IA / MCP…', icon: Bot, onClick: () => setShowAiActivity(true) },
        { label: 'Diagnostic IA de la dernière exécution…', icon: Sparkles, disabled: !run, onClick: () => setShowDiagnosis(true) },
        'sep',
        { label: 'Apparence (thèmes, taille du texte)…', icon: Palette, onClick: () => setShowTheme(true) },
        { label: 'Rechercher les mises à jour', icon: RefreshCw, onClick: () => useUpdateStore.getState().check() }
      ]
    },
    {
      label: 'Fenêtre',
      items: [
        { label: 'Rétablir la disposition de fenêtre', icon: LayoutTemplate, onClick: resetLayout },
        { label: 'Masquer le volet de résultats', shortcut: 'Ctrl+R', checked: resultsHidden, onClick: () => setResultsHidden((h) => !h) },
        { label: 'Fermer tous les documents', disabled: locked, onClick: () => void closeTabs(tabs.map((t) => t.id)) },
        'sep',
        ...tabs.slice(0, 9).map(
          (t, i): MenuItem => ({
            label: `${i + 1}  ${t.title}${t.dirty ? '*' : ''}`,
            checked: t.id === activeId,
            disabled: locked && t.id !== activeId,
            onClick: () => switchToTab(t.id)
          })
        )
      ]
    },
    {
      label: 'Aide',
      items: [
        { label: 'Aide de GTrace', icon: CircleHelp, shortcut: 'F1', onClick: () => setShowHelp(true) },
        { label: 'Nouveautés', icon: Sparkles, onClick: () => setWhatsNewSince('') },
        'sep',
        {
          label: 'À propos de GTrace',
          icon: Info,
          onClick: () =>
            setNotice(
              `GTrace ${appVersion || '?'} — moteur d'analyse ${status?.running ? `ScriptDom ${status.version ?? '?'}` : 'inactif'}`
            )
        }
      ]
    }
  ]

  const menuTab = tabMenu ? tabs.find((t) => t.id === tabMenu.id) : undefined

  /** Onglet du volet de résultats : petit, aligné à gauche, comme SSMS. */
  const resultTab = (
    id: Tab,
    Icon: LucideIcon,
    label: string,
    tip: string,
    count?: number,
    tone?: 'error'
  ): JSX.Element => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`result-tab${tab === id ? ' active' : ''}${id === 'results' || id === 'messages' ? '' : ' ext'}`}
      onClick={() => setTab(id)}
      data-tip={tip}
    >
      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
      <span className="result-label">{label}</span>
      {count !== undefined && count > 0 && <span className={`result-count${tone ? ` ${tone}` : ''}`}>{count}</span>}
    </button>
  )

  return (
    <div className="app">
      <TooltipLayer />

      {/* ─── Barre de menus + Rechercher une commande (Lancement rapide) ─── */}
      <header className="menubar-row">
        <span className="app-logo" data-tip="GTrace — débogueur T-SQL time-travel">
          <LogoIcon size={18} />
        </span>
        <MenuBar menus={menus} />
        <span className="menubar-spacer" />
        <QuickLaunch commands={menuCommands(menus)} />
      </header>

      {/* ─── Barres d'outils (les deux rangées de SSMS) ─────────────────── */}
      {toolbars.standard && (
        <StandardToolbar
          locked={locked}
          onOpen={() => void doOpen()}
          onSave={() => void doSave(false)}
          onSaveAll={() => void doSaveAll()}
          onNew={doNew}
          explorerVisible={showExplorer}
          onToggleExplorer={() => setShowExplorer((v) => !v)}
          resultsVisible={!resultsHidden}
          onToggleResults={() => setResultsHidden((h) => !h)}
          onAppearance={() => setShowTheme(true)}
          onHelp={() => setShowHelp(true)}
        />
      )}
      {toolbars.sql && (
        <SqlToolbar
          connections={connections}
          activeConn={activeConn}
          locked={locked}
          onConnect={() => setShowConnect(true)}
          onPickConnection={pickConnection}
          onDetach={() => pickConnection('')}
          databases={activeDatabases}
          database={activeConn ? (tabDatabase ?? activeConn.defaultDatabase) : null}
          onPickDatabase={pickDatabase}
          dbPickerRef={dbPickerRef}
          runLabel={runLabel}
          runTip={runTip}
          canRun={paused || canExecute}
          running={running && !paused}
          onRun={paused ? continueSession : () => void execute()}
          canStop={session !== null || xe !== null}
          onStop={stopAll}
          onAnalyze={() => void analyze()}
          canStep={paused}
          onStep={stepSession}
          onToggleBreakpoint={toggleBreakpointAtCursor}
          canProfile={canRun}
          onProfile={() => void startProfiling()}
          readOnly={readOnly}
          compatLevel={compatLevel}
          onCompat={setCompatLevel}
        />
      )}
      <UpdateBanner />

      {showConnect && (
        <ConnectDialog
          onConnected={onConnected}
          onClose={() => {
            setShowConnect(false)
            // Dialogue annulé : l'exécution en attente est abandonnée.
            if (!useEditorStore.getState().active().connectionId) setPendingRun(null)
          }}
        />
      )}
      {whatsNewSince !== null && (
        <WhatsNew since={whatsNewSince} onClose={() => setWhatsNewSince(null)} />
      )}
      {showTheme && <ThemeDialog onClose={() => setShowTheme(false)} />}
      {savePrompt && (
        <SaveChangesDialog
          titles={savePrompt.titles}
          onChoice={(choice) => {
            savePrompt.resolve(choice)
            setSavePrompt(null)
          }}
        />
      )}
      {tabMenu && menuTab && (
        <TreeMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            {
              label: `Enregistrer ${menuTab.title}`,
              icon: Save,
              shortcut: 'Ctrl+S',
              onClick: () => {
                switchToTab(menuTab.id)
                void doSave(false)
              }
            },
            { label: 'Fermer', shortcut: 'Ctrl+W', disabled: locked, onClick: () => doCloseTab(menuTab.id) },
            { label: 'Fermer tous les documents', disabled: locked, onClick: () => void closeTabs(tabs.map((t) => t.id)) },
            {
              label: 'Fermer tout sauf cet élément',
              disabled: locked,
              onClick: () => void closeTabs(tabs.filter((t) => t.id !== menuTab.id).map((t) => t.id))
            },
            {
              label: 'Tout fermer, sauf ceux épinglés',
              disabled: locked,
              onClick: () => void closeTabs(tabs.filter((t) => !t.pinned).map((t) => t.id))
            },
            'sep',
            {
              label: "Copier le chemin d'accès complet",
              icon: Copy,
              disabled: !menuTab.filePath,
              onClick: () => void copyText(menuTab.filePath ?? '').then(() => setNotice('Chemin copié.'))
            },
            {
              label: 'Ouvrir le dossier contenant',
              icon: FolderOpen,
              disabled: !menuTab.filePath,
              onClick: () => menuTab.filePath && void window.gtrace.revealFile(menuTab.filePath)
            },
            'sep',
            {
              label: menuTab.pinned ? "Désépingler l'onglet" : "Épingler l'onglet",
              onClick: () => useEditorStore.getState().togglePin(menuTab.id)
            }
          ]}
        />
      )}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
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

      <main className="workspace">
        {/* ─── Panneaux ancrés à gauche (Explorateur d'objets, comme SSMS) ── */}
        {showExplorer && (
          <>
            <aside className="dock-left" style={{ width: explorerWidth }}>
              <ObjectExplorer
                onOpenScript={onOpenScript}
                onConnect={() => setShowConnect(true)}
                onDisconnect={onDisconnect}
                onNewQuery={onNewQuery}
                onNotice={setNotice}
                onHide={() => setShowExplorer(false)}
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

        {/* ─── Zone des documents : onglets, éditeur, résultats, barre de requête ── */}
        <section className="document-area">
          <TabBar
            locked={locked}
            onSwitch={switchToTab}
            runningTabId={running ? activeId : null}
            onClose={doCloseTab}
            onTabMenu={(id, x, y) => setTabMenu({ id, x, y })}
          />
          <div className={`busy-bar${running && !paused ? ' active' : ''}`} aria-hidden="true" />

          {/* Bandeau d'information (débogage en pause, exécution, profilage). */}
          {xe && (
            <div className="infobar running">
              <Gauge size={15} aria-hidden="true" />
              <span className="infobar-text">
                Profilage en cours — {xe.statements} instruction(s)
                {xe.currentLine ? ` — ligne ${xe.currentLine}` : ''}
              </span>
              <button type="button" className="btn btn-sm btn-danger" onClick={stopAll}>
                <Square size={12} aria-hidden="true" /> Arrêter le profil
              </button>
            </div>
          )}
          {session && (
            <div className={`infobar ${session.status}`}>
              {session.status === 'paused' && session.paused ? (
                <>
                  <CirclePause size={15} aria-hidden="true" />
                  <span className="infobar-text">
                    En pause avant la ligne <strong>{session.paused.startLine}</strong>
                    <span className="infobar-meta">
                      TRANCOUNT {session.paused.tranCount}
                      {session.paused.isolationLevel ? ` · ${session.paused.isolationLevel}` : ''}
                      {session.paused.lockCount !== null ? ` · ${session.paused.lockCount} verrou(s)` : ''}
                    </span>
                    {session.paused.tranCount > 0 && (
                      <span className="infobar-warn">
                        <TriangleAlert size={13} aria-hidden="true" /> transaction ouverte : une
                        inspection depuis une autre connexion peut être bloquée (Inspect → READ UNCOMMITTED)
                      </span>
                    )}
                  </span>
                  <span className="infobar-actions">
                    <button type="button" className="btn btn-sm btn-run" onClick={continueSession} data-tip="Continuer" data-shortcut="F5">
                      <Play size={12} fill="currentColor" aria-hidden="true" /> Continuer
                    </button>
                    <button type="button" className="btn btn-sm" onClick={stepSession} data-tip="Pas à pas" data-shortcut="F10">
                      <ArrowDownToDot size={13} aria-hidden="true" /> Pas à pas
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={stopAll} data-tip="Arrêter et annuler (rollback)" data-shortcut="Alt+Pause">
                      <Square size={12} aria-hidden="true" /> Arrêter
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                  <span className="infobar-text">Exécution en cours… elle s&apos;arrêtera au prochain point d&apos;arrêt.</span>
                  <span className="infobar-actions">
                    <button type="button" className="btn btn-sm btn-danger" onClick={stopAll}>
                      <Square size={12} aria-hidden="true" /> Arrêter
                    </button>
                  </span>
                </>
              )}
            </div>
          )}

          {!focusMode && (
            <>
              <section className="editor-pane">
                {run && (
                  <div className="editor-strip">
                    <Breadcrumb crumbs={crumbs} onJump={jumpToLine} />
                    <span className="spacer" />
                    <button
                      className={`btn btn-sm fold-toggle${foldDead ? ' active' : ''}`}
                      onClick={() => setFoldDead((v) => !v)}
                      title={
                        foldDead
                          ? 'Réafficher tout le code'
                          : "Masquer les branches jamais atteintes par cette exécution — ne reste que le chemin réellement pris"
                      }
                    >
                      {foldDead
                        ? `⊞ Tout afficher (${hiddenRanges.reduce((n, r) => n + (r.end - r.start + 1), 0)} lignes masquées)`
                        : '⊟ Masquer le code non exécuté'}
                    </button>
                  </div>
                )}
                <div className="editor-body">
                  <CodeEditor
                    value={sql}
                    onChange={onSqlChange}
                    decorations={decorations}
                    passes={linePasses}
                    onPassClick={goToNextPass}
                    revealLine={revealLine}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                    hiddenRanges={hiddenRanges}
                    onSelectionChange={onEditorSelection}
                    selectLine={selectLineReq}
                    onCursorChange={onCursorChange}
                  />
                </div>
              </section>

              {!resultsHidden && (
                <Splitter axis="y" onDrag={(d) => setResultsHeight((h) => clamp(h - d, 140, 900))} />
              )}
            </>
          )}

          <section
            hidden={resultsHidden && !focusMode}
            className={`results-pane${focusMode ? ' maximized' : ''}`}
            style={focusMode ? undefined : { height: resultsHeight }}
          >
            {/* Éditeur masqué : on garde un repère sur l'endroit du code où
                l'on se trouve, sinon naviguer dans la chronologie devient aveugle. */}
            {focusMode && revealLine !== null && revealLine > 0 && (
              <CodePeek sql={sql} line={revealLine} />
            )}
            <div className="results-header" role="tablist">
              {resultTab('results', Table2, 'Résultats', 'Les jeux de données renvoyés par vos SELECT', run?.resultsets.length)}
              {resultTab('messages', MessageSquareText, 'Messages', 'Messages du serveur : lignes affectées, erreurs (double-clic → ligne fautive), heure de fin', messageErrors, 'error')}
              <span className="results-sep" aria-hidden="true" />
              {resultTab('run', SlidersHorizontal, 'Paramètres', 'Paramètres de la procédure, options (lecture seule, tables suivies), export et diagnostic')}
              {resultTab('variables', Variable, 'Variables', "Valeur de toutes les variables à l'étape sélectionnée dans la chronologie")}
              {resultTab('data', Camera, 'Données', 'Contenu des tables suivies après chaque écriture, avec le différentiel — même sans SELECT et malgré un ROLLBACK', run?.snapshots.length)}
              {resultTab('inspect', ScanSearch, 'Inspect', 'Vos propres requêtes, réévaluées à chaque pause du débogage')}
              {resultTab('profile', Gauge, 'Profil', 'Temps passé par ligne — se remplit après « Profiler »')}
              <span className="results-spacer" />
              <button
                type="button"
                className={`results-action${focusMode ? ' active' : ''}`}
                onClick={() => setFocusMode((f) => !f)}
                data-tip={focusMode ? "Réafficher l'éditeur SQL" : "Agrandir les résultats en masquant l'éditeur"}
                data-shortcut={focusMode ? 'Échap' : undefined}
              >
                {focusMode ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
                <span className="results-action-label">{focusMode ? 'Réafficher l’éditeur' : 'Agrandir'}</span>
              </button>
              {!focusMode && (
                <button
                  type="button"
                  className="results-action icon"
                  onClick={() => setResultsHidden(true)}
                  data-tip="Masquer le volet de résultats"
                  data-shortcut="Ctrl+R"
                  aria-label="Masquer le volet de résultats"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
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
              {tab === 'variables' && (
                <VariablesPanel onOpenProcedure={() => void openCalledProcedure()} />
              )}
              {tab === 'results' && <ResultsPanel />}
              {tab === 'messages' && <MessagesPanel messages={messages} onGoToLine={goToLine} />}
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

          {/* Pas de Déroulé vide (pause avant la première instruction). Journal
              replié : le panneau prend sa hauteur naturelle, sans poignée. */}
          {run && run.steps.length > 0 && (
            <>
              {journalOpen && (
                <Splitter axis="y" onDrag={(d) => setTimelineHeight((h) => clamp(h - d, 220, 640))} />
              )}
              <div
                className={`timeline-container${journalOpen ? '' : ' collapsed'}`}
                style={journalOpen ? { height: timelineHeight } : undefined}
              >
                <Timeline journalOpen={journalOpen} onToggleJournal={() => setJournalOpen((o) => !o)} />
              </div>
            </>
          )}

          <QueryStatusBar
            connection={activeConn}
            database={activeRef?.database ?? activeConn?.defaultDatabase ?? null}
            run={run}
            running={running && !paused}
            paused={paused ? (session?.paused?.startLine ?? 0) : null}
            failed={execError !== null}
            cancelled={cancelled}
            startedAt={runStartedAt}
            finishedAt={runFinishedAt}
          />
        </section>
      </main>

      <MainStatusBar
        busy={running && !paused}
        cursor={cursor}
        selectionLines={selectionLines}
        engineRunning={status?.running ?? false}
        engineVersion={status?.version ?? null}
        appVersion={appVersion}
        onVersionClick={() => setWhatsNewSince('')}
      />

      {/* Messages flottants : les erreurs restent jusqu'à fermeture, les infos s'effacent seules. */}
      <div className="toast-stack" aria-live="polite">
        {error && (
          <div className="toast error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span className="toast-text">{error}</span>
            <button type="button" className="toast-close" onClick={() => setError(null)} aria-label="Fermer">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast info" key={notice}>
            <Info size={16} aria-hidden="true" />
            <span className="toast-text">{notice}</span>
            <button type="button" className="toast-close" onClick={() => setNotice(null)} aria-label="Fermer">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
