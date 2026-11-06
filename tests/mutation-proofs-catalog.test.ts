import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { MUTATION_PROOFS } from '../scripts/mutation-proofs-catalog'

/**
 * Danh mục "làm hỏng có chủ đích" (`scripts/mutation-proofs-catalog.ts`) phải khớp mã HIỆN TẠI.
 *
 * `npm run test:mutations` mới thật sự làm hỏng mã và đòi test đỏ — nó nặng nên không chạy trong
 * `npm test`. Nhưng một refactor đổi đoạn mã mà mục đột biến tìm tới sẽ làm mục đó "STALE" một cách im
 * lặng tới lần chạy kế tiếp; test này bắt điều đó ngay trong CI: mỗi `find` còn xuất hiện đúng một lần.
 */
const ROOT = path.resolve(import.meta.dirname, '..')

test('every mutation still targets exactly one place in its file', () => {
  const stale = MUTATION_PROOFS.flatMap((proof) => {
    const file = path.join(ROOT, proof.file)
    if (!existsSync(file)) return [`${proof.id}: ${proof.file} no longer exists`]
    const count = readFileSync(file, 'utf8').split(proof.find).length - 1
    return count === 1 ? [] : [`${proof.id}: "find" occurs ${count} times in ${proof.file} — update the catalog with the code`]
  })
  assert.deepEqual(stale, [])
})

test('every mutation names test files that exist, a real change, and a reason', () => {
  const ids = new Set<string>()
  for (const proof of MUTATION_PROOFS) {
    assert.ok(!ids.has(proof.id), `duplicate id ${proof.id}`)
    ids.add(proof.id)
    assert.notEqual(proof.find, proof.replace, `${proof.id}: replace equals find`)
    assert.ok(proof.tests.length > 0, `${proof.id}: no test files`)
    for (const file of proof.tests) assert.ok(existsSync(path.join(ROOT, file)), `${proof.id}: ${file} does not exist`)
    assert.ok(proof.why.trim().length > 20, `${proof.id}: say which invariant this protects`)
    // Runner ghi vào worktree tạm; `node_modules` ở đó là symlink tới thư mục THẬT — ghi qua nó là sửa cây thật.
    for (const file of [proof.file, ...proof.tests]) {
      assert.ok(!file.split('/').includes('node_modules') && !file.split('/').includes('..') && !path.isAbsolute(file), `${proof.id}: ${file} must be a repo-relative path outside node_modules`)
    }
  }
  assert.ok(MUTATION_PROOFS.length >= 10)
})
