import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL } from './tests/e2e/harness'

/**
 * Browser tests. Deliberately separate from `npm test`, which runs on Node's
 * built-in runner with no third-party packages — that property is worth keeping,
 * so nothing here is wired into it. Run these with `npm run test:e2e`.
 *
 * What they exist to prove is the one thing source-text assertions cannot: that
 * clicking "Thử lại" re-issues the failed request in a live browser instead of
 * reloading the page. `tests/admin-error-retry-ui.test.ts` can see that the
 * handler is bound and declared; only a browser can see that it works.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // One worker, no retries. Every spec drives the same seeded database through
  // the same admin session, and a retry that turns a failure green is a failure
  // that will reach production instead.
  workers: 1,
  retries: 0,
  fullyParallel: false,
  // Seeding runs bcrypt over the permission matrix, and the first request to a
  // cold build compiles its route chunks.
  globalTimeout: 300_000,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Chromium only. These specs assert behaviour — a request count, a surviving
    // JS value, an ARIA role — none of which differs by engine, and each extra
    // browser is another ~100 MB download for no additional signal.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
