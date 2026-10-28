import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flag,
  History,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer,
  Trash2,
  Variable,
  X
} from 'lucide-react'
import { formatSqlValue, useReplayStore } from '../../stores/replayStore'
import { useWatchStore } from '../../stores/watchStore'
import { buildRunModel, CATEGORIES, valueAt, type StepCategory } from '../../lib/runModel'
import TreeMenu, { type MenuItem } from '../connections/TreeMenu'
import StepTrack, { type ColorMode } from './StepTrack'
import StepJournal from './StepJournal'

type StepFilter = 'all' | StepCategory | 'slow' | 'marks'

const COLOR_KEY = 'gtrace.deroule.couleur'
const SPEED_KEY = 'gtrace.deroule.vitesse'
/** Lecture automatique : une étape toutes les 800 ms à ×1. */
const PLAY_STEP_MS = 800
const SPEEDS = [1, 2, 4, 8]

function loadColorMode(): ColorMode {
  try {
    return localStorage.getItem(COLOR_KEY) === 'duration' ? 'duration' : 'type'
  } catch {
    return 'type'
  }
}

function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return SPEEDS.includes(v) ? v : 1
  } catch {
    return 1
  }
}

/**
 * Déroulé de l'exécution : chaque instruction exécutée, dans l'ordre, pour
 * revenir à n'importe quel moment (l'éditeur surligne la ligne, les variables
 * reprennent leur valeur d'alors). Trois niveaux : barre de lecture avec la
 * phrase « ce qui s'est passé ici », piste cliquable, journal en clair.
 * On peut nommer un moment (signet), retrouvé en rouvrant l'exécution.
 */
