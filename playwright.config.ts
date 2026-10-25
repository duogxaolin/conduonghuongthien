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
  // cold build compiles its route chunks. The whole suite took ~240 s locally with
  // setup at 93 tests (2026-10-24) — 300 s left under a minute of headroom, so the
  // budget became 480 s. Each wave2 branch alone stayed under it (6.4: 97 tests,
  // 313 s), but the integration branch carries them all (2A, 2D's `admin-dialogs`
  // batch, 6.4's `admin-list-pilot`): 112 tests took 298 s locally before 6.4 and
  // runs longer on CI runners, so it is 600 s, the same ~2× margin. Raise it again
  // with the next batch of specs rather than let one slow runner fail every test at once.
  globalTimeout: 600_000,
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
