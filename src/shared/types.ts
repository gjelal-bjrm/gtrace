/**
 * Types partagés entre main process et renderer.
 * Phase 0 : parsing sidecar uniquement. Les types Phase 1+ (TraceStep, StepDetail,
 * ProcSource, ConnectionConfig…) seront ajoutés avec les features correspondantes.
 */

export interface StatementInfo {
  index: number
  type: string
  /** Profondeur d'imbrication (BEGIN/END, IF, WHILE, TRY/CATCH…) */
  depth: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  declaredVariables: string[]
  referencedVariables: string[]
}

export interface VariableInfo {
  name: string
  type: string
  declaredAtLine: number
}

export interface ParseErrorInfo {
  number: number
  line: number
  column: number
  message: string
}

export interface ParseResult {
  statements: StatementInfo[]
  variables: VariableInfo[]
  errors: ParseErrorInfo[]
}

export interface SidecarStatus {
  running: boolean
  version: string | null
  exePath: string
}

export interface InstrumentedStatement {
  index: number
  type: string
  kind: 'statement' | 'container' | 'catchEntry'
  depth: number
  /** Lignes dans le source ORIGINAL (le script instrumenté garde les mêmes lignes) */
  startLine: number
  endLine: number
  traced: boolean
  skipReason: string | null
}

export interface ProcParameter {
  name: string
  type: string
  isOutput: boolean
  hasDefault: boolean
  defaultText: string | null
}

export interface InstrumentResult {
  script: string
  procedureName: string | null
  /** Déclaration prête pour sp_executesql, ex. "@Id int, @Total decimal(18,2) OUTPUT" */
  paramsDeclaration: string | null
  parameters: ProcParameter[]
  statements: InstrumentedStatement[]
  errors: ParseErrorInfo[]
}

// ─── Exécution / replay (Phase 1) ────────────────────────────────────────────

export interface ConnectionConfig {
  server: string
  port?: number
  database: string
  user: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}

export interface TestResult {
  ok: boolean
  serverVersion?: string
  error?: string
}

/** Connexion sauvegardée — le mot de passe reste chiffré côté main (safeStorage/DPAPI). */
export interface SavedConnection {
  id: string
  name: string
  server: string
  port?: number
  database: string
  user: string
  hasPassword: boolean
  /** Connexion marquée « production » par l'utilisateur (avertissement avant exécution) */
  production?: boolean
}

export interface SaveConnectionInput {
  /** Fourni pour mettre à jour une connexion existante */
  id?: string
  name: string
  production?: boolean
  config: ConnectionConfig
}

/**
 * Référence de connexion : id sauvegardé (résolu côté main) ou config inline.
 * `database` surcharge la base cible (sélecteur par onglet, comme SSMS) —
 * appliquée à la résolution, donc respectée par toutes les opérations.
 */
export type ConnectionRef = ({ id: string } | { config: ConnectionConfig }) & {
  database?: string
}

export interface DatabaseInfo {
  name: string
  online: boolean
  /** Base système (master, msdb…) — affichée à part, comme dans SSMS */
  system: boolean
}

/** Objet d'une base (explorateur d'objets type SSMS). */
export interface DbObjectInfo {
  objectId: number
  schema: string
  name: string
  modifiedAt: string
}

export interface DbObjects {
  tables: DbObjectInfo[]
  views: DbObjectInfo[]
  procedures: DbObjectInfo[]
  functions: DbObjectInfo[]
}

export interface ColumnInfo {
  name: string
  /** Type affichable, ex. "nvarchar(100)", "decimal(18,2)" */
  dataType: string
  isNullable: boolean
  isIdentity: boolean
  isPrimaryKey: boolean
}

export interface ProcSummary {
  objectId: number
  schema: string
  name: string
  modifiedAt: string
}

export interface ProcSource {
  objectId: number
  schema: string
  name: string
  definition: string
}

export interface StepError {
  number: number
  message: string
  /** Ligne dans le source ORIGINAL (les lignes sont préservées par l'instrumentation) */
  line: number | null
  severity?: number
  state?: number
}

export interface TraceStep {
  stepIndex: number
  /** ↔ table de correspondance de l'instrumentation */
  statementIndex: number
  kind: 'step' | 'catch' | 'output'
  startLine: number
  endLine: number
  /** @@ROWCOUNT du statement tracé */
  rowCount: number | null
  /** SYSDATETIME() serveur au point de trace (ISO) */
  executedAt: string | null
  durationMs: number | null
  /** Variables écrites par le statement (nom → valeur) */
  variables: Record<string, unknown>
  returnValue: unknown
  error: StepError | null
  /** Resultsets métier produits par ce statement */
  resultsetIndexes: number[]
}

