import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { useEffect, useRef } from 'react'
import { registerSqlCompletion } from './completion'
import { useAppearanceStore } from '../../stores/appearanceStore'
import { findTheme } from '../../theme/themes'

self.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}

registerSqlCompletion()

/** Éditeur monté (il n'y en a qu'un) : cible des commandes du menu Édition. */
let mountedEditor: monaco.editor.IStandaloneCodeEditor | null = null

/** Lance une commande de l'éditeur depuis la barre de menus (annuler, rechercher…). */
export function editorAction(id: string): void {
  if (!mountedEditor) return
  mountedEditor.focus()
  mountedEditor.trigger('menu', id, null)
}

/** Coller depuis le menu : le presse-papiers est lu puis inséré à la sélection. */
export async function editorPaste(): Promise<void> {
  const editor = mountedEditor
  if (!editor) return
  const text = await navigator.clipboard.readText()
  const sel = editor.getSelection()
  if (!sel) return
  editor.focus()
  editor.executeEdits('menu', [{ range: sel, text, forceMoveMarkers: true }])
}

monaco.editor.defineTheme('gtrace-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword.sql', foreground: 'd9a441' },
    { token: 'string.sql', foreground: '7dbb7d' },
    { token: 'comment.sql', foreground: '6b7080' }
  ],
  colors: {
    'editor.background': '#14161a',
    'editor.lineHighlightBackground': '#1d2026',
    'editorLineNumber.foreground': '#4a4f59',
    'editorLineNumber.activeForeground': '#8b909a',
    'editorGutter.background': '#14161a'
  }
})

// Thème clair : coloration SQL classique —
// mots-clés bleus, chaînes rouges, commentaires verts.
monaco.editor.defineTheme('gtrace-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword.sql', foreground: '0000ff' },
    { token: 'string.sql', foreground: 'a31515' },
    { token: 'comment.sql', foreground: '008000' },
    { token: 'number.sql', foreground: '098658' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f0f4f8',
    'editorLineNumber.foreground': '#9aa4b0',
    'editorLineNumber.activeForeground': '#3d4b59',
    'editorGutter.background': '#ffffff'
  }
})

export type DecorationKind =
  | 'current'
  | 'catch'
  | 'warn'
  | 'error'
  | 'heat1'
  | 'heat2'
  | 'heat3'
  | 'heat4'
  | 'executed'

export interface LineDecoration {
  kind: DecorationKind
  startLine: number
  endLine: number
  message?: string
}

