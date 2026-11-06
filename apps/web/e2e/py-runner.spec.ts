// The Python runner against the app's build (WP 6.2; SRD Annex C PD4, PD9, PY-4, PY-5, PY-10,
// PR3; NFR-7). Served by e2e/py-runner/serve.ts under the app's policy as a header (as the
// reference deployment sends it) and as a `<meta>` tag only (as a static host does): S17's
// sandbox probes, the offline check, a round trip on the mock and Stop and the time limit.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type Delivery = 'header' | 'meta' | 'none'
type Role = 'admin' | 'white-force'

/** A request that left the origin; a blob: URL of the origin is its own. */
function foreign(origin: string) {
  return (url: string) => !url.startsWith(origin) && !url.startsWith(`blob:${origin}/`)
}

function origin(page: Page): string {
  return new URL(page.url()).origin
}

/** Opens the test page under a policy and waits for the mock game. Collects every request. */
async function open(page: Page, delivery: Delivery) {
  const requests: string[] = []
  const violations: string[] = []
  page.context().on('request', (r) => requests.push(r.url()))
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto(`./p/${delivery}/__harness/index.html`)
  await page.waitForFunction(() => 'pyHarness' in window)
  await page.evaluate(() => window.pyHarness.ready())
  return { requests, violations }
}

async function hits(page: Page, clear = false) {
  const response = await page.request.get(`/__hits${clear ? '?clear' : ''}`)
  return (await response.json()) as {
    hits: { origin: 'main' | 'canary'; path: string }[]
    reports: unknown[]
  }
}

function run(page: Page, role: Role, code: string, timeoutMs?: number) {
  return page.evaluate(([r, c, t]) => window.pyHarness.run(r, c, t), [
    role,
    code,
    timeoutMs,
  ] as const)
}

/** The last line a script printed, as JSON. */
function lastJson(output: string): Record<string, string> {
  return JSON.parse(output.trim().split('\n').pop() ?? '{}') as Record<string, string>
}

test.describe.configure({ mode: 'serial' })
// Pyodide starts in about 2 s; each probe run starts its own worker.
test.setTimeout(120_000)

test('the app page loads the runner lazily under its own <meta> policy and runs Python (PY-5, PR3)', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { wrxCspViolations: seen })
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  // The real app page, as a static host serves it: the build's <meta> policy, no header.
  await page.goto('./p/meta/index.html')
  await expect(page.getByRole('heading', { name: 'Exercise Northern Gate' })).toBeVisible()
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';")
  expect(csp).toContain("worker-src 'self' blob:;")
  expect(csp).not.toMatch(/(^|\s)'unsafe-eval'/)
  // Nothing of the runner loads with the app (PY-5).
  expect(requests.filter((u) => u.includes('/py/'))).toEqual([])

  const result = await page.evaluate(async () => {
    const { createRunner } = (await import(
      new URL('py/runner.js', document.baseURI).href
    )) as typeof import('@wrx/py-runner')
    const nothing = () => () => undefined
    const store = {
      me: () => ({
        data: { identity: { anonymous: false, isAdmin: true }, isUmpire: true, rooms: [] },
      }),
      worldState: () => ({ data: undefined }),
      roomView: () => ({ data: undefined }),
      acquireRoom: nothing,
      subscribe: nothing,
    } as unknown as Parameters<typeof createRunner>[0]['store']
    const runner = createRunner({ role: 'admin', store, draft: { apply: () => undefined } })
    const outcome = await runner.run(
      'import sys, wrx\nprint(sys.version_info[:2], wrx.context()["role"])',
    )
    runner.dispose()
    return outcome
  })
  expect(result.status, result.error).toBe('finished')
  expect(result.output.trim()).toBe('(3, 14) admin')
  expect(requests.filter(foreign(origin(page)))).toEqual([])
  const violations = await page.evaluate(
    () => (window as unknown as { wrxCspViolations: string[] }).wrxCspViolations,
  )
  expect(violations).toEqual([])
})

