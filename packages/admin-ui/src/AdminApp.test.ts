// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { chatRoomType, createRoomTypeRegistry, defaultRoomTypes, withSlots } from '@wrx/domain'
import type { AdminEditor, AdminEditorProps, PlayerPanel, ReactRoomTypeRegistry } from '@wrx/hooks'
import type { DesignFile } from '@wrx/schemas'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { sampleDesign, sampleDesignWithWhiteCell } from '../../schemas/src/fixtures.ts'
import { AdminApp } from './AdminApp.tsx'
import type { AdminAppProps, AdminSection } from './AdminApp.tsx'
import {
  createDraftStore,
  draftFromDesign,
  markPublished,
  memoryDraftPersistence,
  objectivesOf,
} from './draft/index.ts'
import type { Draft, DraftStore } from './draft/index.ts'
import type { ThemesSlotProps } from './sections/ThemesSection.tsx'

// Testing Library's automatic cleanup needs test globals, which this repo does not enable.
afterEach(cleanup)

const NOW = new Date('2026-10-25T09:30:00.000Z')

function registry(): ReactRoomTypeRegistry {
  return withSlots<PlayerPanel, AdminEditor>(defaultRoomTypes(), {})
}

interface Setup {
  readonly design?: DesignFile
  readonly draft?: Draft
  readonly section?: AdminSection
  readonly props?: Partial<AdminAppProps>
}

function setup({ design = sampleDesign(), draft, section = 'game', props = {} }: Setup = {}) {
  const store = createDraftStore({
    persistence: memoryDraftPersistence(),
    initial: () => draft ?? draftFromDesign(design),
  })
  const user = userEvent.setup()
  render(
    createElement(AdminApp, {
      store,
      registry: registry(),
      initialSection: section,
      now: () => NOW,
      ...props,
    }),
  )
  return { store, user, design: () => store.getSnapshot().draft.design }
}

const main = () => screen.getByRole('main')

function force(store: DraftStore, id: string) {
  return store.getSnapshot().draft.design.forces.find((f) => f.id === id)
}

function role(store: DraftStore, id: string) {
  return store.getSnapshot().draft.design.roles.find((r) => r.id === id)
}

function room(store: DraftStore, id: string) {
  return store.getSnapshot().draft.design.rooms.find((r) => r.id === id)
}

describe('layout (ADM-27, ADM-28)', () => {
  it('has a menu of sections, each opening its list and form', async () => {
    const { user } = setup()
    const nav = screen.getByRole('navigation', { name: 'Admin sections' })
    const items = within(nav).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual([
      'Game',
      'Forces',
      'Roles',
      'Rooms',
      'Themes',
      'Access matrix',
      'Publish',
      'Audit',
    ])
    expect(within(nav).getByRole('button', { name: 'Game' }).getAttribute('aria-current')).toBe(
      'page',
    )
    await user.click(within(nav).getByRole('button', { name: 'Forces' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Forces' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Forces' })).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Force: Blue' })).toBeTruthy()
    await user.click(within(nav).getByRole('button', { name: 'Themes' }))
    expect(main().textContent).toContain('Theme editing')
  })

  it('switches to the game view from the header toggle', async () => {
    const onSwitchToGame = vi.fn()
    const { user } = setup({ props: { onSwitchToGame } })
    const toggle = screen.getByRole('group', { name: 'View' })
    expect(within(toggle).getByRole('button', { name: 'Admin', pressed: true })).toBeTruthy()
    await user.click(within(toggle).getByRole('button', { name: 'Game', pressed: false }))
    expect(onSwitchToGame).toHaveBeenCalledTimes(1)
  })

  it('hides the toggle without a game view', () => {
    setup()
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull()
  })

  it('fills the themes slot with the draft (WP 2.8)', async () => {
    const Themes = ({ draft, onChange }: ThemesSlotProps) =>
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onChange({
              ...draft,
              design: { ...draft.design, game: { ...draft.design.game, name: 'Themed' } },
            })
          },
        },
        `Theme ${draft.design.game.name}`,
      )
    const { user, design } = setup({ section: 'themes', props: { themes: Themes } })
    await user.click(screen.getByRole('button', { name: 'Theme Exercise Northern Gate' }))
    expect(design().game.name).toBe('Themed')
  })

  it('counts each section’s issues in the menu', () => {
    const base = sampleDesign()
    setup({ design: { ...base, game: { ...base.game, name: '' } } })
    const nav = screen.getByRole('navigation', { name: 'Admin sections' })
    expect(within(nav).getByRole('button', { name: 'Game 1 error' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Access matrix 1 error' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Forces' })).toBeTruthy()
  })

  it('reports an unreadable saved draft and failed saves', async () => {
    const store = createDraftStore({
      persistence: {
        load: () => '{broken',
        save: () => {
          throw new Error('quota exceeded')
        },
        clear: () => undefined,
      },
      initial: () => draftFromDesign(sampleDesign()),
    })
    const user = userEvent.setup()
    render(createElement(AdminApp, { store, registry: registry() }))
    expect(screen.getByRole('alert').textContent).toContain('The saved draft could not be read.')
    expect(screen.getByText('Draft saved in this browser.')).toBeTruthy()
    await user.type(screen.getByLabelText('Description'), '!')
    expect(screen.getByText(/could not be saved: quota exceeded/)).toBeTruthy()
  })
})

