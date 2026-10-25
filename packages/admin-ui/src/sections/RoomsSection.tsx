// Rooms (ADM-6, ADM-7): name, room type from the registry, participants, and the type's own
// settings through the registry's admin editor slot (ARC-5). Reordered by drag and drop (ADM-8).
import { roomConfig } from '@wrx/domain'
import type { ReactRoomTypeRegistry } from '@wrx/hooks'
import { LIMITS } from '@wrx/schemas'
import type { Room } from '@wrx/schemas'
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
  deleteRoom,
  moveRoom,
  removeParticipant,
  setParticipant,
  updateRoom,
} from '../draft/index.ts'
import { NodeNamesNotice, IdLine } from './common.tsx'
import type { SectionProps } from './common.tsx'
import { ParticipantsEditor } from './ParticipantsEditor.tsx'

export interface RoomsSectionProps extends SectionProps {
  readonly registry: ReactRoomTypeRegistry
}

export function RoomsSectionCore({ draft, validation, onChange, registry }: RoomsSectionProps) {
  const rooms = draft.design.rooms
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selected = rooms.find((r) => r.id === chosen) ?? rooms[0]
  const types = registry.list()
  const [newType, setNewType] = useState<string | undefined>(undefined)
  const addType =
    types.find((t) => t.type === newType)?.type ??
    types.find((t) => t.type === DEFAULT_ROOM_TYPE)?.type ??
    types[0]?.type ??
    DEFAULT_ROOM_TYPE

  return (
    <SectionFrame title="Rooms" intro={<NodeNamesNotice kind="room" />}>
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
  return (
    <EditForm
      title={`Room: ${room.name.trim() === '' ? '(unnamed)' : room.name}`}
      actions={
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
      }
    >
      <IdLine id={room.id} />
      <TextField
        label="Name"
        value={room.name}
        maxLength={LIMITS.nameChars}
        issues={validation.at(`${at}.name`)}
        onChange={(name) => {
          onChange(updateRoom(draft, room.id, { name }))
        }}
      />
      <SelectField
        label="Room type"
        hint="Changing the type clears the type's settings."
        value={room.roomType}
        options={[
          ...registry.list().map((t) => ({ value: t.type, label: t.label })),
          ...(definition === undefined
            ? [{ value: room.roomType, label: `${room.roomType} (not supported)` }]
            : []),
        ]}
        issues={validation.at(`${at}.roomType`)}
        onChange={(roomType) => {
          onChange(updateRoom(draft, room.id, { roomType }))
        }}
      />
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
        <IssueList issues={validation.at(`${at}.config`)} />
      </fieldset>
    </EditForm>
  )
}