for (const delivery of ['header', 'meta'] as const) {
  test(`offline: Pyodide, numpy, pandas and pydantic come from the build only (${delivery}; NFR-7, PY-5)`, async ({
    page,
  }) => {
    const { requests, violations } = await open(page, delivery)
    await hits(page, true)
    const ready = await page.evaluate(() => window.pyHarness.start('admin'))
    expect(ready.totalMs).toBeGreaterThan(0)
    const out = await run(
      page,
      'admin',
      [
        'import numpy as np, pandas as pd, pydantic, wrx',
        'state = await wrx.world_state()',
        'df = pd.DataFrame(list(state["assets"].values()))',
        'print(int(np.arange(10).sum()), len(df), pydantic.VERSION)',
      ].join('\n'),
    )
    expect(out.status, out.error).toBe('finished')
    expect(out.output.trim()).toMatch(/^45 6 2\.\d+\.\d+$/)
    expect(requests.filter(foreign(origin(page)))).toEqual([])
    const pyodide = new Set(
      requests.filter((u) => u.includes('/py/pyodide/')).map((u) => u.split('/py/pyodide/')[1]),
    )
    for (const file of ['pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
      expect(pyodide).toContain(file)
    }
    expect([...pyodide].some((f) => f?.startsWith('micropip'))).toBe(false)
    const after = await hits(page)
    expect(after.hits.filter((h) => h.origin === 'canary')).toEqual([])
    expect(after.reports).toEqual([])
    expect(violations).toEqual([])
  })
}

const PROBES = readFileSync(join(import.meta.dirname, 'py-runner', 'probes.py'), 'utf8')

async function probe(page: Page, delivery: Delivery) {
  const { requests } = await open(page, delivery)
  await page.evaluate(() => window.pyHarness.start('admin'))
  await hits(page, true)
  const base = origin(page)
  const canary = `http://localhost:${Number(new URL(base).port) + 1}/`
  const code = `CANARY = ${JSON.stringify(canary)}\nSAME = ${JSON.stringify(`${base}/outside-pyodide`)}\n${PROBES}`
  const out = await run(page, 'admin', code, 90_000)
  expect(out.status, out.error).toBe('finished')
  const after = await hits(page)
  const probes = lastJson(out.output)
  // Kept with the test's output (test-results/), as S17 kept results/isolation.json.
  writeFileSync(test.info().outputPath(`probes-${delivery}.json`), JSON.stringify(probes, null, 2))
  return {
    probes,
    canaryHits: after.hits.filter((h) => h.origin === 'canary').map((h) => h.path),
    sameOriginOutside: after.hits.filter((h) => h.origin === 'main').map((h) => h.path),
    foreignRequests: requests.filter(foreign(base)),
    rejected: await page.evaluate(() => window.pyHarness.rejected()),
    draft: await page.evaluate(() => window.pyHarness.draft()),
  }
}

/** Every probe that must be refused once the worker is locked down under the policy (PY-4). */
const MUST_BE_BLOCKED = [
  'js.self',
  'js.fetch',
  'js.XMLHttpRequest',
  'js.WebSocket',
  'js.indexedDB',
  'js.caches',
  'js.importScripts',
  'js.postMessage',
  'js.BroadcastChannel',
  'js.location',
  'pyodide_js.loadPackage(micropip)',
  'import micropip',
  'pyodide.http.pyfetch(canary)',
  'pyodide.http.pyfetch(same origin)',
  'pyodide.http.open_url(canary)',
  'run_js(globalThis) (eval)',
  'Function constructor',
  'import() from run_js (canary)',
  'global.fetch(canary)',
  'global.indexedDB.open',
  'global.postMessage(forged done)',
  'global.navigator.storage',
  'global.importScripts',
  'global.BroadcastChannel',
  'global.caches.keys',
  'global.WebSocket',
  'import() via Function constructor (canary)',
  'Emscripten IDBFS.indexedDB()',
]

for (const delivery of ['header', 'meta'] as const) {
  test(`the sandbox: a script reaches no network, storage or other context (${delivery}; PY-4)`, async ({
    page,
  }) => {
    const result = await probe(page, delivery)
    for (const name of MUST_BE_BLOCKED) {
      expect(result.probes[name], name).toMatch(/^blocked/)
    }
    expect(result.probes['object graph walk']).toContain("'found': []")
    // loadPackage(url) resolves even when its fetch is refused, so its proof is the canary.
    expect(result.canaryHits).toEqual([])
    expect(result.sameOriginOutside).toEqual([])
    expect(result.foreignRequests).toEqual([])
    expect(result.rejected).toBe(0)
    expect(result.draft).toBeUndefined()
  })
}

test('the control: with no policy at all, new Function reaches another origin (why the policy matters)', async ({
  page,
}) => {
  // The lockdown alone cannot remove eval or import(): only the worker's policy does (S17).
  // This shows the probes find that way out when nothing closes it.
  const result = await probe(page, 'none')
  expect(result.probes['Function constructor']).toMatch(/^reached/)
  expect(result.canaryHits).toContain('/fn-import.js')
  // The lockdown still holds for the globals.
  expect(result.probes['js.fetch']).toMatch(/^blocked/)
  expect(result.probes['global.indexedDB.open']).toMatch(/^blocked/)
})

const MOVE = `
import wrx
state = await wrx.world_state()
asset = sorted(state["assets"].values(), key=lambda a: a["title"])[0]
asset["lat"] = round(asset["lat"] + 0.01, 6)
asset["lon"] = round(asset["lon"] - 0.02, 6)
await wrx.write_draft(state)
print("moved", asset["title"])
`

test('round trip on the mock: a script reads the world state and fills the draft (PD7, PD9)', async ({
  page,
}) => {
  await open(page, 'header')
  const ids = await page.evaluate(() => window.pyHarness.ids)

  const read = await run(
    page,
    'admin',
    `import wrx\nm = await wrx.room_messages(${JSON.stringify(ids.blueHq)})\nprint(len(m), m[0]["sender"], m[0]["body"]["content"]["text"])`,
  )
  expect(read.status, read.error).toBe('finished')
  expect(read.output).toContain('blue-co Morning all.')
  expect(await page.evaluate(() => window.pyHarness.draft())).toBeUndefined()

  const moved = await run(page, 'admin', MOVE)
  expect(moved.status, moved.error).toBe('finished')
  expect(moved.applied).toBeDefined()
  const [draft, published] = await page.evaluate(async () => [
    window.pyHarness.draft(),
    await window.pyHarness.published(),
  ])
  const title = moved.output.replace('moved', '').trim()
  const before = Object.values(published?.assets ?? {}).find((a) => a.title === title)
  const after = Object.values(draft?.assets ?? {}).find((a) => a.title === title)
  expect(after?.lat).toBeCloseTo((before?.lat ?? 0) + 0.01, 5)
  expect(after?.lon).toBeCloseTo((before?.lon ?? 0) - 0.02, 5)
  expect(await page.evaluate(() => window.pyHarness.applied())).toBe(1)
})

test('the bridge keeps each role to its operations and validates what it gets (PD4, PY-4)', async ({
  page,
}) => {
  await open(page, 'header')
  const ids = await page.evaluate(() => window.pyHarness.ids)
  const probes = (role: Role) =>
    run(
      page,
      role,
      `import wrx, json
from _wrx_bridge import call
out = {}
state = await wrx.world_state()
# 3,000 assets: under the 5,000-asset limit, over the 500 KB cap (PLY-53).
template = next(iter(state["assets"].values()))
big = {"turn": state["turn"], "assets": {}}
for i in range(3000):
    asset_id = f"30000000-0000-4000-8000-{i:012x}"
    big["assets"][asset_id] = dict(template, id=asset_id)
for name, coro in [
    ("write the draft", wrx.write_draft(state)),
    ("unknown op", wrx._op("publishWorldState", {})),
    ("read Blue HQ", wrx.room_messages(${JSON.stringify(ids.blueHq)})),
    ("a room not the role's", wrx.room_messages("30000000-0000-4000-8000-0000000000ff")),
    ("invalid state", wrx.write_draft({"turn": 0, "assets": {"a": {"lat": 200}}})),
    ("over 500 KB", wrx.write_draft(big)),
    ("not JSON", call("readWorldState", "{")),
    ("wrong shape", call("readRoomMessages", json.dumps({"roomId": 3, "x": 1}))),
]:
    try:
        r = await coro
        if isinstance(r, str):  # a raw call: the reply's JSON
            reply = json.loads(r)
            out[name] = "allowed" if reply["ok"] else "refused: " + reply["error"]
        else:
            out[name] = "allowed"
    except wrx.BridgeError as e:
        out[name] = "refused: " + str(e)
    except Exception as e:
        out[name] = "error: " + str(e)
print(json.dumps(out))`,
    )
  const white = await probes('white-force')
  expect(white.status, white.error).toBe('finished')
  const w = lastJson(white.output)
  expect(w['write the draft']).toMatch(/^refused: writeDraft is not open to the white-force role/)
  expect(w['unknown op']).toMatch(/^refused: no operation publishWorldState/)
  expect(w['read Blue HQ']).toBe('allowed') // the White Force reads every room
  expect(w["a room not the role's"]).toMatch(/^refused: not a room of this role/)
  expect(w['not JSON']).toMatch(/^refused: the payload is not JSON/)
  expect(w['wrong shape']).toMatch(/^refused: readRoomMessages: the request has the wrong shape/)

  const admin = await probes('admin')
  expect(admin.status, admin.error).toBe('finished')
  const a = lastJson(admin.output)
  expect(a['write the draft']).toBe('allowed')
  expect(a['invalid state']).toMatch(/^refused: invalid world state/)
  expect(a['over 500 KB']).toMatch(
    /^refused: the world state is \d+ bytes, over the 500000-byte cap/,
  )
  // The run finished, so its last valid write is the draft (PD9).
  expect(await page.evaluate(() => window.pyHarness.applied())).toBe(1)

  // Only the admin and White Force run scripts (PD4), each as its own role.
  expect(await page.evaluate(() => window.pyHarness.refused('player', 'white-force'))).toMatch(
    /only the admin and White Force roles run scripts/,
  )
  expect(await page.evaluate(() => window.pyHarness.refused('white-force', 'admin'))).toMatch(
    /is the white-force role, not admin/,
  )
  expect(await page.evaluate(() => window.pyHarness.refused('admin', 'admin'))).toBeUndefined()
})

test('Stop, the time limit and a failure leave the draft unchanged (PD9, PY-10)', async ({
  page,
}) => {
  await open(page, 'header')
  const draft = () => page.evaluate(() => window.pyHarness.draft())
  expect(await draft()).toBeUndefined()

  // The time limit, while the script awaits.
  const asleep = await run(
    page,
    'admin',
    `${MOVE}\nimport asyncio\nwhile True:\n    await asyncio.sleep(0.01)`,
    3000,
  )
  expect(asleep.status).toBe('timed-out')
  expect(asleep.output).toContain('moved')
  expect(await draft()).toBeUndefined()

  // Stop, mid-run, in a busy loop that never yields to the worker's event loop. The next run
  // starts a new worker by itself.
  const busy = page.evaluate(
    (code) => window.pyHarness.run('admin', code, 60_000),
    `${MOVE}\nwhile True:\n    pass`,
  )
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.pyHarness.calls())).some((c) => c.op === 'writeDraft'),
    )
    .toBe(true)
  await page.evaluate(() => window.pyHarness.stop())
  const stopped = await busy
  expect(stopped.status).toBe('stopped')
  expect(await draft()).toBeUndefined()

  // A failure after the write.
  const failed = await run(page, 'admin', `${MOVE}\nraise RuntimeError("late failure")`)
  expect(failed.status).toBe('failed')
  expect(failed.error).toContain('late failure')
  expect(await draft()).toBeUndefined()

  // And the same script, finishing, applies its write.
  const ok = await run(page, 'admin', MOVE)
  expect(ok.status, ok.error).toBe('finished')
  expect(await draft()).toBeDefined()
  expect(await page.evaluate(() => window.pyHarness.applied())).toBe(1)
})
