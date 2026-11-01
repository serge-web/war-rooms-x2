import type { z } from 'zod'
import { designFileSchema } from './design.ts'
import {
  announcementSchema,
  assetSchema,
  directorySchema,
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  retiredSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { chatMessageBodySchema } from './message.ts'
import { themeSchema } from './theme.ts'

export interface CatalogueEntry {
  readonly title: string
  /** Where the payload lives. */
  readonly location: string
  /** Who may read and publish it, from SRD §3. */
  readonly access: string
  readonly schema: z.ZodType
  /** Field nesting to show; deeper fields are documented in their own entries. */
  readonly maxDepth?: number
}

/** Every payload the data dictionary documents (DOC-3), in reading order. */
export const CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  {
    title: 'Game setup',
    location: 'PubSub node `game-setup`',
    access: 'Read: anyone, including anonymous users. Publish: admin.',
    schema: gameSetupSchema,
  },
  {
    title: 'Force',
    location: 'PubSub node `forces:<forceId>`',
    access: 'Read: all game users. Publish: admin.',
    schema: forceSchema,
  },
  {
    title: 'Role',
    location: 'PubSub node `roles:<roleId>`; the role is the XMPP account `<loginName>@<domain>`',
    access: 'Read: all game users. Publish: admin.',
    schema: roleSchema,
  },
  {
    title: 'Room',
    location: 'PubSub node `rooms:<roomId>`',
    access: 'Read: game users. Publish: admin.',
    schema: roomSchema,
  },
  {
    title: 'Objectives',
    location: 'PubSub node `objectives:<forceId>`',
    access:
      "Read: the force's roles, every White Force role and the admin. Publish: the admin only, as one item (`admin`) replaced on each edit.",
    schema: objectivesSchema,
  },
  {
    title: 'Asset',
    location: 'PubSub node `assets:<assetId>`',
    access: "Read: game users; the game theme's assets also anonymously. Publish: admin.",
    schema: assetSchema,
  },
  {
    title: 'Announcement',
    location: 'One item of PubSub node `announcements`',
    access: 'Read: every role. Publish: admin.',
    schema: announcementSchema,
  },
  {
    title: 'Deleted force or role',
    location: 'One item of PubSub node `retired`, the item id the entity’s GUID',
    access: 'Read: all game users. Publish: admin. Never used to decide access.',
    schema: retiredSchema,
  },
  {
    title: 'Directory',
    location: 'PubSub node `directory`, one item `current`',
    access:
      'Read: every role. Publish: admin. A role finds its own role document from its login name here; the role document decides.',
    schema: directorySchema,
  },
  {
    title: 'Game state',
    location: 'PubSub node `game-state` (reserved)',
    access: 'Publish: admin.',
    schema: gameStateSchema,
  },
  {
    title: 'Theme',
    location: 'The `theme` field of game setup, forces and rooms',
    access: 'As its owning document.',
    schema: themeSchema,
  },
  {
    title: 'Chat message body',
    location: 'Body of a MUC groupchat message in a chat room',
    access: 'Room participants with write access post; all participants read.',
    schema: chatMessageBodySchema,
  },
  {
    title: 'Design file',
    location: 'A JSON file the admin exports and imports',
    access: 'Held by the admin. Never contains passwords.',
    schema: designFileSchema,
    maxDepth: 1,
  },
])
