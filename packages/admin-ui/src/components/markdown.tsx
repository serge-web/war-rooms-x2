// Markdown for the briefing and objectives (ui-stack.md): `marked`, then DOMPurify on every
// rendered string, so the preview shows what players will see without running anything.
import * as Tabs from '@radix-ui/react-tabs'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { DesignIssue } from '@wrx/schemas'
import { IssueList } from './controls.tsx'

/** Markdown as sanitised HTML. A new `Marked` per call keeps no shared, mutable parser. */
export function renderMarkdown(markdown: string): string {
  const html = new Marked({ gfm: true, breaks: false }).parse(markdown, { async: false })
  return DOMPurify.sanitize(html)
}

export function MarkdownView({
  markdown,
  empty = 'Nothing to preview.',
}: {
  readonly markdown: string
  readonly empty?: string
}) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (markdown.trim() === '') return <p className="wrx-admin-muted">{empty}</p>
  return <div className="wrx-admin-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

export interface MarkdownEditorProps {
  readonly label: string
  readonly value: string
  readonly onChange: (markdown: string) => void
  readonly hint?: ReactNode
  readonly issues?: readonly DesignIssue[]
  readonly maxLength?: number
}

/** A Markdown text area with a Write / Preview pair of tabs (ADM-23, PLY-46). */
export function MarkdownEditor({
  label,
  value,
  onChange,
  hint,
  issues = [],
  maxLength,
}: MarkdownEditorProps) {
  const id = useId()
  const hintId = hint === undefined ? undefined : `${id}-hint`
  const issuesId = issues.length === 0 ? undefined : `${id}-issues`
  const describedBy = [hintId, issuesId].filter((x) => x !== undefined).join(' ') || undefined
  return (
    <div className="wrx-admin-field wrx-admin-markdown-editor">
      <span className="wrx-admin-label" id={`${id}-label`}>
        {label}
      </span>
      {hint !== undefined && (
        <div className="wrx-admin-hint" id={hintId}>
          {hint}
        </div>
      )}
      <Tabs.Root defaultValue="write">
        <Tabs.List className="wrx-admin-tabs" aria-label={`${label}: write or preview`}>
          <Tabs.Trigger className="wrx-admin-tab" value="write">
            Write
          </Tabs.Trigger>
          <Tabs.Trigger className="wrx-admin-tab" value="preview">
            Preview
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="write" className="wrx-admin-tab-panel">
          <textarea
            className="wrx-admin-input wrx-admin-textarea-tall"
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
            aria-invalid={issues.some((i) => i.severity === 'error') || undefined}
            value={value}
            maxLength={maxLength}
            rows={10}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </Tabs.Content>
        <Tabs.Content value="preview" className="wrx-admin-tab-panel wrx-admin-preview">
          <MarkdownView markdown={value} />
        </Tabs.Content>
      </Tabs.Root>
      <IssueList id={issuesId} issues={issues} />
    </div>
  )
}
