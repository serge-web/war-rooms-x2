# Data dictionary

Generated from the runtime schemas in `packages/schemas` (DOC-3). Do not edit by hand: run `pnpm dictionary`.

Every document carries `schemaVersion`; clients migrate older versions on read and ignore payloads that fail validation (ARC-6, NFR-5).

## Game setup

Game properties and the game theme.

- **Location:** PubSub node `game-setup`
- **Access:** Read: anyone, including anonymous users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `description` | string | yes | length ≤ 1000 | Short description |
| `briefing` | string | yes | length ≤ 20000 | Public Markdown briefing for the welcome page (PLY-46–48) |
| `designVersion` | integer | yes | ≥ 1 | Incremented by a publish that changes the structure: a room added or removed, or the effective access to a room of a role in both designs (§3 rule 8); keys saved layouts (PLY-5) |
| `theme` | object | yes |  | Theme: tokens plus optional logo and icon assets |
| `theme.tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `theme.tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `theme.logoAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `roomTypeDefaults` | map of map of any | yes |  | Default config per room type, validated by that type (ARC-5) |

## Force

A side in the game.

- **Location:** PubSub node `forces:<forceId>`
- **Access:** Read: all game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1) |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `colour` | string | yes | pattern `^#[0-9a-fA-F]{6}$` | Colour for message authors; not a theme token (§3 rule 13) |
| `iconAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `isUmpire` | boolean | yes |  | The umpire flag: this is the White Force, which the admin plays in as umpire; exactly one force has it (ADM-4, D8) |
| `order` | integer | yes | ≥ 0 | Admin-set display order; ties sort by id (SRD §3 rule 7) |
| `theme` | object | no |  | Styles the force panel only (D19) |
| `theme.tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `theme.tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `theme.logoAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |

## Role

A player position; one XMPP account.

- **Location:** PubSub node `roles:<roleId>`; the role is the XMPP account `<loginName>@<domain>`
- **Access:** Read: all game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Role id, a GUID |
| `loginName` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5) |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `forceId` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of the role's force |
| `isObserver` | boolean | yes |  | Observers read but never post, in all their rooms (D8) |
| `order` | integer | yes | ≥ 0 | Admin-set display order; ties sort by id (SRD §3 rule 7) |

## Room

A channel: one MUC room plus this config.

- **Location:** PubSub node `rooms:<roomId>`
- **Access:** Read: game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1) |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `roomType` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Room type id from the registry (v1: chat and map) |
| `participants` | array of object | yes |  | Mixed force and role entries; White Force roles are added implicitly, and a role entry assigns a White Force observer the room (§3 rule 4) |
| `participants[]` | object | yes |  | A room participant entry (§3 rule 4) |
| `participants[].kind` | enum | yes | one of "force", "role" |  |
| `participants[].id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Force or role id |
| `participants[].access` | enum | yes | one of "write", "read" | Read-only entries join as MUC visitors |
| `config` | map of any | yes |  | Type-specific config, validated by the room type (ARC-5) |
| `order` | integer | yes | ≥ 0 | Admin-set display order; ties sort by id (SRD §3 rule 7) |
| `theme` | object | no |  | Styles this room's panel and tab |
| `theme.tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `theme.tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `theme.logoAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |

## Objectives

A force's objectives; confidential to that force, the White Force and the admin.

- **Location:** PubSub node `objectives:<forceId>`
- **Access:** Read: the force's roles, every White Force role and the admin. Publish: the admin only, as one item (`admin`) replaced on each edit.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `forceId` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of the force these objectives belong to |
| `markdown` | string | yes | length ≤ 50000 | Objectives as Markdown |
| `updatedAt` | string | yes | format date-time | When the admin wrote this version, by the admin's clock; display only. The node holds one item, the admin's, replaced on each edit; a live notification replaces the copy fetched at login, whatever this says (§3 rule 14) |

## Asset

An image used by themes.

- **Location:** PubSub node `assets:<assetId>`
- **Access:** Read: game users; the game theme's assets also anonymously. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1) |
| `mimeType` | enum | yes | one of "image/png", "image/webp", "image/svg+xml" |  |
| `size` | integer | yes | ≥ 1; ≤ 180000 | Decoded size in bytes |
| `sha256` | string | yes | pattern `^[0-9a-f]{64}$` | SHA-256 of the decoded bytes, lowercase hex |
| `data` | string | yes | format base64; encoding base64 | The image, base64-encoded |