export interface ResultSetData {
  index: number
  columns: string[]
  rows: unknown[][]
  stepIndex: number | null
}

export interface DebugRequest {
  connection: ConnectionRef
  sql: string
  compatLevel?: number
  /** Valeurs des paramètres de la procédure (texte brut saisi dans l'UI, null = NULL) */
  paramValues?: Record<string, string | null>
  /** Tables (#temp, @tablevar, tables réelles) à snapshotter après chaque écriture */
  snapshots?: string[]
  /** Mode lecture seule strict : refus si écritures hors #temp/@tablevar/liste blanche */
  readOnly?: boolean
  /** Tables/procs autorisées en écriture malgré le mode lecture seule */
  readOnlyWhitelist?: string[]
}

export interface ValidateViolation {
  line: number
  type: string
  target: string
}

export interface ValidateResult {
  violations: ValidateViolation[]
  errors: ParseErrorInfo[]
}

/** Contenu d'une table capturé juste après un statement qui l'a modifiée. */
export interface TableSnapshot {
  index: number
  table: string
  /** Step (exécution) juste après lequel le snapshot a été pris */
  stepIndex: number
  statementIndex: number
  columns: string[]
  rows: unknown[][]
}

// ─── Breakpoints simulés (Phase 2) ───────────────────────────────────────────

export interface PauseRequestOptions {
  sessionId: string
  /** Indexes de statements (table de correspondance) porteurs d'un breakpoint */
  breakpoints: number[]
  controlTable: string
}

export interface BreakpointRunOptions {
  /** Indexes de statements avec breakpoint */
  breakpoints: number[]
  /** Pause sur le premier statement même sans breakpoint */
  stopOnEntry: boolean
  /** Timeout de sécurité : au-delà, annulation + ROLLBACK automatique */
  timeoutMs: number
}

export interface DebugStartRequest extends DebugRequest {
  pause: BreakpointRunOptions
}

export interface PausedInfo {
  seq: number
  statementIndex: number
  startLine: number
  tranCount: number
  isolationLevel: string | null
  lockCount: number | null
}

export type DebugSessionEvent =
  | { type: 'started'; sessionId: string; instrument: InstrumentResult }
  | { type: 'step'; sessionId: string; step: TraceStep }
  | { type: 'paused'; sessionId: string; info: PausedInfo }
  | { type: 'resumed'; sessionId: string }
  | { type: 'done'; sessionId: string; result: DebugRunResult }
  | { type: 'stopped'; sessionId: string; reason: 'user' | 'timeout' }
  | { type: 'error'; sessionId: string; message: string }

export interface ControlStatus {
  databaseExists: boolean
  tableExists: boolean
}

// ─── Extended Events (Phase 3, profilage passif) ─────────────────────────────

export interface XeStartRequest {
  connection: ConnectionRef
  sql: string
  compatLevel?: number
  paramValues?: Record<string, string | null>
  /** Garde-fou : annulation au-delà (défaut 10 min) */
  timeoutMs?: number
}

/** Statistiques agrégées par ligne du source (heatmap de lenteur). */
export interface XeLineStat {
  line: number
  /** Nombre d'exécutions du/des statement(s) de cette ligne */
  count: number
  totalDurationUs: number
  maxDurationUs: number
  /** Dernier row_count observé */
  rowCount: number
}

export type XEventsEvent =
  | { type: 'xe-started'; profileId: string; mode: 'proc' | 'batch' }
  | { type: 'xe-progress'; profileId: string; currentLine: number | null; statements: number }
  | {
      type: 'xe-done'
      profileId: string
      stats: XeLineStat[]
      resultsets: ResultSetData[]
      errors: StepError[]
      /** Durée totale de l'exécution profilée (ms, côté client) */
      elapsedMs: number
    }
  | { type: 'xe-error'; profileId: string; message: string }

// ─── Résultat d'exécution ────────────────────────────────────────────────────

export interface DebugRunResult {
  sessionId: string
  instrument: InstrumentResult
  steps: TraceStep[]
  resultsets: ResultSetData[]
  /** Valeurs finales des paramètres OUTPUT */
  outputValues: Record<string, unknown>
  /** Erreurs SQL remontées par le driver (RAISERROR non catché, erreurs fatales…) */
  errors: StepError[]
  /** Snapshots de tables capturés aux points d'écriture (Phase 4) */
  snapshots: TableSnapshot[]
}

