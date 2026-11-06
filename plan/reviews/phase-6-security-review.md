# Phase 6 security review: the Python API in the browser (internal)

WP 6.5, 6 November 2026. Scope: Phase 6 as built in WPs 6.1 to 6.4 and the 6.5 fixes: the SDK and the bridge protocol v2 (PD1, PD2, PY-1–PY-3), the browser runner, its lockdown and packaging (PD3, PY-4, PY-5, PR3), the Scripts panel and private storage (PD4, PD5, PY-6, PY-7, PY-10), act and adjudicate, the umpire room, proposals and publishing without review (PD6–PD9, PY-2, PY-8, PY-9, §3 rule 19). Not for the public site (DOC-2): it describes what the server does not enforce.

This is an adversarial read of the code at the head of the WP 6.5 branch, not a summary of the builders' notes; where it agrees with them it says so briefly. Each finding is probed with a test where it can be. Earlier reviews: `v1-security-review.md`, `phase-4-security-review.md`, `phase-5-security-review.md` (H1, M1–M3, L1–L7), and S17's record (`plan/decisions/S17.md`).

## Ratings

As in Phases 4 and 5:

| Rating | Meaning |
| --- | --- |
| Critical | A player gains access or authority they should not have, or reads what their force should not see |
| High | A player can deny service to other players, or corrupt what other players see, without special access |
| Medium | Integrity, confidentiality or availability harm that needs the admin's action, a trusted role's, or access to the admin's browser |
| Low | A known limit of the design (D2: the server enforces membership and voice only), or harm limited to the actor's own client |
| Info | No harm found; recorded so the next reviewer need not re-derive it |

The product owner decides on anything rated High or Critical. **None was found.**

## The threat model in one paragraph

Only the admin and White Force roles that are not observers run scripts (PD4). A script is code the person chose to run, so its author is trusted as far as that person trusts it (PR1): the review asks (1) whether a script can do more than its role's own client could (PD2: it must not); (2) whether a script it should not trust (an imported file, a teammate's edit to a shared login's script, a sample changed upstream) can harm more than its own run; (3) whether players, who never run scripts, can use the scripting features against the umpires or each other; and (4) whether the wider client policy (PR3) and the shipped Pyodide files weaken anyone's client.

## Summary

