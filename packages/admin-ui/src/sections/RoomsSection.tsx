// Rooms (ADM-6, ADM-7): name, room type from the registry, participants, and the type's own
// settings through the registry's admin editor slot (ARC-5). Reordered by drag and drop (ADM-8).
// The map room and the umpire room are the draft's own (§3 rule 18, PD8): they are never added,
// deleted or retyped here, and their participants are fixed, so the form says so instead of
// offering them; the umpire room's members are listed, read only.
import { effectiveAccess, roomConfig } from '@wrx/domain'
import type { ReactRoomTypeRegistry } from '@wrx/hooks'
import { LIMITS, isFixedRoomType } from '@wrx/schemas'
import type { DesignFile, Room } from '@wrx/schemas'
import { useState } from 'react'
import {
  AddForm,
  ConfirmDialog,
  EditForm,
  IssueList,
  ListAndForm,
  Notice,
  SectionFrame,
  SelectField,
  SortableList,
  TextField,
} from '../components/index.ts'
import {
  DEFAULT_ROOM_TYPE,
  addRoom,
  chatConfigOf,
  deleteRoom,
  isMapRoom,
  isUmpireRoom,
  moveRoom,
  sortedRoles,
  removeParticipant,
  setFreeText,
  setParticipant,
  setTemplateEntry,
  updateRoom,
} from '../draft/index.ts'
import { NodeNamesNotice, IdLine } from './common.tsx'
import type { SectionProps } from './common.tsx'
import { ParticipantsEditor } from './ParticipantsEditor.tsx'
import { RoomTemplatesEditor } from './RoomTemplatesEditor.tsx'

export interface RoomsSectionProps extends SectionProps {
  readonly registry: ReactRoomTypeRegistry
}

export function RoomsSectionCore({ draft, validation, onChange, registry }: RoomsSectionProps) {
  const rooms = draft.design.rooms
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selected = rooms.find((r) => r.id === chosen) ?? rooms[0]
  // The map and umpire rooms come with the draft; no other is added (§3 rule 18).
  const types = registry.list().filter((t) => !isFixedRoomType(t.type))
  const [newType, setNewType] = useState<string | undefined>(undefined)
  const addType =
    types.find((t) => t.type === newType)?.type ??
    types.find((t) => t.type === DEFAULT_ROOM_TYPE)?.type ??
    types[0]?.type ??
    DEFAULT_ROOM_TYPE

  return (
    <SectionFrame
      title="Rooms"
      intro={
        <>
          <RoomNamesNotice />
          <NodeNamesNotice kind="room" />
        </>
      }
    >
      <ListAndForm
        listLabel="Room list"
        list={
          <>
            <SortableList
              label="Rooms"
              items={rooms.map((r) => ({ ...r, label: r.name }))}
              selectedId={selected?.id}
              onSelect={setChosen}
              onMove={(id, index) => {
                onChange(moveRoom(draft, id, index))
              }}
              emptyText="No rooms yet."
            />
            <AddForm
              label="New room name"
              buttonLabel="Add room"
              onAdd={(name) => {
                const added = addRoom(draft, name, addType)
                onChange(added.draft)
                setChosen(added.id)
              }}
            >
              {types.length > 1 && (
                <SelectField
                  label="Room type"
                  value={addType}
                  options={types.map((t) => ({ value: t.type, label: t.label }))}
                  onChange={setNewType}
                />
              )}
            </AddForm>
          </>
        }
        form={
          selected === undefined ? (
            <p className="wrx-admin-muted">Add a room to edit it.</p>
          ) : (
            <RoomForm
              key={selected.id}
              room={selected}
              {...{ draft, validation, onChange, registry }}
            />
          )
        }
      />
    </SectionFrame>
  )
}

/**
 * R24: every role reads every room document, since the client finds its rooms by reading them
 * (§3 rule 15, PLY-60), so a room's name is no secret from any role.
 */
function RoomNamesNotice() {
  return (
    <Notice tone="warning" title="Room names are visible to every role.">
      Every player can read the name of every room, including rooms their role cannot use. Do not
      put plans or anything else confidential in a room&rsquo;s name.
    </Notice>
  )
}

/** The umpire room's members, as access gives them (§3 rules 4, 18): read only, never edited. */
function UmpireMembers({ design, room }: { readonly design: DesignFile; readonly room: Room }) {
  const cells = effectiveAccess(design).cells.get(room.id)
  const members = sortedRoles(design).flatMap((role) => {
    const access = cells?.get(role.id)?.access ?? 'none'
    return access === 'none' ? [] : [{ role, access }]
  })
  return (
    <section className="wrx-admin-fieldset" aria-label="Umpire room members">
      <h3 className="wrx-admin-group-title">Members</h3>
      <ul>
        <li>You, the admin (umpire): write</li>
        {members.map(({ role, access }) => (
          <li key={role.id}>
            {role.name.trim() === '' ? role.loginName : role.name}:{' '}
            {access === 'write' ? 'write' : 'read only (observer)'}
          </li>
        ))}
      </ul>
      {members.length === 0 ? (
        <p className="wrx-admin-hint">The White Force has no roles yet.</p>
      ) : null}
    </section>
  )
}

