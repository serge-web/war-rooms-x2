# Decision: XMPP client library (WP 0.3, P4)

**Status:** decided, 2026-10-24 · **SRD ids:** ARC-1, ARC-8, ARC-12–14, NFR-7, NFR-13, NFR-19, NFR-22 · **Evidence:** `spike/xmpp-library/` (throwaway)

## Decision

**Keep StanzaJS (`stanza` 12.22.1), confined to `packages/transport-xmpp` and pinned exactly. Add `events` 3.3.0 as an explicit dependency.** StanzaJS passed every live check against the reference ejabberd over `wss://`, in Node and in a production bundle in Chromium. That includes SCRAM-SHA-256, ANONYMOUS, XEP-0198 resumption, MUC owner and admin operations, MAM paged backwards with RSM, PubSub owner operations with item events, and XEP-0133. It needed no casts against network data. Its weak points are maintenance and size, not function. It has one maintainer, releases in bursts with gaps of up to 15 months, and adds about 100 kB gzipped that does not tree-shake. It also has a few typing traps, listed below, that the wrapper must absorb.

The fallback, `@xmpp/client` 0.14.0, is better maintained and six times smaller. It works with about 330 lines of hand-written stanza builders, and it ran the same live script. But **its browser build has no SCRAM at all**: it logged in with PLAIN, against NFR-22. Its types stop at RFC 6120 elements, so every XEP payload is untyped XML. Its error parser also misreads ejabberd's errors. It is the exit route, not the choice.

## What was built

`spike/xmpp-library/` is a standalone package outside the pnpm workspace. It uses TypeScript 6.0.3 strict with the repo's base options, Vite 8.3.4, Vitest 5.0.3 and Playwright 1.63.0, and every version in its lockfile is at least 14 days old (`.npmrc` sets `minimum-release-age`). It contains:

- `docker/`: the spike's reference ejabberd 26.09. `ejabberd.yml` and `bootstrap.sh` are copied unchanged from serge-web/xmpp-spike @ 4992530, and the compose file merges the spike's `compose.yaml` and `compose.tls.yaml`. It runs as compose project `wrx-xmpplib`, publishing only `wss://localhost:25443/ws`, with a throwaway internal CA from `make-ca.sh`.
- `src/stanza-client.ts`: about 130 lines of StanzaJS helpers (connect, ad-hoc, forms, error condition). `src/xmppjs-client.ts`: about 330 lines that do the same for `@xmpp/client`, plus MUC, MAM/RSM, PubSub and forms, all built by hand.
- `test/stanza.live.test.ts` and `test/xmppjs.live.test.ts`: the live script, 7 tests per library. `test/browser.live.test.ts`: builds both pages with Vite, serves the production build and logs in from headless Chromium over `wss://`. The browser trusts the test CA by pinning the server key, not by turning certificate checks off.
- `src/typing-probes.ts`: type-level assertions for the StanzaJS operations WP 1.1 needs that the live script does not exercise.

Run it with `cd spike/xmpp-library && pnpm install --ignore-workspace && pnpm stack:up && pnpm typecheck && pnpm test && pnpm build`, then `pnpm stack:down`. Result: **17 of 17 passed** (5 s). With the server down (`XMPP_WS_URL=wss://localhost:25999/ws`), all 17 **fail** with "XMPP server unreachable…"; none is skipped. The helper and test code for both libraries also has **zero NFR-19 violations** (`no-explicit-any`, `no-unsafe-*`, `consistent-type-assertions`) under the root ESLint config (`eslint --no-ignore spike/xmpp-library`).

## 1. Maintenance

