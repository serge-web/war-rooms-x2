// S15-S16 settings: which config is under test, and where its server listens (docker/compose.yaml).
// scripts/run.ts sets S1516_CONFIG and NODE_EXTRA_CA_CERTS before vitest starts.
import { fileURLToPath } from 'node:url'

export type ConfigName = 'ref' | 'tight' | 'http'

export interface Shaper {
  /** Bytes per second after the burst. */
  readonly rate: number
  readonly burst: number
}

export const CONFIGS: Record<ConfigName, { readonly port: number; readonly summary: string; readonly player: Shaper }> = {
  ref: { port: 35980, summary: 'reference config, unchanged', player: { rate: 50_000, burst: 300_000 } },
  tight: { port: 35981, summary: 'player shaper 20 kB/s, 20 kB burst', player: { rate: 20_000, burst: 20_000 } },
  http: { port: 35982, summary: 'shaper option on the ejabberd_http listener', player: { rate: 50_000, burst: 300_000 } },
}

const isConfig = (name: string): name is ConfigName => name in CONFIGS

function configName(): ConfigName {
  const name = process.env.S1516_CONFIG ?? 'ref'
  if (!isConfig(name)) throw new Error(`S1516_CONFIG=${name}?`)
  return name
}

/** The config this run tests. */
export const CONFIG: ConfigName = configName()

export const endpoint = {
  websocketUrl: process.env.S1516_WS ?? `wss://localhost:${CONFIGS[CONFIG].port}/ws`,
  domain: 'localhost',
}

/** Set by docker/bootstrap.sh for a throwaway local container; not a product secret. */
export const ADMIN_PASSWORD = process.env.S1516_ADMIN_PASSWORD ?? 'spike-password'

/** Same digest as deploy/ejabberd/compose.yaml. */
export const IMAGE =
  'ejabberd/ecs:26.09@sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DOCKER_DIR = fileURLToPath(new URL('../docker/', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export const container = (cfg: ConfigName) => `wrx-s1516-${cfg}-ejabberd-1`
