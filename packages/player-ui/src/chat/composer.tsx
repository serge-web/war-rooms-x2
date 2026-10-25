// The composer (PLY-44, PLY-53, PLY-33, PLY-12): a text area at the foot of the panel that grows
// with its text; Enter sends and Shift+Enter starts a new line. Text over the size cap is not
// sent. A refused post keeps its text and says why. When the role may not post, the composer is
// disabled with an explanation; text already typed stays selectable so it can be copied.
import { Button } from '@wrx/ui'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import { messageSize, sizeNote } from './format.ts'

export type SendOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface ComposerCoreProps {
  /** Sends the text; resolves when the server has accepted or refused it. */
  readonly onSend: (text: string) => Promise<SendOutcome>
  /** Why this role cannot post here; set, the composer is disabled with this explanation. */
  readonly disabledReason?: string | undefined
  /** Text to start with, e.g. a post the server refused before the panel was re-mounted. */
  readonly initialText?: string
  /** Why that text was refused. */
  readonly initialError?: string | undefined
  /** The text area's accessible name. */
  readonly label?: string
}

/** The tallest the text area grows before it scrolls, in pixels (also in chat.css). */
const MAX_HEIGHT = 200

/**
 * The browser sizes a text area to its content from CSS alone (`field-sizing`). Support is the
 * same in every window of one browser, popouts included, so the global `CSS` answers for all.
 */
function sizesItself(): boolean {
  return 'CSS' in globalThis && CSS.supports('field-sizing', 'content')
}

function fitHeight(area: HTMLTextAreaElement): void {
  if (sizesItself()) return
  area.style.height = 'auto'
  area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`
}

export function ComposerCore({
  onSend,
  disabledReason,
  initialText = '',
  initialError,
  label = 'Message',
}: ComposerCoreProps) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState(initialError)
  const [sending, setSending] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const noteId = useId()
  const errorId = useId()
  const reasonId = useId()

  const size = messageSize(text)
  const note = sizeNote(size)
  const disabled = disabledReason !== undefined
  const canSend = !disabled && !sending && text.trim() !== '' && size.over === undefined

  // PLY-44: grow with the text, up to MAX_HEIGHT. CSS `field-sizing: content` does it where the
  // browser has it; elsewhere measure, and measure again once a web font loads or the width
  // changes, since either changes the text's height.
  useLayoutEffect(() => {
    if (areaRef.current !== null) fitHeight(areaRef.current)
  }, [text])
  useEffect(() => {
    const area = areaRef.current
    const view = area?.ownerDocument.defaultView
    if (area === null || view === null || view === undefined || sizesItself()) return
    const refit = () => {
      fitHeight(area)
    }
    const fonts = area.ownerDocument.fonts
    fonts.addEventListener('loadingdone', refit)
    let width = area.clientWidth
    const observer =
      'ResizeObserver' in view
        ? new view.ResizeObserver(() => {
            if (area.clientWidth === width) return
            width = area.clientWidth
            refit()
          })
        : undefined
    observer?.observe(area)
    return () => {
      fonts.removeEventListener('loadingdone', refit)
      observer?.disconnect()
    }
  }, [])

  const send = async () => {
    if (!canSend) return
    setSending(true)
    const outcome = await onSend(text)
    setSending(false)
    if (outcome.ok) {
      setText('')
      setError(undefined)
    } else {
      // PLY-33: the text stays, so it can be sent again or copied.
      setError(outcome.reason)
    }
    areaRef.current?.focus()
  }

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault()
    void send()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  const describedBy = [
    disabled ? reasonId : '',
    note === undefined ? '' : noteId,
    error !== undefined ? errorId : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <form className="wrx-composer" onSubmit={onSubmit} aria-label="Send a message">
      {disabled ? (
        <p id={reasonId} className="wrx-composer__reason">
          {disabledReason}
        </p>
      ) : null}
      {error === undefined ? null : (
        <p id={errorId} className="wrx-composer__error" role="alert">
          Not sent: {error} Your text is kept below.
        </p>
      )}
      <div className="wrx-composer__row">
        <textarea
          ref={areaRef}
          className="wrx-composer__input"
          aria-label={label}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          aria-invalid={size.over !== undefined || undefined}
          placeholder={disabled ? undefined : 'Write a message'}
          title="Enter sends; Shift+Enter adds a line"
          aria-keyshortcuts="Enter Shift+Enter"
          rows={1}
          value={text}
          // Disabled when empty; read-only with text, so a refused post can still be copied.
          disabled={disabled && text === ''}
          readOnly={disabled && text !== ''}
          aria-disabled={disabled || undefined}
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" variant="primary" disabled={!canSend} busy={sending}>
          Send
        </Button>
      </div>
      {note === undefined ? null : (
        <p
          id={noteId}
          className={
            size.over === undefined
              ? 'wrx-composer__note'
              : 'wrx-composer__note wrx-composer__error'
          }
        >
          {note}
        </p>
      )}
    </form>
  )
}
