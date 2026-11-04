// S14 settings: which config is under test, and where its server listens (docker/compose.yaml).
// scripts/run.ts sets S14_CONFIG and NODE_EXTRA_CA_CERTS before vitest starts.
import { fileURLToPath } from 'node:url'

/** The brief's three configs, and two probes (the dag plugin without the dag node tree). */
export type ConfigName = 'v0' | 'v1' | 'v2' | 'v1p' | 'v2p'

export const CONFIGS: Record<ConfigName, { readonly port: number; readonly summary: string }> = {
  v0: { port: 35970, summary: 'reference: default node tree, plugins [flat, pep]' },
  v1: { port: 35971, summary: 'nodetree: dag, plugins [flat, dag, pep]' },
  v2: { port: 35972, summary: 'nodetree: dag, plugins [dag, pep]' },
  v1p: { port: 35973, summary: 'probe: default node tree, plugins [flat, dag, pep]' },
  v2p: { port: 35974, summary: 'probe: default node tree, plugins [dag, pep]' },
}

const isConfig = (name: string): name is ConfigName => name in CONFIGS

function configName(variable: string, fallback: string): ConfigName {
  const name = process.env[variable] ?? fallback
  if (!isConfig(name)) throw new Error(`${variable}=${name}?`)
  return name
}

/** The config this run tests. */
export const CONFIG: ConfigName = configName('S14_CONFIG', 'v0')

/** The database volume (compose project) the server runs on; differs from CONFIG only in S14-9. */
export const DB: ConfigName = configName('S14_DB', CONFIG)

export const endpoint = {
  websocketUrl: process.env.S14_WS ?? `wss://localhost:${CONFIGS[DB].port}/ws`,
  domain: 'localhost',
}

/** Set by docker/bootstrap.sh for a throwaway local container; not a product secret. */
export const ADMIN_PASSWORD = process.env.S14_ADMIN_PASSWORD ?? 'spike-password'

/** Same digest as deploy/ejabberd/compose.yaml. */
export const IMAGE =
  'ejabberd/ecs:26.09@sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e'

export const S14_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DOCKER_DIR = fileURLToPath(new URL('../docker/', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Leaf counts for the scale checks (S14-5); S14_SCALE=600 runs one size only. */
export const SCALES: readonly number[] = (process.env.S14_SCALE ?? '600,1200')
  .split(',')
  .map((s) => Number(s.trim()))