describe('game (ADM-3)', () => {
  it('edits name and description', async () => {
    const { user, design } = setup()
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Exercise Cold Start')
    expect(design().game.name).toBe('Exercise Cold Start')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Exercise Cold Start')
    await user.type(screen.getByLabelText('Description'), ' More.')
    expect(design().game.description).toBe('A two-sided negotiation exercise. More.')
  })

  it('shows a schema error under an empty name', async () => {
    const { user } = setup()
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(main().textContent).toContain('Error:')
  })

  // Sanitising is checked in Chromium (e2e/editor.spec.ts): DOMPurify does not work under
  // happy-dom, which drops headings and keeps event handlers.
  it('warns that the briefing is public and previews it (PLY-48)', async () => {
    const { user, design } = setup()
    expect(main().textContent).toContain('The briefing is public.')
    const briefing = screen.getByRole('textbox', { name: 'Briefing' })
    await user.clear(briefing)
    await user.type(briefing, '# Welcome{enter}{enter}Doors open at 08:00.')
    expect(design().game.briefing).toBe('# Welcome\n\nDoors open at 08:00.')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = screen.getByRole('tabpanel', { name: 'Preview' })
    expect(preview.textContent).toContain('Doors open at 08:00.')
    await user.click(screen.getByRole('tab', { name: 'Write' }))
    await user.clear(screen.getByRole('textbox', { name: 'Briefing' }))
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('tabpanel', { name: 'Preview' }).textContent).toBe(
      'Nothing to preview.',
    )
  })
})

