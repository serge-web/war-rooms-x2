# Gate G6: the Python API (draft for posting)

Draft of the Phase 6 gate summary, for the phase PR's description (working model item 6), Nov 6, 2026. The public post is `site/pages/blog/phase-6-python-api.md`; this one adds the internal detail. Internal links point into the repo; the security review stays off the site (DOC-2).

## Delivered, by SRD id

| WP | Delivered | SRD ids |
| --- | --- | --- |
| S17 | Spike: Pyodide in a worker, offline, under the client's policy plus `'wasm-unsafe-eval'`; pass with conditions | Annex C |
| 6.1 | The SDK's models (generated from the JSON Schema export, the asset model named, the 5,000-asset cap) and the read layer, with pandas tables; the bridge protocol, version 1 | PD1, PD2, PY-1–PY-3, ARC-6 |
| 6.2 | The browser runner: the worker, its lockdown, a `blob:` bootstrap, the bridge with role checks; the build step that checks every Pyodide file by sha256; the policy for every role; S17's probes as a regression test | PD3, PD4, PD9, PY-4, PY-5, PY-10, PR1, PR3, NFR-7 |
| 6.3 | The Scripts panel, scripts in the login's private storage with a version check, export and import | PD4, PD5, PY-6, PY-7, PY-10 |
| 6.4 | Protocol 2: send, react, the draft, proposals; the umpire room (§3 rule 19); the `world-proposal` message; a script's change on top of the draft; publishing without review, recorded; PR previews carry `py/` only when they touch Python | PD6–PD9, PY-2, PY-8, PY-9, PR2, ADM-44–46 |
| 6.5 | SC-12 on both backends; performance, accessibility and security reviews and their fixes; docs, release notes, this post | PY-11, PR1–PR5, SC-12 |

## Acceptance results (WP 6.5)

