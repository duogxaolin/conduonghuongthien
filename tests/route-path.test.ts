import assert from 'node:assert/strict'
import test from 'node:test'
import { routePath } from '../server/utils/route-path'

/** Đường dẫn theo cách router hiểu — dùng bởi các plugin tracking/og-image/favicon (CHANGELOG § 81). */
test('query and fragment are dropped', () => {
  assert.equal(routePath('/admin?x=1'), '/admin')
  assert.equal(routePath('/news?page=2#top'), '/news')
  assert.equal(routePath('/admin#a'), '/admin')
})

test('case, percent-encoding and repeated slashes are normalised the way the router reads them', () => {
  assert.equal(routePath('/ADMIN'), '/admin')
  assert.equal(routePath('/%61dmin'), '/admin')
  assert.equal(routePath('/%41PI/x'), '/api/x')
  assert.equal(routePath('//admin//content'), '/admin/content')
})

test('empty, missing and malformed input never throws', () => {
  assert.equal(routePath(undefined), '')
  assert.equal(routePath(null), '')
  assert.equal(routePath(''), '')
  assert.equal(routePath('/%E0%A4%A'), '/%e0%a4%a')
})

test('a slug that merely starts with the letters is not changed into /admin', () => {
  assert.equal(routePath('/admin-huong-dan?x=1'), '/admin-huong-dan')
  assert.equal(routePath('/api-tin-tuc'), '/api-tin-tuc')
})
