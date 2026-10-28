import { useRef, useState, type JSX, type RefObject } from 'react'
import {
  ArrowDownToDot,
  Check,
  ChevronDown,
  CircleDot,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Database,
  FilePlus,
  FolderOpen,
  Gauge,
  ListIndentDecrease,
  ListIndentIncrease,
  LoaderCircle,
  Lock,
  MessageSquareCode,
  MessageSquareOff,
  Palette,
  PanelBottom,
  PanelLeft,
  Play,
  Plug,
  Redo2,
  Save,
  SaveAll,
  Scissors,
  Server,
  Square,
  Undo2
} from 'lucide-react'
import type { DatabaseInfo } from '@shared/types'
import type { OpenConnection } from '../../stores/connectionsStore'
import { editorAction, editorPaste } from '../editor/CodeEditor'
import { ToolButton, ToolGroup } from '../ui/ToolButton'
import TreeMenu, { type MenuItem } from '../connections/TreeMenu'

/**
 * Barre « Standard » (1re rangée de SSMS) : fichiers, Nouvelle requête,
 * presse-papiers, annuler / rétablir — dans le même ordre que SSMS.
 */
export function StandardToolbar({
  locked,
  onOpen,
  onSave,
  onSaveAll,
  onNew,
  explorerVisible,
  onToggleExplorer,
  resultsVisible,
  onToggleResults,
  onAppearance,
  onHelp
}: {
  locked: boolean
  onOpen: () => void
  onSave: () => void
  onSaveAll: () => void
  onNew: () => void
  explorerVisible: boolean
  onToggleExplorer: () => void
  resultsVisible: boolean
  onToggleResults: () => void
  onAppearance: () => void
  onHelp: () => void
}): JSX.Element {
  return (
    <div className="toolbar" role="toolbar" aria-label="Barre d'outils standard">
      <ToolGroup label="Fichiers">
        <ToolButton
          icon={FolderOpen}
          label="Ouvrir un fichier"
          shortcut="Ctrl+O"
          disabled={locked}
          onClick={onOpen}
        />
        <ToolButton icon={Save} label="Enregistrer" shortcut="Ctrl+S" onClick={onSave} />
        <ToolButton
          icon={SaveAll}
          label="Enregistrer tout"
          shortcut="Ctrl+Maj+S"
          onClick={onSaveAll}
        />
      </ToolGroup>
      <ToolGroup label="Nouvelle requête">
        <ToolButton
          icon={FilePlus}
          label="Nouvelle requête"
          showLabel
          tip="Nouvelle requête, sur la base sélectionnée dans l'explorateur ou celle de l'onglet actif"
          shortcut="Ctrl+N"
          disabled={locked}
          onClick={onNew}
        />
      </ToolGroup>
      <ToolGroup label="Presse-papiers">
        <ToolButton
          icon={Scissors}
          label="Couper"
          shortcut="Ctrl+X"
          onClick={() => editorAction('editor.action.clipboardCutAction')}
        />
        <ToolButton
          icon={Copy}
          label="Copier"
          shortcut="Ctrl+C"
          onClick={() => editorAction('editor.action.clipboardCopyAction')}
        />
        <ToolButton
          icon={ClipboardPaste}
          label="Coller"
          shortcut="Ctrl+V"
          onClick={() => void editorPaste()}
        />
      </ToolGroup>
      <ToolGroup label="Annuler et rétablir">
        <ToolButton
          icon={Undo2}
          label="Annuler"
          shortcut="Ctrl+Z"
          onClick={() => editorAction('undo')}
        />
        <ToolButton
          icon={Redo2}
          label="Rétablir"
          shortcut="Ctrl+Y"
          onClick={() => editorAction('redo')}
        />
      </ToolGroup>
      <ToolGroup label="Affichage">
        <ToolButton
          icon={PanelLeft}
          label="Explorateur d'objets"
          shortcut="F8"
          active={explorerVisible}
          onClick={onToggleExplorer}
        />
        <ToolButton
          icon={PanelBottom}
          label="Volet de résultats"
          shortcut="Ctrl+R"
          active={resultsVisible}
          onClick={onToggleResults}
        />
      </ToolGroup>
      <span className="toolbar-spacer" />
      <ToolGroup label="Aide">
        <ToolButton
          icon={Palette}
          label="Apparence : thèmes et taille du texte"
          onClick={onAppearance}
        />
        <ToolButton icon={CircleHelp} label="Aide de GTrace" shortcut="F1" onClick={onHelp} />
      </ToolGroup>
    </div>
  )
}

