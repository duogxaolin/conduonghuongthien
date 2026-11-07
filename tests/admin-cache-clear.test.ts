/**
 * The "Xoá cache" button (`/admin` topbar + user dropdown) and its endpoint
 * `POST /api/admin/cache-clear`.
 *
 * Why this exists: every public route runs `swr: 60` (nuxt.config.ts
 * routeRules). An officer who edits content then opens the public page sees
 * the previous render for up to 60 seconds — which reads as "the site does not
 * update", the exact report that produced this feature. The button makes
 * invalidation explicit instead of leaving it to waiting.
 *
 * The endpoint deletes nothing from the database — it removes entries from
 * Nitro's `cache` storage namespace, group `nitro/routes` (the HTML of public
 * pages). Decisions 1–3 below are run for real in
 * tests/admin-cache-clear-behavior.test.ts; this file keeps only what is structure
 * (the route file's `.post` suffix) and the layout button (decision 4):
 *
 *   1. It is POST + `confirm: true` + RBAC `settings.update` — same three
 *      guards as `retention-run.post.ts`, the operational endpoint this one is
 *      modelled on. A cache purge reachable by GET would be triggerable by
 *      browser prefetch; a purge without RBAC would let any low-privilege
 *      account spam re-renders.
 *   2. It clears ONLY `nitro/routes` — not the whole `cache:` namespace. Other
 *      groups (favicon settings cache, future `nitro/functions` entries) have
 *      their own lifetimes; sweeping them is out of scope and could strip a
 *      cache whose invalidation path lives elsewhere.
 *   3. It writes one `activity_logs` row — an operational action with no audit
 *      trail is invisible exactly when someone asks "who just flushed it".
 *   4. The layout button disables while a request is in flight and reports
 *      through the shared toast — a double-clickable button would fire two
 *      purges, and a silent failure would read as "the button does nothing".
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { ADMIN_LAYOUT_FAMILY, familyTemplate, readAppFile } from './_component-family.ts'

const ROOT = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8')

describe('POST /api/admin/cache-clear — the guards are the endpoint', () => {
  const source = read('server/api/admin/cache-clear.post.ts')

  it('is POST-only by construction (file lives under a .post route)', () => {
    // The route path IS the method: cache-clear.post.ts answers POST, and a
    // GET to /api/admin/cache-clear is a 404 by Nitro routing. Renaming the
    // file without .post would silently open a GET path.
    assert.match(source, /defineEventHandler/, 'no handler at all?')
  })

  // confirm:true, the settings.update gate, clearing ONLY `nitro/routes` and the audit row are run
  // for real in tests/admin-cache-clear-behavior.test.ts (real admin-auth, real unstorage prefix).
})

describe('the layout surfaces the action where officers look for it', () => {
  // The admin layout was split (wave3 D-SPLIT): the top bar is `components/admin/layout/AdminTopBar.vue`,
  // so these read the templates of the whole layout family (tests/_component-family.ts). The
  // behaviour — one request, both buttons busy, the server's sentence — is mounted in
  // tests/admin-layout.test.ts.
  const template = familyTemplate(ADMIN_LAYOUT_FAMILY)

  it('topbar has the clear-cache button next to the user chip', () => {
    assert.match(template, /clearPublicCache/, 'no button calls the handler')
    assert.match(template, /Xoá cache/, 'the topbar button has no label')
    assert.match(template, /fa-broom/, 'no broom icon — the affordance is unreadable without one')
  })

  it('the user dropdown carries its own entry (the chip is hidden below sm:)', () => {
    // The topbar button sits inside a container that is visible on all sizes
    // only via its own spans; the dropdown entry guarantees a second, always-
    // discoverable path. Losing either one is a mobile-visible regression.
    const dropdownEntries = template.match(/Xoá cache Website/g) || []
    assert.equal(dropdownEntries.length, 1, 'the dropdown entry vanished (or duplicated)')
  })

  it('the button is disabled while a purge is in flight', () => {
    assert.match(template, /:disabled="isClearingCache"/, 'double-click can fire two purges')
  })

  it('proof: the family template is what is read — a second dropdown entry in a part, or the label gone, is caught', () => {
    const topBar = 'components/admin/layout/AdminTopBar.vue'
    const doubled = readAppFile(topBar).replace('<span>Đăng xuất</span>', '<span>Đăng xuất</span><span>Xoá cache Website</span>')
    assert.equal((familyTemplate(ADMIN_LAYOUT_FAMILY, { [topBar]: doubled }).match(/Xoá cache Website/g) || []).length, 2)
    const unlabelled = readAppFile(topBar).replaceAll('Xoá cache Website', 'Làm mới')
    assert.equal((familyTemplate(ADMIN_LAYOUT_FAMILY, { [topBar]: unlabelled }).match(/Xoá cache Website/g) || []).length, 0)
    const enabled = readAppFile(topBar).replaceAll(':disabled="isClearingCache"', '')
    assert.doesNotMatch(familyTemplate(ADMIN_LAYOUT_FAMILY, { [topBar]: enabled }), /:disabled="isClearingCache"/)
  })
})
