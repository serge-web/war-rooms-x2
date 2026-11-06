# WP 6.5 — Python API: acceptance and review

**SRD ids:** Annex C PY-11, PR1–PR5, SC-12 (also PD2, PD4–PD9, PY-4–PY-10, NFR-7, NFR-14, NFR-17) · **Depends on:** 6.4 · **Status:** active · **Security review required**

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
