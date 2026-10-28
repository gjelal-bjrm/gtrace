import type { DebugRunResult, InstrumentedStatement, StepError, TraceStep } from '@shared/types'
import { formatSqlValue } from '../stores/replayStore'

/**
 * Modèle du « Déroulé de l'exécution » : traduit les étapes brutes d'une
 * exécution tracée en informations qu'on lit sans connaître GTrace — famille
 * d'instruction, code tel qu'il est écrit, effet en clair (« @total : 450,00 →
 * 495,50 », « 3 lignes modifiées ») — et regroupe les tours de boucle.
 *
 * Fonctions pures, recalculées seulement quand l'exécution change.
 */

/** Famille d'instruction : sert à la couleur, aux filtres et au badge du journal. */
export type StepCategory = 'calc' | 'read' | 'write' | 'call' | 'ctrl' | 'error'

export const CATEGORIES: { id: StepCategory; label: string; plural: string; hint: string }[] = [
  { id: 'calc', label: 'Calcul', plural: 'Calculs', hint: 'DECLARE, SET, SELECT @variable = …' },
  { id: 'read', label: 'Lecture', plural: 'Lectures', hint: 'SELECT qui renvoie des lignes' },
  { id: 'write', label: 'Écriture', plural: 'Écritures', hint: 'INSERT, UPDATE, DELETE, COMMIT, ROLLBACK…' },
  { id: 'call', label: 'Appel', plural: 'Appels', hint: "EXEC d'une autre procédure" },
  { id: 'ctrl', label: 'Contrôle', plural: 'Contrôles', hint: 'RETURN, BREAK, PRINT, BEGIN TRAN…' },
  { id: 'error', label: 'Erreur', plural: 'Erreurs', hint: 'Erreur interceptée par un bloc CATCH' }
]

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<
  StepCategory,
  string
>

/** Type ScriptDom → mot-clé affiché et famille. */
const STATEMENTS: Record<string, [keyword: string, category: StepCategory]> = {
  DeclareVariableStatement: ['DECLARE', 'calc'],
  DeclareTableVariableStatement: ['DECLARE', 'calc'],
  DeclareCursorStatement: ['DECLARE CURSOR', 'calc'],
  SetVariableStatement: ['SET', 'calc'],
  OpenCursorStatement: ['OPEN', 'calc'],
  FetchCursorStatement: ['FETCH', 'calc'],
  CloseCursorStatement: ['CLOSE', 'calc'],
  DeallocateCursorStatement: ['DEALLOCATE', 'calc'],
  SelectStatement: ['SELECT', 'read'],
  InsertStatement: ['INSERT', 'write'],
  UpdateStatement: ['UPDATE', 'write'],
  DeleteStatement: ['DELETE', 'write'],
  MergeStatement: ['MERGE', 'write'],
  TruncateTableStatement: ['TRUNCATE', 'write'],
  CreateTableStatement: ['CREATE TABLE', 'write'],
  DropTableStatement: ['DROP TABLE', 'write'],
  CreateIndexStatement: ['CREATE INDEX', 'write'],
  CommitTransactionStatement: ['COMMIT', 'write'],
  RollbackTransactionStatement: ['ROLLBACK', 'write'],
  BeginTransactionStatement: ['BEGIN TRAN', 'ctrl'],
  SaveTransactionStatement: ['SAVE TRAN', 'ctrl'],
  ExecuteStatement: ['EXEC', 'call'],
  PrintStatement: ['PRINT', 'ctrl'],
  RaiseErrorStatement: ['RAISERROR', 'ctrl'],
  ThrowStatement: ['THROW', 'ctrl'],
  ReturnStatement: ['RETURN', 'ctrl'],
  BreakStatement: ['BREAK', 'ctrl'],
  ContinueStatement: ['CONTINUE', 'ctrl'],
  GoToStatement: ['GOTO', 'ctrl'],
  WaitForStatement: ['WAITFOR', 'ctrl'],
  PredicateSetStatement: ['SET', 'ctrl'],
  SetTransactionIsolationLevelStatement: ['SET', 'ctrl'],
  UseStatement: ['USE', 'ctrl'],
  CatchBlock: ['CATCH', 'error']
}

/** Effet fixe des instructions qui ne renvoient pas de nombre de lignes utile. */
const FIXED_EFFECTS: Record<string, string> = {
  COMMIT: 'transaction validée',
  ROLLBACK: 'transaction annulée',
  'BEGIN TRAN': 'transaction ouverte',
  TRUNCATE: 'table vidée',
  'CREATE TABLE': 'table créée',
  'DROP TABLE': 'table supprimée',
  'CREATE INDEX': 'index créé'
}

