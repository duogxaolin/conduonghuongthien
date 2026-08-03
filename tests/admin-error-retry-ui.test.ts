/**
 * Contract for the error branch on every admin view that fetches data.
 *
 * The failure this guards against is specific and quiet: a fetch rejects, the
 * page falls back to its empty state, and an officer reads "chưa có dữ liệu" —
 * then goes and re-creates a record that already exists. A toast does not cover
 * this, because a toast is gone in four seconds and the empty state stays on
 * screen indefinitely. So the error branch has to be PERSISTENT markup, and it
 * has to offer a way out that does not cost the operator their unsaved work.
 *
 * Four things are pinned per view:
 *   1. an error ref exists in the script, so a rejection has somewhere to land;
 *   2. a `v-else-if` branch renders it, so the state is visible, not just held;
 *   3. that branch carries `role="alert"`, so a screen reader is told;
 *   4. the retry button calls a function DEFINED IN THAT FILE.
 *
 * (4) is the one worth arguing for. `location.reload()` looks like a retry and
 * is not one: it discards every other panel's loaded state and any half-filled
 * form on the page, to re-run the one request that failed. Calling the page's
 * own fetch re-runs exactly the failed request and leaves the rest alone. The
 * assertion is that the handler name is declared in the same file, which is
 * what makes "calls its own fetch" checkable from source text.
 *
 * LIMITATION — same as tests/skeleton-loading-ui.test.ts: these assertions read
 * SFC source text and never mount a component. They prove the branch and its
 * handler still exist and will fail loudly when one is deleted in a refactor.
 * They prove nothing about whether the branch paints, whether the click wires
 * up, or whether the retry actually recovers.
 *
 * That part lives in `tests/e2e/admin-retry.spec.ts` (`npm run test:e2e`), which
 * drives Chromium against a throwaway portal, injects a 500, and asserts the
 * click issues a new request without reloading the document. It covers two of
 * the views listed below — the settings-form shape and the table shape — not all
 * of them. So this file remains the breadth check and the browser suite is the
 * depth check; neither replaces the other.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = (relative: string) => readFile(new URL(`../app/${relative}`, import.meta.url), 'utf8')

/**
 * Every admin view that loads data, with the ref its rejection lands in and the
 * fetch its retry button re-runs. A view is listed here the moment it fetches;
 * the point of naming the handler is that a refactor which renames the fetch but
 * forgets the `@click` fails this test instead of shipping a dead button.
 *
 * Pages with several independent fetches list several refs — the dashboard's
 * four widgets fail independently, and one dead widget must not take out the
 * other three or replace the whole page with an error.
 */
const VIEWS_WITH_ERROR_BRANCH: Array<{ file: string; refs: string[]; retries: string[] }> = [
  // Settings — the group the user asked to start from.
  { file: 'pages/admin/settings/data-retention.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/settings/general.vue', refs: ['error'], retries: ['fetchSettings'] },
  { file: 'pages/admin/settings/email.vue', refs: ['error'], retries: ['fetchSettings'] },
  { file: 'pages/admin/settings/media-storage.vue', refs: ['error'], retries: ['fetchSettings'] },
  { file: 'pages/admin/settings/tracking.vue', refs: ['error'], retries: ['fetchSettings'] },

  // Content.
  { file: 'pages/admin/content/articles/index.vue', refs: ['loadError'], retries: ['fetchArticles'] },
  { file: 'pages/admin/content/articles/[id].vue', refs: ['errorMsg'], retries: ['fetchArticle'] },
  { file: 'pages/admin/content/categories/index.vue', refs: ['error'], retries: ['fetchCategories'] },
  { file: 'pages/admin/content/content-types.vue', refs: ['error'], retries: ['fetchTypes'] },
  { file: 'pages/admin/content/pages/index.vue', refs: ['loadError'], retries: ['fetchPages'] },
  { file: 'pages/admin/content/pages/[id].vue', refs: ['loadError'], retries: ['fetchPage'] },
  { file: 'pages/admin/content/navigation/navbar.vue', refs: ['error'], retries: ['loadMenu'] },
  { file: 'pages/admin/content/navigation/mobile.vue', refs: ['error'], retries: ['loadMenu'] },

  // Chatbot.
  { file: 'pages/admin/chatbot/knowledge/index.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/chatbot/knowledge/[id].vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/chatbot/settings.vue', refs: ['errorMessage'], retries: ['load'] },
  { file: 'pages/admin/chatbot/sessions/index.vue', refs: ['loadError'], retries: ['fetchSessions'] },
  { file: 'pages/admin/chatbot/sessions/[id].vue', refs: ['loadError'], retries: ['fetchSession'] },

  // Users, media, submissions.
  { file: 'pages/admin/users/index.vue', refs: ['loadError'], retries: ['fetchUsers'] },
  { file: 'pages/admin/users/roles.vue', refs: ['error'], retries: ['fetchRoles'] },
  { file: 'pages/admin/users/activity.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/media/index.vue', refs: ['loadError'], retries: ['fetchMedia'] },
  { file: 'pages/admin/submissions/index.vue', refs: ['error'], retries: ['fetchSubmissions'] },

  // Views whose panels fail independently. Each ref is its own branch, so a
  // failed history load still leaves the password form usable.
  { file: 'pages/admin/profile.vue', refs: ['historyError', 'mfaError'], retries: ['loadHistory', 'loadMfa'] },
  {
    file: 'pages/admin/index.vue',
    refs: ['trafficError', 'liveError', 'sourceError', 'deviceError'],
    retries: ['loadTraffic', 'loadLive', 'loadBreakdowns'],
  },
  { file: 'pages/admin/analytics.vue', refs: ['summaryError', 'drillError'], retries: ['loadSummary', 'loadDrill'] },
]

