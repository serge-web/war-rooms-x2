# War Rooms X1 — Development Plan

Oct 24, 2026 (revised the same day, see Plan changes) · @Ian Mayo

## Summary

WRX1 v1 is built by Claude Code in four phases, with up to five work packages running in parallel. Automated CI gates check every PR; people review only at four phase gates and on security-critical PRs.

- **Phase 0, foundations:** pre-development checks P1–P5, repo scaffold, CI, the GitHub Pages site with PR previews, and the schemas.
- **Phase 1, contracts and transports:** the transport interface, contract suite, real transport, mock server and domain layer.
- **Phase 2, features, in three lanes:** admin; player shell, workspace and chat; themes and multi-client.
- **Phase 3, acceptance:** end-to-end scenarios, performance, accessibility, the air-gapped install and release.

The repo README opens with a Mermaid flowchart of this plan's work packages, dependencies and status (section 4). The first scaffold PR creates it, and every PR afterwards updates it with progress or plan changes.

## Working model

Each work package (WP) is a written brief that one Claude Code session builds on its own branch, and the only shared ground between parallel sessions is interfaces that have been frozen.

1. **Brief.** Each WP has a brief at `plan/briefs/WP-x.y.md`. It lists the SRD ids the WP delivers, its acceptance tests, the folders it owns, and the interfaces it may only consume.
2. **Session.** One Claude Code session per WP, in its own git worktree, on a WP branch cut from its phase branch. Sessions don't edit folders owned by another active WP.
3. **One PR per phase.** Each phase has a long-lived branch (`phase-0` to `phase-3`) and a draft PR against `main`, opened when the phase starts. Its preview, screenshots and bot comment update on every push, so progress can be looked at any time. WP branches merge into the phase branch automatically when CI is green, with no human review. Doc reviews only the four phase PRs.
4. **Interfaces.** Shared contracts are set in designated WPs: 0.8 (schemas), 1.1 (transport interface), 1.6 (room-type registry) and 2.5 (workspace module). A later change to one of them may merge, but must be listed in the phase PR's gate summary, and dependent WP branches rebase onto it.
5. **Every WP merge includes:**
   - tests, with the contract suite run against both ejabberd and the mock where the transport is touched;
   - its site content: pages, posts and Mermaid diagram updates (DOC-4, DOC-18);
   - tagged Playwright scenarios for screenshots of new UI (DOC-20);
   - an update to the plan chart on the phase branch: the WP's status, and any change to scope or dependencies.
6. **Gate summary.** The phase PR's description is kept up to date as WPs merge. It lists:
   - what was delivered, by SRD id;
   - interface changes made after their designated WP;
   - differences from the baseline plan chart;
   - open risks;
   - links to the preview and the screenshots that matter for review.
7. **Progress.** The plan chart on the current phase branch is the live view. `main`, its README and the live demo update when each phase PR merges.

**Blog posts between gates.** When a WP delivers a notable feature or design decision, its session writes a post. The post goes to `main` in its own blog-only PR, which merges automatically when CI is green, with a frozen snapshot of the phase-branch build at `snapshots/<post-slug>/`. These are the only PRs to `main` besides the four phase PRs (DOC-23 to DOC-26).

## Phases and work packages

There are 28 work packages. Each is sized for one to three Claude Code PRs, and the order is set by dependencies, not dates.

