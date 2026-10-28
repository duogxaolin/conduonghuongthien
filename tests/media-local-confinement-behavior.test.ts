import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach } from 'node:test'

/**
 * `server/utils/media-local.ts` — the one place a local media file is written or
 * deleted (`<cwd>/public/uploads/YYYY/MM/<file>`).
 *
 * `deleteLocalFile` takes the `storage_path` stored on a `media` row and deletes
 * it. Rows are written by uploads, scans, syncs and repoints, so the path is not
 * trusted: whatever it says, nothing outside `public/uploads/` may be removed —
 * not through `..`, not as an absolute path elsewhere, not through a sibling
 * folder whose name merely starts with `uploads`. A symlink inside the folder is
 * removed as a link; its target survives. A missing file is `false`, not a throw.
 *
 * `uploadLocalFile` / `localUploadTargetFor` put a file in the month folder of the
 * clock they are given and report the same path and URL.
 *
 * Real files under a temporary working directory.
 */

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-media-local-')))
const originalCwd = process.cwd()
process.chdir(workdir)
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})

const { deleteLocalFile, localUploadTargetFor, uploadLocalFile } = await import('../server/utils/media-local')

const uploads = join(workdir, 'public', 'uploads')
const inside = join(uploads, '2026', '10', 'anh.webp')
const env = join(workdir, '.env')
const publicSecret = join(workdir, 'public', 'secret.txt')
const sibling = join(workdir, 'public', 'uploads-old', 'x.webp')

beforeEach(() => {
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(join(uploads, '2026', '10'), { recursive: true })
  mkdirSync(join(workdir, 'public', 'uploads-old'), { recursive: true })
  writeFileSync(inside, 'image')
  writeFileSync(env, 'JWT_SECRET=not-a-real-secret')
  writeFileSync(publicSecret, 'outside uploads')
  writeFileSync(sibling, 'sibling folder')
})

test('a file inside public/uploads is deleted; a missing one is false, not a throw', async () => {
  assert.equal(await deleteLocalFile(inside), true)
  assert.equal(existsSync(inside), false)
  assert.equal(await deleteLocalFile(inside), false)
  assert.equal(await deleteLocalFile('public/uploads/2026/10/never.webp'), false)
})

test('a storage path that resolves outside public/uploads throws and deletes nothing', async () => {
  const attempts = [
    'public/uploads/../secret.txt',
    'public/uploads/2026/10/../../../../.env',
    env,
    publicSecret,
    sibling,
    'public/uploads-old/x.webp',
    '.env',
  ]
  for (const attempt of attempts) {
    await assert.rejects(deleteLocalFile(attempt), /Path traversal attempt blocked/, attempt)
  }
  assert.equal(readFileSync(env, 'utf8'), 'JWT_SECRET=not-a-real-secret')
  assert.equal(readFileSync(publicSecret, 'utf8'), 'outside uploads')
  assert.equal(readFileSync(sibling, 'utf8'), 'sibling folder')
  assert.equal(existsSync(inside), true)
})

test('a symlink inside public/uploads is removed as a link — its target outside survives', async () => {
  const link = join(uploads, '2026', '10', 'link.webp')
  symlinkSync(env, link)
  assert.equal(await deleteLocalFile(link), true)
  assert.equal(existsSync(link), false)
  assert.equal(readFileSync(env, 'utf8'), 'JWT_SECRET=not-a-real-secret')
})

/**
 * The guard above is LEXICAL: `public/uploads/2026/victim.txt` is inside the folder by its
 * spelling, whatever `2026` really is. A DIRECTORY symlink inside uploads (`2026` → a folder
 * elsewhere — a restored archive can carry one) passed it, and `unlink` followed the link: the
 * file outside was deleted (verify of the wave3 test slices, `probe/symlink-dir.out`:
 * `{"returned":true,"victimStillExists":false}`). The folder a file is unlinked from must
 * resolve, for real, inside the real uploads folder.
 */
test('a directory symlink inside public/uploads cannot carry a delete outside it', async () => {
  const outside = join(workdir, 'outside')
  mkdirSync(outside, { recursive: true })
  const victim = join(outside, 'victim.txt')
  writeFileSync(victim, 'not media')
  symlinkSync(outside, join(uploads, '2026', 'linked'))
  symlinkSync(outside, join(uploads, '2025'))
  for (const attempt of ['public/uploads/2026/linked/victim.txt', join(uploads, '2025', 'victim.txt')]) {
    await assert.rejects(deleteLocalFile(attempt), /Path traversal attempt blocked/, attempt)
    assert.equal(readFileSync(victim, 'utf8'), 'not media', `${attempt} deleted a file outside public/uploads`)
  }
  rmSync(outside, { recursive: true, force: true })
})

test('a directory symlink that stays inside public/uploads still works, and a missing folder is false', async () => {
  symlinkSync(join(uploads, '2026', '10'), join(uploads, 'alias'))
  assert.equal(await deleteLocalFile('public/uploads/alias/anh.webp'), true)
  assert.equal(existsSync(inside), false)
  assert.equal(await deleteLocalFile('public/uploads/2031/01/never.webp'), false, 'a folder that does not exist is nothing to delete, not an error')
})

test('public/uploads itself may be a symlink (a mounted volume): deletes inside it still work', async () => {
  const volume = join(workdir, 'volume')
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(join(volume, '2026', '10'), { recursive: true })
  mkdirSync(join(workdir, 'public'), { recursive: true })
  symlinkSync(volume, uploads)
  writeFileSync(join(volume, '2026', '10', 'anh.webp'), 'image')
  try {
    assert.equal(await deleteLocalFile(join(uploads, '2026', '10', 'anh.webp')), true)
    assert.equal(existsSync(join(volume, '2026', '10', 'anh.webp')), false)
  } finally {
    rmSync(volume, { recursive: true, force: true })
  }
})

test('uploadLocalFile writes into the month folder of the given clock and reports that path and URL', async () => {
  const at = new Date(2027, 0, 15, 10, 0, 0)
  const target = localUploadTargetFor('1_logo.webp', at)
  assert.equal(target.url, '/uploads/2027/01/1_logo.webp')
  assert.equal(target.storagePath, join(uploads, '2027', '01', '1_logo.webp'))

  const written = await uploadLocalFile(Buffer.from('webp-bytes'), '1_logo.webp', at)
  assert.deepEqual(written, target)
  assert.equal(readFileSync(target.storagePath, 'utf8'), 'webp-bytes')
  // What was written can be deleted through the same guard.
  assert.equal(await deleteLocalFile(written.storagePath), true)
})
