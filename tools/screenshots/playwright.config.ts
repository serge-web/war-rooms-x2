// Screenshot runs (DOC-19, DOC-20): only @screenshot scenarios, against a built site served at
// its own base path. capture.ts sets the environment.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const root = fileURLToPath(new URL('../..', import.meta.url))

const port = 4392
const dist = process.env.WRX_SHOTS_DIST ?? 'site/dist'
const base = process.env.WRX_SHOTS_BASE ?? '/'

export default defineConfig({
  testDir: 'scenarios',
  grep: /@screenshot/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: process.env.WRX_SHOTS_RESULTS ?? 'test-results/screenshots',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}${base}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  webServer: {
    command: `node tools/site/serve.ts ${dist} ${port} ${base}`,
    cwd: root,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
