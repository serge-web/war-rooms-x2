# WP 6.5 — Python API: acceptance and review

**SRD ids:** Annex C PY-11, PR1–PR5, SC-12 (also PD2, PD4–PD9, PY-4–PY-10, NFR-7, NFR-14, NFR-17) · **Depends on:** 6.4 · **Status:** done · **Security review required**

## Goal

Prove Phase 6 end to end, measure it, review it and close the phase: the Python SDK in the browser runner, the Scripts panel, private storage, act and adjudicate, the umpire room and publishing without review, on both backends.

## Acceptance

- **Scenario SC-12** (new in SRD §12, `apps/web/e2e/scenarios/sc-12-umpire-runs-python.spec.ts`), on the mock and on ejabberd: White Force posts a world-state proposal from a script; the admin loads it into the draft after its change summary; the admin edits an asset by hand, then runs an admin script that adjusts the draft on top of the hand edit; the admin reviews the change summary and publishes; a player sees the map update; a player has no Scripts tab and no umpire room. `pnpm check:trace` passes (the spec names SC-12 and its "Traces to" line).
- **Performance** (`plan/reviews/phase-6-performance.md`): the runner's cold and warm start, the first run that imports the SDK (pydantic), the first pandas run, a script over 600 assets (read, modify, write the draft), event throughput, the interpreter's memory, the Pages and preview sizes with `py/`, and the main bundle's growth across Phase 6 (WP 6.3 +1 KB, 6.4 +9 KB): what grew in 6.4, and whether it can move to a lazy chunk (moved if small).
- **Accessibility** (`plan/reviews/phase-6-accessibility.md`, NFR-14): axe and a keyboard-only path on the Scripts panel, the editor, the output, the confirmations (publishing without review, delete), the proposal card and the load-into-draft summary, and the umpire room.
- **Security review** (`plan/reviews/phase-6-security-review.md`) of the whole phase, adversarial, with severities and recommendations: the sandbox's escape surface, the bridge's validation and role checks, PD2's client-side scoping against D2, private storage, proposals, publishing without review, the umpire room and the vault, the policy widened to every role (PR3), the Pyodide wheels' supply chain, and imported scripts (PR1). Small in-scope problems are fixed with tests; the rest are findings for the owner.
- **Docs:** a site page for umpires on scripting (deny-listed terms kept off; `check:site`), `docs/python-sdk.md` final pass, `RELEASE-NOTES.md` for Phase 6, the gate post draft (`plan/reviews/gate-6-post.md`) and the G6 blog post (`check:blog` accepts phase 6), the README chart (wp65 done).
- **Gates:** `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`; `pnpm check:python`; build and `check:bundle`; `CI=1 pnpm e2e`; `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`; the site build with `check:site` and `check:blog`; screenshots `--repeat`; on ejabberd 26.09 the contract, publish and audit suites and the Playwright `ejabberd` project with `--workers=1`.

## Owns

`apps/web/e2e/scenarios/sc-12-*.spec.ts`, new a11y, keyboard and performance e2e for the scripts; SRD §12 (SC-12) and its revision note; `plan/reviews/phase-6-*.md`, `plan/reviews/gate-6-post.md`; the Phase 6 site page and blog post, `tools/site/lib/blog.ts`'s accepted phases; `docs/python-sdk.md`, `RELEASE-NOTES.md`; the README chart's wp65; and the fixes the reviews call for.

## Consumes

Everything Phase 6 built, as frozen: the SDK and protocol 2 (6.1, 6.4), the runner, its lockdown and packaging (6.2), the Scripts panel and private storage (6.3), act and adjudicate, the umpire room and publishing without review (6.4).

## Notes

- SC-12's admin is the umpire in the game view, as in SC-11: the map room, the Scripts panel and the umpire room are there.
- Decisions that need the product owner are recorded under "For the owner" below and in the gate post, not taken here.

## Notes (done)