| WP | Work package | SRD ids | Depends on |
| --- | --- | --- | --- |
| **Phase 0 — Foundations** |  |  |  |
| 0.1 | S13 offline voice revocation, and the WebSocket stanza cap (P1) | ADM-37, R15 | — |
| 0.2 | Layout library evaluation, FlexLayout vs dockview (P3) | PLY-4–6, 40–42, ARC-9 | — |
| 0.3 | StanzaJS health check (P4) | ARC-1, ARC-12 | — |
| 0.4 | Target environment questions (P2), answered by Doc with the customer | D12, D17, NFR-23 | — |
| 0.5 | Repo scaffold: monorepo, TypeScript strict, lint rules, Vitest, Playwright, CI with ejabberd container, PR template, **README with the Mermaid plan chart** | D18, NFR-7, NFR-15–19, NFR-22, DOC-22 | — |
| 0.6 | Site and previews: generator, serialised `gh-pages` deploys, PR previews and bot comment, PR index, `demo/` on main, blog-only auto-merge with frozen snapshots, size check, deny-list check | NFR-1, DOC-1–2, 6–9, 11–16, 23–26 | 0.5 |
| 0.7 | Screenshot pipeline: tagged Playwright capture, images in the PR comment, before/after | DOC-19–21 | 0.6 |
| 0.8 | Runtime schemas (zod) for every PubSub document and message body, and the generated data dictionary (P5) | ARC-6, NFR-20, DOC-3 | 0.5 |
| **Phase 1 — Contracts and transports** |  |  |  |
| 1.1 | XMPP-level transport interface, frozen by interface PR | ARC-1, ARC-12–14 | 0.3, 0.8 |
| 1.2 | Contract suite, ported from the spike and extended: MUC, PubSub, MAM, presence, admin operations, anonymous access | NFR-16, NFR-21, ARC-10–11 | 1.1 |
| 1.3 | Real transport: StanzaJS plus the ejabberd server adapter | ARC-1, ARC-8 | 1.1 |
| 1.4 | Mock server core: affiliations, voice, PubSub access, MAM/RSM, presence, admin operations, errors, seed, clock, injected faults | ARC-7, D14, NFR-21 | 1.1 |
| 1.5 | Mock hosting: SharedWorker, Web Locks fallback, BroadcastChannel, IndexedDB, base-path isolation, migration | D17, ARC-7, DOC-10, DOC-17 | 1.4 |
| 1.6 | Domain layer, session store and hooks; StrictMode-safe cleanup; room-type registry with `chat` registered | ARC-2–5, ARC-13, NFR-5 | 1.1 |
| **Phase 2 — Features** |  |  |  |
| 2.1 | AdminOps: all admin operations and rules R-A to R-F | ADM-35–40, ADM-12, NFR-3 | 1.3, 1.6, 0.1 |
| 2.2 | Admin design editor and admin screen layout | ADM-1–9, 27–28 | 1.6 |
| 2.3 | Publish and provisioning: diff, progress, live changes, reset, export/import, credentials sheet | ADM-10–17, 25–26, NFR-4, NFR-6 | 2.1, 2.2 |
| 2.4 | Player shell: login, session, reconnect, forced logout, welcome page, empty states | PLY-1–3, 27–32, 46–48, 50–52, NFR-8–9 | 1.6 |
| 2.5 | Workspace: dockable layout, persistence, reconciliation, default layout, reset | PLY-4–6, 8, 40–42, ARC-9 | 0.2, 2.4 |
| 2.6 | Chat room panel: cards, composer, MAM history, unread counts, observer UI, unsent text | PLY-9–14, 33, 43–45, 49, 53 | 2.5 |
| 2.7 | Out-of-game column: announcements, force panel, objectives (including umpire editing) | PLY-15, 25, 35–39, ADM-23–24, 29 | 2.5, 2.1 |
| 2.8 | Themes: runtime theming and inheritance, assets and SVG sanitising, theme editor | D19, PLY-24, 26, ADM-18–22 | 1.6, 2.2 |
| 2.9 | Multi-client view, mock user controls, seed scenarios, admin preview-as-role | PLY-16–22, 34, ADM-30–31 | 1.5, 2.5 |
| 2.10 | Audit and repair; node-name warning | ADM-41–42 | 2.3 |
| **Phase 3 — Acceptance** |  |  |  |
| 3.1 | Playwright scenarios SC-1 to SC-9 on mock and ejabberd | NFR-17, §12 | Phase 2 |
| 3.2 | Performance and scale (NFR-11, NFR-12), accessibility audit (NFR-14) | NFR-11–14 | Phase 2 |
| 3.3 | Reference deployment and air-gapped install on real hardware | NFR-2, NFR-4, NFR-10, NFR-22–23 | 0.4, 1.3 |
| 3.4 | Security review, release notes, v1 milestone blog post | DOC-2, DOC-5 | 3.1–3.3 |

