# Phase 3 performance (WP 3.2: NFR-11, NFR-12)

Measured on 1 November 2026 against the mock-only build (`pnpm build`, `vite preview`), in
headless Chromium 153 from Playwright 1.63. The tests are `apps/web/e2e/perf.spec.ts`. They print
each number and attach it to the Playwright report, so every CI run records its own.

## The fixture

`scaleState()` in `packages/mock-server/src/scale.ts` is a generated game: 50 roles in four
player forces and the White Force (ten White, two of them observers), 30 rooms (a plenary room
where every player force writes, a HQ per force, and rooms between forces or between three named
roles), and 10,000 messages in the plenary. Message text varies in length, and about 15% of
messages wrap over several lines. Each other room has five messages. The fixture is the same on
every run. The demo seed is unchanged: the tests import the fixture into the page's mock with
`importDatabase` (PLY-34), and store the same design as the admin's draft
(`apps/web/e2e/scale.ts`).

## How it is measured

- **Time to a frame.** The click and the wait both run in the page. The clock starts with
  `performance.now()` just before `click()`. It stops one animation frame after the first frame
  in which the result is in the DOM and visible, so the result has been painted. Playwright's round
  trips are not counted. Each span is also left as a `performance.measure` named `wrx:<name>`, so
  it shows in a trace.
- **Room tab render.** The umpire logs in and sees 30 room tabs. Another tab is put on show in
  the plenary's tabset, and the page is reloaded. The layout is restored with the plenary
  unrendered, because FlexLayout renders a tab the first time it is shown. The test then clicks
  the plenary tab. It stops when the newest message, `#10000`, is painted. This is the cold
  render: a 10,000-message room's panel mounts and lays out its first page of history. The
  store loaded that page (50 messages, PLY-49) when it joined the room at login. The warm number
  is the same click after going away and back, with the panel still mounted.
- **Scrolling.** The script moves `scrollTop` by a fixed step each animation frame for 600
  frames, and records the interval between frames. Scrolling up at 60 px a frame pages older
  history in as it goes (pages of 50). Scrolling down at 120 px a frame runs with all 10,000
  messages loaded. Chromium's Long Animation Frames API attributes script time inside long
  frames (scripts over 5 ms).
- **Input to paint.** The Event Timing API reports `keydown`, `keypress`, `input` and `keyup` as
  Playwright types at 25–30 ms a key. It reports events of 16 ms or more (its smallest
  threshold), so at 60 Hz nearly every event is reported: input waits for the next frame.
- **Delivery (NFR-12).** The multi-client view has four panes: Blue CO, Red CO, the umpire and
  the White observer. Each pane shows the Blue–Red negotiation. The clock starts at the click on
  Blue's Send and stops at the frame that shows the message in all four panes. There are ten
  messages.

## Results

The numbers are from seven runs of the room test and three of the others. The machine was a
4-vCPU container shared with other build agents, so the spread comes from the machine and not
from the app. This is not the "standard 8 GB laptop" of NFR-12. A laptop's Chromium has a GPU,
and a busy container is a harder case.

| Measure | Target | Measured | CI fails above |
| --- | --- | --- | --- |
| Room tab, cold render, 10,000-message room | < 1 s | 205–496 ms | 3 s |
| Room tab, switch back (mounted) | < 1 s | 129–174 ms | 3 s |
| Rows in the DOM (first page / 10,000 loaded) | virtualised | 18–19 / 19–22 | 100 |
| Typing in the 10,000-message room, longest input-to-paint | < 100 ms | 32–64 ms | 300 ms |
| Scroll up with paging, p50 / p95 frame | smooth | 16.7 / 16.8–33.4 ms | p95 150 ms |
| Scroll up with paging, longest frame; frames over 50 ms (of 600) | — | 33–366 ms; 0–14 | — |
| Scroll down, 10,000 loaded, p50 / p95 frame | smooth | 16.7 / 16.7–33.4 ms | p95 150 ms |
| Scroll down, 10,000 loaded, longest frame; frames over 50 ms (of 600) | — | 50–467 ms; 0–12 | — |
| Longest script in a long frame, while scrolling | — | under 5 ms (none attributed) | — |
| Paging in all 10,000 (200 pages of 50), informational | — | 4.5–9.3 s | — |
| Umpire login to 30 room tabs, informational | — | 0.4–1.5 s | — |
| Access matrix, 30 rooms × 50 roles, opens | < 1 s | 58–71 ms | 3 s |
| Admin editor typing at that size, longest input-to-paint | < 100 ms | 32–48 ms | 300 ms |
| Publish plan against the server (41 changes) | usable | 323–443 ms | 30 s |
| Publishing those 41 changes, informational | — | 0.3–1.0 s | — |
| **NFR-12** delivery to 4 panes, median of 10 | < 1 s | 41–51 ms | — |
| **NFR-12** delivery to 4 panes, slowest of 10 | < 1 s | 84–120 ms | 3 s |
| **NFR-12** typing with four live panes, longest input-to-paint | < 100 ms | 40–80 ms | 300 ms |

Every target is met, most by a wide margin. The SRD sets no number for "no visible typing lag".
The target used here, 100 ms from key to paint, is the usual threshold for a response that feels
instant, and half of what Core Web Vitals counts as a good interaction (200 ms).

**Long frames while scrolling.** Most runs have a few frames over 50 ms, and the worst single
frame was 467 ms. No script of 5 ms or more ran in any of them (the Long Animation Frames
attribution), and the p50 and p95 stay at one or two frames. These frames are the machine:
garbage collection, other agents' builds, the software compositor. They are not the list's
work. The list keeps 18–22 rows in the DOM whether 50 or 10,000 messages are loaded. A real
regression, such as a lost virtualisation or a render that grows with the room, moves the p95,
and the guard checks the p95.

## The CI guard

The same tests run in the `build-e2e` job, in Chromium, as part of `pnpm e2e`. They take about
45 s. A measurement fails only above three times its target (`MARGIN` in `apps/web/e2e/perf.ts`),
plus the absolute bounds in the table. That is generous enough for a shared runner, and still
catches a regression of several times. The longest single frame is recorded but not asserted,
because it is the noisiest number. The tests skip in Firefox and WebKit: the timing APIs (Event
Timing, Long Animation Frames) and the recorded numbers are Chromium's.

## Gaps

- **Mock only.** These numbers come from the in-browser mock, where a MAM page is a
  `postMessage` to the SharedWorker. Against ejabberd each history page and each message is a
  network round trip. Delivery adds that latency, and paging in a long history is slower in
  proportion. Nothing was measured against the reference ejabberd at this scale. The fixture
  works with any server state, so a contract-job variant could load it there.
- **One browser, one machine.** Chromium in a container. No Firefox or Safari numbers, and no
  laptop.
- **Paging all 10,000 messages takes 4.5–9 s.** It is 200 round trips of 50 messages, and the
  scroll has to reach the top each time. A reader is unlikely to scroll back through 10,000
  messages, and each page lands within a frame or two, but a "jump to the start" would need a
  larger page or a server-side search. That is outside v1.
- **The 30-tab login.** The umpire's login joins 30 rooms and fetches each one's first page. It
  took 0.4–1.5 s here. There is no target for it.