/** Participe du nombre de lignes : « 3 lignes modifiées ». */
const ROW_VERBS: Record<string, string> = {
  INSERT: 'insérée',
  UPDATE: 'modifiée',
  DELETE: 'supprimée',
  MERGE: 'traitée',
  'SELECT INTO': 'copiée'
}

export interface VariableChange {
  name: string
  /** Valeur avant cette étape (sans objet si `hadBefore` est faux) */
  before: unknown
  hadBefore: boolean
  after: unknown
}

export interface StepInfo {
  index: number
  line: number
  category: StepCategory
  /** Mot-clé lisible : SET, UPDATE, EXEC… */
  keyword: string
  /** Première ligne de l'instruction telle qu'elle est écrite (« … » si elle continue) */
  code: string
  /** Ce que l'instruction a produit, en clair (vide si rien de notable) */
  effect: string
  changes: VariableChange[]
  durationMs: number | null
  /** Échelle de durée 0 (rapide) → 3 (lent), relative à l'étape la plus lente */
  heat: 0 | 1 | 2 | 3
  /** Parmi les plus lentes : au moins 5 ms et la moitié du temps de la plus lente */
  slow: boolean
  hasResult: boolean
}

/** Une exécution complète d'une boucle WHILE, découpée en tours. */
export interface LoopRun {
  kind: 'loop'
  /** Identifiant stable : statement WHILE + première étape */
  key: string
  line: number
  start: number
  end: number
  iterations: TreeNode[][]
  /** Première étape de chaque tour */
  iterationStarts: number[]
}

export type TreeNode = { kind: 'step'; index: number } | LoopRun

/** Variable écrite pendant l'exécution, avec les étapes qui la modifient. */
export interface VariableTrack {
  name: string
  steps: number[]
}

export interface RunModel {
  steps: StepInfo[]
  maxMs: number
  /** Erreur non interceptée qui a arrêté l'exécution (affichée en fin de journal) */
  stopError: string | null
  /** Étapes dans l'ordre, les tours de boucle regroupés */
  tree: TreeNode[]
  /** Boucles de premier niveau (accolades sous la piste) */
  topLoops: LoopRun[]
  /** Variables écrites, par ordre alphabétique (« Suivre une variable ») */
  variables: VariableTrack[]
}

const models = new WeakMap<DebugRunResult, { source: string; model: RunModel }>()

/** Modèle d'une exécution, calculé une seule fois pour tous les panneaux qui l'affichent. */
export function getRunModel(run: DebugRunResult, source: string): RunModel {
  const hit = models.get(run)
  if (hit && hit.source === source) return hit.model
  const model = buildRunModel(run, source)
  models.set(run, { source, model })
  return model
}

