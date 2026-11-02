# Phase 4 performance (WP 4.4: NFR-11 with templated messages)

Measured on 2 November 2026 against the mock-only build (`pnpm build`, `vite preview`), in headless Chromium from Playwright 1.63, on the same kind of machine as the Phase 3 numbers (`phase-3-performance.md`, which explains how each number is taken). The browser test is `apps/web/e2e/perf.spec.ts`, "NFR-11: a room of 2,000 templated messages…"; the per-message check is `packages/mock-server/src/scale.test.ts`, "checks a templated message in well under a millisecond". Both print their numbers, so every CI run records its own.

## The fixture

`scaleState({ messages: 2_000, templated: true })`: the Phase 3 scale game (50 roles, 30 rooms) with the demo's three templates (`scaleTemplates`, every field type of the profile: force and role pickers, text with and without a pattern, slider, integer, yes/no, date, date and time, drop-down, linked drop-downs). The plenary offers all three to every player force beside free text, and all 2,000 of its messages are templated, a third of each template, each valid for its template and permitted to its sender. Values are generated from a fixed seed, so the fixture is the same on every run. The test asserts that every message renders as a card and none carries a warning.

## Results

| Measure | Templated room (2,000) | Chat room (10,000), same run | Target |
| --- | --- | --- | --- |
| Room tab, cold render | 109 ms | 201 ms | 1 s (NFR-11) |
| Room tab, switch back | 96 ms | 136 ms | 1 s |
| Rows in the DOM | 11 | 18 | virtualised |
| Typing, longest input-to-paint | 32 ms | 32 ms | 100 ms |
| Scroll up with paging, p95 frame | 16.7 ms | 16.8 ms | smooth (50 ms guard) |
| Scroll up, frames over 50 ms | 0 | 0 | |
| Page in the whole history (informational) | 1.6 s | 3.9 s | |
| Scroll down, everything loaded, p95 frame | 16.7 ms | 16.8 ms | smooth |
| Rows in the DOM, everything loaded | 18 | 19 | virtualised |

The templated room meets every NFR-11 budget with the same margin as plain chat. Cards are taller than most chat rows, so fewer rows are in the DOM.

## The receiver's check per message (TPL-6)

`checkTemplatedMessage` on the fixture's 2,000 messages, with one validator for the session as the store holds it (`SessionStore.templateValidator`, its per-schema cache warm): **22 µs per message** in Node 22 (median of five runs), so 2,000 messages cost about 44 ms of checking in all. The first message of each template, with a new validator, costs about 0.2 ms more while its schema is prepared. The guard fails at 1 ms per message.

The store caches each message's result against the template, the room's config and the force, role and retired documents (`checkTemplate`), so a message is checked again only when one of those changes, not on every render.

## Weak points

- **Paging in is slower per message than for chat:** 1.6 s for 2,000 templated messages against 3.9 s for 10,000 chat messages, about twice the cost per message. It is informational (a player pages history in 50 at a time as they scroll), but `toChatMessage` maps every loaded entry to its card view whenever the entries change, and the card's view is not cached like the check is. At 10,000 templated messages a new message would cost a few tens of milliseconds of mapping; not measured, and no budget is at risk at the sizes NFR-11 names.
- **One machine, Chromium only.** As in Phase 3; Firefox and WebKit are not measured.
