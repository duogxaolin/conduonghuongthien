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
import { readFile, readdir } from 'node:fs/promises'
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
  { file: 'pages/admin/settings/google-oauth.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/settings/ip-bans.vue', refs: ['error'], retries: ['load'] },

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

  // Reader moderation. These read citizens' personal data, so a failed fetch
  // rendering as "chưa có ai" is worse than usual: an officer would conclude
  // nobody has signed up rather than that the query broke.
  { file: 'pages/admin/readers/index.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/readers/[id].vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/comments/index.vue', refs: ['error'], retries: ['load'] },

  // Users, media, submissions.
  { file: 'pages/admin/users/index.vue', refs: ['loadError'], retries: ['fetchUsers'] },
  { file: 'pages/admin/users/roles.vue', refs: ['error'], retries: ['fetchRoles'] },
  { file: 'pages/admin/users/activity.vue', refs: ['error'], retries: ['load'] },
  { file: 'pages/admin/media/index.vue', refs: ['loadError'], retries: ['fetchMedia'] },
  { file: 'pages/admin/submissions/index.vue', refs: ['error'], retries: ['fetchSubmissions'] },

  // Views whose panels fail independently. Each ref is its own branch, so a
  // failed history load still leaves the password form usable.
  // The activity-history panel moved into its own component; the contract
  // followed it rather than being dropped. profile.vue keeps only the MFA panel.
  { file: 'pages/admin/profile.vue', refs: ['mfaError'], retries: ['loadMfa'] },
  { file: 'components/admin/ProfileActivityHistory.vue', refs: ['historyError'], retries: ['loadHistory'] },
  {
    file: 'pages/admin/index.vue',
    refs: ['trafficError', 'liveError', 'sourceError', 'deviceError'],
    retries: ['loadTraffic', 'loadLive', 'loadBreakdowns'],
  },
  { file: 'pages/admin/analytics.vue', refs: ['summaryError', 'drillError'], retries: ['loadSummary', 'loadDrill'] },

  // Components that fetch on their own. These were outside this guard entirely
  // until the coverage gate below was added — the list above names page files, so
  // a fetch living in a component was invisible to it no matter how load-bearing.
  //
  // Each of the three failed differently, which is why they are listed and not
  // fixed in bulk:
  //   - MediaLibraryModal had NO error branch. A failed load showed a 4-second
  //     toast and then "Chưa có ảnh nào. Hãy tải ảnh lên!" — the officer reads an
  //     empty library and re-uploads a file that is already there. That is the
  //     exact failure this whole contract exists to prevent, sitting in the one
  //     surface used from every editor screen.
  //   - ChatbotSmallTalkPanel held an error and rendered it, but offered no way
  //     out: the message stayed on screen until the next page load.
  //   - AnalyticsLiveDashboard already had all three branches and all three retry
  //     buttons; it was missing only role="alert", so a screen-reader user was
  //     told nothing while a sighted user saw amber.
  { file: 'components/admin/MediaLibraryModal.vue', refs: ['loadError'], retries: ['fetchMedia'] },
  { file: 'components/admin/ChatbotSmallTalkPanel.vue', refs: ['error'], retries: ['load'] },
  // The submission detail modal fetches the processing log on open — the list
  // table does not carry it (an N+1 query for a column nobody reads on the
  // table). A failed load here is the worst kind for this resource: the officer
  // sees a citizen's record with no history and concludes nobody has touched it,
  // which is precisely the question the log exists to answer.
  { file: 'components/admin/SubmissionDetailModal.vue', refs: ['error'], retries: ['load'] },
  {
    file: 'components/admin/AnalyticsLiveDashboard.client.vue',
    refs: ['livePanelError', 'breakdownPanelError', 'nocPanelError'],
    retries: ['retryLivePanel', 'retryBreakdownPanel', 'retryNocPanel'],
  },
]

/**
 * Admin views that fetch but deliberately carry no error/retry contract.
 *
 * Named here rather than skipped, because the coverage gate below treats any
 * unlisted fetcher as a gap. Each reason has to survive the question "what does
 * the operator see when this request fails?".
 */