export default function Timeline({
  journalOpen,
  onToggleJournal
}: {
  journalOpen: boolean
  onToggleJournal: () => void
}): JSX.Element | null {
  const liveRun = useReplayStore((s) => s.run)
  const source = useReplayStore((s) => s.source)
  const bookmarks = useReplayStore((s) => s.bookmarks)
  const currentStep = useReplayStore((s) => s.currentStep)
  const { select, next, prev, first, last, setBookmark } = useReplayStore.getState()
  const marked = useWatchStore((s) => s.marked)
  const colorOf = useWatchStore((s) => s.colorOf)

  const [filter, setFilter] = useState<StepFilter>('all')
  const [colorMode, setColorMode] = useState<ColorMode>(loadColorMode)
  const [naming, setNaming] = useState<{ step: number; value: string; error: string | null } | null>(
    null
  )
  const [menu, setMenu] = useState<{ x: number; y: number; step: number } | null>(null)
  /** Variable suivie : seules les étapes qui la modifient restent affichées */
  const [followVar, setFollowVar] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(loadSpeed)

  // En session live, les étapes arrivent en rafale : le modèle suit sans bloquer l'interface.
  const run = useDeferredValue(liveRun)
  const model = useMemo(() => (run ? buildRunModel(run, source) : null), [run, source])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of model?.steps ?? []) {
      c[s.category] = (c[s.category] ?? 0) + 1
      if (s.slow) c.slow = (c.slow ?? 0) + 1
    }
    return c
  }, [model])
  const markCount = Object.keys(bookmarks).length
  // Variable absente de cette exécution (nouvelle exécution) : plus suivie.
  const followed = model?.variables.find((v) => v.name === followVar) ?? null
  const followedSteps = useMemo(() => new Set(followed?.steps ?? []), [followed])

  // Filtre devenu vide (nouvelle exécution, dernier signet retiré) : on revient à « Tout ».
  const activeFilter: StepFilter =
    filter === 'all' || (filter === 'marks' ? markCount > 0 : (counts[filter] ?? 0) > 0)
      ? filter
      : 'all'

  const matches = useCallback(
    (i: number): boolean => {
      const s = model?.steps[i]
      if (!s) return false
      if (followed && !followedSteps.has(i)) return false
      if (activeFilter === 'all') return true
      if (activeFilter === 'slow') return s.slow
      if (activeFilter === 'marks') return bookmarks[i] !== undefined
      return s.category === activeFilter
    },
    [model, activeFilter, bookmarks, followed, followedSteps]
  )
  const filtered = activeFilter !== 'all' || followed !== null

  const watchColors = useMemo(
    () =>
      (run?.steps ?? []).map(
        (s) =>
          Object.keys(s.variables)
            .map((name) => colorOf(name))
            .find((c): c is string => c !== null) ?? null
      ),
    // `marked` : les couleurs changent quand on suit / ne suit plus une variable.
    [run, colorOf, marked]
  )

  // Passer à une autre étape, ou à une autre exécution, annule un nommage en cours.
  useEffect(() => {
    setNaming((nm) => (nm && nm.step !== currentStep ? null : nm))
  }, [currentStep])
  const sessionId = liveRun?.sessionId
  useEffect(() => {
    setNaming(null)
    setPlaying(false)
  }, [sessionId])

  // Lecture automatique : avance d'une étape (retenue par les filtres) à
  // intervalle régulier, et s'arrête sur la dernière.
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const stepCount = model?.steps.length ?? 0
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      const { currentStep: at, select: go } = useReplayStore.getState()
      let next = at + 1
      while (next < stepCount && !matchesRef.current(next)) next++
      if (next >= stepCount) setPlaying(false)
      else go(next)
    }, PLAY_STEP_MS / speed)
    return () => window.clearInterval(timer)
  }, [playing, speed, stepCount])

  const nameInput = useRef<HTMLInputElement>(null)
  const namingStep = naming?.step
  useEffect(() => {
    if (namingStep !== undefined) nameInput.current?.focus()
  }, [namingStep])

  if (!model || model.steps.length === 0) return null

  const n = model.steps.length
  const cur = Math.min(currentStep, n - 1)
  const info = model.steps[cur]
  const curMark = bookmarks[cur]

  const startNaming = (step: number): void => {
    select(step)
    setNaming({ step, value: bookmarks[step] ?? '', error: null })
  }

  const saveName = (): void => {
    if (!naming) return
    if (!naming.value.trim()) {
      setNaming({ ...naming, error: 'Saisissez un nom pour ce moment' })
      nameInput.current?.focus()
      return
    }
    setBookmark(naming.step, naming.value)
    setNaming(null)
  }

  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false)
      return
    }
    // Déjà sur la dernière étape retenue : on rejoue depuis le début.
    let next = cur + 1
    while (next < n && !matches(next)) next++
    if (next >= n) {
      let start = 0
      while (start < n && !matches(start)) start++
      if (start < n) select(start)
    }
    setPlaying(true)
  }

  const cycleSpeed = (): void => {
    setSpeed((s) => {
      const next = SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]
      try {
        localStorage.setItem(SPEED_KEY, String(next))
      } catch {
        /* préférence non mémorisée */
      }
      return next
    })
  }

  const followedValue = followed ? valueAt(model, followed, cur) : null
  const followedColor = followed ? colorOf(followed.name) : null

  const changeColorMode = (mode: ColorMode): void => {
    setColorMode(mode)
    try {
      localStorage.setItem(COLOR_KEY, mode)
    } catch {
      /* préférence non mémorisée */
    }
  }

  const menuItems = (step: number): MenuItem[] => [
    { label: `Revenir à l'étape ${step + 1}`, icon: History, onClick: () => select(step) },
    'sep',
    {
      label: bookmarks[step] ? 'Renommer ce moment…' : 'Nommer ce moment…',
      icon: Bookmark,
      shortcut: 'F2',
      onClick: () => startNaming(step)
    },
    {
      label: 'Retirer le signet',
      icon: Trash2,
      disabled: !bookmarks[step],
      onClick: () => setBookmark(step, '')
    }
  ]

  const chips: { id: StepFilter; label: string; count: number; swatch?: string; tip: string }[] = [
    { id: 'all', label: 'Tout', count: n, tip: 'Toutes les étapes' },
    ...CATEGORIES.filter((c) => (counts[c.id] ?? 0) > 0).map((c) => ({
      id: c.id,
      label: c.plural,
      count: counts[c.id],
      swatch: colorMode === 'type' || c.id === 'error' ? `dr-cat-${c.id}` : undefined,
      tip: c.hint
    }))
  ]

  return (
    <section
      className="deroule"
      aria-label="Déroulé de l'exécution"
      onKeyDown={(e) => {
        // F2 depuis la piste ou le journal : nommer l'étape courante.
        if (e.key === 'F2' && !naming) {
          e.preventDefault()
          startNaming(cur)
        }
        // Espace : lecture / pause (sauf dans un champ ou sur un bouton, qui gèrent l'espace).
        const tag = (e.target as HTMLElement).tagName
        if (e.key === ' ' && !['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(tag)) {
          e.preventDefault()
          togglePlay()
        }
      }}
    >
      <header className="dr-head">
        <span className="dr-title">
          <History size={15} aria-hidden="true" />
          Déroulé de l'exécution
        </span>
        <span className="dr-subtitle">chaque instruction exécutée, dans l'ordre</span>
        <span className="dr-spacer" />

        {naming ? (
          <form
            className="dr-naming"
            onSubmit={(e) => {
              e.preventDefault()
              saveName()
            }}
          >
            <label className="dr-naming-label" htmlFor="dr-name">
              Étape {naming.step + 1} :
            </label>
            <span className="dr-naming-field">
              <input
                id="dr-name"
                ref={nameInput}
                value={naming.value}
                maxLength={80}
                placeholder="Ex. : avant la mise à jour"
                aria-invalid={naming.error !== null}
                aria-describedby={naming.error ? 'dr-name-error' : undefined}
                onChange={(e) => setNaming({ ...naming, value: e.target.value, error: null })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setNaming(null)
                  }
                }}
              />
              {naming.error && (
                <span id="dr-name-error" className="dr-naming-error" role="alert">
                  {naming.error}
                </span>
              )}
            </span>
            <button type="submit" className="dr-btn primary">
              Enregistrer
            </button>
            <button type="button" className="dr-btn" onClick={() => setNaming(null)}>
              Annuler
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="dr-btn"
            onClick={() => startNaming(cur)}
            data-tip="Donner un nom à cette étape pour la retrouver (drapeau sur la piste, filtre Signets)"
            data-shortcut="F2"
          >
            <Bookmark size={14} aria-hidden="true" />
            {curMark ? 'Renommer ce moment' : 'Nommer ce moment'}
          </button>
        )}

        <span className="dr-seg" role="group" aria-label="Couleur des barres">
          <span className="dr-seg-label">Couleur</span>
          <button
            type="button"
            aria-pressed={colorMode === 'type'}
            onClick={() => changeColorMode('type')}
            data-tip="Une couleur par famille d'instruction (la hauteur montre toujours la durée)"
          >
            Type
          </button>
          <button
            type="button"
            aria-pressed={colorMode === 'duration'}
            onClick={() => changeColorMode('duration')}
            data-tip="Du plus clair (rapide) au plus foncé (lent)"
          >
            Durée
          </button>
        </span>

        <button
          type="button"
          className="dr-btn"
          aria-expanded={journalOpen}
          onClick={onToggleJournal}
          data-tip={journalOpen ? 'Masquer le journal des étapes' : 'Afficher le journal des étapes'}
        >
          {journalOpen ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} aria-hidden="true" />
          )}
          Journal
        </button>
      </header>

      <div className="dr-transport">
        <span className="transport-buttons">
          <button type="button" onClick={first} data-tip="Première étape" data-shortcut="Ctrl+←" aria-label="Première étape">
            <SkipBack size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={prev} data-tip="Étape précédente" data-shortcut="Maj+F10" aria-label="Étape précédente">
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={next} data-tip="Étape suivante" data-shortcut="F10" aria-label="Étape suivante">
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button type="button" onClick={last} data-tip="Dernière étape" data-shortcut="Ctrl+→" aria-label="Dernière étape">
            <SkipForward size={14} aria-hidden="true" />
          </button>
        </span>
        <span className="dr-player">
          <button
            type="button"
            className="dr-play"
            aria-pressed={playing}
            onClick={togglePlay}
            data-tip={
              playing
                ? 'Mettre en pause'
                : filtered
                  ? 'Rejouer les étapes retenues par le filtre, une à une'
                  : "Rejouer l'exécution étape par étape : la ligne avance dans le code"
            }
            data-shortcut="Espace"
          >
            {playing ? (
              <Pause size={13} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={13} fill="currentColor" aria-hidden="true" />
            )}
            {playing ? 'Pause' : 'Rejouer'}
          </button>
          <button
            type="button"
            className="dr-speed"
            onClick={cycleSpeed}
            data-tip="Vitesse de lecture (cliquer pour changer)"
            aria-label={`Vitesse de lecture : ×${speed}`}
          >
            ×{speed}
          </button>
        </span>
        <span className="dr-now" aria-live="polite">
          <strong className="dr-now-step">
            Étape {cur + 1} / {n}
          </strong>
          {curMark && (
            <span className="dr-mark">
              <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
              {curMark}
            </span>
          )}
          <span className="dr-now-line">ligne {info.line}</span>
          <code className="dr-now-code">{info.code}</code>
          {info.effect && (
            <span className={`dr-effect${info.category === 'error' ? ' error' : ''}`} data-tip={info.effect}>
              {info.effect}
            </span>
          )}
          <span className={`dr-now-ms${info.slow ? ' slow' : ''}`}>
            <Timer size={12} aria-hidden="true" />
            {info.durationMs === null ? 'non mesurée' : `${info.durationMs} ms`}
            {info.slow && ' · lente'}
          </span>
        </span>
      </div>

      <StepTrack
        model={model}
        current={cur}
        bookmarks={bookmarks}
        colorMode={colorMode}
        matches={matches}
        watchColors={watchColors}
        onSelect={select}
        onMenu={(step, x, y) => setMenu({ x, y, step })}
      />

      <div className="dr-filters" role="group" aria-label="Filtrer les étapes">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className="dr-chip"
            aria-pressed={activeFilter === c.id}
            onClick={() => setFilter(c.id)}
            data-tip={c.tip}
          >
            {c.swatch && <i className={`dr-swatch ${c.swatch}`} aria-hidden="true" />}
            {c.label}
            <span className="dr-chip-count">{c.count}</span>
          </button>
        ))}
        {(counts.slow ?? 0) > 0 && (
          <button
            type="button"
            className="dr-chip"
            aria-pressed={activeFilter === 'slow'}
            onClick={() => setFilter('slow')}
            data-tip="Au moins 5 ms et au moins la moitié du temps de l'instruction la plus lente"
          >
            <Timer size={12} aria-hidden="true" />
            Lentes
            <span className="dr-chip-count">{counts.slow}</span>
          </button>
        )}
        {markCount > 0 && (
          <button
            type="button"
            className="dr-chip"
            aria-pressed={activeFilter === 'marks'}
            onClick={() => setFilter('marks')}
            data-tip="Les moments que vous avez nommés"
          >
            <Flag size={12} aria-hidden="true" />
            Signets
            <span className="dr-chip-count">{markCount}</span>
          </button>
        )}
        {model.variables.length > 0 && (
          <span className="dr-follow">
            <Variable size={13} aria-hidden="true" />
            <select
              className="dr-select"
              aria-label="Suivre une variable"
              value={followed?.name ?? ''}
              onChange={(e) => setFollowVar(e.target.value || null)}
              data-tip="N'afficher que les étapes où cette variable change, avec sa valeur avant → après"
            >
              <option value="">Suivre une variable…</option>
              {model.variables.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.steps.length})
                </option>
              ))}
            </select>
            {followed && (
              <>
                <span
                  className="dr-follow-value"
                  style={followedColor ? { borderColor: followedColor } : undefined}
                  data-tip={
                    followedValue
                      ? `Valeur à l'étape ${cur + 1} (écrite à l'étape ${followedValue.step + 1})`
                      : `Pas encore écrite à l'étape ${cur + 1}`
                  }
                >
                  {followed.name} = {followedValue ? formatSqlValue(followedValue.value) : '—'}
                </span>
                <button
                  type="button"
                  className="dr-follow-clear"
                  onClick={() => setFollowVar(null)}
                  aria-label="Ne plus suivre cette variable"
                  data-tip="Ne plus suivre"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </>
            )}
          </span>
        )}
        {colorMode === 'duration' && (
          <span className="dr-heat-legend" aria-label="Échelle des durées">
            rapide
            <i className="dr-heat-0" />
            <i className="dr-heat-1" />
            <i className="dr-heat-2" />
            <i className="dr-heat-3" />
            lent
          </span>
        )}
        <span className="dr-hint">Cliquez ou faites glisser sur la piste pour revenir à un moment</span>
      </div>

      {journalOpen && (
        <StepJournal
          model={model}
          current={cur}
          bookmarks={bookmarks}
          filtered={filtered}
          followVar={followed?.name ?? null}
          matches={matches}
          stopError={model.stopError}
          onSelect={select}
          onMenu={(step, x, y) => setMenu({ x, y, step })}
          onRename={startNaming}
        />
      )}

      {menu && (
        <TreeMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.step)}
          onClose={() => setMenu(null)}
          className="tree-menu dr-menu"
        />
      )}
    </section>
  )
}
