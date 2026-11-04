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
import { chatRoomConfigSchema, templateMessageBodySchema, templateSchema } from './template.ts'
import { themeSchema } from './theme.ts'
import { mapRoomConfigSchema, worldAssetSchema, worldStateMessageBodySchema } from './world.ts'

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
    title: 'Message template',
    location: 'One item of PubSub node `templates`, the item id the template’s GUID',
    access:
      'Read: every role. Publish: admin. Its schema is fixed once a published room offers it (`lockedAt`).',
    schema: templateSchema,
    maxDepth: 1,
  },
  {
    title: 'Game state',
    location: 'PubSub node `game-state`, one item `current`',
    access:
      'Read: every role. Publish: admin, who advances the turn. A first publish sets turn 1, planning; later publishes leave it alone.',
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
    title: 'Chat room config',
    location:
      'The `config` field of a `chat` room document, version 2; `{}` (version 1) means free text and no templates',
    access: 'As the room document.',
    schema: chatRoomConfigSchema,
  },
  {
    title: 'Template message body',
    location: 'Body of a MUC groupchat message in a chat room',
    access:
      'Room participants with write access post; every receiving client checks it against the template and the room config.',
    schema: templateMessageBodySchema,
  },
  {
    title: 'Map room config',
    location: 'The `config` field of the `map` room document; `{}` means the defaults',
    access: 'As the room document.',
    schema: mapRoomConfigSchema,
  },
  {
    title: 'World-state message body',
    location:
      'Body of a MUC groupchat message in the map room, up to 500,000 bytes as a stanza; every message carries the full state',
    access:
      'Every role reads the map room. Clients accept it only from the admin’s real JID and ignore any other sender.',
    schema: worldStateMessageBodySchema,
    maxDepth: 2,
  },
  {
    title: 'World-state asset',
    location: 'Each value of `content.assets` in a world-state message, keyed by its `id`',
    access: 'As the world-state message.',
    schema: worldAssetSchema,
  },
  {
    title: 'Design file',
    location: 'A JSON file the admin exports and imports',
    access: 'Held by the admin. Never contains passwords.',
    schema: designFileSchema,
    maxDepth: 1,
  },
])
