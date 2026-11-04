# Phase 5 security notes

> Internal. Notes for the Phase 5 security review (WP 5.7). Keep the spike check ids and admin-tooling rules off the public site (DOC-2).

## WP 5.8, the White Force edits objectives (D21, §3 rule 14, PLY-35, R10)

The product owner's Nov 3 revision reverses WP 3.5's admin-only rule (`phase-3-security-notes.md`): White Force roles that are not observers publish objectives again. This widens who may write to a confidential node, so this section says what is enforced where.

- **Who publishes.** `targetState` (`packages/admin-ops/src/target.ts`) and the mock's seed give every White Force role that is not an observer the `publisher` affiliation on every `objectives:<forceId>` node, the White Force's own included. White Force observers and the force's own roles get `member`; no other role has any affiliation (whitelist, R10). The admin owns the node and publishes as owner. Review F5 (observers never publish) holds: `target.test.ts` "D21: White Force roles that are not observers publish…", the target-equals-seed comparison, and the audit's critical `node-access` item for an observer left as publisher (`diff.test.ts`).
- **Re-sync.** A role that moves force, leaves the White Force, becomes an observer or is deleted has its affiliations corrected by the planner's existing grant and revoke steps (grants first, R-D; revocation removes subscriptions too, R-A). The publish scenario on ejabberd moves White Cell to Blue and checks it can no longer read Red's objectives.
- **What the server keeps.** `max_items` stays 1, which ejabberd applies per publisher (contract S15-7), so each author keeps its newest save. A publisher cannot overwrite or retract another's item (contract S02, publish scenario step 2), so one White Force editor cannot remove another's text, nor the admin's; the newest edit shows.
- **Clean-up.** When a role leaves the White Force or is deleted, the planner retracts its items on every objectives node, found by the item's `publisher` (the bare JID ejabberd reports; `itemreply` is set on every node the tooling creates). The retraction is in the removals group, after the access group took its `publisher` affiliation and after the role deletions, so it cannot publish again in between. A White Force role made an observer keeps its earlier items (it is still White Force text) and loses publish. Items with no `publisher` reported are left alone (none can arise on nodes the tooling made), and so are the admin's.
- **Retraction is not confirmed.** Unlike a template's (TPL-6), an objectives item's retraction needs no tick: the role's deletion is confirmed already, and a move out of the White Force is listed as a re-sync warning. `stepConfirmation` works this out from the action's node, never from a flag the step carries (F9). Test: `plan.test.ts` "a role leaving the White Force loses publish first, then its edits are retracted".
- **Readers (F11).** The store shows the last item it holds: the fetch in the server's order (first publish, oldest first; contract S15-2), then each live item appended in arrival order (contract S06), and a retract falls back to the item before. Nothing reads the author's `updatedAt`, so no author's clock can pin or hide an edit; the F11 clock clamp is gone with it. Every save is a new id (`<loginName|admin>-<uuid>` from the store, `admin-<hash of the payload>` from the planner, never an id already on the node), because ejabberd keeps a re-published item in its old place. The store no longer drops items whose id is not `admin`: whatever a publisher the server allowed wrote is shown, and only the server decides who that is.
- **The client is advisory.** `canEditObjectives` (admin, or White Force and not an observer) only decides whether the force panel offers an editor and whether `publishObjectives` sends; the server refuses everyone else (`forbidden`). The preview as a role offers the editor for a White Force non-observer role; as with a post from the preview, the edit goes from the admin's account, not the role's.
- **The purge step is gone.** WP 3.5 purged an objectives node holding items other than the admin's; that would now delete the White Force's edits. `AdminOps.purgeNode` stays as an owner operation with its contract tests; the planner no longer plans it.
- **The mock follows ejabberd (ARC-11).** The mock listed items newest first, moved a re-published item to the end and trimmed the node as a whole; it now keeps creation order, keeps a re-published item in place and trims per publisher with a retract notification. Contract S15-2, S15-7 and S15-8 run on both backends.

**Weak points**

