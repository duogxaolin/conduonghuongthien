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
import { readFile } from 'node:fs/promises'
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
]

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
    'pages/legal-qa/index.vue',
    'pages/role-models/index.vue',
    'pages/reintegration-models/index.vue',
    'pages/news/index.vue',
    'pages/documents/index.vue',
    // The dashboard is BOTH: seven real loading placeholders (metric tiles, the
    // 7-day chart and its ClientOnly fallback, the two donut panels) plus one
    // decorative "Live" badge dot. It has to be scanned here or those seven go
    // unenforced; the per-tag exemption below is what keeps the dot out of it.
    'pages/admin/index.vue',
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
