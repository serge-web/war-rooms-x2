// The Python runner's performance (WP 6.5; SRD Annex C PR4, PY-3, PY-5; NFR-7), against the
// app's build on the mock, in the runner's test page (e2e/py-runner/harness): the worker's cold
// and warm start, the first run that imports the SDK (pydantic), the first pandas run, a script
// over 600 assets that reads the world state, changes every asset and writes the draft, event
// and send throughput, many calls at once, and the interpreter's memory. Each test prints its
// numbers and attaches them; plan/reviews/phase-6-performance.md records a run. The budgets are
// loose (a loaded CI machine), set to catch a regression of several times, not to grade.
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const MB = 1024 * 1024

async function open(page: Page): Promise<void> {
  await page.goto('./p/header/__harness/index.html')
  await page.waitForFunction(() => 'pyHarness' in window)
  await page.evaluate(() => window.pyHarness.ready())
}

function run(page: Page, role: 'admin' | 'white-force', code: string, timeoutMs = 120_000) {
  return page.evaluate(([r, c, t]) => window.pyHarness.run(r, c, t), [
    role,
    code,
    timeoutMs,
  ] as const)
}

/** The last line a script printed, as JSON. */
function lastJson(output: string): Record<string, number> {
  return JSON.parse(output.trim().split('\n').pop() ?? '{}') as Record<string, number>
}

async function report(testInfo: TestInfo, name: string, values: Record<string, number>) {
  const rounded = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, Math.round(v * 10) / 10]),
  )
  console.log(`${name}: ${JSON.stringify(rounded)}`)
  await testInfo.attach(name, {
    body: JSON.stringify(rounded, null, 2),
    contentType: 'application/json',
  })
}

test('start-up: the worker cold and warm, the first SDK run (pydantic), the first pandas run (PR4, PY-3)', async ({
  page,
}, testInfo) => {
  await open(page)
  // Cold: a fresh page's first worker, Pyodide fetched from the build (an HTTP cache that is
  // empty for this context).
  const cold = await page.evaluate(() => window.pyHarness.start('admin'))
  // The first run naming the SDK loads pydantic; the second loads nothing.
  const first = await run(page, 'admin', 'import wrx\nprint(wrx.__version__)')
  expect(first.status, first.error).toBe('finished')
  const second = await run(page, 'admin', 'import wrx\nprint(wrx.__version__)')
  expect(second.status, second.error).toBe('finished')
  // The first pandas run: the assets as a DataFrame.
  const pandas = await run(
    page,
    'admin',
    [
      'import json, wrx',
      'state = await wrx.Game().world_state()',
      'frame = wrx.to_frame(state)',
      'print(json.dumps({"rows": len(frame)}))',
    ].join('\n'),
  )
  expect(pandas.status, pandas.error).toBe('finished')
  expect(lastJson(pandas.output).rows).toBe(6)
  // Warm: Stop ends the worker; a new one starts from the browser's cache.
  await page.evaluate(() => window.pyHarness.stop())
  const warm = await page.evaluate(() => window.pyHarness.start('admin'))
  const warmFirst = await run(page, 'admin', 'import wrx\nprint(wrx.__version__)')
  expect(warmFirst.status, warmFirst.error).toBe('finished')
  await report(testInfo, 'start-up', {
    coldReadyMs: cold.totalMs,
    coldLoadPyodideMs: cold.timings.loadPyodide,
    coldWasmMemoryMB: cold.timings.wasmMemory / MB,
    firstSdkRunMs: first.ms,
    firstSdkImportsMs: first.importsMs ?? 0,
    secondSdkRunMs: second.ms,
    secondSdkImportsMs: second.importsMs ?? 0,
    firstPandasRunMs: pandas.ms,
    firstPandasImportsMs: pandas.importsMs ?? 0,
    afterPandasWasmMemoryMB: (pandas.wasmMemory ?? 0) / MB,
    warmReadyMs: warm.totalMs,
    warmFirstSdkRunMs: warmFirst.ms,
  })
  expect(cold.totalMs).toBeLessThan(30_000)
  expect(warm.totalMs).toBeLessThan(30_000)
  expect(second.importsMs ?? 0).toBeLessThan(first.importsMs ?? 0)
})

const SCALE = 600

