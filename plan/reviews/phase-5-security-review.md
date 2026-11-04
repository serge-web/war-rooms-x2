# Phase 5 security review: turns and the map (internal)

WP 5.7, 4 November 2026. Scope: Phase 5 as built in WPs 5.1 to 5.6 and 5.8 and the 5.7 changes: the turn model (D7, ADM-43, PLY-55, PLY-56), the map room and its world state (D25, §3 rules 16–18, PLY-53, PLY-57–59), the admin's world-state editor and its browser draft (ADM-16, ADM-44–46, R25, R26), room discovery (PLY-60, R24), White Force objective editing (D21, §3 rule 14) and the narrowed structural change (§3 rule 8, R28). Not for the public site (DOC-2): it describes what the server does not enforce.

This is a critical read of the code at the head of the WP 5.7 branch, not a summary of the builders' notes in `phase-5-security-notes.md`; where it agrees with them it says so briefly. Each finding is probed with a test where it can be. Earlier reviews: `v1-security-review.md` (F1 to F11), `phase-4-security-review.md` (H1, M1, M2, L1 to L3).

## Ratings

As in Phase 4:

| Rating | Meaning |
| --- | --- |
| Critical | A player gains access or authority they should not have, or reads what their force should not see |
| High | A player can deny service to other players, or corrupt what other players see, without special access |
| Medium | Integrity, confidentiality or availability harm that needs the admin's action, a trusted role's, or access to the admin's browser |
| Low | A known limit of the design (D2: the server enforces membership and voice only), or harm limited to the actor's own client |
| Info | No harm found; recorded so the next reviewer need not re-derive it |

The product owner decides on anything rated High or Critical.

## Summary

| Id | Finding | Rating | State |
| --- | --- | --- | --- |
| H1 | Any player can bury the admin's world state behind about 200 small map-room posts; after a reload every client said no world state was published, and the admin's editor then offered an empty map whose publish would wipe the state | High | Fixed in part (WP 5.7): never shown as none, the admin cannot publish against it, "Look further back"; the denial of the map after a reload remains (M1). For the owner |
| M1 | What remains of H1: a flood makes each reloading player click "Look further back" once per 200 posts, until the admin publishes again | Medium | Recorded, with options; for the owner |
| M2 | The world-state draft is plain `localStorage`: the umpire's unpublished adjudication, readable by anyone with the browser profile or a script on the origin, and not tied to the admin login | Medium | Accepted (R25); recommendations below |
| M3 | A stale draft outlived its game under the same map-room GUID: a reset did not clear it, and nothing said it was from the game before | Medium | Fixed in part (WP 5.7): a warning on the draft; not cleared |
| L1 | Last writer wins between two admin tabs editing the same draft | Low | Recorded |
| L2 | The design export, after 20 s without an answer from the map room, silently left out the world state | Low | Fixed (WP 5.7): the export says so, and says when it carries the unpublished draft |
| L3 | A world state published with a phase change whose `game-state` publish then fails: players see turn N+1's map at turn N, and the error text says the world state was not published | Low | Recorded |
| L4 | The admin backend joins the map room (while a draft is held, and for an export) | Low | Accepted |
| L5 | Composers pause during adjudication in the client only; the White Force keeps posting | Low | Accepted by design (D7, R27; owner, Nov 4) |
| L6 | Each reader parsed every map-room message before checking its sender | Low | Fixed (WP 5.7): set aside unread |
| L7 | A role added that sees any room is a structural change, so every online player's layout resets | Low | Recorded (R28) |
| I1 | The map room's entries are fixed (§3 rule 18) in the draft, the planner, import and audit | Info | Verified |
| I2 | World-state authority: only the admin's real JID, never a nickname | Info | Verified |
| I3 | `game-state`, `directory` and `rooms:*` read by every role, published by the admin | Info | Verified |
| I4 | White Force objective editing (WP 5.8) | Info | Agrees with the notes |
| I5 | Tiles, symbols and the CSP (WP 5.5) | Info | Agrees with the notes |

## Findings

### H1. A world state buried behind small posts read as "none" (High; fixed in part)

**What.** Every role has voice in the map room (§3 rule 18: forces are write entries, so no role joins the observer vault). A modified client logged in as any player can post as many messages as it likes; the server's per-player byte limit (S16, about 50 kB/s after a 300 kB burst) barely slows small ones. A client joining the map room pages back through MAM for the newest valid world state from the admin, in pages of 5, at most 40 pages (`worldStatePageSize`, `worldStatePageLimit`). With about 200 posts after the admin's latest state, the search stopped at its limit, and the store reported `none: true`, the same as an empty room:

- every player who reloaded saw "The umpire has not published a world state yet";
- the admin's editor (`useAdminWorldDraft`) took `none` as "no world state" and started a draft from an **empty** state: the first edit would make a draft whose publish replaces every asset with one, and the turn panel's confirmation would show "all added" against nothing;
- the export (`readPublishedWorldState`) reported none, so a design file left without its map.

Before WP 5.7 the store's own test asserted this outcome (`none: true` at the page limit).

