/**
 * Contract for the loading placeholders across the public site and the admin panel.
 *
 * LIMITATION — read this before trusting a green run. These assertions read the
 * SFC source text; they never mount a component. That means they can prove a
 * placeholder branch and its reduced-motion guard still EXIST in the file, and
 * they will fail loudly if someone deletes one while refactoring. They prove
 * nothing about whether the placeholder actually paints, occupies the right
 * footprint, or is announced correctly by a screen reader. Those checks need a
 * real browser: `npm run test:e2e` (tests/e2e/) drives Chromium against a
 * throwaway portal and covers the loading→error→content transition on two
 * representative pages. It does not cover every view listed below, so treat
 * this file as a guard against silent removal, not as evidence of correct
 * rendering.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = (relative: string) => readFile(new URL(`../app/${relative}`, import.meta.url), 'utf8')

/**
 * Decorative pulses: elements that animate to say "this is live right now",
 * not "content is on its way". They are deliberately exempt from the
 * reduced-motion guard rule because switching them off would remove the only
 * signal they carry, leaving a dot that means nothing (design.md D6). Each
 * entry names the file and what the pulse indicates, so an addition to this
 * list has to be argued for rather than slipped in.
 */
const DECORATIVE_PULSE_FILES: Record<string, string> = {
  'layouts/default.vue': 'hotline / support availability indicators (two sites)',
  'components/admin/AnalyticsLiveDashboard.client.vue': 'live-visitor heartbeat dot',
  'pages/admin/index.vue': '"Live" status badge dot on the realtime tile',
}

const SKELETON_COMPONENTS = [
  'components/skeleton/SkeletonTable.vue',
  'components/skeleton/SkeletonCards.vue',
  'components/skeleton/SkeletonForm.vue',
]

/**
 * Every view that must keep a loading branch. Sections 2, 4 and 5 of the change
 * each moved one of these from "renders nothing" or "renders a bare sentence"
 * to a shape-matched placeholder; without the pin, the next refactor can drop
 * one and no other test notices.
 */
const VIEWS_WITH_LOADING_BRANCH = [
  // Section 2 — public block-built pages. These render through PageRenderer,
  // which owns the placeholder behind its `pending` prop (design.md D3).
  { file: 'components/PageRenderer.vue', marker: 'v-if="pending"' },
  { file: 'pages/index.vue', marker: ':pending="pending"' },
  { file: 'pages/about.vue', marker: ':pending="pending"' },
  { file: 'pages/contact.vue', marker: ':pending="pending"' },
  { file: 'pages/[slug].vue', marker: ':pending="pending"' },

  // Section 4 — admin views that previously rendered their empty shell while loading.
  { file: 'pages/admin/users/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/users/roles.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/articles/[id].vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/profile.vue', marker: 'v-if="mfaLoading"' },

  // Section 5 — admin views that previously showed a bare text line or a spinner.
  { file: 'pages/admin/content/articles/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/submissions/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/users/activity.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/categories/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/content-types.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/chatbot/knowledge/index.vue', marker: 'v-if="loading"' },
  { file: 'components/admin/ChatbotSmallTalkPanel.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/media/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/general.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/email.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/media-storage.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/tracking.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/data-retention.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/chatbot/settings.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/chatbot/knowledge/[id].vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/pages/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/pages/[id].vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/navigation/navbar.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/content/navigation/mobile.vue', marker: 'v-if="loading"' },

  // Reader moderation and Google sign-in configuration.
  { file: 'pages/admin/readers/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/readers/[id].vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/comments/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/google-oauth.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/settings/ip-bans.vue', marker: 'v-if="loading"' },

  // Views that already had a loading branch but sat outside this guard, because
  // the list above names files and nobody added them. Found by the coverage gate
  // at the bottom of this file, not by reading — which is the point of having it.
  { file: 'components/admin/ProfileActivityHistory.vue', marker: 'v-if="historyLoading"' },
  { file: 'components/admin/MediaLibraryModal.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/chatbot/sessions/index.vue', marker: 'v-if="loading"' },
  { file: 'pages/admin/chatbot/sessions/[id].vue', marker: 'v-if="loading"' },

  // Dashboards whose panels load independently. Each tile owns its own branch, so
  // one slow query must not blank the other three.
  { file: 'pages/admin/index.vue', marker: 'v-if="liveLoading"' },
  { file: 'pages/admin/analytics.vue', marker: 'v-if="initialLoading"' },
]

