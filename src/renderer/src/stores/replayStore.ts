import { create } from 'zustand'
import type { DebugRunResult, InstrumentResult, TraceStep } from '@shared/types'

/** Signets : numéro d'étape → nom donné par l'utilisateur. */
export type Bookmarks = Record<number, string>

interface RunContext {
  /** SQL exécuté (mêmes numéros de ligne que l'éditeur) : extraits du Déroulé */
  source?: string
  bookmarks?: Bookmarks
  /** Entrée d'historique où cette exécution est enregistrée */
  historyId?: string | null
}

interface ReplayState {
  run: DebugRunResult | null
  currentStep: number
  /** Session interactive en cours : les steps arrivent en live */
  live: boolean
  source: string
  bookmarks: Bookmarks
  historyId: string | null
  setRun: (run: DebugRunResult | null, context?: RunContext) => void
  beginLive: (sessionId: string, instrument: InstrumentResult, source?: string) => void
  appendStep: (step: TraceStep) => void
  endLive: (result: DebugRunResult) => void
  /** Nomme une étape (nom vide = retire le signet) ; enregistré dans l'historique. */
  setBookmark: (stepIndex: number, name: string) => void
  /** L'exécution vient d'être enregistrée : ses signets la suivent désormais. */
  attachHistory: (historyId: string) => void
  select: (index: number) => void
  next: () => void
  prev: () => void
  first: () => void
  last: () => void
}

function persistBookmarks(historyId: string | null, bookmarks: Bookmarks): void {
  if (historyId) void window.gtrace.historySetBookmarks(historyId, bookmarks).catch(() => undefined)
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  run: null,
  currentStep: 0,
  live: false,
  source: '',
  bookmarks: {},
  historyId: null,
  setRun: (run, context) =>
    set({
      run,
      currentStep: 0,
      live: false,
      source: context?.source ?? '',
      bookmarks: context?.bookmarks ?? {},
      historyId: context?.historyId ?? null
    }),
  beginLive: (sessionId, instrument, source) =>
    set({
      live: true,
      currentStep: 0,
      source: source ?? '',
      bookmarks: {},
      historyId: null,
      run: {
        sessionId,
        instrument,
        steps: [],
        resultsets: [],
        outputValues: {},
        errors: [],
        snapshots: []
      }
    }),
  appendStep: (step) =>
    set((state) => {
      if (!state.run || !state.live) return state
      const steps = [...state.run.steps, step]
      return { run: { ...state.run, steps }, currentStep: steps.length - 1 }
    }),
  endLive: (result) => set((state) => ({ run: result, live: false, currentStep: state.currentStep })),
  setBookmark: (stepIndex, name) => {
    const bookmarks = { ...get().bookmarks }
    const clean = name.trim()
    if (clean) bookmarks[stepIndex] = clean
    else delete bookmarks[stepIndex]
    set({ bookmarks })
    persistBookmarks(get().historyId, bookmarks)
  },
  attachHistory: (historyId) => {
    set({ historyId })
    // Signets posés avant l'enregistrement (session en pause, ou pendant la sauvegarde).
    if (Object.keys(get().bookmarks).length > 0) persistBookmarks(historyId, get().bookmarks)
  },
  select: (index) => {
    const { run } = get()
    if (run && index >= 0 && index < run.steps.length) set({ currentStep: index })
  },
  next: () => get().select(get().currentStep + 1),
  prev: () => get().select(get().currentStep - 1),
  first: () => get().select(0),
  last: () => {
    const { run } = get()
    if (run && run.steps.length > 0) set({ currentStep: run.steps.length - 1 })
  }
}))

export interface VariableView {
  name: string
  value: unknown
  /** Step où la valeur courante a été écrite */
  changedAtStep: number
  /** Valeur avant la dernière écriture */
  previous: unknown
  hasPrevious: boolean
  /** La variable vient d'être écrite par le step courant */
  changedNow: boolean
}

/** État des variables au step donné, reconstruit en repliant les écritures des steps 0..index. */
export function variablesAt(run: DebugRunResult, stepIndex: number): VariableView[] {
  const map = new Map<string, VariableView>()
  for (let i = 0; i <= stepIndex && i < run.steps.length; i++) {
    for (const [name, value] of Object.entries(run.steps[i].variables)) {
      const existing = map.get(name)
      map.set(name, {
        name,
        value,
        changedAtStep: i,
        previous: existing?.value,
        hasPrevious: existing !== undefined,
        changedNow: i === stepIndex
      })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function formatSqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '')
  if (typeof v === 'string') return `'${v}'`
  return String(v)
}
