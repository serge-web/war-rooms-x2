// Docker helpers: restart a server of the S13 stack, read its log, and start a throwaway container.
// Used for the restart-persistence checks and the R15 config probe. Not used to administer ejabberd:
// every admin operation in the tests goes over XMPP.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ADMIN_PASSWORD, COMPOSE_DIR, servers, type Target } from './config.js';
import { connect, disconnect } from './harness.js';

const run = promisify(execFile);

async function compose(...args: string[]): Promise<string> {
  const { stdout, stderr } = await run('docker', ['compose', ...args], { cwd: COMPOSE_DIR, maxBuffer: 64 * 1024 * 1024 });
  return stdout + stderr;
}

/** Restart one server and wait until the admin can log in over WebSocket again. */
export async function restartServer(target: Target, timeoutMs = 90_000): Promise<number> {
  const started = Date.now();
  await compose('restart', servers[target].service);
  for (;;) {
    try {
      const c = await connect(target, 'admin', ADMIN_PASSWORD, { resource: 'restart-probe', presence: false, timeoutMs: 3_000 });
      await disconnect(c);
      return Date.now() - started;
    } catch (e) {
      if (Date.now() - started > timeoutMs) throw new Error(`${target} not back after restart: ${String(e)}`);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

/** The server's log since an ISO timestamp. */
export function serverLog(target: Target, since: string): Promise<string> {
  return compose('logs', '--no-color', '--since', since, servers[target].service);
}

/** Run the pinned image once with a given config file and return exit code and output. */
export async function runOnce(image: string, configPath: string, timeoutMs = 60_000): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run('docker', ['run', '--rm', '-v', `${configPath}:/home/ejabberd/conf/ejabberd.yml:ro`, image], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, output: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === 'number' ? err.code : -1, output: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}
