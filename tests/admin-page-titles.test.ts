/**
 * The top bar of the admin shell names the current page from `adminPageTitle(route.name,
 * route.params)` (app/utils/admin-layout-menu.ts). A page missing from its map fell back to the
 * route name made readable — "/admin/settings/sitemap" showed "settings sitemap", and 20 other
 * admin pages the same way (22 entries added for those 21 pages: the knowledge editor also got
 * its `-new` one). This walks every page under `app/pages/admin/` that uses the admin
 * layout, derives the route name the way Nuxt does (`index` dropped, `[id]` → `id`, path
 * segments joined by `-`), and fails on any page whose title is still that fallback.
 *
 * A `[id].vue` page that also serves `/new` (`route.params.id === 'new'`) is one route name for
 * both modes, so its create mode must have its own `<base>-new` title — "Viết bài mới" was shown
 * as "Chỉnh sửa bài viết" because the `-new` entry could never match a route name.
 *
 * The mounted layout is tests/admin-layout.test.ts; this one only reads files and calls the pure
 * function.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { adminPageTitle } from '../app/utils/admin-layout-menu.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGES = path.join(ROOT, 'app/pages')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(full)
    return entry.name.endsWith('.vue') ? [full] : []
  })
}

/** Nuxt's route name for a page file: `admin/content/articles/[id].vue` → `admin-content-articles-id`. */
function routeNameOf(file: string): string {
  return path.relative(PAGES, file)
    .replace(/\.vue$/, '')
    .split(path.sep)
    .filter((segment, i, all) => !(segment === 'index' && i === all.length - 1))
    .map(segment => segment.replace(/^\[(.+)\]$/, '$1'))
    .join('-')
}

/** What `adminPageTitle` shows for a name it does not know. */
const fallbackOf = (name: string) => name.replace(/^admin-?/, '').replace(/-/g, ' ') || 'Admin'

const ADMIN_LAYOUT = /definePageMeta\(\s*\{[^}]*layout:\s*['"]admin['"]/s
const pages = vueFiles(path.join(PAGES, 'admin'))
  .filter(file => ADMIN_LAYOUT.test(readFileSync(file, 'utf8')))
  .map(file => ({ file: path.relative(ROOT, file), name: routeNameOf(file), source: readFileSync(file, 'utf8') }))

describe('every admin page has a top-bar title of its own', () => {
  it('finds the admin pages (the walk itself works)', () => {
    assert.ok(pages.length >= 45, `only ${pages.length} admin-layout pages found`)
    const names = pages.map(p => p.name)
    for (const known of ['admin', 'admin-content-articles-id', 'admin-settings-sitemap', 'admin-docs-preview-pageSlug']) {
      assert.ok(names.includes(known), `route name ${known} not derived`)
    }
    assert.ok(!names.includes('admin-login'), 'the login page has no admin layout')
  })

  it('no page falls back to its route name', () => {
    const raw = pages.filter(p => adminPageTitle(p.name, {}) === fallbackOf(p.name)).map(p => `${p.file} → "${fallbackOf(p.name)}"`)
    assert.deepEqual(raw, [])
  })

  it('a [id] page that also serves /new names its create mode apart from editing', () => {
    const withNew = pages.filter(p => p.name.endsWith('-id') && /params\.id\s*===\s*['"]new['"]/.test(p.source))
    assert.deepEqual(withNew.map(p => p.name).sort(), ['admin-chatbot-knowledge-id', 'admin-content-articles-id'])
    for (const p of withNew) {
      const create = adminPageTitle(p.name, { id: 'new' })
      const edit = adminPageTitle(p.name, { id: '7' })
      assert.notEqual(create, edit, `${p.file}: /new shows the editing title "${edit}"`)
      assert.notEqual(create, fallbackOf(p.name), p.file)
    }
    assert.equal(adminPageTitle('admin-content-articles-id', { id: 'new' }), 'Viết bài mới')
    assert.equal(adminPageTitle('admin-content-articles-id', { id: '12' }), 'Chỉnh sửa bài viết')
  })

  it('"new" only means create on an [id] route, and no params is the editing title', () => {
    assert.equal(adminPageTitle('admin-content-articles-id'), 'Chỉnh sửa bài viết')
    assert.equal(adminPageTitle('admin-content-articles-id', { id: ['new'] }), 'Chỉnh sửa bài viết')
    // An `-id` route with no `-new` entry keeps its own title rather than going blank.
    assert.equal(adminPageTitle('admin-readers-id', { id: 'new' }), 'Chi tiết người đọc')
    assert.equal(adminPageTitle('admin-settings-sitemap', { id: 'new' }), 'Sitemap')
  })
})