function optionsFor(dec: LineDecoration): monaco.editor.IModelDecorationOptions {
  const hover = dec.message ? [{ value: dec.message }] : undefined
  switch (dec.kind) {
    case 'current':
      return {
        isWholeLine: true,
        className: 'dec-current',
        glyphMarginClassName: 'dec-current-glyph',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    case 'catch':
      return {
        isWholeLine: true,
        className: 'dec-catch',
        glyphMarginClassName: 'dec-catch-glyph',
        glyphMarginHoverMessage: hover
      }
    case 'warn':
      return {
        isWholeLine: false,
        glyphMarginClassName: 'dec-warn-glyph',
        glyphMarginHoverMessage: hover
      }
    case 'error':
      return {
        isWholeLine: true,
        className: 'dec-error',
        glyphMarginClassName: 'dec-error-glyph',
        glyphMarginHoverMessage: hover
      }
    case 'executed':
      return {
        isWholeLine: true,
        linesDecorationsClassName: 'dec-executed',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    case 'heat1':
    case 'heat2':
    case 'heat3':
    case 'heat4':
      return {
        isWholeLine: true,
        className: `dec-${dec.kind}`,
        hoverMessage: hover,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
  }
}

interface Props {
  value: string
  onChange: (value: string) => void
  decorations: LineDecoration[]
  revealLine: number | null
  breakpoints: ReadonlySet<number>
  onToggleBreakpoint: (line: number) => void
  /** Plages de lignes à masquer (branches non exécutées repliées). */
  hiddenRanges?: { start: number; end: number }[]
  /** Sélection courante (null si vide) : ligne/colonne 1-based du début + texte. */
  onSelectionChange?: (sel: { text: string; startLine: number; startColumn: number } | null) => void
  /** Demande de sélection d'une ligne entière (double-clic sur une erreur) ; seq la rend rejouable. */
  selectLine?: { line: number; seq: number } | null
  /** Position du curseur (Ln / Col de la barre d'état) */
  onCursorChange?: (line: number, column: number) => void
}

export default function CodeEditor({
  value,
  onChange,
  decorations,
  revealLine,
  breakpoints,
  onToggleBreakpoint,
  hiddenRanges,
  onSelectionChange,
  selectLine,
  onCursorChange
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const bpCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onChangeRef = useRef(onChange)
  const onToggleBpRef = useRef(onToggleBreakpoint)
  const onSelectionRef = useRef(onSelectionChange)
  const onCursorRef = useRef(onCursorChange)
  onCursorRef.current = onCursorChange
  const internalEdit = useRef(false)
  onChangeRef.current = onChange
  onToggleBpRef.current = onToggleBreakpoint
  onSelectionRef.current = onSelectionChange

  // L'éditeur suit le thème de l'application (clair/sombre) et la taille de
  // police choisie dans le dialogue Apparence.
  const monacoTheme = useAppearanceStore((s) =>
    findTheme(s.appearance.themeId).base === 'light' ? 'gtrace-light' : 'gtrace-dark'
  )
  const editorFontSize = useAppearanceStore((s) => s.appearance.editorFontSize)

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize })
  }, [editorFontSize])

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      value,
      language: 'sql',
      theme: monacoTheme,
      fontFamily: "'JetBrains Mono', Consolas, 'Cascadia Mono', monospace",
      fontSize: editorFontSize,
      lineHeight: 20,
      minimap: { enabled: false },
      glyphMargin: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      automaticLayout: true,
      wordWrap: 'off',
      tabSize: 2,
      padding: { top: 8 },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'currentDocument',
      // Le dépôt depuis l'explorateur est géré plus bas : celui de Monaco
      // insère le texte comme un modèle et laisse un « $0 » parasite.
      dropIntoEditor: { enabled: false }
    })
    editorRef.current = editor
    mountedEditor = editor
    collectionRef.current = editor.createDecorationsCollection()
    bpCollectionRef.current = editor.createDecorationsCollection()

    const sub = editor.onDidChangeModelContent(() => {
      internalEdit.current = true
      onChangeRef.current(editor.getValue())
      internalEdit.current = false
    })

    // Pose/retrait de breakpoint au clic dans la gouttière
    const mouseSub = editor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        e.target.position
      ) {
        onToggleBpRef.current(e.target.position.lineNumber)
      }
    })

    // Raccourcis SSMS : Ctrl+K, Ctrl+C commente les lignes, Ctrl+K, Ctrl+U les décommente.
    editor.addCommand(
      monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC),
      () => editor.trigger('ssms', 'editor.action.addCommentLine', null)
    )
    editor.addCommand(
      monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU),
      () => editor.trigger('ssms', 'editor.action.removeCommentLine', null)
    )
    // Majuscules / minuscules (SSMS : Ctrl+Maj+U / Ctrl+Maj+L).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU, () =>
      editor.trigger('ssms', 'editor.action.transformToUppercase', null)
    )
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () =>
      editor.trigger('ssms', 'editor.action.transformToLowercase', null)
    )
    // Tests automatisés en développement uniquement (jamais dans l'application installée).
    if (import.meta.env.DEV) (window as unknown as { __gtraceEditor?: unknown }).__gtraceEditor = editor

    // Glisser un objet de l'explorateur : son nom est inséré à l'endroit du
    // dépôt et reste sélectionné (comme SSMS).
    const host = hostRef.current!
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('text/plain')) e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      const text = e.dataTransfer?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      const model = editor.getModel()
      if (!model) return
      const target = editor.getTargetAtClientPoint(e.clientX, e.clientY)
      const last = model.getLineCount()
      const pos = target?.position ?? { lineNumber: last, column: model.getLineMaxColumn(last) }
      const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
      editor.executeEdits('drop', [{ range, text, forceMoveMarkers: true }])
      const end = model.modifyPosition(range.getStartPosition(), text.length)
      editor.setSelection(monaco.Range.fromPositions(range.getStartPosition(), end))
      editor.focus()
    }
    host.addEventListener('dragover', onDragOver, true)
    host.addEventListener('drop', onDrop, true)

    const cursorSub = editor.onDidChangeCursorPosition((e) =>
      onCursorRef.current?.(e.position.lineNumber, e.position.column)
    )

    // Suivi de la sélection (pour « exécuter la sélection sinon tout »).
    const selSub = editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel()
      if (!model) return
      const text = model.getValueInRange(e.selection)
      onSelectionRef.current?.(
        text.trim()
          ? { text, startLine: e.selection.startLineNumber, startColumn: e.selection.startColumn }
          : null
      )
    })

    return () => {
      sub.dispose()
      mouseSub.dispose()
      selSub.dispose()
      cursorSub.dispose()
      host.removeEventListener('dragover', onDragOver, true)
      host.removeEventListener('drop', onDrop, true)
      editor.dispose()
      editorRef.current = null
      if (mountedEditor === editor) mountedEditor = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- montage unique
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (editor && !internalEdit.current && editor.getValue() !== value) {
      editor.setValue(value)
    }
  }, [value])

  useEffect(() => {
    collectionRef.current?.set(
      decorations.map((d) => ({
        range: new monaco.Range(d.startLine, 1, d.endLine, 1),
        options: optionsFor(d)
      }))
    )
  }, [decorations])

  // Repli des branches non exécutées : setHiddenAreas masque les plages sans
  // toucher au document (les numéros de ligne restent ceux du source).
  useEffect(() => {
    const editor = editorRef.current as
      | (monaco.editor.IStandaloneCodeEditor & {
          setHiddenAreas?: (ranges: monaco.IRange[]) => void
        })
      | null
    if (!editor?.setHiddenAreas) return
    editor.setHiddenAreas(
      (hiddenRanges ?? []).map((r) => new monaco.Range(r.start, 1, r.end, 1))
    )
  }, [hiddenRanges])

  useEffect(() => {
    bpCollectionRef.current?.set(
      [...breakpoints].map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'dec-breakpoint',
          glyphMarginHoverMessage: [{ value: 'Breakpoint (simulé)' }],
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }))
    )
  }, [breakpoints])

  useEffect(() => {
    if (revealLine !== null && editorRef.current) {
      editorRef.current.revealLineInCenterIfOutsideViewport(revealLine)
    }
  }, [revealLine])

  // Comme SSMS : la ligne fautive est sélectionnée en entier et l'éditeur reprend le focus.
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || !selectLine) return
    const line = Math.min(Math.max(1, selectLine.line), model.getLineCount())
    editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)))
    editor.revealLineInCenterIfOutsideViewport(line)
    editor.focus()
  }, [selectLine])

  return <div ref={hostRef} className="editor-host" />
}
