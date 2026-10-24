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
| `designVersion` | integer | yes | ≥ 1 | Incremented on each publish that changes the design; keys saved layouts (PLY-5) |
| `theme` | object | yes |  | Theme: tokens plus optional logo and icon assets |
| `theme.tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `theme.tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `theme.logoAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `roomTypeDefaults` | map of map of any | yes |  | Default config per room type, validated by that type (ARC-5) |

## Force

A side in the game.

- **Location:** PubSub node `forces:<forceId>`
- **Access:** Read: all game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Stable URL-safe id, never reused (SRD §3 rule 1) |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `colour` | string | yes | pattern `^#[0-9a-fA-F]{6}$` | Colour for message authors; not a theme token (§3 rule 13) |
| `iconAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `isUmpire` | boolean | yes |  | Umpire-force roles are members of every room (D8) |
| `order` | integer | yes | ≥ 0 | Admin-set display order; ties sort by id (SRD §3 rule 7) |
| `theme` | object | no |  | Styles the force panel only (D19) |
| `theme.tokens` | object | yes |  | Design tokens; an unset token inherits from the game theme, then the default |
| `theme.tokens.primary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.secondary` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.background` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.surface` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.text` | string | no | pattern `^#[0-9a-fA-F]{6}$` | Colour as #rrggbb |
| `theme.tokens.fontFamily` | enum | no | one of "sans", "serif", "mono" | Bundled font id |
| `theme.logoAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |

## Role

A player position; one XMPP account.

- **Location:** PubSub node `roles:<roleId>`
- **Access:** Read: all game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Role id and login id: the XMPP localpart |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `forceId` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of the role's force |
| `isObserver` | boolean | yes |  | Observers read but never post, in all their rooms (D8) |
| `order` | integer | yes | ≥ 0 | Admin-set display order; ties sort by id (SRD §3 rule 7) |

## Room

A channel: one MUC room plus this config.

- **Location:** PubSub node `rooms:<roomId>`
- **Access:** Read: game users. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Stable URL-safe id, never reused (SRD §3 rule 1) |
| `name` | string | yes | length ≥ 1; length ≤ 120 | Display name |
| `roomType` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Room type id from the registry (v1: chat) |
| `participants` | array of object | yes |  | Mixed force and role entries; umpire-force roles are added implicitly |
| `participants[]` | object | yes |  | A room participant entry (§3 rule 4) |
| `participants[].kind` | enum | yes | one of "force", "role" |  |
| `participants[].id` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Force or role id |
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
| `theme.logoAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `theme.iconAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |

## Objectives

A force's objectives; confidential to that force, umpires and admin.

- **Location:** PubSub node `objectives:<forceId>`
- **Access:** Read: the force's roles, umpires and admin. Publish: admin and umpires.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `forceId` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of the force these objectives belong to |
| `markdown` | string | yes | length ≤ 50000 | Objectives as Markdown |

## Asset

An image used by themes.

- **Location:** PubSub node `assets:<assetId>`
- **Access:** Read: game users; the game theme's assets also anonymously. Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |
| `id` | string | yes | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Stable URL-safe id, never reused (SRD §3 rule 1) |
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

## Game state

Reserved for turns and the game clock.

- **Location:** PubSub node `game-state` (reserved)
- **Access:** Publish: admin.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | constant | yes | = 1 |  |

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
| `logoAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |
| `iconAssetId` | string | no | length ≥ 1; length ≤ 64; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Id of an `assets:<id>` node |

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

## Design file

A complete game design, as exported and imported by the admin.

- **Location:** A JSON file the admin exports and imports
- **Access:** Held by the admin. Never contains passwords.

| Field | Type | Required | Rules | Description |
| --- | --- | --- | --- | --- |
| `format` | constant | yes | = "wrx1-design" |  |
| `schemaVersion` | constant | yes | = 1 |  |
| `exportedAt` | string | yes | format date-time | ISO 8601 date-time |
| `game` | object | yes |  | The game setup document |
| `forces` | array of object | yes |  | Force documents |
| `roles` | array of object | yes |  | Role documents; a `password` field is rejected |
| `rooms` | array of object | yes |  | Room documents |
| `objectives` | array of object | yes |  | Objectives documents, at most one per force |
| `assets` | array of object | yes |  | Asset documents |
