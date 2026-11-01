// S14-0 and the start-up half of S14-9: are the configs what the brief asks for, and does ejabberd
// 26.09 start with each of them? Starts each dag config on a fresh volume, records the log, and
// for a config that starts, what mod_pubsub runs with and what PubSub then does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { must, uniq } from '../../../../packages/contract-suite/src/harness.ts'
import { makeBackend, raw } from '../../src/backend.ts'
import { CONFIGS, DOCKER_DIR, IMAGE, REPO_ROOT, type ConfigName } from '../../src/config.ts'
import { observe, saveStanzas } from '../../src/context.ts'
import { bootstrapOn, downOn, effectivePubsub, keyLines, startOn } from '../../src/docker.ts'
import { features, NS, Pubsub, Transcript } from '../../src/pubsub.ts'

const reference = readFileSync(join(REPO_ROOT, 'deploy/ejabberd/ejabberd.yml'), 'utf8')
const config = (name: ConfigName) => readFileSync(join(DOCKER_DIR, `ejabberd-${name}.yml`), 'utf8')

/** The config without its S14 header and with the mod_pubsub block cut out. */
function outsidePubsub(text: string): string {
  const body = text.replace(/^(# S14[^\n]*\n)(#[^\n]*\n)*?#\n/, '')
  return body.replace(/\n {2}mod_pubsub:\n(?: {4}[^\n]*\n)*/, '\n  mod_pubsub: <cut>\n')
}

/** The mod_pubsub keys that are not comments. */
function pubsubBlock(text: string): string[] {
  const m = /\n {2}mod_pubsub:\n((?: {4}[^\n]*\n)*)/.exec(text)
  return (m?.[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

describe('S14-0 configs', () => {
  it('V0 is the reference config; V1, V2 and the probes differ only in mod_pubsub', () => {
    expect(config('v0').replace(/^(# S14[^\n]*\n)(#[^\n]*\n)*?#\n/, '')).toBe(reference)
    for (const name of ['v1', 'v2', 'v1p', 'v2p'] as const) expect(outsidePubsub(config(name))).toBe(outsidePubsub(reference))
    const blocks = Object.fromEntries((['v0', 'v1', 'v2', 'v1p', 'v2p'] as const).map((n) => [n, pubsubBlock(config(n))]))
    observe('S14-0', 'mod_pubsub per config', { blocks })
    expect(blocks.v1).toEqual(['access_createnode: pubsub_createnode', 'nodetree: dag', 'plugins:', '- flat', '- dag', '- pep'])
    expect(blocks.v2).toEqual(['access_createnode: pubsub_createnode', 'nodetree: dag', 'plugins:', '- dag', '- pep'])
  })

  it('the image is pinned by the same digest as deploy/ejabberd/compose.yaml', () => {
    const ref = readFileSync(join(REPO_ROOT, 'deploy/ejabberd/compose.yaml'), 'utf8')
    const ours = readFileSync(join(DOCKER_DIR, 'compose.yaml'), 'utf8')
    expect(ref).toContain(`image: ${IMAGE}`)
    expect(ours).toContain(`image: ${IMAGE}`)
  })
})

describe('S14-9 start-up under each dag config (fresh volume)', () => {
  const started: ConfigName[] = []
  afterAll(async () => {
    for (const db of started) await downOn(db)
  }, 120_000)

  for (const name of ['v1', 'v2', 'v1p', 'v2p'] as const) {
    it(`${name}: ${CONFIGS[name].summary}`, async () => {
      await downOn(name)
      started.push(name)
      const r = await startOn(name, name)
      const lines = keyLines(r.log)
      const result: Record<string, unknown> = {
        healthy: r.healthy,
        ...(r.exitCode === undefined ? {} : { exitCode: r.exitCode }),
        logLines: lines.slice(0, 12),
      }
      if (r.healthy) {
        await bootstrapOn(name)
        result.effectiveModPubsub = await effectivePubsub(name)
        // What PubSub does now: features, and creating a plain node and a collection.
        const backend = makeBackend({ websocketUrl: `wss://localhost:${CONFIGS[name].port}/ws`, domain: 'localhost' })
        const admin = must(await backend.admin(), `admin login on ${name}`)
        const t = new Transcript()
        const ps = new Pubsub(raw, admin, admin.services.pubsub, t, 'admin')
        const info = await ps.discoInfo()
        result.collectionsFeature = features(info.xml).includes(`${NS.pubsub}#collections`)
        const plain = await ps.create(uniq('probe-plain'), { 'pubsub#access_model': 'whitelist' })
        const coll = await ps.create(uniq('probe-coll'), { 'pubsub#node_type': 'collection' })
        const typed = await ps.create(uniq('probe-typed'), { 'pubsub#node_type': 'collection' }, 'dag')
        const fmt = (x: typeof plain) => (x.ok ? 'ok' : `${x.condition ?? '?'}${x.appCondition === undefined ? '' : `/${x.appCondition}`}: ${x.text ?? ''}`)
        result.createPlain = fmt(plain)
        result.createCollection = fmt(coll)
        result.createWithTypeDag = fmt(typed)
        saveStanzas('startup-probe', t, name)
        await admin.disconnect()
      }
      observe('S14-9', `start-up, ${name}`, result)
      if (name === 'v1' || name === 'v2') {
        // Recorded: ejabberd 26.09 aborts. The dag plugin is dropped with a warning, and the dag
        // node tree is a module the image does not have.
        expect(r.healthy).toBe(false)
        expect(lines.join('\n')).toMatch(/Plugin 'dag' of mod_pubsub is not supported anymore/)
        expect(lines.join('\n')).toMatch(/nodetree_dag_sql,init/)
        expect(lines.join('\n')).toMatch(/ejabberd initialization was aborted/)
      } else {
        expect(lines.join('\n')).toMatch(/Plugin 'dag' of mod_pubsub is not supported anymore/)
      }
    })
  }
})
