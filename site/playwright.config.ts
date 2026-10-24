import { defineConfig, devices } from '@playwright/test'

const port = 4391
/** A nested base path, as a PR preview on GitHub Pages has (DOC-6, DOC-11). */
export const pagesRoot = '/wrx-e2e/'
export const base = `${pagesRoot}pr/7/`

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}${base}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ../tools/site/build-site.ts --base ${base} --pages-root ${pagesRoot} && node ../tools/site/serve.ts dist ${port} ${base}`,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