test('every admin view that fetches keeps somewhere for a rejection to land', async () => {
  for (const { file, refs } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const script = sfc.descriptor.scriptSetup?.content ?? sfc.descriptor.script?.content ?? ''

    for (const ref of refs) {
      assert.match(
        script,
        new RegExp(`const ${ref}\\s*=\\s*ref\\(`),
        `${file} must declare ${ref} — without it a failed fetch falls through to the empty state`,
      )
    }
  }
})

test('the error state is rendered, not merely held in a ref', async () => {
  for (const { file, refs } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''

    for (const ref of refs) {
      // v-if is allowed as well as v-else-if: the dashboard's widgets each own a
      // branch chain, and profile.vue's panels are independent of one another.
      assert.match(
        template,
        new RegExp(`v-(else-)?if="${ref}`),
        `${file} holds ${ref} but never renders it — the officer sees the empty state instead of the failure`,
      )
    }
  }
})

test('the error branch is announced to assistive technology', async () => {
  for (const { file } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''

    assert.ok(
      template.includes('role="alert"'),
      `${file} must mark its error branch role="alert" — a sighted user sees red, a screen-reader user is told nothing`,
    )
  }
})

test('retry re-runs the failed fetch and is wired to a function in the same file', async () => {
  for (const { file, retries } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''
    const script = sfc.descriptor.scriptSetup?.content ?? sfc.descriptor.script?.content ?? ''

    for (const handler of retries) {
      // Both `@click="load"` and `@click="load()"` are correct Vue. The bare form
      // passes the MouseEvent as the first argument, which every one of these
      // handlers ignores because none of them declares a parameter. Pinning only
      // the parenthesised form would fail on working code.
      assert.match(
        template,
        new RegExp(`@click="${handler}(\\(|")`),
        `${file} must offer a retry that calls ${handler}()`,
      )
      // The handler has to be declared here. A @click bound to a name this file
      // never defines is a button that throws on press.
      assert.match(
        script,
        new RegExp(`(async\\s+)?function ${handler}\\s*\\(|const ${handler}\\s*=`),
        `${file} binds retry to ${handler}() but never defines it`,
      )
    }
  }
})

test('no admin view reaches for a full page reload as its retry', async () => {
  // The whole point of the contract. A reload throws away every other panel's
  // state and any unsaved form on the page to re-run one request.
  for (const { file } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    assert.ok(
      !/location\s*\.\s*reload\s*\(/.test(source),
      `${file} retries by reloading the page — call the page's own fetch instead so unsaved work survives`,
    )
    assert.ok(
      !/window\s*\.\s*location\s*=/.test(source),
      `${file} navigates instead of retrying — call the page's own fetch instead`,
    )
  }
})
