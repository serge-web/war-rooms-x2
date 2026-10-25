import { basePathOf, hostNames, mockNamespace } from '@wrx/mock-host'
import type { MockHost } from '@wrx/mock-host'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import type { AppProps } from './App.tsx'
import { Backends } from './backends.ts'
import type { BackendsOptions } from './backends.ts'
import { NO_CONFIG, loadConfig } from './config.ts'
import type { ConfigResult } from './config.ts'
import { demoLogins } from './demo-logins.ts'
import './app.css'

declare global {
  interface Window {
    /**
     * The mock host of this tab, set once it has started (mock backend only). For Playwright
     * and for diagnosing a browser: it reaches nothing a user could not reach in their own
     * browser's mock.
     */
    wrxMock?: MockHost
  }
}

/** Remembers the chosen backend per deployment (DOC-10), where storage is allowed. */
function backendPreference(): AppProps['backendPreference'] {
  const key = hostNames(mockNamespace(basePathOf(document.baseURI))).storageKey('backend')
  return {
    load: () => {
      try {
        return localStorage.getItem(key) ?? undefined
      } catch {
        return undefined
      }
    },
    save: (id) => {
      try {
        localStorage.setItem(key, id)
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
    },
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('root')
  if (root === null) throw new Error('Missing #root element')

  // Mock-only builds (previews, the demo, snapshots and the site) never read config.json and
  // carry no real transport (DOC-12). `pnpm build:server` makes the build that does.
  const loaded: ConfigResult = __WRX_REAL_SERVER__
    ? await loadConfig((url) => fetch(url, { cache: 'no-store' }), document.baseURI)
    : { ok: true, config: NO_CONFIG }
  const options: BackendsOptions = {
    onMockHost: (host) => {
      window.wrxMock = host
    },
    ...(__WRX_REAL_SERVER__
      ? {
          loadXmpp: () =>
            import('@wrx/transport-xmpp').then(({ XmppTransport }) => new XmppTransport()),
        }
      : {}),
  }
  const backends = new Backends(loaded.ok ? loaded.config : NO_CONFIG, options)

  createRoot(root).render(
    <StrictMode>
      <App
        backends={backends}
        demoLogins={demoLogins()}
        configProblem={loaded.ok ? undefined : loaded.error}
        backendPreference={backendPreference()}
      />
    </StrictMode>,
  )
}

void main()
