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
  /** Sélection courante (null si vide) : ligne/colonne 1-based du début + texte. */
  onSelectionChange?: (sel: { text: string; startLine: number; startColumn: number } | null) => void
}

export default function CodeEditor({
  value,
  onChange,
  decorations,
  revealLine,
  breakpoints,
  onToggleBreakpoint,
  onSelectionChange
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const bpCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onChangeRef = useRef(onChange)
  const onToggleBpRef = useRef(onToggleBreakpoint)
  const onSelectionRef = useRef(onSelectionChange)
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
      wordBasedSuggestions: 'currentDocument'
    })
    editorRef.current = editor
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
      editor.dispose()
      editorRef.current = null
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

  return <div ref={hostRef} className="editor-host" />
}