## Announcement

An out-of-game announcement from the admin.

- **Location:** One item of PubSub node `announcements`
- **Access:** Read: every role. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `text` | string | yes | length ≥ 1; length ≤ 2000 | Plain text |
| `postedAt` | string | yes | format date-time | Admin's clock when posted; display only |

## Deleted force or role

The last name of a deleted force or role.

- **Location:** One item of PubSub node `retired`, the item id the entity’s GUID
- **Access:** Read: all game users. Publish: admin. Never used to decide access.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The deleted force or role GUID; also the item id |
| `kind` | enum | yes | one of "force", "role" |  |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Its last display name |
| `loginName` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | A role’s login name, which no other role may take (§3 rule 1) |
| `colour` | string | no | pattern `^#[0-9a-fA-F]{6}$` | The force’s colour, or a role’s force’s colour when it was deleted |
| `deletedAt` | string | yes | format date-time | Admin's clock when the deletion was recorded |

## Directory

Where each entity document is, by GUID, and each role by login name.

- **Location:** PubSub node `directory`, one item `current`
- **Access:** Read: every role. Publish: admin. A role finds its own role document from its login name here; the role document decides.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `roles` | array of object | yes |  | Every role: its GUID and its login name |
| `roles[]` | object | yes |  |  |
| `roles[].id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The role GUID |
| `roles[].loginName` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5) |
| `forces` | array of string | yes |  | Every force GUID |
| `rooms` | array of string | yes |  | Every room GUID |

## Message template

A message template: a JSON Schema form the admin designs.

- **Location:** One item of PubSub node `templates`, the item id the template’s GUID
- **Access:** Read: every role. Publish: admin. Its schema is fixed once a published room offers it (`lockedAt`).

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The template GUID; also the item id |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Shown in the composer’s drop-down and on each card (TD7) |
| `description` | string | no | length ≤ 1000 | For the admin and the composer; plain text (PLY-14) |
| `schema` | map of any | yes |  | JSON Schema 2020-12 in the WRX template profile: an object of up to 100 named scalar fields (text with a required maxLength of at most 8,000, or 200 with a pattern; number; integer; yes/no; date; date and time; a drop-down of up to 500 options; a force or role picker marked by x-wrx-picker, with x-wrx-scope and x-wrx-force), linked drop-downs and conditions one level deep (dependencies, if/then/else), and patterns that pass a safe-regex check. No $ref, arrays or nested objects |
| `uiSchema` | map of any | no |  | RJSF UI schema in the WRX template profile: field order, widgets, hints |
| `createdAt` | string | yes | format date-time | Admin's clock when created; display only |
| `lockedAt` | string | no | format date-time | Set by the first publish that makes the template available in a room; its schema is then fixed, and changing it means copying it to a new template (TD6, TPL-4) |

## Game state

The current turn and phase.

- **Location:** PubSub node `game-state`, one item `current`
- **Access:** Read: every role. Publish: admin, who advances the turn. A first publish sets turn 1, planning; later publishes leave it alone.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `turn` | integer | yes | ≥ 1; ≤ 10000 | The turn number, from 1 |
| `phase` | enum | yes | one of "planning", "adjudication" | Each turn has a planning phase, then an adjudication phase (D7) |

## Theme

Theme: tokens plus optional logo and icon assets.

- **Location:** The `theme` field of game setup, forces and rooms
- **Access:** As its owning document.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `logoAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |
| `iconAssetId` | string | no | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Id of an `assets:<id>` node |

## Chat message body

A chat room message.

- **Location:** Body of a MUC groupchat message in a chat room
- **Access:** Room participants with write access post; all participants read.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `type` | constant | yes | = "chat" |  |
| `schemaVersion` | constant | yes | = 1 |  |
| `content` | object | yes |  |  |
| `content.text` | string | yes | length ≥ 1; length ≤ 8000 | Plain text; rendered without HTML (PLY-14) |

## Chat room config

Chat room config: free text and templates.