**Probe.** `apps/web/e2e/scenarios/map-room.spec.ts`, "a world state behind many other map-room posts…", on the mock and on ejabberd: Red CO's modified client posts 230 chat bodies to the map room, Red CO reloads. Unit: `world.store.test.ts` (40 posts, a limit of 3), `editor.test.tsx` (the admin's view).

**Fix (WP 5.7).**

- `WorldStateView` has `unreached`: the search stopped at its limit with older messages left. `none` now means the archive was searched to its start.
- The map says the latest world state is further back, behind other messages, and offers **"Look further back"** (`searchWorldStateFurther`, another 40 pages from where it stopped). Both e2e runs find the state with one click.
- The admin's editor shows the same message and no editing tools until the state is found; the turn panel's confirmation is blocked with an explanation; the export reports the world state as unavailable.

**Why only in part, and the rating.** The denial itself remains (M1). The rating is High as found: a player without special access could make every other player's map show nothing after a reload, and lead the admin to wipe the world state. With the fix the admin can no longer be led into the wipe, and players can recover by themselves. For the owner to confirm.

### M1. The remaining map denial (Medium; recorded)

A player who keeps posting forces each reloading reader to click "Look further back" once per 200 posts; each click is 40 MAM round trips of small pages. Players already in the room are unaffected (live states replace the map; nothing else does), and the admin's next publish puts the state back on top. The posts are visible to nobody in the client (it ignores them), but the server archives them under the poster's real JID, so the umpire can find who did it from the server's archive.

Options, for the owner:

1. **Filter the MAM search by the admin's occupant JID** (XEP-0313 `with`), so other posts are never fetched. Needs a contract check on ejabberd and the mock that a MUC archive filters by occupant real JID, not by nickname, which any occupant may take (a nickname filter would be forgeable).
2. **Larger pages for the search** when the newest page holds no world state (the messages are then small). Raises the cost of the attack linearly; does not end it.
3. **A moderated map room** where only the admin has voice. Ends it at the server, but every role then needs voice revoked in that room, so every role's password joins the observer vault; rule 18 chose members with voice to avoid exactly that (Nov 4).

Recommendation: option 1 if the contract check passes, else 2. Not built in WP 5.7.

### M2. The draft in `localStorage` (Medium; accepted, R25)

The draft holds the umpire's planned positions and states before players see them: in a wargame, the adjudication. It lives in `localStorage` under the deployment's namespace, keyed `world-draft:v1:<server>:<mapRoomId>` (`packages/player-ui/src/map/draft-storage.ts`, `main.tsx`).

- **Who can read it.** Anyone with access to the browser profile, at any time until it is published or discarded: logging out does not remove it. Any script running on the origin could read it too; none is known (React renders text, the Markdown renderer drops images, symbols are our own `data:` URLs), and the CSP forbids inline and foreign scripts.
- **Not tied to the admin login.** Anyone who logs in as the admin in that profile sees and can publish it; only the admin can publish at all, so this adds no authority.
- **The multi-client view** runs every pane on one origin, so a player pane and the admin's share `localStorage`. Player panes never read the draft, but a person at that machine with the browser's developer tools could. The multi-client view is a demo and review tool (PLY-16).

Recommendations: say on the operator's checklist that the umpire's browser profile is the umpire's alone (it already says to play the admin account on a machine only the umpire uses); offer "Discard draft" on logout as a choice; server-side drafts (post-v1, R25) end it. Not changed in WP 5.7; the UI already says the draft is held in this browser.

### M3. A stale draft outliving its game (Medium; fixed in part)

The key is per server and map-room GUID. A reset (ADM-15) followed by a publish of the same design keeps the map room's GUID, so the draft of the game before still applies. The mock's "Reset to seed" keeps it too. Before WP 5.7 nothing said so: the banner said only "Unpublished edits", and its summary compared it with whatever the room now holds.

- **Fixed in part.** A draft remembers the stanza-id of the state it started from. When the room no longer holds any state and the draft started from one, the map now warns "This draft may belong to an earlier game" and asks the admin to check every asset or discard it (`orphaned`, `world-draft.tsx`; test in `editor.test.tsx`). When the room holds a newer state, the existing note says a newer one was published since the draft began.
- **Not done:** clearing the draft on a reset. The reset runs in the admin backend, which knows the design's map room; clearing there would be small, but it would discard a draft the admin may want for the next game, and an import already makes a file's state the draft. Recommendation: offer to discard the world-state draft in the reset's confirmation.

### L1. Last writer wins between admin tabs (Low; recorded)

Each save writes the whole draft. Other tabs see it at once (the `storage` event) and their next edit starts from it, so a lost edit needs two tabs to change state at nearly the same moment, or a form left open in one tab while the other edits the same asset: saving the form writes every field of that asset as the form holds them. Only the admin's own edits are at stake. Recommendation: none for v1; a per-asset merge if server-side drafts are built.

### L2. The export's 20 s fallback (Low; fixed)