function RoomForm({
  room,
  draft,
  validation,
  onChange,
  registry,
}: RoomsSectionProps & { readonly room: Room }) {
  const design = draft.design
  const at = `rooms[${design.rooms.findIndex((r) => r.id === room.id)}]`
  const definition = registry.get(room.roomType)
  const config = roomConfig(registry, room, design.game)
  const Editor = definition?.adminEditor
  const chat = chatConfigOf(room)
  const types = registry.list().filter((t) => !isFixedRoomType(t.type))
  const map = isMapRoom(room)
  const umpire = isUmpireRoom(room)
  const fixed = map || umpire
  return (
    <EditForm
      title={`Room: ${room.name.trim() === '' ? '(unnamed)' : room.name}`}
      actions={
        fixed ? undefined : (
          <ConfirmDialog
            triggerLabel={`Delete ${room.name}`}
            title={`Delete ${room.name}?`}
            confirmLabel="Delete room"
            onConfirm={() => {
              onChange(deleteRoom(draft, room.id))
            }}
          >
            <p>
              If this room has been published, publishing the deletion destroys the room and its
              message history.
            </p>
            <p>Its id is never reused.</p>
          </ConfirmDialog>
        )
      }
    >
      <IdLine id={room.id} />
      <TextField
        label="Name"
        hint="Every role can read it, even roles not in this room."
        value={room.name}
        maxLength={LIMITS.nameChars}
        issues={validation.at(`${at}.name`)}
        onChange={(name) => {
          onChange(updateRoom(draft, room.id, { name }))
        }}
      />
      {map ? (
        <Notice tone="info">
          This is the game’s map room. Every game has exactly one, and every role sees it. Its type
          and participants are fixed; players see only the admin’s world states on it.
        </Notice>
      ) : umpire ? (
        <>
          <Notice tone="info">
            This is the game’s umpire room. Every game has exactly one: you and the White Force are
            its only members, and White Force scripts post their proposed world states here for you
            to load into the world-state draft. Its type and participants are fixed.
          </Notice>
          <UmpireMembers design={design} room={room} />
        </>
      ) : (
        <SelectField
          label="Room type"
          hint="Changing the type clears the type's settings."
          value={room.roomType}
          options={[
            ...types.map((t) => ({ value: t.type, label: t.label })),
            ...(definition === undefined
              ? [{ value: room.roomType, label: `${room.roomType} (not supported)` }]
              : []),
          ]}
          issues={validation.at(`${at}.roomType`)}
          onChange={(roomType) => {
            onChange(updateRoom(draft, room.id, { roomType }))
          }}
        />
      )}
      {!fixed && (
        <ParticipantsEditor
          design={design}
          room={room}
          path={`${at}.participants`}
          issuesAt={validation.at}
          onSet={(entry) => {
            onChange(setParticipant(draft, room.id, entry))
          }}
          onRemove={(kind, id) => {
            onChange(removeParticipant(draft, room.id, kind, id))
          }}
        />
      )}
      {fixed && <IssueList issues={validation.at(`${at}.participants`)} />}
      {chat !== undefined && (
        <RoomTemplatesEditor
          design={design}
          room={room}
          config={chat}
          issues={validation.at(`${at}.config.templates`)}
          onFreeText={(freeText) => {
            onChange(setFreeText(draft, room.id, freeText))
          }}
          onEntry={(kind, id, templateIds) => {
            onChange(setTemplateEntry(draft, room.id, kind, id, templateIds))
          }}
        />
      )}
      <fieldset className="wrx-admin-fieldset">
        <legend>{definition?.label ?? room.roomType} settings</legend>
        {definition === undefined ? (
          <Notice tone="error">This room type is not supported by this client.</Notice>
        ) : Editor === undefined ? (
          <p className="wrx-admin-muted">No settings for this room type.</p>
        ) : (
          <Editor
            room={room}
            config={config.ok ? config.value : room.config}
            onChange={(next) => {
              onChange(updateRoom(draft, room.id, { config: next }))
            }}
          />
        )}
        <IssueList
          issues={validation
            .at(`${at}.config`)
            .filter((i) => chat === undefined || !i.path.startsWith(`${at}.config.templates`))}
        />
      </fieldset>
    </EditForm>
  )
}