- **Location:** The `config` field of a `chat` room document, version 2; `{}` (version 1) means free text and no templates
- **Access:** As the room document.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 2 |  |
| `freeText` | boolean | yes |  | Free text allowed beside templates (TD3) |
| `templates` | array of object | yes |  | Template entries per force or role (TD4) |
| `templates[]` | object | yes |  | Templates a force or role may use in a room (TD4, TPL-2) |
| `templates[].kind` | enum | yes | one of "force", "role" |  |
| `templates[].id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | Force or role GUID |
| `templates[].templateIds` | array of string | yes |  | Templates this force or role may use here; a role entry adds to its force’s |

## Template message body

A templated message.

- **Location:** Body of a MUC groupchat message in a chat room
- **Access:** Room participants with write access post; every receiving client checks it against the template and the room config.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `type` | constant | yes | = "template" |  |
| `schemaVersion` | constant | yes | = 1 |  |
| `content` | object | yes |  |  |
| `content.templateId` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The template used |
| `content.values` | map of any | yes |  | Field values by field name; pickers hold GUIDs, never names (TPL-8) |

## Map room config

Map room config: the opening view.

- **Location:** The `config` field of the `map` room document; `{}` means the defaults
- **Access:** As the room document.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `centre` | object | no |  | Where the map opens; unset, it fits the assets |
| `centre.lat` | number | yes | ≥ -90; ≤ 90 |  |
| `centre.lon` | number | yes | ≥ -180; ≤ 180 |  |
| `zoom` | integer | no | ≥ 0; ≤ 22 | The zoom it opens at; unset, it fits the assets |

## World-state message body

A world-state message in the map room, posted by the admin only.

- **Location:** Body of a MUC groupchat message in the map room, up to 500,000 bytes as a stanza; every message carries the full state
- **Access:** Every role reads the map room. Clients accept it only from the admin’s real JID and ignore any other sender.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `type` | constant | yes | = "world-state" |  |
| `schemaVersion` | constant | yes | = 1 |  |
| `content` | object | yes |  | The full world state: every asset with its position and status (D25) |
| `content.turn` | integer | yes | ≥ 1; ≤ 10000 | The turn this state belongs to |
| `content.assets` | map of object | yes |  | Every asset, keyed by its GUID; each key is its asset’s `id` |

## World-state asset

A unit or platform on the map, with the fixed fields of v1 (§3 rule 17).

- **Location:** Each value of `content.assets` in a world-state message, keyed by its `id`
- **Access:** As the world-state message.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `id` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The asset GUID; also its key in `assets` (§3 rules 1, 16) |
| `forceId` | string | yes | pattern `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | The force that owns the asset |
| `title` | string | yes | length ≥ 1; length ≤ 120 | Display name, e.g. "1st Armoured Squadron" |
| `category` | string | yes | length ≥ 1; length ≤ 60 | What kind of asset it is, e.g. "armour" or "frigate" |
| `sidc` | string | yes | pattern `^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}\|[0-9]{20}\|[0-9]{30})$` | MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D) |
| `lat` | number | yes | ≥ -90; ≤ 90 | Latitude, WGS 84 decimal degrees |
| `lon` | number | yes | ≥ -180; ≤ 180 | Longitude, WGS 84 decimal degrees |
| `state` | string | yes | length ≥ 1; length ≤ 60 | Its condition in words, e.g. "operational" or "damaged" |
| `health` | number | yes | ≥ 0; ≤ 100 | Health, 0 (destroyed) to 100 (full) |
| `fuel` | number | yes | ≥ 0; ≤ 100 | Fuel, 0 (empty) to 100 (full) |

## Design file

A complete game design, as exported and imported by the admin.

- **Location:** A JSON file the admin exports and imports
- **Access:** Held by the admin. Never contains passwords.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `format` | constant | yes | = "wrx1-design" |  |
| `schemaVersion` | constant | yes | = 3 |  |
| `exportedAt` | string | yes | format date-time | ISO 8601 date-time |
| `game` | object | yes |  | The game setup document |
| `forces` | array of object | yes |  | Force documents |
| `roles` | array of object | yes |  | Role documents; a `password` field is rejected |
| `rooms` | array of object | yes |  | Room documents |
| `objectives` | array of object | yes |  | Objectives documents, at most one per force |
| `assets` | array of object | yes |  | Asset documents |
| `retired` | array of object | yes |  | The last names of deleted forces and roles that were published, kept so old messages show them (§3 rule 1) |
| `templates` | array of object | yes |  | Message templates (Annex A); a file from before templates has none. Each locks when a published room makes it available (TPL-4) |
| `worldState` | object | no |  | The world state to set the map up with (ADM-16): the admin’s draft when exported, else the latest published state. Imported as the admin’s draft, published only by the admin (ADM-45) |