const NO_CONTRACT_NEEDED: Record<string, string> = {
  // The retry IS the submit button. A failed sign-in already renders its reason in
  // two role="alert" branches; adding a separate "thử lại" would re-post the same
  // credentials, which is the same action the form already offers.
  'pages/admin/login.vue': 'the form submit is the retry',
  // Swallows its failure into an empty category list on purpose, so the field
  // falls back to "Tất cả" and the block stays editable. There is no error state
  // to render — a failed lookup degrades a dropdown, it does not blank a page.
  'components/admin/builder/PropertyPanel.vue': 'failure degrades to an empty dropdown, nothing to retry',
  // Rejects the upload promise back to TinyMCE, which shows the failure in its own
  // dialog and keeps the file selected so the user can press upload again. Holding
  // a second copy of that state here would let the two disagree.
  'components/admin/TinyMceEditor.vue': 'rejects to the editor, which owns the retry affordance',
}

test('every admin view that fetches keeps somewhere for a rejection to land', async () => {
  for (const { file, refs } of VIEWS_WITH_ERROR_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const script = sfc.descriptor.scriptSetup?.content ?? sfc.descriptor.script?.content ?? ''

    for (const ref of refs) {
      // `computed(` counts as well as `ref(`. AnalyticsLiveDashboard derives its
      // three panel errors from poller state rather than holding them separately,
      // which is the better shape — one source of truth per panel instead of a
      // copy that can drift. Pinning only `ref(` would have failed working code
      // and pushed whoever hit it toward duplicating the state to satisfy a test.
      assert.match(
        script,
        new RegExp(`const ${ref}\\s*=\\s*(ref|computed)\\(`),
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

/**
 * COVERAGE GATE — the part that makes the list above stop being a blind spot.
 *
 * Everything before this point asserts against `VIEWS_WITH_ERROR_BRANCH`, which is
 * a hand-written list of paths. A list is green forever for any file nobody thought
 * to add to it: a new admin page that fetches, renders an empty state on failure
 * and offers no way out passes every assertion above by simply not being mentioned.
 * That is not hypothetical — it was measured on this very file. Five admin
 * components fetched data and only one of them was listed, so the contract was
 * unenforced on `MediaLibraryModal` (a failed fetch read as "Chưa có ảnh nào. Hãy
 * tải ảnh lên!"), on `ChatbotSmallTalkPanel` (error branch, no way to retry it)
 * and on all three panels of `AnalyticsLiveDashboard` (no `role="alert"`).
 *
 * So this walks the directories instead of trusting the list, and demands that
 * every admin view which fetches is EITHER covered above OR named in
 * `NO_CONTRACT_NEEDED` with the reason it genuinely needs no error branch. Adding
 * a new admin view now forces that choice — there is no silent third option.
 *
 * Same shape as the directory-scanning guards in tests/reader-audit-atomicity.ts
 * and tests/client-ip.test.ts, and for the same reason.
 */
const FETCH_CALL = /\$fetch|useFetch\(|useAsyncData\(/

async function adminViewsThatFetch(): Promise<string[]> {
  const roots = ['pages/admin', 'components/admin']
  const found: string[] = []

  const walk = async (relative: string) => {
    const dir = new URL(`../app/${relative}`, import.meta.url)
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      if (!entry.name.endsWith('.vue')) continue
      if (FETCH_CALL.test(await read(child))) found.push(child)
    }
  }

  for (const root of roots) await walk(root)
  return found.sort()
}

test('every admin view that fetches is either covered or exempt with a stated reason', async () => {
  const listed = new Set(VIEWS_WITH_ERROR_BRANCH.map(view => view.file))
  const uncovered: string[] = []

  for (const file of await adminViewsThatFetch()) {
    if (listed.has(file)) continue
    if (NO_CONTRACT_NEEDED[file]) continue
    uncovered.push(file)
  }

  assert.deepEqual(
    uncovered,
    [],
    'these admin views fetch data but no error/retry contract covers them — add them to '
    + 'VIEWS_WITH_ERROR_BRANCH, or to NO_CONTRACT_NEEDED with the reason they need none. '
    + 'A hand-written list is green forever for files it has never heard of; this gate '
    + 'scans the directory precisely because of that.',
  )
})

test('neither list has drifted from what is on disk', async () => {
  // A stale entry is the mirror failure: it keeps passing against a file that no
  // longer fetches (or no longer exists), so the list reads as broader coverage
  // than it has. `ProfileActivityHistory.vue` was listed while a grep for fetch
  // calls missed it, which is what prompted checking both directions.
  const fetching = new Set(await adminViewsThatFetch())

  const staleExemptions = Object.keys(NO_CONTRACT_NEEDED).filter(file => !fetching.has(file))
  assert.deepEqual(
    staleExemptions,
    [],
    'exempt but no longer fetches — drop it from NO_CONTRACT_NEEDED so the list keeps meaning something',
  )
})
