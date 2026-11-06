// The script editor (WP 6.3): a labelled monospace textarea, not a code-editor library. The repo's
// CodeMirror (the admin's raw template editor) has no Python mode in the lockfile, and Python needs
// only indentation from an editor here. Tab indents and Shift+Tab dedents the line or the selected
// lines by four spaces; Escape then Tab leaves the editor, so the keyboard is never trapped
// (WCAG 2.1.2, as CodeMirror does it). Ctrl+S (or Cmd+S) saves. The caret's line and column are
// shown, since a Python traceback names lines.
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

const INDENT = '    '

export interface CodeEditorProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSave?: (() => void) | undefined
  readonly readOnly?: boolean
}

/** An edit of the text with the selection after it. */
export interface TextEdit {
  readonly value: string
  readonly start: number
  readonly end: number
}

/** Tab: four spaces at a caret; with lines selected, each selected line indented. */
export function indent(value: string, start: number, end: number): TextEdit {
  if (start === end || !value.slice(start, end).includes('\n')) {
    return {
      value: value.slice(0, start) + INDENT + value.slice(end),
      start: start + INDENT.length,
      end: start + INDENT.length,
    }
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const block = value.slice(lineStart, end)
  const lines = block.split('\n')
  const indented = lines.map((line) => INDENT + line).join('\n')
  return {
    value: value.slice(0, lineStart) + indented + value.slice(end),
    start: start + INDENT.length,
    end: end + INDENT.length * lines.length,
  }
}

/** Shift+Tab: up to four leading spaces removed from each line the selection touches. */
export function dedent(value: string, start: number, end: number): TextEdit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lines = value.slice(lineStart, end).split('\n')
  let removedFirst = 0
  let removed = 0
  const out = lines.map((line, i) => {
    const n = /^ {0,4}/.exec(line)?.[0].length ?? 0
    if (i === 0) removedFirst = n
    removed += n
    return line.slice(n)
  })
  return {
    value: value.slice(0, lineStart) + out.join('\n') + value.slice(end),
    start: Math.max(lineStart, start - removedFirst),
    end: Math.max(lineStart, end - removed),
  }
}

/** 1-based line and column of an offset. */
export function caretPosition(value: string, offset: number): { line: number; column: number } {
  const before = value.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 }
}

export function CodeEditor({ label, value, onChange, onSave, readOnly = false }: CodeEditorProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const ref = useRef<HTMLTextAreaElement>(null)
  /** Escape was the last key: the next Tab leaves the editor. */
  const released = useRef(false)
  const [caret, setCaret] = useState({ line: 1, column: 1 })
  const pendingSelection = useRef<{ start: number; end: number } | undefined>(undefined)

  useLayoutEffect(() => {
    const selection = pendingSelection.current
    const area = ref.current
    if (selection === undefined || area === null) return
    pendingSelection.current = undefined
    area.setSelectionRange(selection.start, selection.end)
  })

  const track = () => {
    const area = ref.current
    if (area !== null) setCaret(caretPosition(area.value, area.selectionStart))
  }

  const apply = (edit: TextEdit) => {
    pendingSelection.current = { start: edit.start, end: edit.end }
    onChange(edit.value)
    setCaret(caretPosition(edit.value, edit.start))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSave?.()
      return
    }
    if (event.key === 'Escape') {
      released.current = true
      return
    }
    const wasReleased = released.current
    released.current = false
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return
    if (wasReleased || readOnly) return // the browser moves focus
    event.preventDefault()
    const area = event.currentTarget
    apply((event.shiftKey ? dedent : indent)(area.value, area.selectionStart, area.selectionEnd))
  }

  return (
    <div className="wrx-field wrx-scripts__editor">
      <label className="wrx-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="wrx-scripts__code"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        rows={16}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.value)
          setCaret(caretPosition(event.target.value, event.target.selectionStart))
        }}
        onKeyDown={onKeyDown}
        onKeyUp={track}
        onClick={track}
        onSelect={track}
      />
      <p id={hintId} className="wrx-field__hint wrx-scripts__editor-hint">
        <span>Tab indents and Shift+Tab dedents. To leave the editor, press Escape, then Tab.</span>{' '}
        <span className="wrx-scripts__caret" aria-hidden="true">
          Line {caret.line}, column {caret.column}
        </span>
      </p>
    </div>
  )
}
