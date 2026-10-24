import { defineConfig, devices } from '@playwright/test'

// The same spec runs twice: against the Vite dev server, where React StrictMode double-invokes
// effects, and against the production build.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'dev', use: { baseURL: 'http://localhost:5174/' } },
    { name: 'prod', use: { baseURL: 'http://localhost:4174/' } },
  ],
  webServer: [
    { command: 'pnpm exec vite --port 5174 --strictPort', port: 5174, reuseExistingServer: true },
    { command: 'pnpm build && pnpm preview', port: 4174, reuseExistingServer: false },
  ],
})