| | `stanza` | `@xmpp/client` (xmpp.js) |
| --- | --- | --- |
| Latest release | **12.22.1, 2026-03-28** (7 months ago) | **0.14.0, 2025-10-29** (12 months ago). Master has 12 unreleased commits, the last on 2026-09-03 |
| Releases | 97 versions since 2012. Recent ones: 12.18.0 2022-06 · 12.19.0 2023-09 · 12.19.1, 12.20.0 2024-01 · 12.21.0 2025-03 · 12.21.1 2026-02 · 12.22.0, 12.22.1 2026-03 | 0.13.x from 2021 to 2025, then 0.14.0 2025-10. Still pre-1.0 |
| Cadence | Bursts, with gaps of 15, 13 and 11 months since 2022. Commits per year: 12, 16, 11, 3 and 11 (2022 to 2026) | Steadier: work every month or two in 2025–26 |
| Last commit | 2026-03-28 (the 12.22.1 release) | 2026-09-03 |
| Open PRs / issues | 8 open PRs, the oldest from May 2021. They include #489, "Check SASL mechanism credential requirements", the gap we hit below. GitHub shows 0 open issues; the closed count could not be read through the proxy, so treat that figure with care | 4 open PRs, 32 open issues |
| Bus factor | **1.** Lance Stout is the only npm maintainer and the only merger (1,334 of 1,460 commits). Seven outside contributors since 2023, including IanMayo (#507, merged 2024-10). Merges are quick when he is active (#512 and #513 within a day) | **1.** Sonny Piers is the only npm maintainer (66 of 79 commits since 2024) |
| Types | Bundled, written in TypeScript, built with TS 5.9. Clean under TS 6.0.3 strict with `skipLibCheck: false`. One error in its own `xep0004.d.ts` under `exactOptionalPropertyTypes` (not a repo setting) | None in the package. Community `@types/xmpp__*` 0.14.x (DefinitelyTyped, 2026-01), which pulls in about 20 `@types` packages including koa and express. Clean under TS 6 |
| Licence, deps | MIT. Runtime deps: `ws`, `sdp`, `punycode`, `@types/node`, `@types/ws` | ISC. About 25 `@xmpp/*` packages, plus `ltx`, `events`, `saslmechanisms` |
| Stars, forks | 1.2k, 247 | 2.3k, 383 |

The issue and PR counts come from the public GitHub pages. The proxy blocks GitHub API calls for repositories outside the session, so those counts were read from the rendered pages. History comes from full clones.

## 2. Browser build

Both libraries build for production with Vite 8 and TypeScript 6 strict, and both log in from Chromium (`test/browser.live.test.ts`) with no console errors.

| | `stanza` page | `@xmpp/client` page |
| --- | --- | --- |
| Entry chunk (Vite's figures) | 363.9 kB raw · **98.5 kB gzip** | 48.9 kB raw · **15.6 kB gzip** (including our 330 lines of builders) |
| Shared chunk (`events` polyfill and page helpers) | +7.9 kB · +2.9 kB gzip | same |
| Per page (`scripts/bundle-size.ts`, gzip -9) | 363 kB raw · **97.7 kB gzip** · 78 kB brotli | 55.5 kB raw · **17.8 kB gzip** · 16 kB brotli |
| Node polyfills needed | **`events`**, as a direct dependency. StanzaJS imports `events` in seven modules (core, parser, stream management, Jingle and its browser stream shims) but does not declare it; it bundles its own Buffer, crypto, streams and WebSocket shims. Without `events`, Vite only warns ("externalized for browser compatibility"), and the page dies at load with `Class extends value undefined is not a constructor or null` (reproduced). In the spike `events` was first resolved as a phantom dependency through `@xmpp/client`, which hid the problem | None. `node:dns` in `@xmpp/resolve` is externalized harmlessly; WebSocket is the browser's own |
| SASL in the browser | SCRAM-SHA-256 (pure-JS SHA-256 and PBKDF2), ANONYMOUS | **PLAIN and ANONYMOUS only.** `@xmpp/sasl-scram-sha-1` is excluded from the browser build, and there is no SHA-256 mechanism |
| Tree-shaking | No. `createClient` registers every plugin, including Jingle and WebRTC. Building a slimmer client from `Client` with selected plugins might help, but was not tried | Yes, by package |

There is also a type-level leak. StanzaJS depends on `@types/node`, so any browser package that type-checks code importing `stanza` gets Node's globals. In `tsconfig.browser.json` (`types: []`), `process.env` compiles and `setTimeout` returns `NodeJS.Timeout`. `apps/web` will see this if it compiles `packages/transport-xmpp` from source.

## 3. Typing quality

The question for each area is what the transport code needs. "Typed" means the operation and its result are typed and no cast is needed. The casts column counts casts in our code. The only StanzaJS casts in the whole spike are three `handler as never` casts in a generic `waitFor<K>` test helper, because StrictEventEmitter's overloads cannot be selected from a generic key. Code that names a concrete event needs none. The spike repo's other casts (on `getNodeSubscribers`, `mam:item` listeners and form fields) turned out to be unnecessary.

| Area | StanzaJS 12.22.1 | Casts | `@xmpp/client` 0.14.0 + `@types` |
| --- | --- | --- | --- |
| **XEP-0045 owner and admin** (affiliations, roles, room config forms) | **Typed.** `joinRoom` returns a presence with `muc.affiliation`, `role` and `statusCodes` (110, 321…). `setRoomAffiliation`, `setRoomRole`, `getRoomMembers` (returns `muc.users`), `kick`, `ban`, `getRoomConfig` (returns `DataForm`), `configureRoom`, `destroyRoom`, and `muc:*` events are all typed. Room config is a generic XEP-0004 form (field names are strings; values are a union narrowed by `type`). Raw `Presence.muc` is a `join \| info` union that needs narrowing | 0 | **Missing.** Hand-written (about 70 lines). Results are untyped `Element`s, and `attrs` is `any` in `@types/ltx` |
| **XEP-0060 owner** (create, configure, delete, affiliations, subscriptions, item events) | **Partly typed.** Create, configure, get config, delete, purge, get and update affiliations, update subscriptions, subscribe, unsubscribe, publish, get items, retract, and every event are typed. Gaps: `getNodeSubscribers` and `getAffiliations` return a bare `IQ` (the payload is reachable but optional, so no cast is needed). **`pubsub:retracted` is typed `string[] & PubsubItem[]`**, a contradictory intersection, so the wrapper must re-type it. XEP-0335 item content is `json?: any`. Event item content is the base `PubsubItemContent`, so reading `json` needs an `'json' in content` check | 0 | **Missing.** Hand-written (about 90 lines). Item payloads are strings we serialize and parse ourselves |
| **XEP-0313 with XEP-0059 RSM** | **Typed.** `searchHistory(room, {paging: {max, before}})` resolves to `MAMFin` with `results[]` (`id` = RSM cursor, `item.message.from` = occupant JID, `item.delay.timestamp: Date`), `paging.first`, `last` and `count`, and `complete`. `before: ''` sends `<before/>` for the last page | 0 | **Missing.** Hand-written (about 45 lines). Timestamps are strings |
| **XEP-0133 over XEP-0050 with data forms** | **Partly typed.** There is no execute or complete helper, only `getCommands()`, but `sendIQ` takes a typed `command` payload (`AdHocCommand`: `sid`, `status`, `actions`, `notes`, `form: DataForm`). **Trap:** `sendIQ<T = IQ, R = T>` infers the response type from the request literal, so the reply is typed as an echo, with `command` required and `action: 'execute'`. Always call `sendIQ<IQ>(…)` (`typing-probes.ts`) | 0 | **Missing.** About 30 lines, plus 25 lines of form builders and parsers |
| **XEP-0198 stream management** | **Typed.** `sm.started`, `resumable`, `id`, `sm.cache()` (to persist state across reloads), `stream:management:resumed`, `stanza:acked`, `failed` and `hibernated`, and the config options `allowResumption`, `autoReconnect` and `maxReconnectBackoff`. Live: a dropped socket **resumed the same full JID** in about 3 s. Note that `session:started` fires at bind, before `<enabled/>` arrives | 0 | **Partly typed.** The data fields (`enabled`, `id`) are typed, but the runtime EventEmitter (`resumed`, `ack`, `fail`) is typed as a plain object, so listening needs a cast. Resumption was **not demonstrated**: dropping the socket left the client `online` for more than 4 s, and `disconnect()` sends `</stream>` |
| **SASL ANONYMOUS and SCRAM-SHA-256** | **Typed** config (`jid`, `password`, `credentials`, `sasl.disable()`). Live: SCRAM-SHA-256 in Node and Chromium, and ANONYMOUS. Gap: StanzaJS picks the highest mechanism the server offers without checking that it holds credentials for it (open PR #489), and ranks ANONYMOUS lowest, so an anonymous login must `disable()` the others | 0 | ANONYMOUS works (the choice is credential-aware). **SCRAM-SHA-256 is missing.** SCRAM-SHA-1 exists in Node only. Live: PLAIN over TLS |
| Errors (ARC-14) | Rejections are untyped (`catch (e)` gives `unknown`), but the rejected value is the error IQ and narrows structurally to `error.condition`. It handles ejabberd's `<text/>`-before-condition order correctly | 0 | `@xmpp/error` takes the **first** child of `<error/>` as the condition, so for ejabberd it reports `"text"`. We parse the element ourselves (1 cast) |
| `any` reaching user code | `AgentEvents['stream:data']`, `'*'`, `Message.json`, `JSONItem.json`. None is needed by the transport | | `ltx` `Element.attrs` on every attribute read |

## 4. Live script result (reference ejabberd 26.09, `wss://localhost:25443/ws`)

| Step | StanzaJS | `@xmpp/client` |
| --- | --- | --- |
| Admin login | ✅ SCRAM-SHA-256 | ✅ PLAIN |
| XEP-0133 `add-user`, then test user login | ✅ SCRAM-SHA-256 | ✅ PLAIN |
| XEP-0133 `get-online-users-num` (field `onlineusersnum`) | ✅ | ✅ |
| SASL ANONYMOUS session | ✅ | ✅ |
| XEP-0198 enabled, and resume after a dropped socket | ✅, resumed the same JID | ✅ enabled, with a resumable id; resume not shown |
| Room create, config form, member affiliation, member list, voice off and on | ✅ | ✅ |
| Join returns affiliation `member`, role `participant` and status 110 | ✅ | ✅ |
| 7 posts; live echo carries the room's `stanza-id` | ✅ | ✅ |
| MAM backwards, `max=3`, `<before/>` then `before=<first>`: pages [4–6], [1–3], [0], then `complete`. Chronological, no gaps or duplicates, server timestamps, occupant `from` | ✅ | ✅ |
| Whitelist node create and config, member affiliation, subscribe, owner subscription list, JSON publish, item event, `getItems` | ✅ | ✅ |
| Player `createNode` is refused with `forbidden` | ✅ | ✅ (after fixing the error parser) |
| Production bundle logs in from Chromium | ✅ SCRAM-SHA-256 and ANONYMOUS | ✅ PLAIN |

## 5. Recommendation for WP 1.1 and 1.3

**Why StanzaJS despite bus factor 1.** It is the only candidate that meets NFR-22 (SCRAM-SHA-256) in the browser out of the box. It types five of the six required XEP areas well, which matters under NFR-19. It also does XEP-0198 resumption, the part of a transport that is hardest to write. The fallback's better maintenance does not offset writing and typing MUC, PubSub, MAM, forms, ad-hoc, SCRAM-SHA-256 and resumption ourselves; that is several weeks of work with its own bus factor. StanzaJS is mature and slow-moving rather than abandoned: the protocol it implements is stable, and its 2026 releases fixed real bugs.

**Risks of the choice**

1. **Abandonment (medium likelihood, medium impact).** There is one maintainer, gaps of a year are normal, and PRs have been open since 2021. A browser or bundler change (as with the `global` fix in 12.22.1) could go unfixed for months. Mitigations: the exit plan below, MIT licence, and an exact version pin.
2. **Size (certain, low to medium impact).** About 100 kB gzipped, most of it Jingle and WebRTC code we don't use. That is acceptable for an intranet tool (NFR-7 needs bundling, not a size budget), but it is the biggest single dependency.
3. **Hidden `events` dependency (certain, high impact if missed, cheap to fix).** pnpm's layout or a hoisting change can make it disappear. The build only warns and the app dies at load. Declare it, and make CI's Playwright smoke test catch a load-time crash.
4. **Type traps that compile but mislead:** the echo-typed `sendIQ`, the `retracted` intersection, `json: any`, and Node globals leaking into browser type-checking.
5. **Sync EventEmitter model.** Handlers run synchronously, and the roadmap's async-hooks rewrite would be a breaking major release. Pin 12.x and treat 13 as a migration.

**What the transport wrapper (`packages/transport-xmpp`) must hide**

- All StanzaJS types. No `stanza` type may appear in `packages/transport`'s interface, and `transport-xmpp` should export only the interface implementation. This keeps the `@types/node` leak and the `any`s out of `apps/web`, and makes the library swappable. Consider a lint rule restricting `import 'stanza'` to `packages/transport-xmpp`.
- `sendIQ<IQ>` everywhere, plus one structural `errorCondition(e)`, producing `Result<T, TransportError>` (ARC-14). Never let a rejection escape.
- **Ready state.** `session:started` arrives before stream management is enabled. "Online" should wait for `<enabled/>` (or a short timeout when the server doesn't offer SM), then disco (ARC-2).
- **Reconnect semantics.** Distinguish *resumed* (`stream:management:resumed`: rooms and subscriptions intact, nothing to refetch) from *reconnected with a new session* (rejoin rooms and refetch from MAM, PLY-2). StanzaJS retries with exponential back-off (`maxReconnectBackoff`). Persist SM state with `sm.cache()` if resumption across page reloads is wanted.
- **ANONYMOUS login.** Disable every other mechanism, as `stanza-client.ts` does.
- **Re-type PubSub events.** `retracted` is a list of ids, and item content is a raw JSON string or `unknown` (WP 1.1 "payloads stay raw").
- **MAM.** Use `fin.results`, not `mam:item` listeners. The cursor is `results[].id`, and `<before/>` is `before: ''`.
- **ejabberd specifics (ARC-8 adapter):** `accountjid` vs `accountjids`; `get-online-users-num` returns `onlineusersnum`; `<text/>` comes before the condition in `<error/>`; and the spike's stored-role and subscription rules (R-A to R-F in the spike's `admin-ops.ts`).

**Exit plan if StanzaJS is abandoned or breaks**

1. *Short term:* fork or vendor. It is MIT, pure TypeScript, has three runtime deps, and its source builds with `tsx` and `webpack`. Patch in the fork and keep the exact pin.
2. *Replace:* reimplement `packages/transport-xmpp` over `@xmpp/client` (or over a raw WebSocket plus `ltx`). `src/xmppjs-client.ts` is a working, NFR-19-clean starting point covering every area of the WP 1.1 table except XEP-0198 resume. The contract suite (WP 1.2) is the acceptance test: it is library-agnostic, so the same suite proves the swap. Extra work: a SCRAM-SHA-256 mechanism over WebCrypto (`@xmpp/sasl` awaits `mech.response()`, so an async PBKDF2 fits; about 100 lines), our own error parsing, and resumption testing. Estimate: 2 to 3 weeks.
3. *Trigger:* a blocking bug unfixed for more than 3 months, a browser or bundler incompatibility, or a security issue with no release.

## 6. Changes to the WP briefs

- **WP 1.1:** split the connection status "online after reconnect" into `resumed` (nothing missed) and `reconnected` (refetch from MAM, rejoin), so the domain layer knows when PLY-2 applies. Keep library types out of the interface; this record depends on it.
- **WP 1.3:**
  - add `events` (pinned) to `packages/transport-xmpp`'s dependencies;
  - "ready" waits for SM `<enabled/>`;
  - use `sendIQ<IQ>`;
  - add the ejabberd error-order and `onlineusersnum` quirks to the adapter list;
  - in Node, the contract suite trusts the internal CA through `NODE_EXTRA_CA_CERTS` (NFR-2), and the Playwright smoke test pins the server key rather than ignoring certificate errors;
  - a Playwright check that the production bundle loads with no `pageerror` (this catches a dropped `events`).
- **Root ESLint config (WP 0.5 scaffold, or whichever WP next owns it):** consider restricting `import 'stanza'` to `packages/transport-xmpp` with a lint rule.
- **NFR-22 hardening (server, optional):** ejabberd also offers PLAIN. Disabling it (`disable_sasl_mechanisms: [plain]`) enforces SCRAM-SHA-256, but would lock out the `@xmpp/client` fallback until it gains a SCRAM-SHA-256 mechanism.