- **SC-12** (`apps/web/e2e/scenarios/sc-12-umpire-runs-python.spec.ts`, SRD §12 and a §14 note) passes on the mock and on ejabberd 26.09, with axe on the load confirmation. Script names carry a per-run tag: a server reset keeps the admin account, so its scripts (private storage, PD5) outlive a reset on ejabberd.
- **Performance** (`plan/reviews/phase-6-performance.md`, new `apps/web/e2e/py-runner-perf.spec.ts` in the `py-runner` project; the harness gains `publishScale` and `playerPosts`): ready 2.0 s cold, 2.1 s warm; first SDK run 0.9 s; first pandas run 3.0 s; 600 assets read, changed and written in 79 ms; about 2,500 events a second; memory 30, 36 and 90 MB. Start-up chunk +10,607 bytes over the phase (6.3 +1,009, 6.4 +9,255, 6.5 +183). 6.4's growth was attributed by source map; moving the admin's umpire panel to a lazy chunk split the start-up chunk in three for 1.6 kB, so it was reverted. The product owner then accepted the phase's growth (Nov 6, 2026); `check:bundle`'s assertions are unchanged.
- **Accessibility** (`plan/reviews/phase-6-accessibility.md`, `apps/web/e2e/scripts-a11y.spec.ts`): A1 fixed (inline forms and confirmations, and the proposal's, give focus back when they close).
- **Security** (`plan/reviews/phase-6-security-review.md`): no Critical or High. Fixed: M3 (the bridge and publishing without review against an unreached world state), L1 (proposals from White Force observers). New probes: a deep walk of Pyodide's internals, the AsyncFunction constructor, a string timer, and M1's recorded probe.
- **Docs:** `site/pages/scripting.md` (new, in the sidebar and nav), `docs/python-sdk.md` (limits and expectations, the record's key, `UnavailableError`), `RELEASE-NOTES.md` (Phase 6 section), `plan/reviews/gate-6-post.md`, `site/pages/blog/phase-6-python-api.md`; `tools/site/lib/blog.ts` accepts phase 6.
- **Gates** (Nov 6, 2026): `pnpm check` (1,779 unit tests); `check:python` (84 passed, 3 skipped); build and `check:bundle`; `CI=1 pnpm e2e` with ports 5083/5085 (125 passed, 18 skipped: the ejabberd project without a stack); `e2e:mock-host` (18), `e2e:admin-ui` (17), `e2e:theme` (4); the site build with `check:site` (62 files, no deny-list match; 33.8 MB) and `check:blog` (8 posts); screenshots `--repeat` (31, identical). On ejabberd 26.09 (compose projects `wrx-wp65-a3497`, port 35521, and `wrx-wp65-audit-a3497`, port 35522; both stopped and removed): contract (109), publish (39), audit (22), and the Playwright `ejabberd` project with `--workers=1` (18 passed, 1 skipped; SC-12 failed once on a script name left by an earlier run, fixed as above).

## For the owner

1. **M1:** a fresh Python interpreter for every run (recommended), only before runs that publish without review, or keep as documented.
2. **M2:** a per-run budget on sends, proposals and calls in flight (suggested 100, 10, 16).
3. **M4:** refuse publishing without review when the draft held unreviewed hand edits (recommended), or publish only the script's change.
4. **Blog snapshots** carry `py/` (about 34 MB each); build them without Python unless the post is about it.

## Weak points

- **Three Medium findings stay open** (M1, M2, M4), with the owner.
- **The sandbox is still a deny-list plus the policy.** The new walks found no path to the global scope, but they are a sample, not a proof.
- **Numbers are the mock's, on loopback, in Chromium.** No network time, no WebKit, no Python throughput on ejabberd.
- **Scripts outlive a server reset** on ejabberd, since the admin account is kept; by design (PD5), but the next game's admin sees the last game's scripts, publish-without-review settings included.
- **The keyboard test focuses its starting controls** rather than tabbing through the whole page; the FlexLayout tab's keyboard use is WP 2.5's test.
- **No real screen reader** was used.
