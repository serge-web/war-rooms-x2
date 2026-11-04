// Docker helpers: the server's memory (S14-5, S14-10), and starting a config on a given database
// volume (S14-9). Not used to administer ejabberd: every PubSub operation goes over XMPP.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CONFIGS, DOCKER_DIR, type ConfigName } from './config.ts'

const run = promisify(execFile)

export const container = (db: ConfigName) => `wrx-s14-${db}-ejabberd-1`

/** The container's memory use in MiB (docker stats). */
export async function memoryMiB(db: ConfigName): Promise<number> {
  const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', container(db)])
  const m = /([\d.]+)\s*(KiB|MiB|GiB)/.exec(stdout)
  if (m === null) return Number.NaN
  const v = Number(m[1])
  return m[2] === 'GiB' ? v * 1024 : m[2] === 'KiB' ? v / 1024 : v
}

export interface StartResult {
  readonly healthy: boolean
  readonly exitCode?: number
  readonly log: string
}

/**
 * Starts `config` on `db`'s volume with docker compose (the same as `scripts/up.sh <config> --db
 * <db>`), and returns whether it became healthy and its log.
 */
export async function startOn(config: ConfigName, db: ConfigName): Promise<StartResult> {
  const env = { ...process.env, S14_CONFIG: config, S14_DB: db, S14_PORT: String(CONFIGS[db].port) }
  let healthy = true
  try {
    await run('docker', ['compose', 'up', '-d', '--wait', '--force-recreate'], { cwd: DOCKER_DIR, env })
  } catch {
    healthy = false
  }
  const { stdout, stderr } = await run('docker', ['compose', 'logs', '--no-color'], {
    cwd: DOCKER_DIR,
    env,
    maxBuffer: 32 * 1024 * 1024,
  })
  const state = await run('docker', ['inspect', '-f', '{{.State.ExitCode}} {{.State.Running}}', container(db)]).catch(
    () => ({ stdout: '' }),
  )
  const [code, running] = state.stdout.trim().split(' ')
  return {
    healthy: healthy && running === 'true',
    ...(running === 'true' || code === undefined ? {} : { exitCode: Number(code) }),
    log: stdout + stderr,
  }
}

/** The lines of a log that matter for a config change: warnings, errors, critical. */
export function keyLines(log: string): string[] {
  return log
    .split('\n')
    .filter((l) => /\[(warning|error|critical)\]|undef,|nodetree_dag|node_dag/.test(l))
    .map((l) => l.replace(/^ejabberd-1\s+\|\s*/, '').trim())
    .filter((l) => !/mod_last is recommended/.test(l))
}

/** Stops a stack and deletes its volume (scripts/down.sh for one database). */
export async function downOn(db: ConfigName): Promise<void> {
  const env = { ...process.env, S14_CONFIG: db, S14_DB: db, S14_PORT: String(CONFIGS[db].port) }
  await run('docker', ['compose', 'down', '-v', '--remove-orphans'], { cwd: DOCKER_DIR, env })
}

/** Creates the admin account on a running stack (docker/bootstrap.sh). */
export async function bootstrapOn(db: ConfigName): Promise<void> {
  await run('docker', ['exec', container(db), 'sh', '/home/ejabberd/bootstrap.sh'])
}

/** The effective mod_pubsub options of a running server, from `ejabberdctl dump_config`. */
export async function effectivePubsub(db: ConfigName): Promise<string> {
  await run('docker', ['exec', container(db), 'ejabberdctl', 'dump_config', '/tmp/s14-effective.yml'])
  const { stdout } = await run('docker', ['exec', container(db), 'cat', '/tmp/s14-effective.yml'])
  const m = /\n {2}mod_pubsub: *\n((?: {4}.*\n| {6}.*\n)*)/.exec(stdout)
  return (m?.[1] ?? '').trimEnd()
}
