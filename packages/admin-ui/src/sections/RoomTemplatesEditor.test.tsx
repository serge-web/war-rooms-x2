// @vitest-environment happy-dom
// The room's template table (WP 4.3, TD4): unticking the last template of a force that is not a
// participant removes its entry, and its row stays, unticked, so the admin can tick another
// (found by SC-10, WP 4.4: the row went with its entry).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DesignFile } from '@wrx/schemas'
import { FORCE, ROOM, templatedDesign } from '@wrx/schemas/fixtures'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { chatConfigOf, draftFromDesign, setTemplateEntry } from '../draft/index.ts'
import type { Draft } from '../draft/index.ts'
import { RoomTemplatesEditor } from './RoomTemplatesEditor.tsx'

afterEach(cleanup)

function Harness({ start }: { start: Draft }) {
  const [draft, setDraft] = useState(start)
  const room = draft.design.rooms.find((r) => r.id === ROOM.negotiation)
  const config = room === undefined ? undefined : chatConfigOf(room)
  if (room === undefined || config === undefined) return null
  return (
    <RoomTemplatesEditor
      design={draft.design}
      room={room}
      config={config}
      issues={[]}
      onFreeText={() => undefined}
      onEntry={(kind, id, ids) => {
        setDraft(setTemplateEntry(draft, room.id, kind, id, ids))
      }}
    />
  )
}

describe('RoomTemplatesEditor', () => {
  it('keeps a row whose last template is unticked, so another can be ticked', () => {
    const design: DesignFile = templatedDesign()
    const sitrep = design.templates[0]
    const contact = design.templates[1]
    if (sitrep === undefined || contact === undefined) throw new Error('no templates')
    // Blue (not a participant of the negotiation) may use the situation report there.
    const start = setTemplateEntry(draftFromDesign(design), ROOM.negotiation, 'force', FORCE.blue, [
      sitrep.id,
    ])
    render(<Harness start={start} />)
    const old = screen.getByRole<HTMLInputElement>('checkbox', {
      name: `Force: Blue may use ${sitrep.name}`,
    })
    expect(old.checked).toBe(true)
    fireEvent.click(old)
    const after = screen.getByRole<HTMLInputElement>('checkbox', {
      name: `Force: Blue may use ${sitrep.name}`,
    })
    expect(after.checked).toBe(false)
    const other = screen.getByRole<HTMLInputElement>('checkbox', {
      name: `Force: Blue may use ${contact.name}`,
    })
    fireEvent.click(other)
    expect(other.checked).toBe(true)
  })
})