// ─── Historique des sessions (Phase 4) ───────────────────────────────────────

export interface HistoryEntrySummary {
  id: string
  savedAt: string
  title: string
  server: string
  database: string
  stepCount: number
  /** Erreurs SQL + steps CATCH : une session « en erreur » pour le tri/diagnostic */
  errorCount: number
}

export interface HistoryEntry extends HistoryEntrySummary {
  sql: string
  /** Valeurs d'entrée des paramètres au lancement (diagnostic) */
  paramValues?: Record<string, string | null>
  run: DebugRunResult
}

export interface HistorySaveInput {
  title: string
  server: string
  database: string
  sql: string
  paramValues?: Record<string, string | null>
  run: DebugRunResult
}

// ─── Persistance de l'espace de travail (onglets + connexions ouvertes) ──────

/**
 * Connexion ouverte persistée. Référence UNIQUEMENT une connexion enregistrée
 * (savedId) dont le mot de passe est chiffré par safeStorage — jamais de mot de
 * passe en clair sur disque. Les connexions inline (saisie manuelle non
 * enregistrée) ne sont pas persistées.
 */
export interface PersistedConnection {
  savedId: string
  label: string
  server: string
  user: string
  database: string
  /** Surcharge de base portée par la référence ({id, database}) — restaurée telle quelle */
  overrideDatabase: string | null
  production: boolean
  version: string
}

/** Onglet d'édition persisté (contenu inclus, pour retrouver le travail en cours). */
export interface PersistedTab {
  id: string
  title: string
  filePath: string | null
  content: string
  dirty: boolean
  /** savedId de la connexion liée (null si aucune / non restaurable) */
  connectionSavedId: string | null
  database: string | null
  compatLevel: number
  paramValues: Record<string, string | null>
  breakpoints: number[]
  snapshotTargets: string
  readOnly: boolean
  roWhitelist: string
}

export interface WorkspaceState {
  connections: PersistedConnection[]
  tabs: PersistedTab[]
  activeTabId: string | null
}

/**
 * Résultat de chargement du workspace. `ok=false` = lecture/JSON en échec
 * (fichier verrouillé/corrompu) : le renderer NE DOIT PAS écraser le fichier
 * (sinon perte définitive). `ok=true` avec state vide = fichier absent/vide légitime.
 */
export interface WorkspaceLoadResult {
  state: WorkspaceState
  ok: boolean
}

// ─── Accès IA / MCP (Phase 6) ─────────────────────────────────────────────────

/** Connexion explicitement exposée à l'accès MCP lecture seule (opt-in, spec §3.4.3). */
export interface McpConnection {
  /** connectionId opaque référencé par les outils MCP */
  id: string
  label: string
  server: string
  port?: number
  database: string
  user: string
  /** Motifs de colonnes à masquer avant sortie MCP (ex. "email", "iban") */
  maskPatterns: string[]
  /** Autorise run_debug_session / la CLI headless sans confirmation (spec §4) */
  allowUnattendedRuns: boolean
}

export interface McpGrantInput {
  /** Connexion sauvegardée à exposer (le mot de passe est résolu côté main) */
  savedConnectionId?: string
  label: string
  /** Config inline (si pas de connexion sauvegardée) */
  config?: ConnectionConfig
  maskPatterns?: string[]
  allowUnattendedRuns?: boolean
}

// ─── IA embarquée (Phase 6.4) ────────────────────────────────────────────────

export interface AiConfig {
  backend: 'ollama' | 'anthropic'
  ollamaUrl: string
  ollamaModel: string
  anthropicModel: string
  hasAnthropicKey: boolean
}

export interface AiConfigPatch {
  backend?: 'ollama' | 'anthropic'
  ollamaUrl?: string
  ollamaModel?: string
  anthropicModel?: string
  /** Fournie une fois, stockée chiffrée (DPAPI), jamais renvoyée au renderer */
  anthropicKey?: string
}

export interface AiDiagnosis {
  text: string
  backend: string
  model: string
}

export interface McpAuditEntry {
  at: string
  tool: string
  connectionId?: string
  /** Requête SQL éventuelle (run_readonly_query) */
  sql?: string
  /** Nombre de lignes retournées, ou -1 si rejeté */
  rows: number
  ok: boolean
  message?: string
}