/**
 * Admin views that fetch but deliberately show no skeleton.
 *
 * Named rather than skipped, so the coverage gate at the bottom treats anything
 * unlisted as a gap. Each reason has to answer "what does the operator see while
 * this request is in flight?".
 */
const NO_SKELETON_NEEDED: Record<string, string> = {
  // Fetches only on submit, and the button itself carries the pending state. A
  // skeleton would replace a form the user is still looking at.
  'pages/admin/login.vue': 'submit-time fetch; the button shows pending',
  // Fills a dropdown in the background. The field is usable throughout — it just
  // starts with "Tất cả" — so there is nothing to placeholder.
  'components/admin/builder/PropertyPanel.vue': 'background lookup behind an already-usable field',
  // Uploads on demand; TinyMCE renders its own progress UI for the transfer.
  'components/admin/TinyMceEditor.vue': 'upload progress belongs to the editor',
  // Polls on an interval and keeps the previous reading on screen between ticks,
  // which is strictly better than a placeholder: replacing live numbers with grey
  // boxes every few seconds would make a working dashboard look broken. Its
  // heartbeat dot is already an allowed decorative pulse above.
  'components/admin/AnalyticsLiveDashboard.client.vue': 'polls and keeps the last reading visible between ticks',
}

/** Files whose loading branch is drawn inline rather than by a shared component. */
const INLINE_PLACEHOLDER_FILES = [
  'components/PageRenderer.vue',
  'pages/admin/users/index.vue',
  'pages/admin/users/roles.vue',
  'pages/admin/content/articles/[id].vue',
  'pages/admin/profile.vue',
  'pages/admin/content/pages/[id].vue',
  'pages/admin/content/navigation/navbar.vue',
  'pages/admin/content/navigation/mobile.vue',
  // Reader moderation: a reader row is an avatar plus two stacked lines, a
  // comment row is a header plus a wrapped body, and the OAuth form is a mix of
  // text fields and a read-only URL block. SkeletonTable/Cards/Form describe
  // none of those, and forcing one in would produce a placeholder whose size
  // does not match what replaces it.
  'pages/admin/readers/index.vue',
  'pages/admin/readers/[id].vue',
  'pages/admin/comments/index.vue',
  'pages/admin/settings/google-oauth.vue',
  'pages/admin/settings/ip-bans.vue',
]

/**
 * Split a template into the individual tags that carry `animate-pulse`, so the
 * guard can be checked on the SAME element rather than merely somewhere in the
 * file. A file-wide search would pass on a file where one placeholder is
 * guarded and a second one is not.
 */
function tagsWithPulse(template: string): string[] {
  return (template.match(/<[^>]*animate-pulse[^>]*>/g) ?? [])
}

test('every animated placeholder stops animating under prefers-reduced-motion', async () => {
  const files = [
    ...SKELETON_COMPONENTS,
    ...VIEWS_WITH_LOADING_BRANCH.map((v) => v.file),
    // Public placeholders that predate this change and were retrofitted with the guard.
    'components/NewsCategoryList.vue',
    'components/ArticleDetail.vue',
    // The public comment thread's loading state.
    'components/ArticleComments.vue',
    'pages/legal-qa/index.vue',
    'pages/role-models/index.vue',
    'pages/reintegration-models/index.vue',
    'pages/news/index.vue',
    'pages/documents/index.vue',
    // NOTE: `pages/admin/index.vue` used to be appended here by hand. It is now in
    // VIEWS_WITH_LOADING_BRANCH above, so it arrives through the spread and must
    // NOT be repeated — the dashboard is BOTH seven real placeholders (metric
    // tiles, the 7-day chart and its ClientOnly fallback, the two donut panels)
    // AND one decorative "Live" badge dot, and the per-tag exemption below is what
    // keeps the dot out of the assertion.
  ]

  for (const file of files) {
    assert.ok(
      !(file in DECORATIVE_PULSE_FILES) || file === 'pages/admin/index.vue',
      `${file} cannot be both a loading placeholder and a decorative pulse`,
    )

    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''

    for (const tag of tagsWithPulse(template)) {
      // The one exempt element in this file is the "Live" badge dot, which is a
      // status indicator rather than a placeholder.
      if (file === 'pages/admin/index.vue' && tag.includes('rounded-full bg-[#2c6e33]')) continue

      assert.ok(
        tag.includes('motion-reduce:animate-none'),
        `${file} has an animate-pulse element without motion-reduce:animate-none: ${tag.slice(0, 140)}`,
      )
    }
  }
})

