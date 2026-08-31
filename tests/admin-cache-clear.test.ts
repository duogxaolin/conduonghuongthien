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
 * pages). What a source-text test can pin without a running Nitro is the set of
 * decisions a refactor could quietly invert:
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
import { parse } from '@vue/compiler-sfc'

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

  it('requires explicit confirm:true, not a stray click', () => {
    assert.match(source, /body\?\.confirm !== true/, 'the confirm gate disappeared')
    assert.match(source, /statusCode: 400/, 'a missing confirm must be a 400')
  })

  it('gates on settings.update RBAC, not on nothing', () => {
    assert.match(
      source,
      /requireResourcePermission\(admin, 'settings', 'update'\)/,
      'cache invalidation must sit behind settings.update — any lower and a viewer account can spam re-renders, any higher and officers who edit content cannot see their edits',
    )
  })

  it('clears ONLY the nitro/routes group, not the whole cache namespace', () => {
    assert.match(source, /getKeys\('nitro\/routes'\)/, 'must list only the route cache group')
    assert.doesNotMatch(
      source,
      /getKeys\(\s*\)/,
      'a bare getKeys() sweeps every cache group — favicon settings and future function caches have their own invalidation paths',
    )
  })

  it('writes one audit row naming who flushed and how much', () => {
    assert.match(source, /activityLogs/, 'no audit insert at all')
    assert.match(source, /clearedKeys/, 'the row must record the number of entries cleared')
    assert.match(source, /clear_swr_cache/, 'the row must name the operation')
  })
})

describe('the layout surfaces the action where officers look for it', () => {
  const { descriptor } = parse(read('app/layouts/admin.vue'))
  const template = descriptor?.template?.content || ''

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
})
