// The SharedWorker side of the mock host (D17, ARC-7): one worker per deployment, named from its
// namespace (DOC-10), serving every tab that connects. Tabs talk to it over their own
// MessagePort; it notices a tab has gone when the tab's Web Lock is released.
//
// The worker holds the deployment's leader lock while it serves. It takes it by stealing, so a
// newer release's worker (a new script URL, hence a new worker) takes over the database from an
// older one still serving old tabs: the old one stops saving and tells its tabs to reload.
import { demoState, parseMockState } from '@wrx/mock-server'
import type { MockState } from '@wrx/mock-server'
import type { Channel, Locks } from './env.ts'
import { ServerHost } from './host.ts'
import type { StateMigrations } from './migrate.ts'
import { hostNames, mockNamespace, namespaceOfWorkerName } from './namespace.ts'
import type { StateStore } from './store.ts'
import { parseMessage, upMessageSchema } from './wire.ts'
import type { DownMessage, Log, MockNotice, UpMessage } from './wire.ts'

export interface WorkerHostOptions {
  /** The worker's name, `<namespace>:worker`. */
  readonly name: string
  readonly locks: Locks | undefined
  readonly openStore: (name: string) => StateStore
  readonly log: Log
  readonly saveDelayMs?: number
  readonly migrations?: StateMigrations
}

export interface WorkerHost {
  /** A tab connected: `port` is its end of the channel. */
  connect(port: Channel): void
}

/** Serves the mock to every tab that connects. All state lives in the returned closure. */
export function serveSharedWorker(options: WorkerHostOptions): WorkerHost {
  const { log, locks } = options
  const names = hostNames(namespaceOfWorkerName(options.name) ?? mockNamespace('/'))
  const ports = new Set<Channel>()
  const watched = new Set<string>()
  /** Work that arrived before the host finished loading, in order. */
  const backlog: ((host: ServerHost) => void)[] = []
  let host: ServerHost | undefined
  let starting = false

  const broadcast = (notice: MockNotice) => {
    for (const port of ports) port.post({ k: 'notice', notice } satisfies DownMessage)
  }

  const withHost = (task: (host: ServerHost) => void) => {
    if (host === undefined) backlog.push(task)
    else task(host)
  }

  const start = async (seed: MockState) => {
    if (locks !== undefined) {
      await new Promise<void>((acquired) => {
        locks
          .request(names.leaderLock, { steal: true }, () => {
            acquired()
            // Held for the worker's life.
            return new Promise(() => undefined)
          })
          .catch(() => {
            // Stolen: a newer release's worker hosts the database now.
            host?.retire()
            broadcast({
              kind: 'superseded',
              text: 'A newer version of the app is open in another tab. Reload this tab.',
            })
          })
      })
    }
    const started = await ServerHost.start({
      store: options.openStore(names.database),
      seed,
      log,
      broadcast,
      ...(options.saveDelayMs === undefined ? {} : { saveDelayMs: options.saveDelayMs }),
      ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
    })
    host = started
    for (const task of backlog.splice(0)) task(started)
  }

  /** When the tab's lock comes free, the tab has closed: drop its sessions. */
  const watch = (tab: string) => {
    if (locks === undefined || watched.has(tab)) return
    watched.add(tab)
    void locks.request(names.tabLock(tab), {}, () => {
      watched.delete(tab)
      withHost((h) => {
        h.dropTab(tab)
      })
    })
  }

  const handle = (port: Channel, message: UpMessage) => {
    switch (message.k) {
      case 'hello': {
        const seed = parseMockState(message.seed)
        if (!seed.ok)
          log({ level: 'warn', message: 'mock worker: invalid seed', detail: seed.error })
        if (!starting) {
          starting = true
          void start(seed.ok ? seed.value : demoState())
        }
        watch(message.tab)
        withHost((h) => {
          port.post({ k: 'ready', tab: message.tab, notices: [...h.notices] } satisfies DownMessage)
        })
        return
      }
      case 'c2s':
        withHost((h) => {
          h.receive(message.tab, message.conn, message.frame, (frame) => {
            port.post({
              k: 's2c',
              tab: message.tab,
              conn: message.conn,
              frame,
            } satisfies DownMessage)
          })
        })
        return
      case 'control':
        withHost((h) => {
          void h.control(message.control).then((result) => {
            port.post({
              k: 'result',
              tab: message.tab,
              id: message.id,
              result,
            } satisfies DownMessage)
          })
        })
        return
      case 'bye':
        ports.delete(port)
        withHost((h) => {
          h.dropTab(message.tab)
          void h.flush()
        })
        return
    }
  }

  return {
    connect(port: Channel) {
      ports.add(port)
      port.listen((data) => {
        // A tab back from the back-forward cache after `bye` is heard again.
        ports.add(port)
        const message = parseMessage(upMessageSchema, data, 'tab to SharedWorker', log)
        if (message !== undefined) handle(port, message)
      })
    },
  }
}