/**
 * Barre « Éditeur SQL » (2e rangée de SSMS) : connexion, liste des bases,
 * Exécuter / Arrêter / Analyser, puis les outils propres à GTrace (pas à pas,
 * point d'arrêt, profilage) et la mise en forme du texte.
 */
export function SqlToolbar({
  connections,
  activeConn,
  locked,
  onConnect,
  onPickConnection,
  onDetach,
  databases,
  database,
  onPickDatabase,
  dbPickerRef,
  runLabel,
  runTip,
  canRun,
  running,
  onRun,
  canStop,
  onStop,
  onAnalyze,
  canStep,
  onStep,
  onToggleBreakpoint,
  canProfile,
  onProfile,
  readOnly,
  compatLevel,
  onCompat
}: {
  connections: OpenConnection[]
  activeConn: OpenConnection | null
  locked: boolean
  onConnect: () => void
  onPickConnection: (id: string) => void
  onDetach: () => void
  databases: DatabaseInfo[] | undefined
  /** Base effective de l'onglet (null = non connecté) */
  database: string | null
  onPickDatabase: (name: string) => void
  dbPickerRef: RefObject<HTMLSelectElement>
  runLabel: string
  runTip: string
  canRun: boolean
  running: boolean
  onRun: () => void
  canStop: boolean
  onStop: () => void
  onAnalyze: () => void
  canStep: boolean
  onStep: () => void
  onToggleBreakpoint: () => void
  canProfile: boolean
  onProfile: () => void
  readOnly: boolean
  compatLevel: number
  onCompat: (level: number) => void
}): JSX.Element {
  const chipRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const connItems: MenuItem[] = [
    ...connections.map((c): MenuItem => ({
      label: `${c.label}${c.production ? '  (production)' : ''}`,
      icon: Server,
      checked: c.id === activeConn?.id,
      disabled: locked,
      onClick: () => onPickConnection(c.id)
    })),
    ...(connections.length > 0 ? (['sep'] as MenuItem[]) : []),
    { label: 'Se connecter à un serveur…', icon: Plug, onClick: onConnect },
    { label: "Déconnecter l'onglet", disabled: !activeConn || locked, onClick: onDetach }
  ]

  return (
    <div className="toolbar" role="toolbar" aria-label="Barre d'outils de l'éditeur SQL">
      <ToolGroup label="Connexion">
        <ToolButton icon={Plug} label="Se connecter à un serveur" onClick={onConnect} />
        <button
          ref={chipRef}
          type="button"
          className={`conn-chip${activeConn ? '' : ' off'}${activeConn?.production ? ' prod' : ''}`}
          data-tip="Connexion de l'onglet : changer de serveur"
          aria-haspopup="menu"
          onClick={() => {
            const r = chipRef.current?.getBoundingClientRect()
            if (r) setMenu({ x: r.left, y: r.bottom + 2 })
          }}
        >
          <Server size={14} aria-hidden="true" />
          <span className="conn-chip-label">{activeConn ? activeConn.label : 'Non connecté'}</span>
          {activeConn?.production && <span className="prod-pill">PROD</span>}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <span
          className={`select-wrap db-select${activeConn ? '' : ' off'}`}
          data-tip="Bases de données disponibles"
          data-shortcut="Ctrl+U"
        >
          <Database size={14} aria-hidden="true" />
          <select
            ref={dbPickerRef}
            value={database ?? ''}
            disabled={!activeConn || locked}
            onChange={(e) => onPickDatabase(e.target.value)}
            aria-label="Base de données de l'onglet"
          >
            {!activeConn && <option value="">—</option>}
            {/* La base courante figure toujours, même avant le chargement de la liste. */}
            {activeConn && database && !databases?.some((d) => d.name === database) && (
              <option value={database}>{database}</option>
            )}
            {databases
              ?.filter((d) => d.online)
              .map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
          </select>
          <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
        </span>
      </ToolGroup>
      <button
        type="button"
        className={`run-btn${running ? ' running' : ''}${canRun ? '' : ' is-disabled'}`}
        aria-disabled={!canRun || undefined}
        data-tip={runTip}
        data-shortcut="F5"
        onClick={canRun ? onRun : undefined}
      >
        {running ? (
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
        ) : (
          <Play size={15} fill="currentColor" aria-hidden="true" />
        )}
        <span>{runLabel}</span>
      </button>
      <ToolGroup label="Exécution">
        <ToolButton
          icon={Square}
          iconFill
          label="Arrêter"
          tip="Arrêter le débogage ou le profilage"
          shortcut="Alt+Pause"
          variant="danger"
          disabled={!canStop}
          onClick={onStop}
        />
        <ToolButton
          icon={Check}
          label="Analyser"
          tip="Analyser : vérifier la syntaxe sans rien exécuter"
          shortcut="Ctrl+F5"
          disabled={locked}
          onClick={onAnalyze}
        />
      </ToolGroup>
      <ToolGroup label="Débogage">
        <ToolButton
          icon={ArrowDownToDot}
          label="Pas à pas"
          tip="Pas à pas : exécuter l'instruction suivante (session en pause)"
          shortcut="F10"
          disabled={!canStep}
          onClick={onStep}
        />
        <ToolButton
          icon={CircleDot}
          label="Point d'arrêt"
          tip="Poser / retirer un point d'arrêt sur la ligne du curseur"
          shortcut="F9"
          onClick={onToggleBreakpoint}
        />
        <ToolButton
          icon={Gauge}
          label="Profiler"
          tip="Profiler : mesurer le temps passé sur chaque ligne (sans instrumentation)"
          disabled={!canProfile}
          onClick={onProfile}
        />
      </ToolGroup>
      <ToolGroup label="Mise en forme">
        <ToolButton
          icon={MessageSquareCode}
          label="Commenter les lignes"
          shortcut="Ctrl+K, Ctrl+C"
          onClick={() => editorAction('editor.action.addCommentLine')}
        />
        <ToolButton
          icon={MessageSquareOff}
          label="Décommenter les lignes"
          shortcut="Ctrl+K, Ctrl+U"
          onClick={() => editorAction('editor.action.removeCommentLine')}
        />
        <ToolButton
          icon={ListIndentDecrease}
          label="Réduire le retrait"
          onClick={() => editorAction('editor.action.outdentLines')}
        />
        <ToolButton
          icon={ListIndentIncrease}
          label="Augmenter le retrait"
          onClick={() => editorAction('editor.action.indentLines')}
        />
      </ToolGroup>
      <span className="toolbar-spacer" />
      {readOnly && (
        <span
          className="toolbar-badge ok"
          data-tip="Mode lecture seule : toute écriture hors #temp et liste blanche est refusée"
        >
          <Lock size={12} aria-hidden="true" /> Lecture seule
        </span>
      )}
      <span
        className="select-wrap compat-select"
        data-tip="Version de SQL Server utilisée pour analyser le script"
      >
        <select
          value={compatLevel}
          onChange={(e) => onCompat(Number(e.target.value))}
          aria-label="Niveau de compatibilité"
        >
          <option value={160}>SQL 2022</option>
          <option value={150}>SQL 2019</option>
          <option value={140}>SQL 2017</option>
          <option value={130}>SQL 2016</option>
        </select>
        <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
      </span>
      {menu && <TreeMenu x={menu.x} y={menu.y} items={connItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