**Traceability.** Every live SRD requirement id is assigned to at least one WP above, except four that apply to every PR: ARC-15 (team's choice), DOC-4 and DOC-18 (working model item 5) and DOC-5 (blog posts). CI checks this on every PR (`pnpm check:trace`), so a requirement added to the SRD without a WP fails the build.

Documentation is not a separate phase. Each PR carries its own pages and diagrams (DOC-18), and a blog post closes each phase (DOC-5).

## The README plan chart

The README opens with a Mermaid flowchart of the work packages and their dependencies, coloured by status: grey for to do, amber for active, green for done. WP 0.5 copies the chart below to the top of `README.md`; from then on it is the live plan.

```mermaid
flowchart TB
    subgraph P0["Phase 0 — Foundations"]
        direction LR
        wp01["0.1 S13 and stanza cap"]
        wp02["0.2 Layout library eval"]
        wp03["0.3 StanzaJS health"]
        wp04["0.4 Target environment"]
        wp05["0.5 Scaffold and README plan"]
        wp06["0.6 Site and PR previews"]
        wp07["0.7 Screenshot pipeline"]
        wp08["0.8 Schemas and dictionary"]
    end
    subgraph P1["Phase 1 — Contracts and transports"]
        direction LR
        wp11["1.1 Transport interface"]
        wp12["1.2 Contract suite"]
        wp13["1.3 Real transport"]
        wp14["1.4 Mock server core"]
        wp15["1.5 Mock hosting"]
        wp16["1.6 Domain layer and hooks"]
    end
    subgraph P2["Phase 2 — Features"]
        direction LR
        wp21["2.1 AdminOps"]
        wp22["2.2 Design editor"]
        wp23["2.3 Publish and provisioning"]
        wp210["2.10 Audit and repair"]
        wp24["2.4 Player shell"]
        wp25["2.5 Workspace"]
        wp26["2.6 Chat panel"]
        wp27["2.7 Out-of-game column"]
        wp28["2.8 Themes"]
        wp29["2.9 Multi-client and seeds"]
    end
    subgraph P3["Phase 3 — Acceptance"]
        direction LR
        wp31["3.1 Scenarios SC-1 to SC-9"]
        wp32["3.2 Performance and a11y"]
        wp33["3.3 Air-gapped install"]
        wp34["3.4 Security review and release"]
    end
    G0{{"Gate G0"}}
    G1{{"Gate G1"}}
    G2{{"Gate G2"}}
    G3{{"Gate G3 — v1"}}

    wp05 --> wp06 --> wp07
    wp05 --> wp08
    wp03 & wp08 --> wp11
    wp11 --> wp12 & wp13 & wp14 & wp16
    wp14 --> wp15
    wp13 & wp16 & wp01 --> wp21
    wp16 --> wp22
    wp21 & wp22 --> wp23 --> wp210
    wp16 --> wp24
    wp02 & wp24 --> wp25 --> wp26
    wp25 & wp21 --> wp27
    wp16 & wp22 --> wp28
    wp15 & wp25 --> wp29
    wp04 & wp13 --> wp33
    wp31 & wp32 & wp33 --> wp34
    P0 -.-> G0
    P1 -.-> G1
    P2 -.-> G2
    G2 --> wp31 & wp32
    P3 -.-> G3

    classDef todo fill:#f2f2f2,stroke:#888,color:#222
    classDef active fill:#fff1c2,stroke:#c9a000,color:#222,stroke-width:2px
    classDef done fill:#d6f0dc,stroke:#2e7d32,color:#222
    classDef gate fill:#e3ecfa,stroke:#3b5bab,color:#222
    class wp01,wp02,wp03,wp04,wp05,wp06,wp07,wp08,wp11,wp12,wp13,wp14,wp15,wp16,wp21,wp22,wp23,wp210,wp24,wp25,wp26,wp27,wp28,wp29,wp31,wp32,wp33,wp34 todo
    class G0,G1,G2,G3 gate
```

**How PRs update the chart**

- A PR that starts a WP moves its id from the `todo` class line to an `active` line; the PR that finishes it moves the id to `done`.
- A PR that adds, splits or removes a WP, or changes its dependencies, edits the nodes and arrows, and says why in the PR description.
- New work gets a new node with the next free WP id, never a reused one.
- Node ids (`wp05` and so on) never change, because the arrows and class lines refer to them.
- CI renders the chart on every PR and fails if the Mermaid doesn't parse. The PR checklist asks whether the chart reflects the PR.
- At each gate, the chart is compared with this baseline, and the differences are recorded in the gate's blog post.

## CI gates and human checkpoints

CI decides whether a work package merges into its phase branch. People review only the four phase PRs, each of which is a gate, plus a tech-lead security review of the admin work before the Phase 2 PR merges.

**Automated checks on every WP merge and every phase PR push (all must pass)**

| Check | What it enforces | SRD |
| --- | --- | --- |
| Type check and lint | TypeScript strict; no `any` or unchecked casts of network data; no module-level mutable state | NFR-19, ARC-2 |
| Unit tests | Store, hooks and mock against the in-memory transport | NFR-15 |
| Contract suite on ejabberd and mock | Same results on both, failing (not skipping) if the server is down | NFR-16, ARC-10–11 |
| R1 tests | Observer read-only still enforced (S01, S01b, C01) | NFR-22 |
| Playwright end-to-end | Multi-client send and receive; tagged screenshot capture | NFR-17, DOC-20 |
| Preview deploy | Whole site to `pr/<n>/`, one updated bot comment with screenshots | DOC-6–7, DOC-19 |
| Site checks | Mermaid parses (including the README plan chart), deny-list scan, size below 70% of the limit | DOC-2, DOC-14 |
| Bundle check | No secrets or real-server endpoints in preview builds | NFR-1, DOC-12 |

**Human checkpoints**

| Checkpoint | When | Who | Decides |
| --- | --- | --- | --- |
| Gate G0: Phase 0 PR | Phase 0 complete | Doc | Foundations fit; previews and screenshots usable for review |
| Gate G1: Phase 1 PR | Phase 1 complete | Doc and tech leads | Contract suite green on both backends; transport interface and schemas acceptable |
| Security review | Before the Phase 2 PR merges | A tech lead | AdminOps (2.1, 2.3, 2.10) applies rules R-A to R-F correctly; nothing security-sensitive on the site |
| Gate G2: Phase 2 PR | Phase 2 complete | Doc, with a stakeholder demo of the preview | Features complete against the SRD |
| Gate G3: Phase 3 PR | v1 release | Doc and tech leads | Scenarios, performance, accessibility and the air-gapped install pass |

Phase 2 lanes start as soon as their dependencies merge, without waiting for G1. Gate G1 can stop them if the contract suite reveals a transport problem.

## Risks to the plan

The biggest risk is not speed but correctness without close human review: the same agent writes the code and the tests that judge it.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Self-graded tests.** A session can write tests that pass its own mistakes | Defects merge through green CI | The contract suite against real ejabberd is an independent judge; scenario tests (3.1) are written from the SRD in a separate session, not by the feature's author |
| **Security with light review.** AdminOps decides who can read and post | A missed rule leaks objectives or gives an observer a voice | 2.1, 2.3 and 2.10 always get a tech-lead review; R1 tests run on every PR |
| **Interface churn.** Three lanes build on the transport interface and schemas at once | Rework across lanes; merge conflicts | Interfaces are set in designated WPs, and later changes are listed in the gate summary; folder ownership per brief; dependent branches rebase after each change |
| **Mock fidelity at XMPP level** is a large piece of work | Phase 1 takes longer, and the lanes that need the mock wait | The mock implements only what the contract suite covers (ARC-10) |
| **Plan chart and diagram drift.** Updates rely on a PR checklist | The README shows a plan that isn't real | CI checks the chart parses; each gate compares it with the baseline |
| **CI cost and time.** ejabberd, Playwright and screenshots run on every PR from up to five sessions | Queues slow merges; GitHub Actions minutes grow | Cache builds; run screenshots only on PRs touching UI or site; one deploy queue (DOC-13) |
| **Customer answers arrive late** (WP 0.4) | A browser or approval constraint lands mid-build | Ask at the start; 3.3 doesn't depend on them until Phase 3 |
| **Plans for an unproven way of working.** Briefs, worktrees and gates haven't been run at this scale here | Early work packages need more iteration | Phase 0 is the trial; adjust the working model at G0 |

## Plan changes

Changes from the baseline above are listed here and in the phase PR's gate summary.

| Change | Why |
| --- | --- |
| The room-type registry (ARC-5) moves from 2.2 to 1.6, with `chat` registered there | 2.2 (admin) and 2.6 (chat panel) both need the registry, but 2.6 did not depend on 2.2. Both already depend on 1.6 |
| SRD ids assigned that no WP covered: ADM-17 → 2.3; NFR-1 → 0.6; NFR-3 → 2.1; NFR-4 → 2.3 and 3.3; NFR-5 → 1.6; NFR-6 → 2.3; NFR-7 → 0.5; NFR-8–9 → 2.4; NFR-10 → 3.3; NFR-21 → 1.2 and 1.4 | Found by the traceability check |
| 0.5 leaves two items to later WPs: the ejabberd CI job moves to 1.2, and Storybook (NFR-18) to 2.4 | No contract suite exists for the ejabberd job to run until 1.2, and no presentational component for Storybook to show until 2.4. CI gets both when they have something to check |
| Phase 0 work is built on the session branch `claude/gracious-thompson-aowbqs`, and its PR stands in for the `phase-0` PR | This session can push only to that branch. Later phases use phase branches as planned |
| 2.1 grows: it builds the encrypted observer-password vault (ADM-37) | WP 0.1 found no documented way to make an offline observer read-only (`plan/decisions/S13.md`) |
| 1.2 and 1.4: the contract suite covers the errors for a role change on an absent occupant (`not-allowed`, `not-acceptable`), and the mock matches them | Found by WP 0.1; the earlier spike had recorded a different error |
| 1.3 uses StanzaJS 12.22.1; 2.5 uses FlexLayout; the site uses VitePress 1.6.4 | Decisions from WP 0.3, 0.2 and 0.6 (`plan/decisions/`, `site/README.md`) |
| PR titles must avoid deny-listed terms | The site's PR index publishes every PR title, and the deny-list check (DOC-2) fails the build on a match |

