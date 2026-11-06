// Spike S17 (SRD Annex C): Pyodide in a Web Worker, served only from the build, under the
// client's Content-Security-Policy, with a minimal bridge. Each test measures and asserts one
// question, and writes what it measured to results/ (plan/decisions/S17.md reads them).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

const port = Number(process.env.S17_PORT ?? 5027)
const ORIGIN = `http://localhost:${port}`
const CANARY = `http://localhost:${port + 1}/`
const results = join(import.meta.dirname, '..', 'results')
const SAMPLES = Number(process.env.S17_SAMPLES ?? 5)

function record(name: string, data: unknown): void {
  mkdirSync(results, { recursive: true })
  writeFileSync(join(results, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`)
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}
const round = (n: number) => Math.round(n)
/** A request that left the origin; a blob: URL of the origin is its own. */
const foreign = (url: string) => !url.startsWith(ORIGIN) && !url.startsWith(`blob:${ORIGIN}/`)

type Mode = 'direct' | 'blob'

/** Opens the page under a policy and waits for the mock game. Collects every request. */
async function open(page: Page, policy: string): Promise<string[]> {
  const requests: string[] = []
  page.context().on('request', (r) => requests.push(r.url()))
  await page.goto(`/p/${policy}/index.html`)
  await page.waitForFunction(() => window.s17 !== undefined)
  await page.evaluate(() => window.s17.ready())
  return requests
}

async function start(
  page: Page,
  packages: string[] = [],
  lockdown = true,
  mode: Mode = 'direct',
  timeoutMs = 60_000,
) {
  return page.evaluate(
    ([p, l, m, t]) =>
      window.s17
        .start({ packages: p, lockdown: l, mode: m, timeoutMs: t })
        .then((r) => ({ ok: true as const, ...r }))
        .catch((e: unknown) => ({ ok: false as const, error: String(e) })),
    [packages, lockdown, mode, timeoutMs] as const,
  )
}

async function run(page: Page, role: 'admin' | 'white', code: string, timeoutMs?: number) {
  return page.evaluate(([r, c, t]) => window.s17.run(r, c, t), [role, code, timeoutMs] as const)
}

async function hits(page: Page, clear = false) {
  const response = await page.request.get(`${ORIGIN}/__hits${clear ? '?clear' : ''}`)
  return (await response.json()) as {
    hits: { origin: string; path: string }[]
    reports: { 'csp-report'?: Record<string, string> }[]
  }
}

const IMPORTS: Record<string, string> = {
  core: 'import sys\nprint(sys.version.split()[0])',
  numpy: 'import numpy as np\nprint(int(np.arange(10).sum()))',
  pandas: 'import pandas as pd\nprint(len(pd.DataFrame({"a": [1, 2, 3]})))',
  pydantic: 'import pydantic\nprint(pydantic.VERSION)',
}

test.describe.configure({ mode: 'serial' })

test('1. offline: every file comes from the build, nothing from another origin (NFR-7, PY-5)', async ({
  page,
}) => {
  const requests = await open(page, 'wasm')
  await hits(page, true)
  const ready = await start(page)
  expect(ready.ok).toBe(true)
  for (const name of ['numpy', 'pandas', 'pydantic']) {
    const out = await run(page, 'admin', IMPORTS[name] ?? '')
    expect(out.status, out.error).toBe('finished')
  }
  const outside = requests.filter(foreign)
  const pyodide = [...new Set(requests.filter((u) => u.includes('/pyodide/')).map((u) => u.split('/pyodide/')[1]))]
  record('offline', { requests: requests.length, foreign: outside, pyodideFiles: pyodide.sort() })
  expect(outside).toEqual([])
  expect((await hits(page)).hits.filter((h) => h.origin === 'canary')).toEqual([])
})

test('2. the Content-Security-Policy each package set needs (PR3)', async ({ browser }) => {
  test.setTimeout(600_000)
  const policies = ['app', 'wasm', 'wasm-strict', 'unsafe-eval', 'wasm-octet', 'wasm-meta']
  const matrix: Record<string, Record<string, string>> = {}
  for (const policy of policies) {
    matrix[policy] = {}
    for (const set of Object.keys(IMPORTS)) {
      if ((policy === 'app' || policy === 'wasm-octet') && set !== 'core') continue
      const context = await browser.newContext()
      const page = await context.newPage()
      await open(page, policy)
      await hits(page, true)
      const ready = await start(page, [], true, 'direct', 15_000)
      let result: string
      if (!ready.ok) result = `start failed: ${ready.error.slice(0, 200)}`
      else {
        const out = await run(page, 'admin', IMPORTS[set] ?? '')
        result = out.status === 'finished' ? `ok (${out.output.trim()})` : `failed: ${(out.error ?? '').slice(-200)}`
      }
      const reports = (await hits(page)).reports.map(
        (r) => `${r['csp-report']?.['effective-directive'] ?? ''} ${r['csp-report']?.['blocked-uri'] ?? ''}`,
      )
      matrix[policy][set] = reports.length > 0 ? `${result}; violations: ${[...new Set(reports)].join(', ')}` : result
      await context.close()
    }
  }
  record('csp', matrix)
  expect(matrix.app?.core).toMatch(/^start failed/)
  for (const set of Object.keys(IMPORTS)) {
    expect(matrix.wasm?.[set], set).toMatch(/^ok/)
    expect(matrix['wasm-strict']?.[set], set).toMatch(/^ok \(/)
    expect(matrix['wasm-strict']?.[set], set).not.toMatch(/violations/)
  }
  expect(matrix['wasm-octet']?.core).toMatch(/^start failed/)
})

const PROBES = readFileSync(join(import.meta.dirname, 'probes.py'), 'utf8')

async function probeRun(browser: Browser, policy: string, lockdown: boolean, mode: Mode) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests = await open(page, policy)
  const ready = await start(page, [], lockdown, mode)
  expect(ready.ok, ready.ok ? '' : ready.error).toBe(true)
  await hits(page, true)
  const code = `CANARY = ${JSON.stringify(CANARY)}\nSAME = ${JSON.stringify(`${ORIGIN}/outside-pyodide`)}\n${PROBES}`
  const out = await run(page, 'admin', code, 60_000)
  expect(out.status, out.error).toBe('finished')
  const lines = out.output.trim().split('\n')
  const probes = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, string>
  const after = await hits(page)
  const rejected = await page.evaluate(() => window.s17.rejected().length)
  await context.close()
  return {
    probes,
    canaryHits: after.hits.filter((h) => h.origin === 'canary').map((h) => h.path),
    sameOriginOutside: after.hits.filter((h) => h.origin === 'main').map((h) => h.path),
    foreignRequests: requests.filter(foreign),
    forgedMessagesRejected: rejected,
  }
}

test('3. the worker: what a script can reach, by policy delivery and lockdown (PY-4)', async ({ browser }) => {
  test.setTimeout(600_000)
  const cases = {
    'header CSP, lockdown': await probeRun(browser, 'wasm', true, 'direct'),
    'header CSP, no lockdown': await probeRun(browser, 'wasm', false, 'direct'),
    'meta CSP only, lockdown, worker from URL': await probeRun(browser, 'wasm-meta', true, 'direct'),
    'meta CSP only, lockdown, worker from blob:': await probeRun(browser, 'wasm-blob-meta', true, 'blob'),
    'no CSP, no lockdown (baseline)': await probeRun(browser, 'none', false, 'direct'),
  }
  record('isolation', cases)
  const strict = cases['header CSP, lockdown']
  const blocked = (name: string) => expect(strict.probes[name], name).toMatch(/^blocked/)
  for (const name of [
    'js.self',
    'js.fetch',
    'js.XMLHttpRequest',
    'js.WebSocket',
    'js.indexedDB',
    'js.importScripts',
    'js.postMessage',
    'js.BroadcastChannel',
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
    'import() via Function constructor (canary)',
    'Emscripten IDBFS.indexedDB()',
  ]) {
    blocked(name)
  }
  expect(strict.probes['object graph walk']).toContain("'found': []")
  // loadPackage(url) resolves even when its fetch is refused, so its proof is the canary.
  expect(strict.canaryHits).toEqual([])
  expect(strict.sameOriginOutside).toEqual([])
  // A worker loaded from its URL under a <meta> policy has no policy at all: eval works, and a
  // script reaches another origin with import(). The lockdown alone does not close that.
  const meta = cases['meta CSP only, lockdown, worker from URL']
  expect(meta.probes['Function constructor']).toMatch(/^reached/)
  expect(meta.canaryHits).toEqual(['/fn-import.js'])
  // The blob: worker takes the page's <meta> policy, so a static host is as strict as a header.
  const blob = cases['meta CSP only, lockdown, worker from blob:']
  expect(blob.probes['run_js(globalThis) (eval)']).toMatch(/^blocked/)
  expect(blob.canaryHits).toEqual([])
  // The baseline shows the probes do reach things when nothing stops them.
  expect(cases['no CSP, no lockdown (baseline)'].canaryHits.length).toBeGreaterThan(0)
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

test('4. round trip on the mock: a script fills the draft, White Force posts a proposal (PD6, PD7, PD9)', async ({
  page,
}) => {
  await open(page, 'wasm')
  expect((await start(page)).ok).toBe(true)
  const ids = await page.evaluate(() => window.s17.ids)

  // Read a room's messages, as the admin.
  const read = await run(
    page,
    'admin',
    `import wrx\nm = await wrx.room_messages(${JSON.stringify(ids.blueHq)})\nprint(len(m), m[0]["sender"], m[0]["body"]["content"]["text"])`,
  )
  expect(read.status, read.error).toBe('finished')
  expect(read.output).toContain('blue-co Morning all.')

  // The admin's script moves an asset; the draft is filled when it finishes.
  expect(await page.evaluate(() => window.s17.draft())).toBeUndefined()
  const moved = await run(page, 'admin', MOVE)
  expect(moved.status, moved.error).toBe('finished')
  const summary = await page.evaluate(() => window.s17.summary())
  expect(summary.changed).toEqual([{ title: moved.output.replace('moved ', '').trim(), fields: ['lat', 'lon'] }])
  await expect(page.locator('#summary li')).toHaveText([/^Changed: .* \(lat, lon\)$/])
  await expect(page.locator('#draft-status')).toHaveText('Unpublished draft')

  // The bridge keeps each role to its operations, and validates what it gets.
  const refused = await run(
    page,
    'white',
    `import wrx, json
out = {}
await_state = await wrx.world_state()
for name, coro in [
    ("white writes the draft", wrx.write_draft(await_state)),
    ("unknown op", wrx._op("publishWorldState", {})),
    ("White Force reads Blue HQ", wrx.room_messages(${JSON.stringify(ids.blueHq)})),
    ("a room not the role's", wrx.room_messages("30000000-0000-4000-8000-0000000000ff")),
    ("invalid state", wrx.post_proposal({"turn": 0, "assets": {}}, "bad")),
    ("not JSON", __import__("_wrx_bridge").call("readWorldState", "{")),
]:
    try:
        r = await coro
        out[name] = "allowed" if not isinstance(r, str) else r
    except wrx.BridgeError as e:
        out[name] = "refused: " + str(e)
    except Exception as e:
        out[name] = "error: " + str(e)
print(json.dumps(out))`,
  )
  expect(refused.status, refused.error).toBe('finished')
  const refusals = JSON.parse(refused.output.trim().split('\n').pop() ?? '{}') as Record<string, string>
  expect(refusals['white writes the draft']).toMatch(/^refused: writeDraft is not open/)
  expect(refusals['unknown op']).toMatch(/^refused: no operation/)
  expect(refusals['White Force reads Blue HQ']).toBe('allowed') // the White Force reads every room
  expect(refusals["a room not the role's"]).toMatch(/^refused: not a room of this role/)
  expect(refusals['invalid state']).toMatch(/^refused: invalid world state/)
  const adminPosts = await run(page, 'admin', 'import wrx\nawait wrx.post_proposal(await wrx.world_state(), "x")')
  expect(adminPosts.status).toBe('failed')
  expect(adminPosts.error).toContain('postProposal is not open to the admin role')

  // White Force proposes: moves another asset and posts it to the umpire room.
  await page.evaluate(() => window.s17.resetDraft())
  const proposal = await run(
    page,
    'white',
    `import wrx
state = await wrx.world_state()
asset = sorted(state["assets"].values(), key=lambda a: a["title"])[-1]
asset["health"] = 40
asset["state"] = "damaged"
r = await wrx.post_proposal(state, "Bridge strike: " + asset["title"])
print(r["stanzaId"] != "")`,
  )
  expect(proposal.status, proposal.error).toBe('finished')
  await expect.poll(() => page.evaluate(() => window.s17.proposals())).toHaveLength(1)
  const received = await page.evaluate(() => window.s17.proposals())
  expect(received[0]).toMatchObject({ from: 'white-cell', valid: true })
  // White Force wrote no draft; the admin loads the proposal with one action and sees the summary.
  expect(await page.evaluate(() => window.s17.draft())).toBeUndefined()
  const loaded = await page.evaluate(() => window.s17.loadProposal(0))
  expect(loaded.changed).toHaveLength(1)
  expect(loaded.changed[0]?.fields).toEqual(['state', 'health'])
  record('round-trip', {
    read: read.output.trim(),
    moved: { output: moved.output.trim(), ms: round(moved.ms), summary },
    refusals: { ...refusals, 'admin posts a proposal': adminPosts.error?.trim().split('\n').pop() },
    proposal: { received, summary: loaded, proposalChars: received[0]?.chars },
  })
})

test('5. stop, time limit and failure leave the draft unchanged (PD9, PY-10)', async ({ page }) => {
  await open(page, 'wasm')
  expect((await start(page)).ok).toBe(true)
  const before = await page.evaluate(() => window.s17.draft())
  expect(before).toBeUndefined()
  const out: Record<string, unknown> = {}

  // Time limit, while the script awaits.
  const asleep = await run(page, 'admin', `${MOVE}\nimport asyncio\nwhile True:\n    await asyncio.sleep(0.01)`, 1500)
  expect(asleep.status).toBe('timed-out')
  expect(asleep.output).toContain('moved')
  expect(await page.evaluate(() => window.s17.draft())).toBeUndefined()
  out.timedOut = { status: asleep.status, ms: round(asleep.ms) }

  // Stop, mid-run, in a busy loop that never yields to the worker's event loop.
  const restart = await start(page)
  expect(restart.ok).toBe(true)
  out.restartAfterStopMs = restart.ok ? round(restart.totalMs) : undefined
  const busy = page.evaluate((code) => window.s17.run('admin', code, 60_000), `${MOVE}\nwhile True:\n    pass`)
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.s17.stop())
  const stopped = await busy
  expect(stopped.status).toBe('stopped')
  expect(await page.evaluate(() => window.s17.draft())).toBeUndefined()
  out.stopped = { status: stopped.status, ms: round(stopped.ms) }

  // A script that fails after writing.
  expect((await start(page)).ok).toBe(true)
  const failed = await run(page, 'admin', `${MOVE}\nraise RuntimeError("late failure")`)
  expect(failed.status).toBe('failed')
  expect(await page.evaluate(() => window.s17.draft())).toBeUndefined()
  out.failed = { status: failed.status, error: failed.error?.trim().split('\n').pop() }

  // And the same script, finishing, applies.
  const ok = await run(page, 'admin', MOVE)
  expect(ok.status).toBe('finished')
  expect(await page.evaluate(() => window.s17.draft())).toBeDefined()
  record('stop', out)
})

test('6. timings: cold and warm start, first run, pandas, memory (PR4)', async ({ browser }) => {
  test.setTimeout(600_000)
  const cold: Record<string, number>[] = []
  const warm: Record<string, number>[] = []
  const sample = async (page: Page, into: Record<string, number>[]) => {
    const t0 = Date.now()
    await page.goto(`/p/wasm/index.html`)
    await page.waitForFunction(() => window.s17 !== undefined)
    await page.evaluate(() => window.s17.ready())
    const pageMs = Date.now() - t0
    const ready = await start(page)
    if (!ready.ok) throw new Error(ready.error)
    const first = await run(page, 'admin', 'import wrx\ns = await wrx.world_state()\nprint(len(s["assets"]))')
    const pandas = await run(
      page,
      'admin',
      'import pandas as pd, wrx\ns = await wrx.world_state()\ndf = pd.DataFrame(list(s["assets"].values()))\nprint(df.groupby("forceId").size().to_dict())',
    )
    const again = await run(page, 'admin', 'import pandas as pd\nprint(pd.__version__)')
    into.push({
      pageMs,
      workerReadyMs: ready.totalMs,
      loadPyodideMs: ready.timings.loadPyodide,
      firstRunMs: first.ms,
      pandasFirstRunMs: pandas.ms,
      pandasImportLoadMs: pandas.importsMs ?? NaN,
      pandasSecondRunMs: again.ms,
      wasmMemoryCoreMB: ready.timings.wasmMemory / 2 ** 20,
      wasmMemoryPandasMB: (pandas.wasmMemory ?? 0) / 2 ** 20,
    })
  }
  for (let i = 0; i < SAMPLES; i++) {
    const context = await browser.newContext() // an empty cache
    const page = await context.newPage()
    await sample(page, cold)
    await sample(page, warm) // the same context: HTTP cache (revalidated) and the code cache
    await context.close()
  }
  const summarise = (rows: Record<string, number>[]) =>
    Object.fromEntries(Object.keys(rows[0] ?? {}).map((k) => [k, { median: round(median(rows.map((r) => r[k] ?? 0))), samples: rows.map((r) => round(r[k] ?? 0)) }]))
  record('timings', {
    machine: 'CI-like container: 4 vCPU, 15 GiB, headless Chromium (Playwright 1.63), loopback HTTP',
    samples: SAMPLES,
    cold: summarise(cold),
    warm: summarise(warm),
  })
  expect(median(cold.map((r) => r.workerReadyMs ?? 0))).toBeLessThan(15_000)
})

test('7. typed models generated from the JSON Schema run in Pyodide (PY-1)', async ({ page }) => {
  await open(page, 'wasm')
  expect((await start(page)).ok).toBe(true)
  const models = join(import.meta.dirname, '..', 'models')
  const pydanticSrc = readFileSync(join(models, 'world_state_pydantic.py'), 'utf8')
  const dataclassSrc = readFileSync(join(models, 'world_state_dataclasses.py'), 'utf8')
  const code = `
import json, sys, types, wrx, pydantic, dataclasses
out = {"pydantic": pydantic.VERSION}
def module(name, src):
    m = types.ModuleType(name)
    sys.modules[name] = m
    exec(src, m.__dict__)
    return m
p = module("world_state_pydantic", ${JSON.stringify(pydanticSrc)})
d = module("world_state_dataclasses", ${JSON.stringify(dataclassSrc)})
state = await wrx.world_state()
body = {"type": "world-state", "schemaVersion": 1, "content": state}
m = p.WorldStateMessageBody.model_validate(body)
out["pydantic valid"] = len(m.content.assets)
bad = json.loads(json.dumps(body))
next(iter(bad["content"]["assets"].values()))["lat"] = 200
try:
    p.WorldStateMessageBody.model_validate(bad)
    out["pydantic invalid"] = "accepted"
except pydantic.ValidationError as e:
    out["pydantic invalid"] = "refused: " + str(e.errors()[0]["loc"])
dc = d.WorldStateMessageBody(type="world-state", schemaVersion=1, content=d.Content(turn=state["turn"], assets={k: d.Assets(**v) for k, v in state["assets"].items()}))
out["dataclasses valid"] = len(dc.content.assets)
dbad = d.Assets(**next(iter(bad["content"]["assets"].values())))
out["dataclasses invalid"] = "accepted (no validation): lat=" + str(dbad.lat)
round_trip = m.model_dump(mode="json")
out["pydantic round trip equal"] = round_trip == body
print(json.dumps(out))
`
  const result = await run(page, 'admin', code)
  expect(result.status, result.error).toBe('finished')
  const out = JSON.parse(result.output.trim().split('\n').pop() ?? '{}') as Record<string, unknown>
  record('typed-models', { ...out, runMs: round(result.ms), importLoadMs: round(result.importsMs ?? 0) })
  expect(out['pydantic valid']).toBe(6)
  expect(out['pydantic invalid']).toMatch(/^refused/)
  expect(out['pydantic round trip equal']).toBe(true)
})
