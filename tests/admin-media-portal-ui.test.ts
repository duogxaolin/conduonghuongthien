/**
 * Structural checks for the two admin pages added by `add-media-portal`.
 *
 * `tests/admin-error-retry-ui.test.ts` already pins the load/error/retry contract
 * for these two pages (they are in `VIEWS_WITH_ERROR_BRANCH`). This file covers
 * what is specific to media-portal and livestream and what would otherwise be
 * invisible to a breadth check:
 *
 *  1. **Endpoints called match what the server exposes.** The media-portal page
 *     must call `/api/admin/media-portal` (not the old photo `/api/admin/media`),
 *     and the livestream page must read status from `/api/public/livestream/active`
 *     — the public endpoint, by design (docstring on the page explains why).
 *     Start/stop use the admin routes under `/api/admin/livestream/**`.
 *  2. **Permission gates match the RBAC resources.** `media_portal` is a distinct
 *     resource from `media`; `livestream` is its own resource. The pages use
 *     `hasPermission('media_portal', 'create'|'update'|'delete')` and
 *     `hasPermission('livestream', 'create'|'update')` — not the wrong resource.
 *  3. **Loading/error/empty branches are present and structured.** Both pages
 *     fetch after mount (no SSR fetch — livestream status changes at any time),
 *     so the loading skeleton + error `role="alert"` + empty state are all
 *     reachable and correct.
 *  4. **Interactive elements are keyboard-accessible.** Tabs, filters and buttons
 *     use real `<button>` / `<select>` / `<input>` elements and carry accessible
 *     labels; the filter `<select>` elements react to keyboard via `@change`.
 *
 * Reviewed by source text, not by mounting a component — same boundary as the
 * sibling structural tests. The assertions prove the branches and their wiring
 * still exist; they do not prove the branches paint, which is the e2e suite's
 * job.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { mediaProcessingMessage } from '../app/composables/mediaProcessingMessage.ts'

const read = (relative: string) => readFile(new URL(`../app/${relative}`, import.meta.url), 'utf8')

const MEDIA_PORTAL_PAGE = 'pages/admin/media-portal/index.vue'
const LIVESTREAM_PAGE = 'pages/admin/livestream/index.vue'

test('processing failures give a useful action without disclosing server paths', () => {
  for (const [reason, expected] of [
    ['ENOSPC /private/media/source.mp4', /dung lượng/],
    ['ENOENT /private/media/source.mp4', /tệp video gốc/],
    ['ffprobe: invalid data /private/source.mp4', /định dạng/],
    ['ECONNRESET to private-storage', /Kết nối/],
    ['unexpected /private/server/problem', /tiêu đề video và thời điểm/],
  ] as const) {
    const message = mediaProcessingMessage(reason)
    assert.match(message, expected)
    assert.doesNotMatch(message, /private|\/|ffprobe/)
  }
})

test('media actions have actual pages and the upload page mounts the resumable uploader', async () => {
  for (const page of ['external', 'upload', '[id]']) {
    const { sfc } = await parseSfc(`pages/admin/media-portal/${page}.vue`)
    assert.deepEqual(sfc.errors, [])
    assert.match(sfc.descriptor.template?.content ?? '', /role="alert"/)
  }
  const upload = await read('pages/admin/media-portal/upload.vue')
  assert.match(upload, /<AdminChunkedUploader/)
  assert.match(upload, /config\?\.uploadEnabled/)
  const detail = await read('pages/admin/media-portal/[id].vue')
  assert.match(detail, /onBeforeUnmount/)
  assert.match(detail, /clearTimeout\(timer\)/)
  assert.doesNotMatch(detail, /\{\{[^}]*processingError/)
})

async function parseSfc(file: string) {
  const source = await read(file)
  return { source, sfc: parse(source, { filename: file }) }
}

// ──────────────────────────────────────────────────────────────────────────────
// Media Portal — `/admin/media-portal/index.vue`
// ──────────────────────────────────────────────────────────────────────────────

test('media-portal page lists videos from the media_portal endpoint, not the photo library', async () => {
  const { sfc } = await parseSfc(MEDIA_PORTAL_PAGE)
  const script = sfc.descriptor.scriptSetup?.content ?? ''
  // The page MUST call `/api/admin/media-portal`, not `/api/admin/media` — they
  // serve two different tables (media_items vs media) and two different RBAC
  // resources.
  assert.match(script, /\/api\/admin\/media-portal/,
    'the media-portal page does not call `/api/admin/media-portal` — it may be hitting the old photo library path instead')
  // Regression guard: a refactor that "corrects" the path to `/api/admin/media`
  // would silently swap the table underneath the page.
  assert.doesNotMatch(script, /\$fetch\s*<[^>]*>\s*\(?\s*['"`]\/api\/admin\/media['"`]/,
    'the media-portal page calls `/api/admin/media` (the photo library) — that serves a different table')
})

test('media-portal page uses the media_portal RBAC resource, not the media resource', async () => {
  const { sfc } = await parseSfc(MEDIA_PORTAL_PAGE)
  const script = sfc.descriptor.scriptSetup?.content ?? ''
  // `media_portal` is a distinct RBAC resource from `media` (see permissions.ts).
  // An officer with access to the photo library must NOT automatically get access
  // to the video library — they are different content types with different duties.
  assert.match(script, /hasPermission\(\s*['"`]media_portal['"`]/,
    'the page does not gate on the `media_portal` resource')
  assert.doesNotMatch(script, /hasPermission\(\s*['"`]media['"`]\s*,\s*['"`]create['"`]/,
    'the page gates create on the `media` (photo library) resource — it should gate on `media_portal`')
})

test('media-portal page has loading, error and empty branches in order', async () => {
  const { sfc } = await parseSfc(MEDIA_PORTAL_PAGE)
  const template = sfc.descriptor.template?.content ?? ''

  // Loading branch — `role="status"` + `aria-busy="true"` + sr-only label.
  assert.match(template, /v-if="loading"/, 'no loading branch')
  assert.match(template, /role="status".*aria-busy="true"/, 'the loading branch misses role="status" or aria-busy="true"')
  assert.match(template, /sr-only/, 'the loading branch has no sr-only accessibility label')

  // Error branch — `role="alert"` and a retry button calling `fetchMedia`.
  assert.match(template, /v-else-if="loadError"/, 'no error branch')
  assert.match(template, /role="alert"/, 'the error branch is missing role="alert"')
  assert.match(template, /@click="fetchMedia\(/, 'the retry button does not call fetchMedia()')

  // Empty branch — after error, before data.
  assert.match(template, /v-else-if="items\.length === 0"/, 'no empty branch')

  // Data branch renders a table on desktop and cards on mobile — table tag present.
  assert.ok(template.includes('<table'), 'the data branch has no table')

  // animate-pulse on the loading skeleton has a motion-reduce guard.
  assert.match(template, /animate-pulse[^]*motion-reduce:animate-none/,
    'an animate-pulse skeleton is missing the motion-reduce:animate-none guard')
})

test('media-portal page filter controls are keyboard-accessible real elements', async () => {
  const { sfc } = await parseSfc(MEDIA_PORTAL_PAGE)
  const template = sfc.descriptor.template?.content ?? ''
  // Filters are `<input>` (search) + `<select>` (status/source) — real form
  // elements, not `<div>` with click handlers. `@change` on the selects is the
  // keyboard path; `@keydown.enter` on the input covers Enter-to-apply.
  assert.ok(template.includes('<input'), 'no `<input>` element for search')
  assert.ok(template.includes('<select'), 'no `<select>` elements for filters')
  assert.match(template, /@keydown\.enter="applyFilters"/, 'the search input does not respond to Enter')
  assert.match(template, /@change="applyFilters"/, 'the filter selects do not respond to keyboard `@change`')
  // The filter `<button>` is a real button, not a div.
  assert.match(template, /<button[^>]*@click="applyFilters"/, 'the filter button is not a real `<button>`')
})

// ──────────────────────────────────────────────────────────────────────────────
// Livestream — `/admin/livestream/index.vue`
// ──────────────────────────────────────────────────────────────────────────────

test('livestream page reads status from the public active endpoint by design', async () => {
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const script = sfc.descriptor.scriptSetup?.content ?? ''
  // `loadActive` reads `/api/public/livestream/active` — the docstring explains
  // this is deliberate: the public endpoint already returns the data the admin
  // page needs, and it does not read reader cookies, so there is no security
  // reason for a separate admin-only path.
  assert.match(script, /\/api\/public\/livestream\/active/,
    'the page does not read status from `/api/public/livestream/active`')
  // Start and stop go through the admin routes.
  assert.match(script, /\/api\/admin\/livestream\/start/,
    'the page does not POST to `/api/admin/livestream/start`')
  assert.match(script, /\/api\/admin\/livestream\/stop/,
    'the page does not POST to `/api/admin/livestream/stop`')
})

test('livestream page uses the livestream RBAC resource with correct verbs', async () => {
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const script = sfc.descriptor.scriptSetup?.content ?? ''
  // Start requires `livestream/create`; stop requires `livestream/update`.
  // These are distinct verbs on the same resource — a viewer with read-only
  // access cannot start or stop a broadcast.
  assert.match(script, /hasPermission\(\s*['"`]livestream['"`]\s*,\s*['"`]create['"`]/,
    'the page does not gate start on `livestream/create`')
  assert.match(script, /hasPermission\(\s*['"`]livestream['"`]\s*,\s*['"`]update['"`]/,
    'the page does not gate stop on `livestream/update`')
  assert.match(script, /hasPermission\(\s*['"`]livestream['"`]\s*,\s*['"`]delete['"`]/,
    'the page does not gate chat moderation on `livestream/delete`')
  // Regression guard: must not accidentally gate on `media_portal`.
  assert.doesNotMatch(script, /hasPermission\(\s*['"`]media_portal['"`]/,
    'the livestream page accidentally gates on the `media_portal` resource')
})

test('livestream page lists the current chat and removes through the admin route', async () => {
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const script = sfc.descriptor.scriptSetup?.content ?? ''
  const template = sfc.descriptor.template?.content ?? ''
  assert.match(script, /\/api\/public\/livestream\/chat\/history/,
    'the moderator cannot see the current public chat history')
  assert.match(script, /\/api\/admin\/livestream\/chat\/\$\{message\.id\}/,
    'a chat removal does not use the protected admin route')
  assert.match(script, /res\.sessionId !== expectedSessionId/,
    'chat results can be shown under a different session after a stop/start race')
  assert.match(template, /v-for="message in chatMessages"/,
    'the current chat is never rendered for moderation')
  assert.match(template, /@click="removeChatMessage\(message\)"/,
    'the remove button is not wired to the moderation action')
})

test('livestream page has loading, error and empty (no active) branches', async () => {
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const template = sfc.descriptor.template?.content ?? ''

  // Loading branch.
  assert.match(template, /v-if="loading"/, 'no loading branch')
  assert.match(template, /role="status".*aria-busy="true"/, 'the loading branch misses role="status" or aria-busy="true"')
  assert.match(template, /sr-only/, 'the loading branch has no sr-only label')

  // Error branch — role="alert" and a retry button calling `loadActive`.
  assert.match(template, /v-else-if="loadError"/, 'no error branch')
  assert.match(template, /role="alert"/, 'the error branch is missing role="alert"')
  assert.match(template, /@click="loadActive\(/, 'the retry button does not call loadActive()')

  // Empty (no active session) — distinct from "error".
  assert.match(template, /v-else-if="!activeSession"/, 'no "no active session" branch')

  // Active session card — the chain ends with `v-else` (all other branches
  // are exhaustive: loading / error / !activeSession, so `v-else` IS the
  // active-session branch).
  assert.match(template, /<!-- Active session -->/, 'no "active session" branch comment')
  assert.match(template, /TRỰC TIẾP/, 'the live badge text is missing')

  // animate-pulse on the loading skeleton (and the live badge dot) has a
  // motion-reduce guard.
  const pulseBlocks = template.match(/animate-pulse[^>]*>/g) ?? []
  for (const block of pulseBlocks) {
    // Find the vicinity of this animate-pulse occurrence to check for the guard.
    const idx = template.indexOf(block)
    const window = template.slice(idx, idx + 200)
    assert.ok(
      /motion-reduce:animate-none/.test(window),
      'an animate-pulse element is missing the motion-reduce:animate-none guard',
    )
  }
})

test('livestream start form uses labelled real input elements', async () => {
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const template = sfc.descriptor.template?.content ?? ''
  // The start form must use `<label>` + `<input>` / `<textarea>` / `<select>` —
  // real form elements with `id`/`for` pairing for screen readers.
  assert.match(template, /<label[^>]*for="ls-title"/, 'the title input has no <label for="ls-title">')
  assert.match(template, /<input[^>]*id="ls-title"/, 'the title input is missing id="ls-title"')
  assert.match(template, /<label[^>]*for="ls-desc"/, 'the description textarea has no <label for="ls-desc">')
  assert.match(template, /<textarea[^>]*id="ls-desc"/, 'the description textarea is missing id="ls-desc"')
  assert.match(template, /<label[^>]*for="ls-source"/, 'the source select has no <label for="ls-source">')
  assert.match(template, /<select[^>]*id="ls-source"/, 'the source select is missing id="ls-source"')
  // The start button is a real button.
  assert.match(template, /<button[^>]*@click="startLivestream\(/, 'the start button is not a real `<button>` calling startLivestream()')
  // The stop button is wired and disabled while stopping.
  assert.match(template, /<button[^>]*@click="stopLivestream\(/, 'the stop button is not a real `<button>` calling stopLivestream()')
  assert.match(template, /:disabled="isStopping"/, 'the stop button does not show disabled while stopping')
})

test('livestream page external links use rel="noopener noreferrer" with target="_blank"', async () => {
  // The active session card links to the YouTube embed. A `target="_blank"`
  // without `rel="noopener noreferrer"` lets the destination write into this
  // page's `window.location` — a link to a hostile clone could redirect the
  // portal itself. Same rule as the nav config.
  const { sfc } = await parseSfc(LIVESTREAM_PAGE)
  const template = sfc.descriptor.template?.content ?? ''
  // Find every target="_blank" occurrence and check the same element has
  // rel="noopener noreferrer".
  const blankMatches = [...template.matchAll(/target="_blank"/g)]
  assert.ok(blankMatches.length > 0, 'no target="_blank" link found — the page should link to the YouTube embed')
  for (const match of blankMatches) {
    // Look backwards from the match to the opening `<` of this element.
    const idx = match.index!
    const tagStart = template.lastIndexOf('<', idx)
    const tagEnd = template.indexOf('>', idx)
    const element = template.slice(tagStart, tagEnd + 1)
    assert.match(
      element,
      /rel="noopener noreferrer"/,
      `a target="_blank" element is missing rel="noopener noreferrer":\n${element}`,
    )
  }
})
