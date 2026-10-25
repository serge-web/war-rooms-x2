// A reorderable list (ADM-8): drag and drop with dnd-kit, its keyboard sensor (Space to pick
// up, arrows to move, Space to drop, Escape to cancel) and screen-reader announcements, plus
// Move up / Move down buttons, the single-pointer alternative WCAG 2.2 asks for (NFR-14).
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import { Button } from './controls.tsx'

export interface SortableItem {
  readonly id: string
  /** The name read out and shown. */
  readonly label: string
}

export interface SortableListProps<T extends SortableItem> {
  /** The list's accessible name, e.g. "Forces". */
  readonly label: string
  readonly items: readonly T[]
  readonly selectedId?: string | undefined
  readonly onSelect: (id: string) => void
  /** Moves an item to a new index in this list. */
  readonly onMove: (id: string, index: number) => void
  /** Extra content after the name: a colour swatch, flags. */
  readonly decorate?: (item: T) => ReactNode
  readonly emptyText?: string
}

export function SortableList<T extends SortableItem>({
  label,
  items,
  selectedId,
  onSelect,
  onMove,
  decorate,
  emptyText = 'None yet.',
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const nameOf = (id: UniqueIdentifier) => items.find((i) => i.id === id)?.label ?? String(id)
  const position = (id: UniqueIdentifier) =>
    `position ${items.findIndex((i) => i.id === id) + 1} of ${items.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, in ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} moved to ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} dropped in ${position(over.id)}.`
        : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} cancelled.`,
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const index = items.findIndex((i) => i.id === over.id)
    if (index !== -1) onMove(String(active.id), index)
  }

  if (items.length === 0) return <p className="wrx-admin-muted">{emptyText}</p>
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To reorder, press Space or Enter to pick up, use the arrow keys to move, press Space or Enter to drop, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="wrx-admin-list" aria-label={label}>
          {items.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              selected={item.id === selectedId}
              onSelect={onSelect}
              onMove={onMove}
              decoration={decorate?.(item)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function Row({
  item,
  index,
  count,
  selected,
  onSelect,
  onMove,
  decoration,
}: {
  readonly item: SortableItem
  readonly index: number
  readonly count: number
  readonly selected: boolean
  readonly onSelect: (id: string) => void
  readonly onMove: (id: string, index: number) => void
  readonly decoration: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })
  return (
    <li
      ref={setNodeRef}
      data-sort-index={index}
      className={`wrx-admin-list-row${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="wrx-admin-handle"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${item.label}`}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        className="wrx-admin-list-name"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(item.id)
        }}
      >
        <span className="wrx-admin-list-label">
          {item.label.trim() === '' ? '(unnamed)' : item.label}
        </span>
        {decoration}
      </button>
      <span className="wrx-admin-list-moves">
        <Button
          variant="quiet"
          aria-label={`Move ${item.label} up`}
          disabled={index === 0}
          onClick={() => {
            onMove(item.id, index - 1)
          }}
        >
          <span aria-hidden="true">↑</span>
        </Button>
        <Button
          variant="quiet"
          aria-label={`Move ${item.label} down`}
          disabled={index === count - 1}
          onClick={() => {
            onMove(item.id, index + 1)
          }}
        >
          <span aria-hidden="true">↓</span>
        </Button>
      </span>
    </li>
  )
}
