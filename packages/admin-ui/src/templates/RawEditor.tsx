// The raw JSON Schema editor (WP 4.3, TD5, TPL-7): CodeMirror 6 with JSON, over the same template
// the builder edits. Profile issues are marked in place (lint) and listed below, so they reach a
// screen reader too. CodeMirror needs no eval and no workers; its styles go in a `<style>` element,
// which the CSP's `style-src 'self' 'unsafe-inline'` allows (F7).
//
// Tab is left to move focus out (WCAG 2.1.2, no keyboard trap); Escape then Tab also leaves, as
// CodeMirror documents.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { parseRaw, rawIssues } from './raw.ts'

export interface RawEditorProps {
  /** The text the editor starts with; later changes come from the editor. */
  readonly initialText: string
  readonly readOnly: boolean
  /** The editor's accessible name. */
  readonly label: string
  /** Id of the element that describes the editor (its problems list). */
  readonly describedBy?: string
  readonly onChange: (text: string) => void
}

/** The diagnostics for the text: JSON syntax first, then the shape, then the profile. */
function diagnostics(view: EditorView): Diagnostic[] {
  const syntax = jsonParseLinter()(view)
  if (syntax.length > 0) return syntax
  const text = view.state.doc.toString()
  const parsed = parseRaw(text)
  if (!parsed.ok) {
    return [{ from: 0, to: Math.min(1, text.length), severity: 'error', message: parsed.error }]
  }
  return rawIssues(text).map((issue) => ({ ...issue, severity: 'error' as const }))
}

const THEME = EditorView.theme({
  '&': {
    border: '1px solid var(--wrx-border, #d1d5db)',
    borderRadius: '6px',
    background: 'var(--wrx-background, #ffffff)',
    color: 'var(--wrx-text, #111827)',
    fontSize: '0.875rem',
  },
  '&.cm-focused': { outline: '3px solid var(--wrx-focus, #2563eb)', outlineOffset: '2px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-content': { minHeight: '16rem', caretColor: 'var(--wrx-text, #111827)' },
  '.cm-gutters': {
    background: 'var(--wrx-surface, #f9fafb)',
    color: 'var(--wrx-muted, #4b5563)',
    borderRight: '1px solid var(--wrx-border, #d1d5db)',
  },
})

export function RawEditor({ initialText, readOnly, label, describedBy, onChange }: RawEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | undefined>(undefined)
  const changed = useRef(onChange)
  const editable = useRef(new Compartment())
  const attributes = useRef(new Compartment())
  useEffect(() => {
    changed.current = onChange
  }, [onChange])

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          json(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lintGutter(),
          linter(diagnostics, { delay: 250 }),
          editable.current.of([EditorState.readOnly.of(readOnly)]),
          attributes.current.of(EditorView.contentAttributes.of({})),
          EditorView.lineWrapping,
          THEME,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = created
    return () => {
      created.destroy()
      view.current = undefined
    }
    // The editor is made once per mount; the text then lives in it. Its parent keys it by template.
  }, [])

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        editable.current.reconfigure([EditorState.readOnly.of(readOnly)]),
        attributes.current.reconfigure(
          EditorView.contentAttributes.of({
            'aria-label': label,
            ...(readOnly ? { 'aria-readonly': 'true' } : {}),
            ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
          }),
        ),
      ],
    })
  }, [readOnly, label, describedBy])

  return <div ref={host} className="wrx-template-raw" />
}