export function buildRunModel(run: DebugRunResult, source: string): RunModel {
  const lines = source.split(/\r?\n/)
  const byIndex = new Map<number, InstrumentedStatement>()
  for (const st of run.instrument.statements) byIndex.set(st.index, st)

  let maxMs = 0
  for (const s of run.steps) if (s.durationMs !== null && s.durationMs > maxMs) maxMs = s.durationMs

  const rowsOf = new Map(run.resultsets.map((r) => [r.index, r.rows.length]))
  const last = new Map<string, unknown>()
  const writers = new Map<string, number[]>()

  // Erreur non interceptée : sur l'instruction fautive quand l'exécution a
  // continué, en fin de journal quand elle s'est arrêtée là.
  const uncaught = new Map<number, StepError>()
  let stopError: string | null = null
  for (const e of run.errors) {
    if (typeof e.stepIndex === 'number' && e.stepIndex < run.steps.length) {
      if (!uncaught.has(e.stepIndex)) uncaught.set(e.stepIndex, e)
      continue
    }
    if (stopError !== null) continue
    const where = e.line ? ` à la ligne ${e.line}` : ''
    stopError =
      e.stepIndex === null
        ? `Exécution arrêtée par une erreur${where} : ${e.message}`
        : `Erreur non interceptée${where} : ${e.message}`
  }

  const steps = run.steps.map((step, index): StepInfo => {
    const changes = Object.entries(step.variables).map(([name, after]) => {
      const hadBefore = last.has(name)
      const change = { name, before: last.get(name), hadBefore, after }
      last.set(name, after)
      const list = writers.get(name)
      if (list) list.push(index)
      else writers.set(name, [index])
      return change
    })
    // L'entrée dans un CATCH porte la ligne de sa première instruction : on
    // affiche le bloc lui-même, l'instruction suivra comme étape à part.
    const code = step.kind === 'catch' ? 'BEGIN CATCH' : excerpt(lines, step.startLine, step.endLine)
    const [keyword, kind] = classify(step, byIndex.get(step.statementIndex), code)
    const heat = heatOf(step.durationMs, maxMs)
    const failed = uncaught.get(index)
    const category = failed ? 'error' : kind
    const effect = effectOf(step, keyword, kind, changes, rowsOf)
    return {
      index,
      line: step.startLine,
      category,
      keyword,
      code: code || keyword,
      effect: failed
        ? [
            `Erreur ${failed.number}${failed.line && failed.line !== step.startLine ? ` ligne ${failed.line}` : ''} : ${failed.message}`,
            effect
          ]
            .filter(Boolean)
            .join(' · ')
        : effect,
      changes,
      durationMs: step.durationMs,
      heat,
      // Plancher de 5 ms : une exécution entièrement rapide n'a pas d'étape « lente ».
      slow: step.durationMs !== null && step.durationMs >= SLOW_FLOOR_MS && heat >= 2,
      hasResult: step.resultsetIndexes.length > 0
    }
  })

  const tree = buildTree(run.steps, run.instrument.statements, byIndex)
  return {
    steps,
    maxMs,
    stopError,
    tree,
    topLoops: tree.filter((n): n is LoopRun => n.kind === 'loop'),
    variables: [...writers]
      .map(([name, list]) => ({ name, steps: list }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

/**
 * Valeur d'une variable à une étape : celle de sa dernière écriture jusqu'à
 * cette étape incluse (null si elle n'a pas encore été écrite).
 */
export function valueAt(
  model: RunModel,
  track: VariableTrack,
  stepIndex: number
): { value: unknown; step: number } | null {
  let lo = 0
  let hi = track.steps.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (track.steps[mid] <= stepIndex) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found < 0) return null
  const step = track.steps[found]
  const change = model.steps[step].changes.find((c) => c.name === track.name)
  return change ? { value: change.after, step } : null
}

/** Première ligne de l'instruction, sans l'indentation. */
function excerpt(lines: string[], start: number, end: number): string {
  const first = (lines[start - 1] ?? '').trim()
  if (!first) return ''
  const text = first.length > 160 ? `${first.slice(0, 160)}…` : first
  return end > start ? `${text} …` : text
}

function classify(
  step: TraceStep,
  st: InstrumentedStatement | undefined,
  code: string
): [string, StepCategory] {
  if (step.kind === 'catch') return ['CATCH', 'error']
  const type = st?.type ?? ''
  const known = STATEMENTS[type]
  if (type === 'SelectStatement') {
    // SELECT @x = … calcule ; SELECT … INTO #t écrit ; sinon il lit.
    if (step.resultsetIndexes.length === 0) {
      if (Object.keys(step.variables).length > 0) return ['SELECT', 'calc']
      if (/\binto\s+[#@[\w]/i.test(code)) return ['SELECT INTO', 'write']
    }
    return ['SELECT', 'read']
  }
  if (known) return known
  const word = /^[a-z]+/i.exec(code)?.[0]?.toUpperCase() ?? type.replace(/Statement$/, '').toUpperCase()
  return [word, /^(Create|Drop|Alter)/.test(type) ? 'write' : 'ctrl']
}

const SLOW_FLOOR_MS = 5

function heatOf(ms: number | null, maxMs: number): 0 | 1 | 2 | 3 {
  if (ms === null || maxMs <= 0) return 0
  const ratio = ms / maxMs
  return ratio < 0.25 ? 0 : ratio < 0.5 ? 1 : ratio < 0.75 ? 2 : 3
}

const plural = (n: number, word: string): string =>
  `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`

function shortValue(v: unknown): string {
  const text = formatSqlValue(v)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function effectOf(
  step: TraceStep,
  keyword: string,
  category: StepCategory,
  changes: VariableChange[],
  rowsOf: Map<number, number>
): string {
  if (step.kind === 'catch') {
    const e = step.error
    if (!e) return 'erreur interceptée'
    return `Erreur ${e.number}${e.line ? ` ligne ${e.line}` : ''} : ${e.message}`
  }
  const parts: string[] = []
  if (changes.length > 0) {
    const shown = changes.slice(0, 3).map((c) =>
      c.hadBefore && formatSqlValue(c.before) !== formatSqlValue(c.after)
        ? `${c.name} : ${shortValue(c.before)} → ${shortValue(c.after)}`
        : `${c.name} = ${shortValue(c.after)}`
    )
    const more = changes.length - 3
    if (more > 0) shown.push(`et ${more} autre${more > 1 ? 's' : ''}`)
    parts.push(shown.join(' · '))
  }
  if (step.resultsetIndexes.length > 0) {
    const rows = step.resultsetIndexes.reduce((sum, i) => sum + (rowsOf.get(i) ?? 0), 0)
    const sets = step.resultsetIndexes.length
    parts.push(`${sets} ${sets > 1 ? 'jeux' : 'jeu'} de résultats · ${plural(rows, 'ligne')}`)
  }
  const fixed = FIXED_EFFECTS[keyword]
  if (fixed) parts.push(fixed)
  else if (category === 'write' && step.rowCount !== null && step.rowCount >= 0) {
    const verb = ROW_VERBS[keyword] ?? 'affectée'
    parts.push(
      step.rowCount === 0
        ? `aucune ligne ${verb}`
        : `${plural(step.rowCount, 'ligne')} ${verb}${step.rowCount > 1 ? 's' : ''}`
    )
  }
  if (step.returnValue !== null && step.returnValue !== undefined) {
    parts.push(`renvoie ${shortValue(step.returnValue)}`)
  }
  return parts.join(' · ')
}

/**
 * Regroupe les étapes par boucle WHILE et par tour. Le moteur ne trace pas
 * l'évaluation de la condition du WHILE : un nouveau tour se reconnaît au
 * retour en arrière dans le code (instruction d'indice inférieur ou égal à la
 * précédente), attribué à la boucle la plus intérieure qui contient les deux.
 * C'est exact pour les boucles usuelles (compteur, FETCH NEXT en fin de corps).
 */
function buildTree(
  steps: TraceStep[],
  statements: InstrumentedStatement[],
  byIndex: Map<number, InstrumentedStatement>
): TreeNode[] {
  const loops = statements.filter((st) => st.type === 'WhileStatement')
  const chains = new Map<number, InstrumentedStatement[]>()
  const chainOf = (statementIndex: number): InstrumentedStatement[] => {
    let chain = chains.get(statementIndex)
    if (!chain) {
      const st = byIndex.get(statementIndex)
      chain = st
        ? loops
            .filter(
              (l) => l.index < st.index && l.startLine <= st.startLine && st.endLine <= l.endLine
            )
            .sort((a, b) => a.index - b.index)
        : []
      chains.set(statementIndex, chain)
    }
    return chain
  }

  const root: TreeNode[] = []
  const stack: { loop: InstrumentedStatement; run: LoopRun }[] = []
  const container = (): TreeNode[] =>
    stack.length > 0 ? stack[stack.length - 1].run.iterations.at(-1)! : root
  let prevChain: InstrumentedStatement[] = []
  let prevIndex = -1

  steps.forEach((step, i) => {
    const chain = chainOf(step.statementIndex)
    // Sorti d'une boucle : son exécution se termine à l'étape précédente.
    while (stack.length > 0 && !chain.includes(stack[stack.length - 1].loop)) {
      stack.pop()!.run.end = i - 1
    }
    // Retour en arrière dans une boucle : nouveau tour.
    if (i > 0 && step.statementIndex <= prevIndex) {
      const common = chain.filter((l) => prevChain.includes(l))
      const pos = stack.findIndex((o) => o.loop === common[common.length - 1])
      if (pos >= 0) {
        while (stack.length > pos + 1) stack.pop()!.run.end = i - 1
        stack[pos].run.iterations.push([])
        stack[pos].run.iterationStarts.push(i)
      }
    }
    // Entrée dans une (ou plusieurs) boucle(s).
    for (let d = stack.length; d < chain.length; d++) {
      const run: LoopRun = {
        kind: 'loop',
        key: `${chain[d].index}:${i}`,
        line: chain[d].startLine,
        start: i,
        end: i,
        iterations: [[]],
        iterationStarts: [i]
      }
      container().push(run)
      stack.push({ loop: chain[d], run })
    }
    container().push({ kind: 'step', index: i })
    prevChain = chain
    prevIndex = step.statementIndex
  })
  while (stack.length > 0) stack.pop()!.run.end = steps.length - 1
  return root
}

/** Tour d'une boucle qui contient l'étape (dernier tour commencé avant elle). */
export function iterationOf(run: LoopRun, stepIndex: number): number {
  const starts = run.iterationStarts
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= stepIndex) lo = mid
    else hi = mid - 1
  }
  return lo
}