test('the decorative pulses stay exempt and stay documented', async () => {
  for (const [file, reason] of Object.entries(DECORATIVE_PULSE_FILES)) {
    const source = await read(file)
    assert.ok(
      source.includes('animate-pulse'),
      `${file} is listed as carrying a decorative pulse (${reason}) but no longer has one — remove it from the allowlist`,
    )
  }
})

test('the shared placeholder components exist and carry no scoped CSS', async () => {
  for (const file of SKELETON_COMPONENTS) {
    const source = await read(file)
    assert.ok(source.length > 0, `${file} must exist`)
    // Tailwind v3 utilities only — a <style> block here is how a placeholder
    // starts drifting away from the design system it is imitating.
    assert.ok(!source.includes('<style'), `${file} must not declare a <style> block`)
    assert.match(source, /animate-pulse/, `${file} must animate`)
    assert.match(source, /motion-reduce:animate-none/, `${file} must respect prefers-reduced-motion`)
  }
})

test('every pinned view still renders a loading branch', async () => {
  for (const { file, marker } of VIEWS_WITH_LOADING_BRANCH) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''

    assert.ok(
      template.includes(marker),
      `${file} must keep its loading branch (expected ${marker} in the template)`,
    )
  }
})

test('placeholder containers announce themselves as busy', async () => {
  const files = [...SKELETON_COMPONENTS, ...INLINE_PLACEHOLDER_FILES]

  for (const file of files) {
    const source = await read(file)
    const sfc = parse(source, { filename: file })
    const template = sfc.descriptor.template?.content ?? ''

    assert.ok(
      template.includes('role="status"') && template.includes('aria-busy="true"'),
      `${file} must mark its placeholder container with role="status" and aria-busy="true"`,
    )
    // The grey blocks themselves are meaningless noise to a screen reader; the
    // sr-only label is what carries the meaning.
    assert.ok(
      template.includes('aria-hidden="true"'),
      `${file} must hide its decorative placeholder blocks from assistive technology`,
    )
    assert.ok(
      template.includes('sr-only'),
      `${file} must give assistive technology a text description of what is loading`,
    )
  }
})

/**
 * COVERAGE GATE — same reasoning as the one in tests/admin-error-retry-ui.test.ts.
 *
 * Every assertion above runs over `VIEWS_WITH_LOADING_BRANCH`, a hand-written list
 * of paths, so it is green forever for any file nobody added. Measured, not
 * assumed: ten admin views that fetch were outside this guard, and six of them
 * already had a loading branch that simply went unenforced — including both
 * chat-session views, both dashboards, the media picker and the activity-history
 * panel. A contract nobody checks is a contract that quietly stops holding.
 *
 * So this walks the directories and demands every admin view that fetches is
 * EITHER pinned above OR named in `NO_SKELETON_NEEDED` with its reason.
 */
const FETCH_CALL = /\$fetch|useFetch\(|useAsyncData\(/

async function adminViewsThatFetch(): Promise<string[]> {
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

  for (const root of ['pages/admin', 'components/admin']) await walk(root)
  return found.sort()
}

test('every admin view that fetches is either pinned or exempt with a stated reason', async () => {
  const pinned = new Set(VIEWS_WITH_LOADING_BRANCH.map(view => view.file))
  const uncovered: string[] = []

  for (const file of await adminViewsThatFetch()) {
    if (pinned.has(file)) continue
    if (NO_SKELETON_NEEDED[file]) continue
    uncovered.push(file)
  }

  assert.deepEqual(
    uncovered,
    [],
    'these admin views fetch data but no loading contract covers them — pin them in '
    + 'VIEWS_WITH_LOADING_BRANCH, or name them in NO_SKELETON_NEEDED with the reason they '
    + 'need no placeholder. A hand-written list cannot fail on a file it has never heard of.',
  )
})

test('the skeleton exemption list has not gone stale', async () => {
  // The mirror failure: an entry that no longer fetches keeps passing and makes the
  // list read as wider coverage than it has.
  const fetching = new Set(await adminViewsThatFetch())
  const stale = Object.keys(NO_SKELETON_NEEDED).filter(file => !fetching.has(file))

  assert.deepEqual(
    stale,
    [],
    'exempt but no longer fetches — drop it from NO_SKELETON_NEEDED so the list keeps meaning something',
  )
})
