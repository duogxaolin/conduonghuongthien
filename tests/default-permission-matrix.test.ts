import assert from 'node:assert/strict'
import test from 'node:test'
import { PERMISSION_FLAGS, type PermissionFlag, readRepoFile, SEED_PATH, seedPermissionMatrix, seedResources } from './_seed-source'

/**
 * The default role → permission matrix that `server/db/seed.ts` writes, pinned.
 *
 * The seed inserts a (role, resource) row only when it is missing, so a change to
 * these defaults reaches production silently: new deployments get the new rights,
 * existing ones keep the old rows, and no upgrade test can tell an intended change
 * from a mistake. Pinning the matrix makes every change to it a deliberate edit of
 * this file, reviewed next to the seed change — in particular any right granted to
 * `editor`, `moderator` or `viewer`.
 *
 * The matrix is read from seed.ts itself (`tests/_seed-source.ts` evaluates the four
 * `…Perms` initializers without a database). Rights are listed per resource as a
 * subset of: create, read, update, delete, publish, archive, test.
 */

const ALL = 'create,read,update,delete,publish,archive,test'

const PINNED_RESOURCES = [
  'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
  'home_sections', 'pages', 'users', 'roles', 'media', 'settings', 'submissions', 'analytics',
  'chatbot_settings', 'chatbot_knowledge', 'readers', 'comments', 'media_portal', 'livestream', 'ai',
]

/** role → resource → granted rights. A resource not listed has no right at all. */
const PINNED_MATRIX: Record<string, Record<string, string>> = {
  superadmin: Object.fromEntries(PINNED_RESOURCES.map(resource => [resource, ALL])),
  editor: {
    news: 'create,read,update',
    role_models: 'create,read,update',
    reintegration: 'create,read,update',
    documents: 'create,read,update',
    faq: 'create,read,update',
    categories: 'create,read,update',
    pages: 'create,read,update',
    media: 'create,read',
    home_sections: 'read',
    submissions: 'read',
  },
  moderator: {
    news: 'read,update',
    role_models: 'read,update',
    reintegration: 'read,update',
    documents: 'read,update',
    faq: 'read,update',
    submissions: 'read,update',
  },
  viewer: {
    submissions: 'read',
  },
}

const flagOf = (right: string): PermissionFlag => {
  const flag = `can${right[0]!.toUpperCase()}${right.slice(1)}` as PermissionFlag
  assert.ok(PERMISSION_FLAGS.includes(flag), `unknown right "${right}" in the pinned matrix`)
  return flag
}

const rights = (row: Record<PermissionFlag, boolean>) =>
  PERMISSION_FLAGS.filter(flag => row[flag]).map(flag => flag.slice(3).toLowerCase()).join(',')

test('the seed\'s resources are exactly the pinned list', () => {
  assert.deepEqual(seedResources(), PINNED_RESOURCES)
})

test('the seed\'s default role → permission matrix is exactly the pinned one', () => {
  const actual = seedPermissionMatrix()
  assert.equal(actual.length, 4 * PINNED_RESOURCES.length, 'one row per default role and resource')
  const differences: string[] = []
  for (const row of actual) {
    const expected = PINNED_MATRIX[row.role]?.[row.resource] ?? ''
    for (const right of expected.split(',').filter(Boolean)) flagOf(right)
    if (rights(row) !== expected) differences.push(`${row.role} · ${row.resource}: seed grants "${rights(row) || 'nothing'}", pinned "${expected || 'nothing'}"`)
  }
  assert.deepEqual(differences, [], `the default permission matrix in ${SEED_PATH} changed — if that is intended, update PINNED_MATRIX here in the same change:\n${differences.join('\n')}`)
  assert.deepEqual(Object.keys(PINNED_MATRIX).sort(), [...new Set(actual.map(row => row.role))].sort())
})

test('the evaluated matrix reacts to the seed source (not a cached copy)', () => {
  const source = readRepoFile(SEED_PATH)
  const marker = "resource === 'home_sections' || resource === 'submissions'"
  assert.ok(source.includes(marker), 'the editor read-only branch moved — update this test')
  const changed = source.replace(marker, "resource === 'home_sections' || resource === 'submissions' || resource === 'users'")
  const editorUsers = seedPermissionMatrix(changed).find(row => row.role === 'editor' && row.resource === 'users')!
  assert.equal(rights(editorUsers), 'read')
})
