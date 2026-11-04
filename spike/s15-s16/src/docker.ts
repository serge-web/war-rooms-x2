// Docker helpers: restarting the server (S15-6) and starting a config to see whether it starts
// (S16-5). Not used to administer ejabberd: every operation under test goes over XMPP.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CONFIGS, container, DOCKER_DIR, type ConfigName } from './config.ts'

const run = promisify(execFile)

const env = (cfg: ConfigName) => ({ ...process.env, S1516_CONFIG: cfg, S1516_PORT: String(CONFIGS[cfg].port) })

/** Restarts the container in place (same volume) and waits until it is healthy. */
export async function restart(cfg: ConfigName): Promise<number> {
  const started = performance.now()
  await run('docker', ['compose', 'restart'], { cwd: DOCKER_DIR, env: env(cfg) })
  await run('docker', ['compose', 'up', '-d', '--wait'], { cwd: DOCKER_DIR, env: env(cfg) })
  return performance.now() - started
}

export interface StartResult {
  readonly healthy: boolean
  readonly exitCode?: number
  readonly log: string
}

/** Starts `cfg` on a fresh volume (as `scripts/up.sh <cfg>`), and returns whether it became healthy. */
export async function start(cfg: ConfigName): Promise<StartResult> {
  await run('docker', ['compose', 'down', '-v', '--remove-orphans'], { cwd: DOCKER_DIR, env: env(cfg) })
  let healthy = true
  try {
    await run('docker', ['compose', 'up', '-d', '--wait', '--force-recreate'], { cwd: DOCKER_DIR, env: env(cfg) })
  } catch {
    healthy = false
  }
  const { stdout, stderr } = await run('docker', ['compose', 'logs', '--no-color'], {
    cwd: DOCKER_DIR,
    env: env(cfg),
    maxBuffer: 32 * 1024 * 1024,
  })
  const state = await run('docker', ['inspect', '-f', '{{.State.ExitCode}} {{.State.Running}}', container(cfg)]).catch(
    () => ({ stdout: '' }),
  )
  const [code, running] = state.stdout.trim().split(' ')
  return {
    healthy: healthy && running === 'true',
    ...(running === 'true' || code === undefined ? {} : { exitCode: Number(code) }),
    log: stdout + stderr,
  }
}

export async function stop(cfg: ConfigName): Promise<void> {
  await run('docker', ['compose', 'down', '-v', '--remove-orphans'], { cwd: DOCKER_DIR, env: env(cfg) })
}

/**
 * The stored `creation` and `modification` of a node's items, read from the server's SQLite file
 * with the image's sqlite3 (read only). Evidence for what the fetched order is based on; a
 * client cannot see these columns.
 */
export async function storedTimes(
  cfg: ConfigName,
  node: string,
): Promise<{ itemid: string; publisher: string; creation: string; modification: string }[]> {
  const sql =
    `select itemid, publisher, creation, modification from pubsub_item where nodeid = ` +
    `(select nodeid from pubsub_node where node = '${node.replace(/'/g, "''")}') order by rowid;`
  const { stdout } = await run('docker', [
    'exec',
    container(cfg),
    'sqlite3',
    '-readonly',
    '-separator',
    '|',
    '/home/ejabberd/database/ejabberd.db',
    sql,
  ])
  return stdout
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [itemid = '', publisher = '', creation = '', modification = ''] = l.split('|')
      return { itemid, publisher: publisher.replace(/^s1516-[0-9a-z]+-[0-9a-z]{5}-/, 'RUN-'), creation, modification }
    })
}

/** The lines of a log that matter for a config change: warnings, errors, critical. */
export function keyLines(log: string): string[] {
  return log
    .split('\n')
    .filter((l) => /\[(warning|error|critical)\]|shaper/i.test(l))
    .map((l) => l.replace(/^ejabberd-1\s+\|\s*/, '').trim())
    .filter((l) => !/mod_last is recommended/.test(l))
}
