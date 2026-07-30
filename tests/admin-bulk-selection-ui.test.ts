/**
 * Contract for the bulk-selection UI across the admin lists.
 *
 * Eight pages had to be edited by hand to gain the same three parts: a header
 * checkbox that selects the visible rows, a checkbox on each row, and the action
 * strip. Copying that by hand is exactly the kind of work where one page quietly
 * ends up missing a piece — most likely the mobile card branch, which is
 * invisible on a desktop browser.
 *
 * These assertions read the SFCs rather than rendering them: there is no
 * component test harness in this project, and the thing worth guarding is
 * structural (every list has the parts, wired to the shared composable) rather
 * than behavioural.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

type Page = {
  /** Path under app/pages/admin/. */
  file: string
  /** The bulk endpoints this page must call. */
  endpoints: string[]
  /**
   * How many separate row-checkbox sites the template must have. More than one
   * means the page renders its rows twice — a desktop table plus a mobile card
   * list, or a two-level tree — and every branch needs its own checkbox.
   */
  rowCheckboxSites: number
}

const pages: Page[] = [
  {
    file: 'content/articles/index.vue',
    endpoints: ['/api/admin/articles/bulk-delete', '/api/admin/articles/bulk-status'],
    // Desktop table + mobile cards.
    rowCheckboxSites: 2,
  },
  {
    file: 'chatbot/knowledge/index.vue',
    endpoints: ['/api/admin/chatbot/knowledge/bulk-delete', '/api/admin/chatbot/knowledge/bulk-status', '/api/admin/chatbot/knowledge/bulk-quick-question'],
    rowCheckboxSites: 1,
  },
  {
    file: 'content/categories/index.vue',
    endpoints: ['/api/admin/categories/bulk-delete'],
    // Root + child rows in the table, root + child in the mobile cards.
    rowCheckboxSites: 4,
  },
  {
    file: 'content/content-types.vue',
    endpoints: ['/api/admin/content-types/bulk-delete'],
    rowCheckboxSites: 1,
  },
  {
    file: 'content/pages/index.vue',
    endpoints: ['/api/admin/pages/bulk-delete'],
    rowCheckboxSites: 1,
  },
  {
    file: 'users/index.vue',
    endpoints: ['/api/admin/users/bulk-delete', '/api/admin/users/bulk-active'],
    rowCheckboxSites: 2,
  },
  {
    file: 'submissions/index.vue',
    endpoints: ['/api/admin/submissions/bulk-delete'],
    rowCheckboxSites: 2,
  },
  {
    file: 'media/index.vue',
    endpoints: ['/api/admin/media/bulk-delete'],
    // A card grid rather than a table: one checkbox site, on the card.
    rowCheckboxSites: 1,
  },
]

const sources = new Map<string, { script: string; template: string }>()
for (const page of pages) {
  const source = await readFile(new URL(`../app/pages/admin/${page.file}`, import.meta.url), 'utf8')
  const sfc = parse(source, { filename: page.file })
  sources.set(page.file, {
    script: sfc.descriptor.scriptSetup?.content ?? '',
    template: sfc.descriptor.template?.content ?? '',
  })
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

test('every admin list wires selection through the shared composable', () => {
  for (const page of pages) {
    const { script } = sources.get(page.file)!

    assert.match(script, /useBulkSelection\(\)/, `${page.file} must build its selection with useBulkSelection`)
    assert.match(script, /useBulkAction\(selection\)/, `${page.file} must run bulk requests through useBulkAction`)
    // Per-page reimplementations of the Set juggling are what the composable exists to prevent.
    assert.doesNotMatch(script, /new Set<number>\(/, `${page.file} should not hand-roll selection state`)

    assert.match(script, /const visibleIds = computed\(/, `${page.file} must derive its selectable ids from what is on screen`)

    for (const endpoint of page.endpoints) {
      assert.ok(script.includes(endpoint), `${page.file} must call ${endpoint}`)
    }

    // Every bulk call goes through a confirm — none of these actions is undoable.
    assert.match(script, /confirm: \{/, `${page.file} must confirm before a bulk action`)
  }
})

test('every admin list renders a header checkbox, row checkboxes and the action strip', () => {
  for (const page of pages) {
    const { template } = sources.get(page.file)!

    assert.match(
      template,
      /selection\.toggleAll\(visibleIds\)/,
      `${page.file} must offer a select-all control over the visible rows`,
    )
    assert.match(
      template,
      /selection\.allSelected\(visibleIds\)/,
      `${page.file} must reflect the all-selected state`,
    )
    // Without this the header box reads as empty while some rows are ticked.
    assert.match(
      template,
      /selection\.someSelected\(visibleIds\)/,
      `${page.file} must show the indeterminate state`,
    )

    assert.match(template, /<AdminBulkActionBar/, `${page.file} must render the bulk action bar`)
    assert.match(
      template,
      /v-if="selection\.count\.value"/,
      `${page.file} must hide the action bar when nothing is selected`,
    )
    assert.match(template, /@clear="selection\.clear\(\)"/, `${page.file} must let the operator drop the selection`)
  }
})

test('a page that renders its rows more than once has a checkbox in every branch', () => {
  for (const page of pages) {
    const { template } = sources.get(page.file)!
    const toggles = countOccurrences(template, 'selection.toggle(Number(')

    assert.equal(
      toggles,
      page.rowCheckboxSites,
      `${page.file} should have ${page.rowCheckboxSites} row-checkbox site(s), found ${toggles}. ` +
      'A missing one usually means the mobile card branch was skipped, which hides the feature on phones.',
    )
  }
})

test('the selection is narrowed to the rows still on screen after a reload or filter change', () => {
  for (const page of pages) {
    const { script } = sources.get(page.file)!
    assert.match(
      script,
      /selection\.keepOnly\(/,
      `${page.file} must drop ids that are no longer visible — a stale id from page 2 must not be deletable from page 1`,
    )
  }
})

test('rows the server would refuse are not selectable', () => {
  // Offering a checkbox on a row that can only ever come back as a failure is a
  // trap, so these three pages filter their selectable set.
  const { script: contentTypes } = sources.get('content/content-types.vue')!
  assert.match(
    contentTypes,
    /!ct\.isSystem/,
    'content-types must exclude system types, which can never be deleted',
  )

  const { script: pagesScript } = sources.get('content/pages/index.vue')!
  assert.match(pagesScript, /!p\.isSystem/, 'pages must exclude system pages')

  const { script: users } = sources.get('users/index.vue')!
  assert.match(users, /systemRoleIds/, 'users must exclude accounts in a system role')
  assert.match(
    users,
    /currentUser/,
    "users must exclude the operator's own account, which the server refuses to delete",
  )
})

test('the shared composable reports partial results honestly', async () => {
  const source = await readFile(new URL('../app/composables/useBulkSelection.ts', import.meta.url), 'utf8')

  // The important case: 19 of 20 deleted is not a success, and the operator has
  // to be told which one was skipped and why.
  assert.match(source, /tone: 'warning'/, 'a partial result must be reported as a warning')
  assert.match(source, /succeededIds/, 'only the ids the server accepted may leave the selection')
  assert.match(source, /new Set\(reasons\)/, 'repeated failure reasons should collapse into one sentence')
})
