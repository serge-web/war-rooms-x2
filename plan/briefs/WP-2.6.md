# WP 2.6 — Chat room panel

**SRD ids:** PLY-9–14, PLY-33, PLY-43–45, PLY-49, PLY-53 · **Depends on:** 2.5 · **Status:** done

## Goal

The `chat` room type's player panel, registered in the room-type registry.

## Acceptance

- **Message list:**
  - cards with a header row (role name, force colour, local time), with consecutive messages from one sender sharing a header (PLY-43);
  - a date divider between days (PLY-45);
  - plain text only, with links optionally auto-linked (PLY-14).
- **History:** loaded from MAM, paging back on scroll, from `useRoomMessages` (PLY-9, PLY-49).
- **Virtualised list** for 10,000 messages, with the tab rendering in under 1 s (NFR-11).
- **Composer:**
  - grows as text is entered; Enter sends, Shift+Enter adds a line (PLY-44);
  - enforces the size cap (PLY-53);
  - keeps the unsent text and shows why when a post is refused (PLY-33).
- **Read-only:** observers and read-only participants see the composer disabled with an explanation (PLY-12).
- **Online participants** are shown (PLY-13).
- **Unread counts:** kept per room and shown in the tab through 2.5's slot (PLY-11).
- **The room's theme** is applied, scoped to the panel (PLY-24).
- Registered through `withSlots` on the `chat` type.
- Playwright: send and receive between two clients on the mock, an observer who can't post, and paging back through history.

## Owns

`packages/player-ui/` chat panel files.
