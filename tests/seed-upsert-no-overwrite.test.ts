import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * `server/db/seed.ts` runs at EVERY container start (Dockerfile CMD: init → seed →
 * server). So its upserts must be insert-only: a duplicate key may never write a
 * value, or each restart reverts what staff changed since.
 *
 * `home_sections` broke that rule: `onDuplicateKeyUpdate({ set: { displayOrder } })`
 * put every legacy home section back in seed order on each boot, undoing the
 * admin's reordering (wave1 D14, spec `boot-seed`). The no-op idiom the rest of
 * the file uses is `keepExisting('<column>')` — `SET col = col`, which changes no
 * value, so not even `ON UPDATE CURRENT_TIMESTAMP` fires.
 *
 * Source guard (importing `seed.ts` would run it): every `onDuplicateKeyUpdate` in
 * the file sets exactly one column, to itself.
 */

const source = readFileSync(new URL('../server/db/seed.ts', import.meta.url), 'utf8')

const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)

/** The `set` object literal of every `onDuplicateKeyUpdate(...)` call, with the statement it ends. */
function upserts(): Array<{ set: string, statement: string }> {
  const found: Array<{ set: string, statement: string }> = []
  const pattern = /\.onDuplicateKeyUpdate\(\{\s*set:\s*\{([^}]*)\}\s*\}\)/g
  for (const match of source.matchAll(pattern)) {
    const start = source.lastIndexOf('await db.insert(', match.index)
    found.push({ set: match[1]!.trim(), statement: source.slice(start, match.index! + match[0].length) })
  }
  return found
}

test('the home_sections seed upsert writes nothing to an existing row', () => {
  const homeSections = upserts().filter(entry => entry.statement.includes('db.insert(homeSections)'))
  assert.equal(homeSections.length, 1, 'expected exactly one home_sections upsert in seed.ts')
  const set = homeSections[0]!.set
  assert.doesNotMatch(set, /displayOrder|display_order/, 'the seed must not reset an admin-chosen display order')
  assert.match(set, /^(\w+):\s*keepExisting\('(\w+)'\)$/, `home_sections upsert is not a no-op: { ${set} }`)
})

test('every seed upsert is a no-op on a duplicate key: one column set to itself', () => {
  const all = upserts()
  assert.ok(all.length >= 10, `only ${all.length} upserts found — did the pattern stop matching?`)
  const offenders: string[] = []
  for (const { set, statement } of all) {
    const match = /^(\w+):\s*keepExisting\('(\w+)'\)$/.exec(set)
    if (!match || snake(match[1]!) !== match[2]) {
      offenders.push(`${statement.split('\n')[0]!.trim()} … set: { ${set} }`)
    }
  }
  assert.deepEqual(offenders, [], `seed upserts that overwrite data on every boot:\n${offenders.join('\n')}`)
})

test('the seed never updates home_sections directly either', () => {
  assert.doesNotMatch(source, /db\.update\(homeSections\)/)
})
