import { defineConfig, devices } from '@playwright/test'

// The S17 spec, on its own build and server (scripts/serve.ts), apart from the app's e2e.
// S17_PORT moves the server (the canary takes the next port). S17_BROWSERS=chromium,webkit
// adds WebKit where it is installed; only Chromium is installed in the dev container.
const port = Number(process.env.S17_PORT ?? 5027)
const browsers = (process.env.S17_BROWSERS ?? 'chromium').split(',').map((b) => b.trim())
const DEVICES = { chromium: devices['Desktop Chrome'], webkit: devices['Desktop Safari'] }

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  projects: browsers.map((name) => {
    if (name !== 'chromium' && name !== 'webkit') throw new Error(`S17_BROWSERS: ${name}`)
    return { name, use: { ...DEVICES[name] } }
  }),
  webServer: {
    command: `node scripts/serve.ts ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
})