- **SC-12** (new, SRD §12; `apps/web/e2e/scenarios/sc-12-umpire-runs-python.spec.ts`) passes on the mock and on ejabberd 26.09: a White Force script proposes; the admin loads the proposal after its summary, edits by hand, runs an admin script on top of the hand edit, reviews all three changes and publishes; Blue's open map updates; Blue has no Scripts tab and no umpire room.
- **Performance** (`plan/reviews/phase-6-performance.md`, `apps/web/e2e/py-runner-perf.spec.ts`): worker ready 2.0 s cold, 2.1 s warm; first SDK run 0.9 s (pydantic), first pandas run 3.0 s; a 600-asset read, change and draft write 79 ms; 2,500 events a second, 100 sends in 88 ms, 1,000 calls at once in 200 ms; interpreter memory 30 MB, 36 MB with the SDK, 90 MB with pandas. `py/` is 23.4 MB (the core 6.4 MB gzip, the wheels barely compress). The start-up chunk grew 10,607 bytes over the phase (1.05%), 9,255 of them in WP 6.4 (the umpire room, the proposal schema and card, the draft merge); moving the admin's umpire panel (2.2 kB) to a lazy chunk split the start-up chunk in three for a 1.6 kB saving, so it was not kept.
- **Accessibility** (`plan/reviews/phase-6-accessibility.md`, `apps/web/e2e/scripts-a11y.spec.ts`): axe clean on the panel, the editor, the output, the confirmations, the umpire room and its proposal cards for both roles, and the load summary. The keyboard-only test found **A1**: the panel's inline forms and confirmations, and the proposal's, lost focus to the page when they closed. Fixed: focus returns to the opener, else to "New script".
- **Security** (`plan/reviews/phase-6-security-review.md`): no Critical or High.
  - **M3** (Medium, fixed): a world state behind many map-room posts (Phase 5 H1) read as "none" through the bridge, and publishing without review did not check, so a player plus an auto-publishing script could wipe the map. Now `unavailable`, and publishing without review refuses.
  - **L1** (Low, fixed): proposals counted on receipt from White Force observers; now only from the admin and White Force roles that are not observers.
  - **M1** (Medium, for the owner): runs in one panel share an interpreter, so one script can tamper with a later one, an auto-publishing run included (probed by a test).
  - **M2** (Medium, for the owner): no per-run budget on sends; a handler answering each message lets a player drive the umpire's script to flood a room.
  - **M4** (Medium, for the owner): publishing without review publishes the whole draft, unreviewed hand edits included.
  - **L2–L7**: per-call, not per-run, bounds; private storage (shared logins, the 5 s re-read, the publish record read then written); silent dropped events; the lock is trust-on-first-use; imported scripts not marked; the policy for every role (accepted, PR3).
  - **I1–I4**: the sandbox (new probes: a deep walk into Pyodide's Emscripten module, the AsyncFunction constructor, a string timer; a Node walk of 28,815 objects), the bridge's validation, PD2 against D2, the umpire room and the vault: verified.

## Interface changes after their designated WP

- `@wrx/py-runner` bridge (WP 6.2, 6.4): `readWorldState`, and `readDraft` with no draft held, now refuse with `unavailable` when the latest world state is further back in the map room (`WorldStateView.unreached`), instead of returning `null`. The SDK raises `UnavailableError`.
- `@wrx/player-ui` `publishScriptDraft` (WP 6.4) returns `failed` when the published state is unreached or still loading.
- `@wrx/domain` store (WP 6.4): a received `world-proposal` from a White Force observer is unreadable ("not from the White Force").
- The runner's e2e harness gains `publishScale` and `playerPosts`; the `py-runner` Playwright project also runs `py-runner-perf.spec.ts`.
- `tools/site/lib/blog.ts` accepts phase 6.

## Differences from the baseline plan chart

- Phase 6 ran as drawn: S17, then WPs 6.1 to 6.5 in sequence; none added or split. WP 6.2's and 6.3's split of FT-4's P2 was decided before the phase began (Nov 6).
- FT-4 keeps P5, the native runner (PY-12), until bot players have been discussed.

## Decided by the owner during Phase 6 (Nov 6, 2026)

- One client policy for every role, with `'wasm-unsafe-eval'` and `blob:` workers (PR3).
- S17 stays public (not deny-listed).
- PR previews carry `py/` only when the PR touches Python; the main site always does.
- Phase 6 itself: WPs 6.1–6.5 after S17, with gate G6.

## For the owner

1. **M1, one interpreter per panel.** Recommended: a fresh interpreter for every run (about 3 s more before each run's first output; a first pandas run 3 s each time). Alternatives: only before runs that may publish without review, plus a "Restart Python" button; or keep it as documented.
2. **M2, a per-run budget.** Recommended: refuse past 100 sends, 10 proposals and 16 calls in flight per run, with a clear error; the numbers are yours.
3. **M4, publishing without review and hand edits.** Recommended: refuse to publish without review when the draft held unreviewed hand edits at the run's start (the change stays in the draft); later, if asked, publish only the script's change.
4. **PY-5's wording.** The start-up chunk grew 1.05% over the phase, for the umpire room and proposals, which every umpire's client reads; the runner and Pyodide add nothing. Confirm that PY-5 means "the runner and Pyodide SHALL NOT be in the main bundle", or ask for a chunk-layout WP to move the umpire room's code out.
5. **Blog snapshots and `py/`.** Each gate snapshot built from now on carries `py/` (about 34 MB). Not urgent at 3.4% of the Pages limit; building snapshots without Python unless the post is about it would keep them at about 10 MB.

## Open risks

- M1, M2 and M4, above.
- The sandbox is a deny-list plus the policy; the probes are a sample, not a proof. A new browser global is out of reach only because no path to the global scope exists.
- R29 (no session eviction) and Phase 5's M1 (the map denial's remainder) are unchanged.
- WebKit's Pyodide start-up, real screen readers, and Python throughput on ejabberd were not measured in this WP.
- WP 3.3's real-hardware install is still with the owner; v1's release waits on it.

## Links

- Preview and screenshots: the phase PR's bot comment (the Scripts panel, the umpire room with a proposal card).
- `plan/briefs/WP-6.1.md` to `WP-6.5.md`, `plan/reviews/phase-6-*.md`, `plan/decisions/S17.md`, `RELEASE-NOTES.md`, `docs/python-sdk.md`.