`readPublishedWorldState` waited 20 s for the map room and then returned whatever it had, or nothing; the export then left out the world state with no word. Now the read says `found`, `none` or `unavailable` with the reason (a room error, the 20 s timeout, or H1's `unreached`), and the export panel says "The file holds no world state." with why, or "The file holds your world-state draft." with a reminder that it holds edits players have not seen (`PublishSection.tsx`, `transfer.ts`; tests in `PublishSection.test.ts` and `editor.test.tsx`).

### L3. A phase change that fails after its world state went out (Low; recorded)

`advancePhase` sends the world state first (so players never see the new phase with the old map), then publishes `game-state`. If that publish fails, the world state for turn N+1 is out while the turn stays at N, and the turn panel's error says "the world state was not published, so the phase did not move", which is then untrue. The draft is not cleared, but it now matches the published state, so a retry moves only the phase. Recommendation: word the error by which step failed, and clear the draft when the world state went out. Not changed: it needs a richer result from the store than the code and message it returns today.

### L4. The admin backend joins the map room (Low; accepted)

The header's turn control joins the map room only while a draft is held, to show the change summary; the export joins it for one read and leaves. Both use the admin's own session: its presence in the room is the admin's, as in the game view. The backend then holds the room's newest world state in memory (R26 keeps only that). No new authority and nothing shown to players.

### L5. Adjudication is advisory; the White Force keeps posting (Low; accepted)

Composers pause for roles outside the White Force (`postingPaused`), and the store refuses to send for them (`paused`), but the server does not: a modified client posts during adjudication, as D7 and R27 accept. White Force roles that are not observers keep posting (confirmed by the owner, Nov 4), and their observers cannot post at all (they are visitors). Players see the phase change from `game-state`, which only the admin publishes.

### L6. Map-room messages parsed before their sender was checked (Low; fixed)

Every reader JSON-parsed and schema-checked each map-room message, then ignored it if it was not the admin's. A modified client sending large posts (slowly, at the per-player byte limit) made every reader parse them. The store now sets aside a map-room message whose sender is not the admin before reading its body (`store.ts`; `world.store.test.ts`). The admin's own messages are parsed as before, and its state is still checked with `worldStateSchema`.

### L7. A role added counts as structural (Low; recorded, R28)

Since the owner's narrowing (Nov 4, §3 rule 8) only rooms added or removed and changes of a role's effective access move `designVersion`. `designStructure` is the room ids plus the full access matrix, so a new role that sees any room changes it, and every online player's layout resets though their own rooms did not change. Layouts are saved per role, so the new role loses nothing. Comparing only roles present in both designs would avoid the reset; it is left as the owner's rule reads. Recorded in the WP 5.7 brief.

### I1. The map room's fixed entries (§3 rule 18)

The draft always has exactly one map room, its participants every force as a write entry, kept so when forces change (`draft.ts`); the Rooms section offers no way to add, delete, retype or edit it. `checkDesign` refuses a second map room and any other participants, so an imported or hand-edited file cannot widen or narrow it, and `withMapRoom` repairs a stored draft. The planner treats it like any room: observers are read only there (in the vault already for their other rooms), White Force non-observers write. The audit compares it like any room. One stale comment (`checkMapRoom` said "read entry") is corrected.

### I2. World-state authority

A world state is accepted only from the admin's real bare JID on this server (`sender.isAdmin`), never by nickname: tests cover a White Force role, an `admin` on another domain, and no real JID (`world.store.test.ts`), and WP 5.5's scenario posts a forged state as Red CO on both backends. Sending is refused by the store for anyone but the admin's own session, and a preview as a role never shows the editor.

### I3. Discovery and the turn

`game-state`, `directory` and every `rooms:<id>` node are whitelist nodes read by every role and published by the admin only (`target.ts`, §3 rule 15). Room names, the map room's included, are visible to every role (R24); the admin editor warns.

### I4. White Force objective editing (WP 5.8)

Read again against `target.ts`, the planner's clean-up and the store's reader: it agrees with `phase-5-security-notes.md`, including its weak points (server order rests on ejabberd's choice, guarded by contract S15; a publish can re-send the admin's draft text over later White Force edits).

### I5. Tiles, symbols and the CSP (WP 5.5)

Agrees with the notes: the server build's `img-src https:` relies on the operator's header to narrow it; symbols are `data:` URLs from a validated code; tile requests send the origin only.

## What WP 5.7 changed

| Change | Files | Tests |
| --- | --- | --- |
| `unreached` world state, "Look further back", no editing or publishing against it (H1) | `domain/src/store.ts`, `player-ui/src/map/map-panel.tsx`, `world-draft.tsx`, `column/turn-panel.tsx` | `world.store.test.ts`, `editor.test.tsx`, `scenarios/map-room.spec.ts` (both backends) |
| Map-room posts not from the admin set aside unread (L6) | `domain/src/store.ts` | `world.store.test.ts` |
| A draft from an earlier game flagged (M3) | `player-ui/src/map/world-draft.tsx`, `map-editor.tsx` | `editor.test.tsx` |
| The export says when it holds no world state, or the draft (L2) | `admin-ui/src/publish/PublishSection.tsx`, `transfer.ts`, `apps/web/src/seams/AdminApp.tsx`, `world-draft.tsx` | `PublishSection.test.ts`, `editor.test.tsx` |