describe('forces (ADM-4, ADM-23)', () => {
  it('adds a force with a generated id and selects it', async () => {
    const { user, store } = setup({ section: 'forces' })
    await user.type(screen.getByLabelText('New force name'), 'Green Force')
    await user.click(screen.getByRole('button', { name: 'Add force' }))
    expect(force(store, 'green-force')).toMatchObject({ name: 'Green Force', order: 3 })
    expect(screen.getByRole('form', { name: 'Force: Green Force' })).toBeTruthy()
    expect(main().textContent).toContain('green-force')
  })

  it('edits name, colour, icon and umpire flag', async () => {
    const { user, store } = setup({ section: 'forces' })
    const name = screen.getByLabelText('Name')
    await user.type(name, ' Team')
    expect(force(store, 'blue')?.name).toBe('Blue Team')

    const hex = screen.getByLabelText('Colour')
    await user.clear(hex)
    await user.type(hex, '#12')
    expect(main().textContent).toContain('use a colour as #rrggbb')
    expect(force(store, 'blue')?.colour).toBe('#1d4ed8')
    await user.type(hex, '3456')
    expect(force(store, 'blue')?.colour).toBe('#123456')
    expect(screen.getByLabelText<HTMLInputElement>('Colour picker').value).toBe('#123456')

    await user.selectOptions(screen.getByLabelText('Icon'), 'game-logo')
    expect(force(store, 'blue')?.iconAssetId).toBe('game-logo')
    await user.selectOptions(screen.getByLabelText('Icon'), '')
    expect(force(store, 'blue')).not.toHaveProperty('iconAssetId')

    // Exactly one force carries the umpire flag (ADM-4): setting it on Blue clears it on White.
    await user.click(screen.getByLabelText('Umpire flag (White Force)'))
    expect(force(store, 'blue')?.isUmpire).toBe(true)
    expect(force(store, 'white')?.isUmpire).toBe(false)
    await user.click(screen.getByLabelText('Umpire flag (White Force)'))
    expect(force(store, 'blue')?.isUmpire).toBe(false)
    expect(main().textContent).toContain(
      'no force carries the umpire flag; exactly one, the White Force, is expected (ADM-4)',
    )
  })

  it('writes objectives with a preview', async () => {
    const { user, store } = setup({ section: 'forces' })
    const editor = screen.getByRole('textbox', { name: 'Objectives' })
    await user.clear(editor)
    await user.type(editor, '**Hold** the bridge')
    expect(objectivesOf(store.getSnapshot().draft.design, 'blue')).toEqual({
      schemaVersion: 1,
      forceId: 'blue',
      markdown: '**Hold** the bridge',
      updatedAt: NOW.toISOString(),
    })
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = screen.getByRole('tabpanel', { name: 'Preview' })
    expect(preview.querySelector('strong')?.textContent).toBe('Hold')
  })

  it('will not delete a force with roles, and says why', async () => {
    const { user, store } = setup({ section: 'forces' })
    await user.click(screen.getByRole('button', { name: 'Delete Blue' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Blue cannot be deleted yet' })
    expect(dialog.textContent).toContain('Blue CO')
    expect(dialog.textContent).toContain('Blue HQ')
    expect(within(dialog).queryByRole('button', { name: 'Delete force' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(force(store, 'blue')).toBeDefined()
  })

  it('deletes a force after confirmation, and never reuses its id', async () => {
    const { user, store } = setup({ section: 'forces' })
    await user.type(screen.getByLabelText('New force name'), 'Green')
    await user.click(screen.getByRole('button', { name: 'Add force' }))
    await user.click(screen.getByRole('button', { name: 'Delete Green' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Green?' })
    expect(dialog.textContent).toContain('Nothing else refers to this force.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete force' }))
    expect(force(store, 'green')).toBeUndefined()
    await user.type(screen.getByLabelText('New force name'), 'Green')
    await user.click(screen.getByRole('button', { name: 'Add force' }))
    expect(force(store, 'green-2')).toBeDefined()
  })
})

describe('roles (ADM-5, ADM-14)', () => {
  it('adds a role to the chosen force', async () => {
    const { user, store } = setup({ section: 'roles' })
    await user.type(screen.getByLabelText('New role name'), 'Red Logistics')
    await user.selectOptions(screen.getByLabelText('In force'), 'red')
    await user.click(screen.getByRole('button', { name: 'Add role' }))
    expect(role(store, 'red-logistics')).toMatchObject({ forceId: 'red', order: 1 })
    expect(screen.getByRole('form', { name: 'Role: Red Logistics' })).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Roles in Red' })).getAllByRole('listitem'),
    ).toHaveLength(2)
  })

  it('edits name and observer flag, and moves force keeping the id', async () => {
    const { user, store } = setup({ section: 'roles' })
    await user.type(screen.getByLabelText('Name'), ' (acting)')
    expect(role(store, 'blue-co')?.name).toBe('Blue CO (acting)')
    await user.click(screen.getByLabelText('Observer'))
    expect(role(store, 'blue-co')?.isObserver).toBe(true)
    await user.selectOptions(screen.getByLabelText('Force'), 'red')
    expect(role(store, 'blue-co')).toMatchObject({ forceId: 'red', order: 1 })
    expect(
      within(screen.getByRole('list', { name: 'Roles in Red' })).getByText('Blue CO (acting)'),
    ).toBeTruthy()
  })

  it('changes the login id before publishing, and refuses bad ones', async () => {
    const { user, store } = setup({ section: 'roles' })
    const login = screen.getByLabelText('Login id')
    await user.clear(login)
    await user.type(login, 'red-co')
    await user.click(screen.getByRole('button', { name: 'Change login id' }))
    expect(screen.getByRole('alert').textContent).toBe('Error: another role is "red-co"')
    expect(login.getAttribute('aria-invalid')).toBe('true')
    await user.clear(login)
    await user.type(login, 'blue-commander{enter}')
    expect(role(store, 'blue-commander')).toBeDefined()
    expect(role(store, 'blue-co')).toBeUndefined()
    expect(room(store, 'negotiation')?.participants[0]?.id).toBe('blue-commander')
    expect(screen.getByRole('form', { name: 'Role: Blue CO' })).toBeTruthy()
  })

  it('fixes the login id once published', () => {
    setup({ section: 'roles', draft: markPublished(draftFromDesign(sampleDesign())) })
    const login = screen.getByLabelText<HTMLInputElement>('Login id')
    expect(login.readOnly).toBe(true)
    expect(main().textContent).toContain('Fixed: this role has been published.')
    expect(screen.queryByRole('button', { name: 'Change login id' })).toBeNull()
  })

  it('warns that history stays before deleting a role', async () => {
    const { user, store } = setup({ section: 'roles' })
    await user.click(screen.getByRole('button', { name: 'Delete Blue CO' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Blue CO?' })
    expect(dialog.textContent).toContain('Message history stays.')
    expect(dialog.textContent).toContain('still attributed to its login id blue-co')
    expect(dialog.textContent).toContain('Blue–Red negotiation')
    await user.click(within(dialog).getByRole('button', { name: 'Delete role' }))
    expect(role(store, 'blue-co')).toBeUndefined()
    expect(store.getSnapshot().draft.meta.retiredIds.roles).toEqual(['blue-co'])
  })
})

describe('rooms (ADM-6, ADM-7)', () => {
  it('adds a room and edits its participants', async () => {
    const { user, store } = setup({ section: 'rooms' })
    await user.type(screen.getByLabelText('New room name'), 'Press room')
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    expect(room(store, 'press-room')).toMatchObject({ roomType: 'chat', participants: [] })
    expect(main().textContent).toContain('No settings for this room type.')

    await user.selectOptions(screen.getByLabelText('Add participant'), 'force:red')
    await user.selectOptions(screen.getByLabelText('With access'), 'read')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await user.selectOptions(screen.getByLabelText('Add participant'), 'role:blue-co')
    await user.selectOptions(screen.getByLabelText('With access'), 'write')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    expect(room(store, 'press-room')?.participants).toEqual([
      { kind: 'force', id: 'red', access: 'read' },
      { kind: 'role', id: 'blue-co', access: 'write' },
    ])

    await user.selectOptions(screen.getByLabelText('Access for Force: Red'), 'write')
    expect(room(store, 'press-room')?.participants[0]?.access).toBe('write')
    await user.click(screen.getByRole('button', { name: 'Remove Role: Blue CO (Blue)' }))
    expect(room(store, 'press-room')?.participants).toEqual([
      { kind: 'force', id: 'red', access: 'write' },
    ])
  })

  it('renames and deletes a room', async () => {
    const { user, store } = setup({ section: 'rooms' })
    await user.type(screen.getByLabelText('Name'), ' main')
    expect(room(store, 'blue-hq')?.name).toBe('Blue HQ main')
    await user.click(screen.getByRole('button', { name: 'Delete Blue HQ main' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Blue HQ main?' })
    expect(dialog.textContent).toContain('destroys the room and its message history')
    await user.click(within(dialog).getByRole('button', { name: 'Delete room' }))
    expect(room(store, 'blue-hq')).toBeUndefined()
    expect(screen.getByRole('form', { name: 'Room: Red HQ' })).toBeTruthy()
  })

  it('shows the registry’s admin editor for type settings (ADM-7)', async () => {
    const SlowMode = ({ config, onChange }: AdminEditorProps) => {
      const parsed = z.object({ slow: z.boolean() }).safeParse(config)
      return createElement(
        'label',
        null,
        createElement('input', {
          type: 'checkbox',
          checked: parsed.success && parsed.data.slow,
          onChange: (e: { target: { checked: boolean } }) => {
            onChange({ slow: e.target.checked })
          },
        }),
        'Slow mode',
      )
    }
    const types = withSlots<PlayerPanel, AdminEditor>(
      createRoomTypeRegistry([
        { ...chatRoomType, configSchema: z.object({ slow: z.boolean().default(false) }) },
      ]),
      { chat: { adminEditor: SlowMode } },
    )
    const { user, store } = setup({ section: 'rooms', props: { registry: types } })
    await user.click(screen.getByLabelText('Slow mode'))
    expect(room(store, 'blue-hq')?.config).toEqual({ slow: true })
  })

  it('flags a room type the registry does not know', () => {
    const base = sampleDesign()
    setup({
      section: 'rooms',
      design: { ...base, rooms: base.rooms.map((r) => ({ ...r, roomType: 'map' })) },
    })
    expect(main().textContent).toContain('This room type is not supported by this client.')
    expect(main().textContent).toContain('room type "map" is not supported')
  })
})

describe('reordering (ADM-8)', () => {
  // happy-dom does no layout, so each sortable row reports a box from its position.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const row = this.closest<HTMLElement>('[data-sort-index]')
      const top = Number(row?.dataset.sortIndex ?? 0) * 40
      return DOMRect.fromRect({ x: 0, y: top, width: 300, height: 36 })
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const names = (list: HTMLElement) =>
    within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.wrx-admin-list-label')?.textContent)

  it('reorders forces with the keyboard sensor, and announces it', async () => {
    const { user, design } = setup({ section: 'forces' })
    const handle = screen.getByRole('button', { name: 'Reorder Blue' })
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable')
    handle.focus()
    await user.keyboard(' ')
    expect(handle.getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('{ArrowDown}')
    expect(document.body.textContent).toContain('Blue moved to position 2 of 3.')
    await user.keyboard(' ')
    expect(document.body.textContent).toContain('Blue dropped in position 2 of 3.')
    expect(design().forces.map((f) => `${f.id}:${f.order}`)).toEqual(['red:0', 'blue:1', 'white:2'])
    expect(names(screen.getByRole('list', { name: 'Forces' }))).toEqual(['Red', 'Blue', 'White'])
  })

  it('cancels a keyboard move with Escape', async () => {
    const { user, design } = setup({ section: 'rooms' })
    screen.getByRole('button', { name: 'Reorder Blue HQ' }).focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Escape}')
    expect(design().rooms.map((r) => r.id)).toEqual(['blue-hq', 'red-hq', 'negotiation'])
    expect(document.body.textContent).toContain('Moving Blue HQ cancelled.')
  })

  it('moves rooms and roles with the Move buttons', async () => {
    const { user, design } = setup({ section: 'rooms' })
    await user.click(screen.getByRole('button', { name: 'Move Blue–Red negotiation up' }))
    expect(design().rooms.map((r) => `${r.id}:${r.order}`)).toEqual([
      'blue-hq:0',
      'negotiation:1',
      'red-hq:2',
    ])
    expect(screen.getByRole('button', { name: 'Move Blue HQ up' })).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: 'Roles' }))
    await user.click(screen.getByRole('button', { name: 'Move Blue CO down' }))
    expect(
      design()
        .roles.map((r) => `${r.id}:${r.order}`)
        .slice(0, 2),
    ).toEqual(['blue-observer:0', 'blue-co:1'])
  })
})

describe('access matrix (ADM-9)', () => {
  /** The cell's access for a room row and role column, read the way a screen reader would. */
  function access(table: HTMLElement, roomName: string, roleName: string): string | undefined {
    const headers = within(table).getAllByRole('columnheader')
    const roleHeaders = headers.slice(
      headers.length - table.querySelectorAll('thead tr:last-child th').length,
    )
    const column = roleHeaders.findIndex((h) => h.firstChild?.textContent === roleName)
    const row = within(table).getByRole('rowheader', { name: roomName }).closest('tr')
    return row?.querySelectorAll('td')[column]?.dataset.access
  }

  it('shows write, read and none with the precedence rules', () => {
    setup({ section: 'access', design: sampleDesignWithWhiteCell() })
    const table = screen.getByRole('table', { name: /Effective access/ })
    // A force entry.
    expect(access(table, 'Blue HQ', 'Blue CO')).toBe('write')
    expect(access(table, 'Blue HQ', 'Red CO')).toBe('none')
    // An observer is read-only, even where its force writes.
    expect(access(table, 'Blue HQ', 'Blue Observer')).toBe('read')
    // A White Force role writes everywhere, with no entry; its observer, with no rooms
    // assigned, reads everywhere.
    for (const roomName of ['Blue HQ', 'Red HQ', 'Blue–Red negotiation']) {
      expect(access(table, roomName, 'White Cell')).toBe('write')
      expect(access(table, roomName, 'White Observer')).toBe('read')
    }
    // Role entries.
    expect(access(table, 'Blue–Red negotiation', 'Red CO')).toBe('write')
    expect(access(table, 'Blue–Red negotiation', 'Blue Observer')).toBe('none')
    // Headers group roles by force.
    expect(within(table).getByRole('columnheader', { name: 'White' }).getAttribute('scope')).toBe(
      'colgroup',
    )
    expect(table.textContent).toContain('(White Force)')
    expect(table.textContent).toContain('(White observer, no rooms assigned: reads all)')
  })

  it('limits a White observer to its assigned rooms, read only, and follows edits live (F5)', async () => {
    const base = sampleDesign()
    const { user } = setup({
      section: 'access',
      design: {
        ...base,
        rooms: base.rooms.map((r) =>
          r.id === 'negotiation'
            ? {
                ...r,
                participants: [
                  ...r.participants,
                  { kind: 'role' as const, id: 'white-observer', access: 'write' as const },
                ],
              }
            : r,
        ),
      },
    })
    let table = screen.getByRole('table', { name: /Effective access/ })
    expect(access(table, 'Blue–Red negotiation', 'White Observer')).toBe('read')
    expect(access(table, 'Red HQ', 'White Observer')).toBe('none')
    expect(table.textContent).toContain('(role entry, observer)')
    expect(table.textContent).toContain('(White observer, not assigned here)')

    // No longer an observer: a White Force role writes everywhere.
    await user.click(screen.getByRole('button', { name: 'Roles' }))
    await user.click(screen.getByRole('button', { name: 'White Observer Observer' }))
    await user.click(screen.getByLabelText('Observer'))
    await user.click(screen.getByRole('button', { name: 'Access matrix' }))
    table = screen.getByRole('table', { name: /Effective access/ })
    expect(access(table, 'Red HQ', 'White Observer')).toBe('write')
    expect(access(table, 'Blue–Red negotiation', 'White Observer')).toBe('write')
  })

  it('lists entries that grant nothing, and every design check', () => {
    const base = sampleDesign()
    setup({
      section: 'access',
      design: {
        ...base,
        rooms: base.rooms.map((r) =>
          r.id === 'red-hq'
            ? {
                ...r,
                participants: [...r.participants, { kind: 'role', id: 'ghost', access: 'write' }],
              }
            : r,
        ),
      },
    })
    expect(main().textContent).toContain('Red HQ: unknown role "ghost" (grants nothing)')
    expect(main().textContent).toContain('1 error (these block publishing), 0 warnings.')
    expect(main().textContent).toContain('rooms[1].participants[1]')
  })

  it('says when there is nothing to show', () => {
    const base = sampleDesign()
    setup({ section: 'access', design: { ...base, rooms: [] } })
    expect(main().textContent).toContain('Add rooms and roles to see who can use each room.')
    expect(main().textContent).toContain('No problems: the design can be published.')
  })
})
