import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('uploadLocalFile `exclusive`: a second write to the same name is refused and the first file keeps its bytes', async () => {
  const at = new Date(2027, 0, 15, 10, 0, 0)
  const first = await uploadLocalFile(Buffer.from('first'), '1_dup.webp', at, { exclusive: true })
  await assert.rejects(uploadLocalFile(Buffer.from('second'), '1_dup.webp', at, { exclusive: true }), { code: 'EEXIST' })
  assert.equal(readFileSync(first.storagePath, 'utf8'), 'first')
  // Without it (the R2 → local sync re-writes the same name on a retry) the write replaces.
  await uploadLocalFile(Buffer.from('again'), '1_dup.webp', at)
  assert.equal(readFileSync(first.storagePath, 'utf8'), 'again')
})

/**
 * The WRITE side of the same hole: `mkdir -p` and `writeFile` follow a directory symlink
 * inside uploads like `unlink` did (independent verify of the hardening follow-ups: a probe
 * created a new file outside `public/uploads` through `uploads/<year>` → elsewhere). Every
 * folder a write goes through must resolve, for real, under the real uploads folder; a write
 * that would land elsewhere throws BEFORE anything is created there — no file, no folder.
 */
function entriesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      out.push(`${prefix}${entry.name}`)
      if (entry.isDirectory()) walk(join(current, entry.name), `${prefix}${entry.name}/`)
    }
  }
  walk(dir, '')
  return out
}

test('uploadLocalFile: a directory symlink inside public/uploads cannot carry a write outside it (year or month level)', async () => {
  const outside = join(workdir, 'outside-write')
  mkdirSync(outside, { recursive: true })
  try {
    symlinkSync(outside, join(uploads, '2027'))
    await assert.rejects(uploadLocalFile(Buffer.from('payload'), '1_x.webp', new Date(2027, 0, 15)), /Path traversal attempt blocked/)
    assert.deepEqual(entriesUnder(outside), [], 'something was created outside public/uploads (year link)')

    rmSync(join(uploads, '2027'))
    mkdirSync(join(uploads, '2027'))
    symlinkSync(outside, join(uploads, '2027', '02'))
    await assert.rejects(uploadLocalFile(Buffer.from('payload'), '1_y.webp', new Date(2027, 1, 15)), /Path traversal attempt blocked/)
    assert.deepEqual(entriesUnder(outside), [], 'something was created outside public/uploads (month link)')
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('uploadLocalFile: a filename that is not a single name is refused — nothing written outside the month folder', async () => {
  for (const name of ['../../../evil.webp', '../escape.webp', 'sub/dir.webp', '..', '.']) {
    await assert.rejects(uploadLocalFile(Buffer.from('payload'), name, new Date(2027, 0, 15)), /Path traversal attempt blocked/, name)
  }
  assert.equal(existsSync(join(workdir, 'public', 'evil.webp')), false)
  assert.equal(existsSync(join(uploads, '2027', 'escape.webp')), false)
})

test('uploadLocalFile: a directory symlink that stays inside uploads, and uploads itself as a symlink (a volume), still take writes', async () => {
  symlinkSync(join(uploads, '2026'), join(uploads, '2028'))
  const viaAlias = await uploadLocalFile(Buffer.from('alias'), '1_alias.webp', new Date(2028, 9, 1))
  assert.equal(viaAlias.storagePath, join(uploads, '2028', '10', '1_alias.webp'), 'the reported path is the one the row stores')
  assert.equal(readFileSync(join(uploads, '2026', '10', '1_alias.webp'), 'utf8'), 'alias', 'written into the real folder the link points at')

  const volume = join(workdir, 'volume-write')
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(volume, { recursive: true })
  mkdirSync(join(workdir, 'public'), { recursive: true })
  symlinkSync(volume, uploads)
  try {
    const written = await uploadLocalFile(Buffer.from('on the volume'), '1_vol.webp', new Date(2029, 2, 3))
    assert.equal(written.storagePath, join(uploads, '2029', '03', '1_vol.webp'))
    assert.equal(readFileSync(join(volume, '2029', '03', '1_vol.webp'), 'utf8'), 'on the volume')
  } finally {
    rmSync(volume, { recursive: true, force: true })
  }
})