test('a script over 600 assets reads the world state, changes every asset and writes the draft (PR4, NFR-11)', async ({
  page,
}, testInfo) => {
  await open(page)
  const chars = await page.evaluate((n) => window.pyHarness.publishScale(n), SCALE)
  await page.evaluate(() => window.pyHarness.start('admin'))
  // Warm the SDK and pandas, so the run below measures the script, not their first load.
  await run(
    page,
    'admin',
    'import wrx\nimport pandas\nwrx.to_frame(await wrx.Game().world_state())',
  )
  const outcome = await run(
    page,
    'admin',
    [
      'import json, time, wrx',
      't0 = time.perf_counter()',
      'game = wrx.Game()',
      'state = await game.world_state()',
      't1 = time.perf_counter()',
      'for asset in state.assets.values():',
      '    asset.health = max(0, asset.health - 5)',
      '    asset.lat = round(asset.lat + 0.001, 6)',
      't2 = time.perf_counter()',
      'frame = wrx.to_frame(state)',
      't3 = time.perf_counter()',
      'await game.write_draft(state)',
      't4 = time.perf_counter()',
      'ms = lambda a, b: (b - a) * 1000',
      'print(json.dumps({"assets": len(state.assets), "readMs": ms(t0, t1), "changeMs": ms(t1, t2),',
      '    "frameMs": ms(t2, t3), "writeMs": ms(t3, t4), "scriptMs": ms(t0, t4)}))',
    ].join('\n'),
  )
  expect(outcome.status, outcome.error).toBe('finished')
  const numbers = lastJson(outcome.output)
  expect(numbers.assets).toBe(SCALE)
  const draft = await page.evaluate(() => window.pyHarness.draft())
  expect(Object.keys(draft?.assets ?? {})).toHaveLength(SCALE)
  await report(testInfo, `${SCALE} assets`, {
    stateChars: chars,
    ...numbers,
    runMs: outcome.ms,
    importsMs: outcome.importsMs ?? 0,
    wasmMemoryMB: (outcome.wasmMemory ?? 0) / MB,
  })
  expect(outcome.ms).toBeLessThan(30_000)
})

const EVENTS = 200
const BLUE_HQ = '30000000-0000-4000-8000-000000000001'

test('event and send throughput, and many calls at once (PY-2)', async ({ page }, testInfo) => {
  await open(page)
  await page.evaluate(() => window.pyHarness.start('white-force'))
  await run(page, 'white-force', 'import wrx')
  // A handler for every message a player posts in Blue HQ, until it has seen them all.
  const listening = page.evaluate(([code]) => window.pyHarness.run('white-force', code, 120_000), [
    [
      'import json, time, wrx',
      'game = wrx.Game()',
      `N = ${EVENTS}`,
      'seen, at = [], {}',
      `@game.on_message("${BLUE_HQ}")`,
      'async def got(message):',
      '    if not seen:',
      '        at["first"] = time.perf_counter()',
      '    seen.append(message.body.content.text)',
      '    if len(seen) >= N:',
      '        at["last"] = time.perf_counter()',
      '        game.stop()',
      'await game.run_forever(seconds=100)',
      'print(json.dumps({"received": len(seen), "spanMs": (at["last"] - at["first"]) * 1000,',
      '    "dropped": __import__("_wrx_bridge").dropped_events()}))',
    ].join('\n'),
  ] as const)
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.pyHarness.calls('white-force'))).some(
        (c) => c.op === 'subscribeMessages' && c.ok,
      ),
    )
    .toBe(true)
  const postMs = await page.evaluate((n) => window.pyHarness.playerPosts(n, 'event'), EVENTS)
  const heard = await listening
  expect(heard.status, heard.error).toBe('finished')
  const events = lastJson(heard.output)
  expect(events.received).toBe(EVENTS)

  // Sends, one after another, as the White Force.
  const sends = await run(
    page,
    'white-force',
    [
      'import json, time, wrx',
      'game = wrx.Game()',
      't0 = time.perf_counter()',
      'for i in range(100):',
      `    await game.send_message("${BLUE_HQ}", f"umpire note {i}")`,
      'print(json.dumps({"sends": 100, "ms": (time.perf_counter() - t0) * 1000}))',
    ].join('\n'),
  )
  expect(sends.status, sends.error).toBe('finished')

  // 1,000 reads at once: the bridge takes them all; nothing bounds a run's calls in flight
  // (recorded by the Phase 6 security review).
  const burst = await run(
    page,
    'white-force',
    [
      'import asyncio, json, time, wrx',
      'game = wrx.Game()',
      't0 = time.perf_counter()',
      'turns = await asyncio.gather(*(game.turn() for _ in range(1000)))',
      'print(json.dumps({"calls": len(turns), "ms": (time.perf_counter() - t0) * 1000}))',
    ].join('\n'),
  )
  expect(burst.status, burst.error).toBe('finished')
  await report(testInfo, 'throughput', {
    events: events.received ?? 0,
    playerPostMs: postMs,
    handlerSpanMs: events.spanMs ?? 0,
    eventsPerSecond: (EVENTS / Math.max(1, events.spanMs ?? 1)) * 1000,
    dropped: events.dropped ?? 0,
    sends: lastJson(sends.output).sends ?? 0,
    sendMs: lastJson(sends.output).ms ?? 0,
    burstCalls: lastJson(burst.output).calls ?? 0,
    burstMs: lastJson(burst.output).ms ?? 0,
    wasmMemoryMB: (burst.wasmMemory ?? 0) / MB,
  })
})
