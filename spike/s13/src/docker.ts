// Docker helpers: restart a server of the S13 stack, read its log, and start a throwaway container.
// Used for the restart-persistence checks and the R15 config probe. Not used to administer ejabberd:
// every admin operation in the tests goes over XMPP.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ADMIN_PASSWORD, COMPOSE_DIR, servers, type Target } from './config.js'
import { connect, disconnect } from './harness.js'

const run = promisify(execFile)

async function compose(...args: string[]): Promise<string> {
  const { stdout, stderr } = await run('docker', ['compose', ...args], {
    cwd: COMPOSE_DIR,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout + stderr
}

/** Restart one server and wait until the admin can log in over WebSocket again. */
export async function restartServer(target: Target, timeoutMs = 90_000): Promise<number> {
  const started = Date.now()
  await compose('restart', servers[target].service)
  for (;;) {
    try {
      const c = await connect(target, 'admin', ADMIN_PASSWORD, {
        resource: 'restart-probe',
        presence: false,
        timeoutMs: 3_000,
      })
      await disconnect(c)
      return Date.now() - started
    } catch (e) {
      if (Date.now() - started > timeoutMs)
        throw new Error(`${target} not back after restart`, { cause: e })
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }
}

/** The server's log since an ISO timestamp. */
export function serverLog(target: Target, since: string): Promise<string> {
  return compose('logs', '--no-color', '--since', since, servers[target].service)
}

const PROBE_NAME = 'wrx-s13-config-probe'

/**
 * Start the pinned image detached with a given config file (no ports published), wait until it
 * either starts listening or logs a critical error, then remove it. Returns whether it started and
 * its log. The container is always removed, also on timeout.
 */
export async function probeConfig(
  image: string,
  configPath: string,
  timeoutMs = 60_000,
): Promise<{ started: boolean; log: string }> {
  await run('docker', ['rm', '-f', PROBE_NAME]).catch(() => undefined)
  await run('docker', [
    'run',
    '-d',
    '--name',
    PROBE_NAME,
    '-v',
    `${configPath}:/home/ejabberd/conf/ejabberd.yml:ro`,
    image,
  ])
  const started = Date.now()
  try {
    for (;;) {
      const { stdout, stderr } = await run('docker', ['logs', PROBE_NAME], {
        maxBuffer: 16 * 1024 * 1024,
      }).catch((e: { stdout?: string; stderr?: string }) => ({
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
      }))
      const log = stdout + stderr
      if (/\[critical\]/.test(log)) return { started: false, log }
      if (/Start accepting TCP connections at 0\.0\.0\.0:5280/.test(log))
        return { started: true, log }
      if (Date.now() - started > timeoutMs) return { started: false, log: `${log}\n(timeout)` }
      await new Promise((r) => setTimeout(r, 1_000))
    }
  } finally {
    await run('docker', ['rm', '-f', PROBE_NAME]).catch(() => undefined)
  }
}