- **The order rests on ejabberd's choice** to sort by first publish (S15); no XEP requires it. Contract S15 guards it across upgrades (NFR-22). A server clock stepped backwards between two edits would show the older edit until the next one.
- **`getItems` with `max` returns the oldest, not the newest**, through the transport: StanzaJS sends an RSM set beside `max_items`, and ejabberd answers it as a page from the start (found when porting S15; the spike's raw `max_items` gave the newest). No reader uses `max`; the interface now says so. A future reader that used `max: 1` to find the newest would show the oldest edit.
- **A publish can revert the admin's own game-view edit.** The planner compares the draft with the admin's own item. After the admin amends objectives in the game view, its item no longer holds the draft, so the next publish sends the draft again as the newest edit (the plan step says so), replacing what the force sees, White Force edits made since included. The same was true under WP 3.5 for the admin's item. White Force edits alone never trigger it.
- **Text by a departed role stays visible until the next publish.** Leaving the White Force is a design change, so the role's publisher affiliation and items go when the admin publishes; until then it is still a White Force role on the server and may edit.
- **Item ids carry the author's login name** (`white-cell-…`). Readers of the node, the force and the White Force, already see the `publisher`; nothing new is disclosed.

## WP 5.5, the map room for players (PLY-57–59, D12, D25, NFR-7, NFR-9, NFR-11, R23, R26, R30)

### Libraries (the dependency rule)

| Package | Version | Released | Licence | Where |
| --- | --- | --- | --- | --- |
| `leaflet` | 1.9.4 | May 18, 2023 | BSD-2-Clause | `@wrx/player-ui`, map chunk |
| `milsymbol` | 3.0.4 | Mar 10, 2026 | MIT | `@wrx/player-ui`, map chunk |
| `@types/leaflet` | 1.9.22 | Aug 1, 2026 | MIT | dev only (pulls `@types/geojson` 7946.0.16, MIT, Jan 2025) |

`milsymbol` 3.0.5 (Oct 27, 2026) is 8 days old and was not taken. Leaflet 2.0 is in beta. Both libraries are bundled (NFR-7) into one lazily loaded chunk (`leaflet-map-*.js`, about 1 MB before gzip, 245 kB after; milsymbol is most of it); neither holds `eval` or `new Function` (the built chunk was searched), and both run under the build's policy with no violation (`apps/web/e2e/map.spec.ts`).

### The Content-Security-Policy and the tile host (F7)

The tile host must be in `img-src`, and the policy is a `<meta>` tag built into `index.html` (and `popout.html`).

- **Mock build** (demo, previews, the site): it reads no `config.json`, so its tiles are a built-in default (`apps/web/src/tiles.ts`) and its policy names exactly that origin: `img-src 'self' data: blob: https://tile.openstreetmap.org`.
- **Server build**: the tile URL comes from `config.json` at run time, so the built-in policy allows `img-src 'self' data: blob: https:`, as `connect-src` already allows any `wss:` host. The operator's header narrows it to the tile origin (`deploy/README.md`).
- **Reference deployment**: its install writes no `map` block, so it has no base map, and its header (`ejabberd.yml`) keeps `img-src 'self' data: blob:`. `reference-config.test.ts` now compares it with `contentSecurityPolicy(false, 'none')`.
- **`popout.html`** is a static file with its own policy; the build writes its `img-src` into the copy in `dist` (`popoutImageSources` in `vite.config.ts`), so a popped-out map's tiles load (e2e).

**Weighed and not chosen:** rewriting the built policy with the tile origin when `config.json` is written at deploy time. Narrowest, but the policy would be edited by a shell step after the build on every kind of host, the reference header is a static file that would need templating as well, and a mistake either fails open or breaks the client.

**Security cost of `https:` in the server build's `img-src`:** an injected `<img>` (or CSS `url()`, since `style-src` has `'unsafe-inline'`) could load from, and so beacon to, any HTTPS host: a reader's address and timing, and anything an attacker could put in the URL. Nothing renders untrusted markup today: React renders text, the Markdown renderer drops images (`packages/ui/src/markdown.tsx`), theme images are `data:` URLs, and symbols are our own `data:` URLs from a validated code. So this removes a layer of defence in depth, not a boundary, and only where the operator has not narrowed it with the header. The mock build keeps one named origin. Scripts are unchanged: no `unsafe-eval`, no inline script.

**Leaflet's styles:** Leaflet sets inline `style` attributes (positions, transforms, sizes) and ships `leaflet.css`, bundled with the panel; `style-src 'self' 'unsafe-inline'` already covers both, so `style-src` is unchanged. Leaflet's attribution control (which would set `innerHTML`) is off; the attribution is rendered by React as text and a link.

### Tile privacy (D12, R30)

- A tile server learns every player's address, when they look, and which area at which zoom: in a wargame, that can reveal the area of operations. The server build therefore has **no default** tile server; without `map.tiles` the map shows the assets on a plain background and asks nothing of anyone. Choosing a tile server is the operator's decision (`deploy/README.md`); a server on the same origin or the internal network keeps it inside.
- Tile requests send `Referer` as the origin only (`referrerPolicy: 'strict-origin'` on the tile layer), whatever the page's `Referrer-Policy`: OSMF's policy asks for a Referer, and no path or hash leaves. Tiles are never fetched with `crossOrigin`, so no pixels are read back.
- **The demo's default is OpenStreetMap's tile server.** OSMF's tile usage policy (read Nov 4, 2026) allows normal interactive viewing by a person with visible attribution and a valid Referer; it forbids bulk download, prefetching, offline use and heavy use, offers no SLA and may block without notice. The demo is light, interactive use and prefetches nothing. If OSMF blocks or changes the policy, the demo's base map goes blank; the map still shows the assets.
- `config.json`'s tile URL is checked (`parseTiles`): `https:`, `http:` to this machine only, or a path on this origin; `{z}`, `{x}`, `{y}` required, no other placeholder (Leaflet throws on an unknown one), no braces elsewhere, no credentials; attribution plain text of at most 200 characters, its link `https:` only.

### Symbols and assets

- milsymbol gets only the asset's `sidc`, which `sidcSchema` has checked, and no text modifiers; its SVG goes into an `<img>` as a `data:` URL, never into the DOM as markup, so a hostile code cannot inject script. A code milsymbol does not know draws an unknown frame.
- Asset titles, categories, states and the attribution are React text; marker `alt` and `title` attributes are set as properties.

### Authority and memory (D25, R23, R26)

- Unchanged from WP 5.2: only valid world states from the admin's real JID are accepted (PLY-58). The scenario `apps/web/e2e/scenarios/map-room.spec.ts` posts a forged state as Red CO on both backends: the server takes it (members have voice), the map ignores it live, and after a reload the client pages back past it to the admin's newest (PLY-59).
- **R26:** a room watched for its world state now keeps only the newest accepted world state (`Timeline.retainOnly`, `trimWorldState` in the store). This also bounds what a modified client can make every reader hold: before, each forged 500 KB state stayed in every client's memory for the session. Dropped ids stay known, so MAM pages and reconnections never add them back; the ignored count survives the trim.

### Performance (NFR-11)

Measured in `apps/web/e2e/perf.spec.ts` ("a world state of 600 assets"), Chromium, the scale fixture with a 600-asset world state (`scaleWorldState`, about 167,000 characters), on the development container:

| Measure | Value | Target |
| --- | --: | --: |
| New 600-asset world state from the admin, send to the frame showing all 600 symbols | 140–260 ms (4 runs, one at a time); 400 ms in the full parallel suite | 1,000 ms |
| Map tab's first render, chunk preloaded: click to the frame showing all 600 symbols, the MAM search included | 730–900 ms (4 runs, one at a time); 1,140 ms in the full parallel suite | 1,000 ms |
| Map chunk load and compile when not preloaded (instrumented run) | about 550 ms | |

Before the map opened straight at the assets' view (it first showed the world, fetching tiles for a view replaced at once), the first render was 1,000–1,140 ms. The CI guard is 3 × the target, as for the other budgets. The first render meets the budget alone but with little margin, and misses it under a loaded runner; the live replacement, the case that recurs during play, is well under. The map chunk is fetched while the browser is idle after login (`MapPreload`), so its compile is usually not on the tab's first open.

### Weak points

- **The server build's `img-src https:`** relies on the operator's header to narrow it; a host that serves no header keeps the wide policy.
- **The first open of the map tab has little margin** on the 1 s budget at 600 assets (above), and misses it on a loaded machine. Leaflet places one `<img>` per asset; a canvas renderer or clustering would be the next step if a slower machine misses it.
- **Popouts:** Leaflet follows a drag on the opener's `document`; the map forwards the popout's mouse and pointer moves to it (`forwardPopoutDrags`). This leans on Leaflet internals; Leaflet 2 changes them. Touch dragging in a popout is not tested.
- **Third-party tiles on the demo** are outside our control (above).

## WP 5.6, the admin's world-state editor (ADM-16, ADM-44–46, D25, R25, R26)

- **Nothing new on the server.** The editor publishes through the admin's own session only: `sendWorldState` and `advancePhase` refuse any other session before sending, and clients accept world states only from the admin's real JID (PLY-58, unchanged). A preview as a role, and every player, gets no editor; the server would take a map-room post from them (members have voice) and every client ignores it, as WP 5.5's scenario shows.
- **The draft is in `localStorage`** under the deployment's namespace (DOC-10), keyed by server and map-room GUID (`world-draft:v1:<server>:<mapRoomId>`). It holds the planned positions and states of every asset: in a wargame, the umpire's adjudication before players see it. Any script on the origin can read it, as it can the design draft already held there (WP 2.2). On a shared machine the next user of the browser profile can read it until it is published or discarded. Accepted as R25 says (browser-only draft, server-side drafts post-v1); the UI says the draft is held in this browser.
- **What a stored draft can do.** It is parsed with `worldStateSchema` on every read (`parseWorldDraft`); a draft that fails is set aside with a notice, never published. Another tab's write arrives by the `storage` event and is parsed the same way. A tampered draft can only become a world state the admin then sees in the change summary and confirms.
- **The size check** runs before every publish (`worldStateSize`, the 500,000-byte map-room cap, PLY-53): the publish button and the phase change are blocked with the size, and the store and transports check again.
- **Design files** gain an optional `worldState` (version 3). It is checked by `worldStateSchema` on import; assets whose force is not in the design are a warning. Import writes it to the world-state draft only: nothing reaches the map room until the admin publishes it (ADM-45).

**Weak points**

- **The draft is not tied to the admin's login.** Anyone who logs in as the admin in the same browser profile sees and can publish it; anyone with the profile can read it.
- **Last writer wins between admin tabs.** Two tabs editing the same draft overwrite each other's edits on save (each saves the whole state); a newer publish from another tab is shown as a note on the draft, not merged.
- **The draft is not cleared by the mock's "Reset to seed"** or by a server reset; "Discard draft" is the only way, so a stale draft can outlive the game it was made for, under the same map-room GUID.