| Id | Finding | Rating | State |
| --- | --- | --- | --- |
| M1 | Runs in one panel share an interpreter: one script can patch the SDK or builtins so that a later run, an auto-publishing one included, does something else | Medium | **Fixed** (the owner's decision, Nov 6, 2026): a fresh interpreter for every run; the probe is now a regression test |
| M2 | No budget on what a run sends or calls: a loop, or a handler answering each message, fills rooms as the umpire; a player's posts can drive such a handler | Medium | **Accepted by the owner** (Nov 6, 2026): no per-run budget; the time limit and the server's per-login shaper bound it |
| M3 | A world state behind many map-room posts (Phase 5 H1) read as "none" through the bridge, and publishing without review did not check for it, so a player could set up a script to publish a map built from nothing | Medium | **Fixed** (WP 6.5): `unavailable` from the bridge; publishing without review refuses |
| M4 | Publishing without review publishes the whole draft, including hand edits nobody reviewed (WP 6.4's weak point) | Medium | **Accepted by the owner** (Nov 6, 2026): it publishes the whole draft; the confirmation and the docs say so |
| L1 | A proposal counted on receipt from a White Force observer | Low | **Fixed** (WP 6.5): only from the admin or a White Force role that is not an observer |
| L2 | Calls in flight, payload sizes and cursors are bounded per call, not per run: a script can make its own tab do a lot of work | Low | Recorded |
| L3 | Private storage: a shared login's scripts change under you every 5 s; the record of publishes without review is read then written | Low | Recorded (PD5 accepted) |
| L4 | Dropped events are silent: a reconciler can miss messages | Low | Recorded (WP 6.4's weak point) |
| L5 | Supply chain: the lock is trust-on-first-use from the Pyodide release and npm | Low | Recorded |
| L6 | Imported scripts (PR1) carry nothing that marks them as not yet read | Low | Recorded |
| L7 | The policy widened for every role (PR3) | Low | Accepted by the owner (Nov 6); no new capability found |
| I1 | The sandbox: no way to the worker's global scope, and eval in every form refused | Info | Verified with more probes (WP 6.5) |
| I2 | The bridge: operations, roles and payloads validated; worker messages parsed strictly | Info | Verified |
| I3 | PD2 against D2: a script gains nothing a modified client of the same login lacks | Info | Verified |
| I4 | The umpire room's membership and the observer's read-only state | Info | Verified (contract U01, both backends) |

## Findings

### M1. One interpreter for a panel's runs (Medium; fixed, the owner's decision of Nov 6, 2026)

**What.** The runner keeps its worker, and so its Python interpreter, from one run to the next until Stop, a time limit, a start failure or the panel closing terminates it (`packages/py-runner/src/runner.ts`). Each run gets a fresh `__main__` globals dict (`worker.ts`, `run`), but nothing else is reset: `sys.modules` (the SDK itself), `builtins`, pydantic, asyncio's loop, and anything a script attaches to them outlast the run.

**Probe.** `apps/web/e2e/py-runner.spec.ts`, "one run can change what a later run in the same worker does (review M1, recorded)": a first run replaces `wrx.Game.write_draft` with a version that sets every asset's health to 1 and leaves a value in `builtins`; a second, ordinary script that moves one asset then writes a draft in which every asset's health is 1. After Stop, a new worker is clean.

**Why it matters.** PR1's mitigation is that scripts come only from the account's own storage or a file the user imports, and the user reads them. M1 widens what one unread script can do from "its own run" to "every later run until the worker ends": an imported "analysis" script, run once, can make the admin's trusted resupply script, or one with **Publish without review** on, publish a tampered world state an hour later, without any further code being run that the admin did not read. With a shared White Force login (PD5), a teammate's script does the same to the next teammate's runs in that tab. Rated Medium: it needs a trusted role to run the first script.

**Options, for the owner.**

1. **A fresh interpreter for every run.** Terminate the worker after each run and start the next at once in the background. Measured cost (`phase-6-performance.md`): about 2 s to be ready again and about 0.9 s for the SDK's first import, so back-to-back runs wait about 3 s; a first pandas run pays its 3 s each time. Memory is unchanged (one worker at a time).
2. **A fresh interpreter only before a run that may publish without review**, and a "Restart Python" button. Cheaper; leaves ordinary runs exposed.
3. **Keep it, and say so** (done in WP 6.5: `docs/python-sdk.md`, the site's scripting page: "Stop once before running a script you trust after one you do not").

Recommendation: option 1, since runs are minutes apart in adjudication and the cost is a few seconds. Not built in WP 6.5: it changes the panel's behaviour and every run's start-up time, which is the owner's call.

**Decision and fix (the owner, Nov 6, 2026): option 1.** Every run gets a fresh interpreter. `ScriptRunner` (`packages/py-runner/src/runner.ts`) sends a worker one run at most and terminates it when that run ends, however it ends (finished, failed, stopped, timed out); nothing a script does to `sys.modules`, `builtins`, pydantic or asyncio reaches another run. Each new worker gets the same start as before (the lockdown, then `ready`) before any script, so PD9's draft buffering, the `started`-based time limit, events and Stop are unchanged. Two small additions keep the cost down: as soon as a run ends the next worker starts in the background (`prewarm`, on by default), and each worker imports the SDK, so pydantic, after the lockdown and before `ready` (`preimportSdk`, on by default): the worker's own step, not a script's, so the next run starts from a clean interpreter with only the SDK loaded. Measured (`phase-6-performance.md`): a run asked for a few seconds after the last starts in about 2 ms, as before; one asked for straight after the last waits about 2.8 s for its worker; every pandas run pays pandas' import, about 3.4 s. The probe is now a regression test that passes: `apps/web/e2e/py-runner.spec.ts`, "a run cannot see or patch what a previous run left (review M1, fixed)": the first run patches `wrx.Game.write_draft`, leaves a value in `builtins` and a module in `sys.modules`; the second, ordinary run sees none of them, and its draft holds only its own change. Unit tests: `packages/py-runner/src/runner.test.ts`, "a fresh interpreter for every run (review M1)".

### M2. No budget on what a run sends (Medium; accepted by the owner, Nov 6, 2026)

**What.** The bridge checks each call (its operation, the role, the room, the payload's schema and size) but not how many a run makes. A `for` loop or `asyncio.gather` sends as many messages, templated messages or proposals as it asks for, as the admin ("Umpire") or the White Force, which are exempt from the adjudication pause. Measured on the mock: 100 sends in 88 ms, 1,000 concurrent reads in 200 ms (`py-runner-perf.spec.ts`).

**The player's lever.** An `on_message` handler that answers each message in a room is a natural umpire script (the SDK's own example acknowledges every message). A player with an ordinary client, or a modified one posting as fast as the server lets it, then makes the umpire's handler post one reply per message, as the umpire, to everyone in the room. The handler leaves out messages from its own login, so two handlers on two umpire logins can answer each other until their time limits. Each run ends at its time limit (30 s by default, at most 10 minutes), which bounds the damage per run.

**Why Medium, not High.** It needs a trusted role to run the handler; the person in that role could post as fast by hand with a modified client (D2), so it gains no authority; and the server's per-login byte shaping (Phase 5) slows a flood of large messages, though barely small ones. The harm is to the room's readability and to the umpire's credibility, not to access.

**Options, for the owner.** A per-run budget in the bridge, refused with a clear error when spent: for example 100 sends and 10 proposals per run, and at most 16 calls in flight. The numbers are a product choice; the change is small (`bridge.ts`, a counter per run in `RunState`). Recommendation: build it with those defaults, configurable per deployment later. Not built in WP 6.5, because a limit a reconciler might legitimately meet should be the owner's number.

**Decision (the owner, Nov 6, 2026): accepted.** No per-run budget on sends, proposals or calls. The run's time limit (30 s by default, at most 10 minutes, PY-10) and the server's per-player shaper (Phase 5) are what bound a run. Recorded as an accepted risk in SRD Annex C, the gate post and `docs/python-sdk.md` ("Limits and what to expect"). L2 (bounds per call, not per run) stays recorded with it.

### M3. A world state "further back" read as none by scripts (Medium; fixed)

**What.** Phase 5's H1: a player can bury the admin's latest world state behind about 200 small map-room posts; after a reload the store reports it `unreached`, never `none`, and the map room and the admin's editor refuse to edit or publish against it. Phase 6 added two paths that did not check:

- The bridge's `readWorldState` (and `readDraft` with no draft held) waited for the search to stop and then returned `null` when no state was found, `unreached` or not. A script took the empty answer as "nothing published yet"; one that builds a starting state when there is none (a reasonable reconciler) would write a draft from nothing.
- Publishing without review (`publishScriptDraft`) compared the draft with `published?.state` and published whenever they differed, without the map room's `unreached` check. So the same script, with **Publish without review** on, would have published its from-nothing state to every role: the wipe H1's fix stopped by hand, now reachable by a player plus an auto-publishing script. Rated Medium because it needs the admin to have turned on publishing without review for such a script.

**Fix (WP 6.5).** The bridge refuses both reads with `unavailable` ("the latest world state is further back in the map room, behind other messages; open the Map room and choose “Look further back”, then run again"), which the SDK raises as `UnavailableError`. `publishScriptDraft` refuses to publish unless the published state is found or the room was searched to its start (`none`), with the same advice; the panel then shows the failure and leaves the draft. Tests: `packages/py-runner/src/bridge.test.ts` ("refuses, rather than reads as none, a world state behind other map-room posts"), `packages/player-ui/src/scripts/runner-host.test.ts` (refuses `unreached` and a state still loading; publishes into a room that is truly empty).

### M4. Publishing without review publishes the whole draft (Medium; accepted by the owner, Nov 6, 2026)

**What.** With **Publish without review** on, a clean run that changed the draft publishes the draft as it then is (`publishScriptDraft`), which includes every hand edit the admin made since the last publish and has not reviewed in a change summary. A half-finished hand edit, or a proposal loaded into the draft to look at, goes live with the script's change. The panel's record lists what changed, after the fact. WP 6.4 recorded this as a weak point; this review rates it.

**Options, for the owner.**

1. **Refuse to publish without review when the draft held unpublished edits at the run's start** that the script did not make, and say so; the run's change stays in the draft for a manual publish. Small, and keeps PD7's promise only for runs that start from a clean draft.
2. **Publish only the script's change**, applied to the published state (`applyWorldChanges(base, scriptState, published)`), leaving the hand edits in the draft. Closest to what an admin expects, but the draft and the map then differ in a way the panel must explain.
3. Keep it, documented (done in WP 6.5: `docs/python-sdk.md`, the site's scripting page).

Recommendation: option 1 now, option 2 if umpires ask for it.

**Decision (the owner, Nov 6, 2026): accepted (option 3).** Publishing without review publishes the whole draft, hand edits included. The panel says so plainly: the setting's hint ("the whole draft, your hand edits included, is published") and the confirmation shown when it is turned on ("publish the whole draft … the script's change and any hand edits in the draft that you have not published, finished or not … Publish or discard your hand edits before a run"), checked by `scripts-panel.test.tsx`; and `docs/python-sdk.md` and the site's scripting page. Recorded as an accepted risk in SRD Annex C and the gate post.

### L1. Proposals from a White Force observer (Low; fixed)

Receivers accepted a `world-proposal` from any White Force login, observers included (`isWhiteForceLogin`). The server stops an observer posting in the umpire room only through its voice being revoked from the vault (contract U01 checks it on both backends), so a moment with the vault not yet applied, or a misconfigured server, would have let an observer's post show as a loadable proposal. PD6 names the roles that post proposals: White Force roles that are not observers. Now receivers accept only those and the admin (`isWhiteForceWriter`, `packages/domain/src/store.ts`); test `world.store.test.ts`, "White Force proposals on receipt".

### L2. Per-call bounds, not per-run (Low; recorded)

Each call is bounded (10,000 characters, or 1,000,000 for a world state; a page of at most 500 messages), but:

- **Calls in flight** are unbounded: 1,000 at once were all answered (200 ms on the mock). A larger burst holds memory on both sides (the worker's `pending` map, the page's promises) until answered.
- **The payload is cloned before it is checked.** A script can pass a string of hundreds of megabytes to `_wrx_bridge.call`; the worker posts it whole and the page's zod check refuses it only after the structured clone. The tab's memory spikes; nothing else is harmed.
- **A forged cursor** on a newest-first read pages the whole room archive in (up to 1,000 store pages) before refusing it as no longer valid.
- **Subscribed rooms** are re-scanned in full on every store change (`subscribeMessages`'s `check`), so a long room with a subscription costs the tab CPU on each message.

All of it is the script's own tab, which the script's runner could equally hang with `while True: pass` (Stop and the time limit end both). Recommendation: fold a cap on calls in flight into M2's budget; truncate in the worker before posting (cheap, but the worker is untrusted anyway, so the page's check stays the guarantee).

### L3. Private storage (Low; recorded)

- **Size.** One key per login, 200,000 bytes, checked before sending in both transports (the reference server would otherwise end the stream at 256 KB). A full key cannot be saved to; nothing else is harmed.
- **Shared logins (PD5, accepted).** Everyone using a role's login shares, and can change, its scripts. The panel re-reads every 5 s and, with no unsaved edits, takes another session's save at once, announced only in a polite status. So the code you read a minute ago may not be the code that runs when you press Run, if a teammate saved meanwhile. Within the trust PD5 accepts. Recommendation: say "Changed by another session" visibly for a few seconds when a re-read replaces the open script, and keep it until the next run.
- **No conditional write.** Two saves within one round trip end last-writer-wins (WP 6.3's weak point); the version check catches everything slower.
- **The record of publishes without review** (`wrx-script-publishes`, the admin account's private storage) is read, appended and written, so two admin sessions recording at once keep one; it keeps the newest 50, and the admin can overwrite it with any client. It is a convenience, not an audit trail: the map room's archive holds every published world state as the admin's message, with server time, which is the authoritative record. Recommendation: say so in the panel ("The map room's history has every publish").
- Scripts cannot reach private storage: no bridge operation reads or writes it, so a script cannot turn on its own publishing without review.

### L4. Dropped events are silent (Low; recorded)

The worker queues at most 1,000 events per run while a handler is busy and drops the oldest; `_wrx_bridge.dropped_events()` counts them, but the SDK does not surface the count. A reconciler that must see every message (a tally of reports) can miss some without knowing. None were dropped at 2,500 events a second on the mock. Recommendation: raise a warning on stderr the first time an event is dropped, and expose the count on `Game`.

### L5. Supply chain of the Pyodide files (Low; recorded)

- **What is checked.** Every shipped file (the four core files from the `pyodide` npm package and ten wheels from the release) is checked at every build against the sha256 in the committed `packages/py-runner/pyodide.lock.json`; a mismatch fails the build. The npm package is also pinned by pnpm's lockfile integrity. Nothing is fetched at run time, and the trimmed `pyodide-lock.json` in the build lists only the shipped packages, so a script cannot install anything else (no micropip).
- **Where the hashes came from.** The lock was generated (`pnpm --filter @wrx/py-runner lock`) from the release's own `pyodide-lock.json` on jsDelivr's mirror and the npm tarball: trust on first use of both. A compromised mirror at generation time would have been locked in; later tampering is caught.
- **Build-time fetch.** A build without the cache fetches the wheels from `cdn.jsdelivr.net` over HTTPS, then checks them. CI caches them keyed on the lock.
- **Air-gapped path.** `WRX_PYODIDE_RELEASE` points the build at an extracted release folder, checked against the same lock; the install bundle carries the built `py/`.
- **The worker's fetch** is put back only for GETs under `py/pyodide/` of the same origin, without a query string, so a script can fetch shipped files and nothing else.

Recommendation: when the lock is next regenerated, check the release lock's digests against the GitHub release tarball (`pyodide-314.0.7.tar.bz2`) as a second source, and record its sha256 in the lock's description.

### L6. Imported scripts (Low; recorded)

PR1's mitigation holds: no script is loaded from anything players can publish to; import reads only files the user picks, validates them (format, sizes, at most the script limit), adds them as new scripts with unique names and **Publish without review** off, and runs nothing. The sample bundle (`python/examples/sample-scripts.json`) is regenerated and checked by `check:python`. What is missing is any mark that a script was imported and has not been run or read since; with M1, one imported script run once can affect the rest of the session. Recommendation: mark imported scripts "imported, not yet run" until their first run, and fix M1.

### L7. The client policy for every role (Low; accepted, PR3)

Every role's page now allows `'wasm-unsafe-eval'` in `script-src` and `blob:` in `worker-src`. `'unsafe-eval'` stays absent (asserted by `app.test.ts`, the shell e2e and the deployment checks), so `eval`, `new Function`, string timers and every function constructor are still refused on the page and in the worker. WebAssembly compilation gives a script already running on the page no new reach (no network or DOM of its own); `blob:` workers inherit the page's policy (S17). Both matter only after a script injection, which nothing found allows (React text, DOMPurify for Markdown, `script-src 'self'`). No player page loads the runner. Accepted by the owner on Nov 6 for one simple policy.

### I1. The sandbox (Info; verified with more probes)

The worker's guarantees are two: the lockdown removes the network, storage and messaging globals before any script runs (a deny-list: a new browser global would need adding), and the worker's policy refuses every form of eval and any `import()` from another origin. What makes the deny-list enough is that a script cannot reach the global scope at all, so even a global the list misses is out of reach. WP 6.5 tested that more widely:

- **Probes** (`apps/web/e2e/py-runner/probes.py`, under the policy as a header and as a `<meta>` tag, plus a no-policy control): all of S17's, and new: a **deep walk** into Pyodide's Emscripten module and API (`pyodide_js._module`, `pyodide_js._api`), which the first walk skipped (452 objects, no global scope found); the **AsyncFunction constructor** (refused: `EvalError` under the policy; reaches the global scope with no policy); and **`setTimeout` with a string** (refused silently under the policy, so the proof is the canary, which a no-policy run does reach).
- **A JS-side walk** from the Pyodide API object in Node (every own property, prototypes included, 28,815 objects): no reference to the global scope, `fetch` or `process`.
- **`pyodide_js` is reachable** from Python, as S17 found: its `loadPackage` goes through the guarded fetch (only shipped files), its `FS` is the in-memory file system, `registerJsModule` would let a script register modules of its own, in its own interpreter only (and so for later runs, M1).
- **Same-origin `import()`** is allowed by `script-src 'self'`, but only eval could call it; none is reachable.

### I2. The bridge (Info; verified)

Every worker message is parsed against `fromWorkerSchema` (strict, sizes capped) and a message for another run is ignored; every call is parsed by `parseBridgeCall` (strict request shapes; 10,000 or 1,000,000 characters); the role table (`OPERATION_ROLES`) is checked before any work: `readDraft`/`writeDraft` admin only, `postProposal` the White Force only; unknown and prototype names (`constructor`, `__proto__`, `toString`) are `unknown-op`. Reads are scoped to the session (`me().rooms`), sends go through the store's own send paths with the composer's checks (write access, joined, the pause), and every result is checked against its schema before it goes back (`bridgeOk`). A draft write is checked as a publish is (schema, 500 KB) and held until a clean finish. The admin backend's operations (design publish, passwords, the vault, private storage, reset) have no operation at all. Tests: `bridge.test.ts`, `py-runner.spec.ts` ("the bridge keeps each role to its operations…").

### I3. PD2 against D2 (Info; verified)

Every check the bridge makes is client-side. The server enforces only membership, voice and PubSub affiliations (D2), so the question is whether a script can do anything a **modified client of the same login** could not. It cannot: the bridge runs in the logged-in session and adds no credential, room or node. Conversely, a modified client does not need scripts to do what the bridge refuses: the admin's or a White Force role's modified client can post a `world-proposal` body in any room it writes (receivers show it unreadable outside the umpire room: the registry), post during adjudication (advisory, D7), skip a template's checks (receivers validate, TPL-6) or flood (M2). A player's modified client cannot reach the umpire room (members only, U01) and its world states and proposals are ignored by every reader (Phase 5 I2; L1). So PD2 holds in the sense the SRD means: a script gains no rights a person in that role lacks.

### I4. The umpire room and the vault (Info; verified)

The umpire room is members-only with fixed participants (§3 rule 19): the White Force as a write entry, plus a read entry for each White Force observer assigned rooms elsewhere. Contract U01 on the mock and ejabberd: a player of another force cannot join; a proposal near 500 KB goes from the White Force writer to the admin live and through MAM with the sender's real JID, and the observer receives it; the observer, made read-only through the vault, cannot post; a proposal over the cap is refused before sending. White Force observers were already in the vault for their other read-only rooms, so the room adds no new secrets. Its contents (proposals: whole world states before publication) are confidential to the umpire team by design; a White Force observer reads them, as PD8 says.

## What WP 6.5 changed

- `packages/py-runner/src/bridge.ts`: `unavailable` for an unreached world state (M3).
- `packages/player-ui/src/scripts/runner-host.ts`: publishing without review refuses an unreached or loading published state (M3).
- `packages/domain/src/store.ts`: proposals on receipt only from the admin or a White Force role that is not an observer (L1).
- Probes and tests: `probes.py` (deep walk, AsyncFunction, string timer), `py-runner.spec.ts` (M1's probe, the control's canary), `bridge.test.ts`, `runner-host.test.ts`, `world.store.test.ts`.

## After the review: the owner's decisions (Nov 6, 2026)

- `packages/py-runner/src/runner.ts`, `worker.ts`, `protocol.ts`, `index.ts`: a fresh interpreter for every run, the next worker started in the background, the SDK imported by each worker before `ready` (M1).
- `apps/web/e2e/py-runner.spec.ts`: M1's probe turned into a regression test that passes; `py-runner-perf.spec.ts` measures a run's wait for its fresh interpreter, with and without the background start.
- `packages/player-ui/src/scripts/scripts-panel.tsx`: the status line says each run starts in a fresh Python; the publish-without-review hint and confirmation say it publishes the whole draft, hand edits included (M4).
- M2 and M4 recorded as accepted risks (SRD Annex C, the gate post, `docs/python-sdk.md`).

## For the owner

Decided on Nov 6, 2026:

1. **M1**: fixed, a fresh interpreter for every run (option 1).
2. **M2**: accepted, no per-run budget; the time limit and the server's per-player shaper bound a run.
3. **M4**: accepted, publishing without review publishes the whole draft, hand edits included, and the panel and docs say so.
