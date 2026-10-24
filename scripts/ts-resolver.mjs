/**
 * Test bootstrap: lets Node's built-in test runner import the project's
 * TypeScript sources directly.
 *
 * Why this exists
 * ---------------
 * The suites under `tests/` import application code with extension-less
 * specifiers (e.g. `../server/utils/chatbot/crypto`), which is normal for a
 * bundler/Nuxt setup but invalid for Node's native ESM resolver. Node ≥22.6 can
 * strip TypeScript types on its own (`--experimental-strip-types`), so the only
 * missing piece is extension resolution — supplied here by a resolve hook.
 *
 * This keeps the test runner dependency-free: no ts-node/tsx/vitest needed, and
 * it works identically in CI and inside the Docker image.
 *
 * `~~/…` (Nuxt's rootDir alias) resolves from the repo root. app/ code must reach
 * shared/ as `~~/shared/…`, never relatively: Nuxt keeps shared/ external in the
 * SSR build and rolldown can render a relative source as a path Nitro cannot
 * resolve (tests/app-shared-imports.test.ts). The tests load some of those app
 * modules (nav-config, hero-content) directly, so the alias must work here too.
 *
 * Usage (see the `test` script in package.json):
 *   node --experimental-strip-types --experimental-test-module-mocks \
 *        --import ./scripts/ts-resolver.mjs --test tests/*.test.ts
 *
 * Requires Node >= 22.15 (for `module.registerHooks`).
 */
import { registerHooks } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CANDIDATE_SUFFIXES = ['.ts', '/index.ts', '.mts', '.js']
const REPO_ROOT = new URL('../', import.meta.url)

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      let base
      if (specifier.startsWith('~~/')) {
        base = new URL(specifier.slice(3), REPO_ROOT)
        // Unlike a relative specifier, Node never resolved the exact path itself.
        const exact = fileURLToPath(base)
        if (existsSync(exact) && statSync(exact).isFile()) return { url: base.href, shortCircuit: true }
      } else {
        // Only rescue relative/absolute specifiers; bare package names must keep
        // failing so a genuinely missing dependency is still reported.
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error
        if (!context.parentURL) throw error
        base = new URL(specifier, context.parentURL)
      }
      for (const suffix of CANDIDATE_SUFFIXES) {
        const url = base.href + suffix
        if (existsSync(fileURLToPath(url))) {
          // Deliberately omit `format` so Node infers it from the extension and
          // still applies TypeScript type-stripping to .ts files.
          return { url, shortCircuit: true }
        }
      }
      throw error
    }
  },
})
