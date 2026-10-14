import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { gzipSync } from 'node:zlib'

/**
 * `inspectArchive` đọc header tar trực tiếp (`TarHeaderScanner`), không tách cột
 * của `tar -tzvf`.
 *
 * Lỗ hổng gốc (C3): `uname`/`gname` do người tạo archive viết và có thể chứa
 * khoảng trắng. Một uname `a 1 2026-01-01 00:00 uploads/ok` làm dòng
 * `-rw-r--r-- a 1 2026-01-01 00:00 uploads/ok/g 1 2025-10-09 09:53 evil/x.txt`
 * khớp regex cột với TÊN `uploads/ok/g 1 … evil/x.txt` → qua kiểm tra, trong khi
 * `tar -x` ghi `evil/x.txt` (hay `/tmp/abs_pwn.txt`) ra ngoài cây.
 *
 * Archive ở đây được dựng bằng Node (header viết tay — đúng định dạng ustar/GNU/pax
 * byte theo byte) và bằng `tar` CLI cho phần "archive thật do tar sinh vẫn qua".
 */

const guards = await import('../server/services/backup-restore-guards')
const { inspectArchive, BackupRestoreError, TarHeaderScanner, DEFAULT_RESTORE_LIMITS, DEFAULT_MAX_ARCHIVE_ENTRIES } = guards

const workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-tar-scan-'))
after(() => rmSync(workdir, { recursive: true, force: true }))

// ─── Tar builder ───────────────────────────────────────────────────────────────

interface HeaderSpec {
  name: string
  type?: string
  size?: number
  linkname?: string
  prefix?: string
  magic?: 'gnu' | 'posix' | 'v7'
  uname?: string
  gname?: string
  badChecksum?: boolean
  base256Size?: boolean
  gnuPrefixGarbage?: boolean
}

function put(block: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, 'latin1')
  bytes.copy(block, offset, 0, Math.min(bytes.length, length))
}
const octal = (value: number, width: number) => `${value.toString(8).padStart(width - 1, '0')}\0`

function header(spec: HeaderSpec): Buffer {
  const block = Buffer.alloc(512)
  put(block, 0, 100, spec.name)
  put(block, 100, 8, octal(0o644, 8))
  put(block, 108, 8, octal(0, 8))
  put(block, 116, 8, octal(0, 8))
  if (spec.base256Size) {
    block[124] = 0x80
    block.writeUInt32BE(spec.size ?? 0, 132)
  } else {
    put(block, 124, 12, octal(spec.size ?? 0, 12))
  }
  put(block, 136, 12, octal(1_760_000_000, 12))
  block.fill(0x20, 148, 156)
  put(block, 156, 1, spec.type ?? '0')
  put(block, 157, 100, spec.linkname ?? '')
  const magic = spec.magic ?? 'gnu'
  if (magic === 'gnu') put(block, 257, 8, 'ustar  \0')
  if (magic === 'posix') put(block, 257, 8, 'ustar\u000000')
  put(block, 265, 32, spec.uname ?? 'ray')
  put(block, 297, 32, spec.gname ?? 'ray')
  if (spec.prefix) put(block, 345, 155, spec.prefix)
  if (spec.gnuPrefixGarbage) put(block, 345, 12, octal(1_760_000_000, 12))
  let sum = 0
  for (const byte of block) sum += byte
  if (spec.badChecksum) sum += 1
  put(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `)
  return block
}

const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)])
const END = Buffer.alloc(1024)

/** One member: header (+ data, padded). */
function entry(spec: HeaderSpec, data: Buffer | string = ''): Buffer {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return Buffer.concat([header({ ...spec, size: spec.size ?? (spec.type === '5' ? 0 : body.length) }), pad(body)])
}
const file = (name: string, data = 'x', extra: Partial<HeaderSpec> = {}) => entry({ name, ...extra }, data)
const dir = (name: string, extra: Partial<HeaderSpec> = {}) => entry({ name, type: '5', ...extra })
/** GNU long name record (`././@LongLink`, type L) followed by nothing — caller adds the member. */
const longName = (name: string, type: 'L' | 'K' = 'L') => entry({ name: '././@LongLink', type }, `${name}\0`)
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  let length = body.length + 1
  while (`${length}${body}`.length !== length) length += 1
  return `${length}${body}`
}
const pax = (records: Record<string, string>) => entry({ name: 'PaxHeaders/x', type: 'x', magic: 'posix' }, Object.entries(records).map(([k, v]) => paxRecord(k, v)).join(''))

let counter = 0
function write(parts: Buffer[], { gzip = true, raw }: { gzip?: boolean, raw?: Buffer } = {}): string {
  const target = path.join(workdir, `fixture-${counter++}.tar.gz`)
  const tar = raw ?? Buffer.concat(parts)
  writeFileSync(target, gzip ? gzipSync(tar) : tar)
  return target
}
const archive = (...parts: Buffer[]) => write([...parts, END])

async function reasonOf(filePath: string, top: 'uploads' | 'media' = 'uploads', limits?: { maxArchiveBytes: number, maxArchiveEntries?: number }): Promise<string> {
  try {
    await inspectArchive(filePath, top, limits)
  } catch (error) {
    assert.ok(error instanceof BackupRestoreError, String(error))
    return (error as InstanceType<typeof BackupRestoreError>).reason
  }
  return 'accepted'
}

const LONG = `uploads/${'d'.repeat(60)}/${'f'.repeat(90)}.jpg`
// A long name whose 100th byte is '/': the truncated header copy ends with '/'.
const LONG_SLASH_AT_100 = `uploads/${'a'.repeat(91)}/${'b'.repeat(30)}.png`

// ─── Valid archives ────────────────────────────────────────────────────────────

describe('well-formed archives pass', () => {
  test('directories, files, GNU long names and pax paths are counted, nothing else', async () => {
    assert.equal(LONG_SLASH_AT_100[99], '/')
    const target = archive(
      dir('uploads/'),
      dir('uploads/2026/'),
      file('uploads/2026/a.jpg', 'jpeg-bytes'),
      longName(LONG), file(LONG.slice(0, 100), 'long'),
      longName(LONG_SLASH_AT_100), file(LONG_SLASH_AT_100.slice(0, 100), 'long2'),
      pax({ path: `uploads/${'p'.repeat(150)}.webp`, mtime: '1760000000.5', uname: 'a 1 2026-01-01 00:00 x' }),
      entry({ name: 'uploads/pppp', magic: 'posix' }, 'pax'),
      entry({ name: 'z.txt', prefix: 'uploads/posix-prefix', magic: 'posix' }, 'prefixed'),
      file('uploads/old-style', 'v', { type: '\0' }),
    )
    assert.deepEqual(await inspectArchive(target, 'uploads'), { entries: 8 })
  })

  test('archives produced by the real tar CLI pass (gnu, posix/pax and ustar formats, long names)', async () => {
    const root = mkdtempSync(path.join(workdir, 'tree-'))
    mkdirSync(path.join(root, 'uploads', 'sub', 'x'.repeat(120)), { recursive: true })
    writeFileSync(path.join(root, 'uploads', 'a.txt'), 'a')
    writeFileSync(path.join(root, 'uploads', 'sub', 'x'.repeat(120), `${'y'.repeat(120)}.jpg`), 'y')
    writeFileSync(path.join(root, 'uploads', 'tên tiếng Việt có dấu.png'), 'v')
    for (const format of ['gnu', 'posix', 'ustar']) {
      const target = path.join(workdir, `cli-${format}.tar.gz`)
      try {
        execFileSync('tar', ['czf', target, `--format=${format}`, '-C', root, 'uploads'], { stdio: 'pipe' })
      } catch (error) {
        // ustar cannot store a 120-char path component — that refusal is tar's, not ours.
        if (format === 'ustar') continue
        throw error
      }
      assert.equal(await reasonOf(target), 'accepted', format)
    }
    const media = path.join(workdir, 'cli-media.tar.gz')
    mkdirSync(path.join(root, 'media', 'v'), { recursive: true })
    writeFileSync(path.join(root, 'media', 'v', 'seg.ts'), 's')
    execFileSync('tar', ['czf', media, '-C', root, 'media'])
    assert.equal(await reasonOf(media, 'media'), 'accepted')
    assert.equal(await reasonOf(media, 'uploads'), 'archive_outside_tree')
  })
})

// ─── The C3 bypass: archive-controlled owner/group columns ────────────────────

describe('owner/group names cannot smuggle an entry past the check', () => {
  const SPOOF = 'a 1 2026-01-01 00:00 uploads/ok'
  const CASES: Array<[string, Buffer, string]> = [
    ['outside the tree', file('evil/x.txt', 'x', { uname: SPOOF, gname: 'g 1 2025-10-09 09:53' }), 'archive_outside_tree'],
    ['absolute', file('/tmp/abs_pwn.txt', 'x', { uname: SPOOF }), 'archive_absolute_path'],
    ['traversal', file('../../../tmp/pwn_uname.txt', 'x', { uname: SPOOF }), 'archive_traversal'],
    ['hard link', file('uploads/hl', '', { type: '1', linkname: '/etc/passwd', uname: SPOOF }), 'archive_link_entry'],
    ['symlink', file('uploads/sl', '', { type: '2', linkname: '/etc/passwd', gname: SPOOF }), 'archive_link_entry'],
  ]
  for (const [label, member, reason] of CASES) {
    test(`${label}: refused`, async () => {
      assert.equal(await reasonOf(archive(file('uploads/ok.txt'), member)), reason)
    })
  }
})

// ─── Long names: every reading must be safe ────────────────────────────────────

describe('pax and GNU long names', () => {
  test('pax path with .. is refused even when the header name looks fine', async () => {
    assert.equal(await reasonOf(archive(pax({ path: `uploads/${'a'.repeat(120)}/../../../evil.txt` }), file('uploads/aaaa'))), 'archive_traversal')
  })
  test('a fine pax path does not launder an unsafe header name (an extractor may ignore pax)', async () => {
    assert.equal(await reasonOf(archive(pax({ path: 'uploads/fine.txt' }), entry({ name: '/abs.txt', magic: 'posix' }, 'x'))), 'archive_absolute_path')
    assert.equal(await reasonOf(archive(pax({ path: 'uploads/fine.txt' }), entry({ name: 'evil.txt', magic: 'posix' }, 'x'))), 'archive_outside_tree')
  })
  test('GNU long name with .. or outside the tree is refused; a fine L name does not launder the header name', async () => {
    assert.equal(await reasonOf(archive(longName(`uploads/${'a'.repeat(120)}/../../x`), file('uploads/aaaa'))), 'archive_traversal')
    assert.equal(await reasonOf(archive(longName(`evil/${'a'.repeat(120)}`), file('uploads/aaaa'))), 'archive_outside_tree')
    assert.equal(await reasonOf(archive(longName(`uploads/${'a'.repeat(120)}`), file('../evil'))), 'archive_traversal')
  })
  test('a long link name on a regular file is refused', async () => {
    assert.equal(await reasonOf(archive(longName('/etc/passwd', 'K'), file('uploads/x'))), 'archive_link_entry')
    assert.equal(await reasonOf(archive(pax({ linkpath: '/etc/passwd' }), file('uploads/x'))), 'archive_link_entry')
    assert.equal(await reasonOf(archive(file('uploads/x', 'x', { linkname: '/etc/passwd' }))), 'archive_link_entry')
  })
  test('two long-name records in a row, or a record with no member after it, are refused', async () => {
    assert.equal(await reasonOf(archive(longName(`uploads/${'a'.repeat(120)}`), longName(`uploads/${'b'.repeat(120)}`), file('uploads/x'))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(file('uploads/x'), longName(`uploads/${'a'.repeat(120)}`))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(pax({ path: 'uploads/a' }), pax({ path: 'uploads/b' }), file('uploads/x'))), 'archive_unparseable')
  })
  test('a pax size that disagrees with the header size is refused (the two extractors would skip differently)', async () => {
    assert.equal(await reasonOf(archive(pax({ size: '0' }), file('uploads/x', 'twelve bytes'))), 'archive_unparseable')
  })
  test('malformed pax records and GNU sparse keywords are refused', async () => {
    const bad = entry({ name: 'PaxHeaders/x', type: 'x', magic: 'posix' }, '99 path=uploads/x\n')
    assert.equal(await reasonOf(archive(bad, file('uploads/x'))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(pax({ 'GNU.sparse.map': '0,1' }), file('uploads/x'))), 'archive_unsupported_entry')
  })
})

// ─── Entry types ─────────────────────────────────────────────────────────────

describe('only regular files and directories', () => {
  for (const [type, reason] of [['1', 'archive_link_entry'], ['2', 'archive_link_entry'], ['3', 'archive_link_entry'], ['4', 'archive_link_entry'], ['6', 'archive_link_entry'], ['7', 'archive_unsupported_entry'], ['g', 'archive_unsupported_entry'], ['S', 'archive_unsupported_entry'], ['V', 'archive_unsupported_entry'], ['M', 'archive_unsupported_entry'], ['N', 'archive_unsupported_entry'], ['D', 'archive_unsupported_entry'], ['Z', 'archive_unsupported_entry']] as const) {
    test(`typeflag ${type}: ${reason}`, async () => {
      assert.equal(await reasonOf(archive(dir('uploads/'), entry({ name: 'uploads/t', type }, ''))), reason)
    })
  }
  test('a directory with a non-zero size is refused (GNU skips 0 bytes, BusyBox skips size bytes)', async () => {
    const hidden = file('evil.txt', 'smuggled')
    assert.equal(await reasonOf(archive(Buffer.concat([header({ name: 'uploads/d/', type: '5', size: hidden.length }), hidden]))), 'archive_unparseable')
  })
})

// ─── Names ─────────────────────────────────────────────────────────────────────

describe('names', () => {
  const CASES: Array<[string, Buffer, string]> = [
    ['newline in the name', file('uploads/a\n-rw-r--r-- u/g 1 2026-01-01 00:00 uploads/b'), 'archive_unsafe_name'],
    ['carriage return', file('uploads/a\rb'), 'archive_unsafe_name'],
    ['backslash', file('uploads\\..\\..\\x.txt'), 'archive_unsafe_name'],
    ['DEL', file('uploads/a\x7fb'), 'archive_unsafe_name'],
    ['leading ./', file('./uploads/x.txt'), 'archive_outside_tree'],
    ['top-level prefix look-alike', file('uploadsX/evil.txt'), 'archive_outside_tree'],
    ['the top directory as a FILE', file('uploads'), 'archive_outside_tree'],
    ['a regular file named like a directory', file('uploads/x/'), 'archive_outside_tree'],
    ['.. in the middle', file('uploads/a/../../x'), 'archive_traversal'],
    ['posix prefix pointing outside', entry({ name: 'x.txt', prefix: '../etc', magic: 'posix' }, 'x'), 'archive_traversal'],
    ['posix prefix absolute', entry({ name: 'x.txt', prefix: '/etc', magic: 'posix' }, 'x'), 'archive_absolute_path'],
  ]
  for (const [label, member, reason] of CASES) {
    test(`${label}: ${reason}`, async () => {
      assert.equal(await reasonOf(archive(dir('uploads/'), member)), reason)
    })
  }
})

// ─── Framing ───────────────────────────────────────────────────────────────────

describe('framing: truncated, corrupt or ambiguous archives fail closed', () => {
  const good = Buffer.concat([dir('uploads/'), file('uploads/a.txt', 'a'.repeat(700)), END])

  test('truncated inside a header, inside data, or without the end blocks', async () => {
    assert.equal(await reasonOf(write([], { raw: good.subarray(0, 700) })), 'archive_unparseable')
    assert.equal(await reasonOf(write([], { raw: good.subarray(0, 512 + 512 + 300) })), 'archive_unparseable')
    assert.equal(await reasonOf(write([], { raw: good.subarray(0, good.length - 1024) })), 'archive_unparseable')
  })
  test('data after the first zero block (BusyBox reads on after a lone zero block, GNU stops)', async () => {
    assert.equal(await reasonOf(write([dir('uploads/'), Buffer.alloc(512), file('evil.txt'), END])), 'archive_unparseable')
  })
  test('bad checksum, missing magic (v7), base-256 size, GNU prefix area in use', async () => {
    assert.equal(await reasonOf(archive(file('uploads/x', 'x', { badChecksum: true }))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(file('uploads/x', 'x', { magic: 'v7' }))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(Buffer.concat([header({ name: 'uploads/x', size: 1, base256Size: true }), pad(Buffer.from('x'))]))), 'archive_unparseable')
    assert.equal(await reasonOf(archive(file('uploads/x', 'x', { gnuPrefixGarbage: true }))), 'archive_unparseable')
  })
  test('a gzip that is not a tar, a non-gzip file, and an empty archive', async () => {
    assert.equal(await reasonOf(write([], { raw: Buffer.from('-- just some SQL\nSELECT 1;\n'.repeat(100)) })), 'archive_unparseable')
    assert.equal(await reasonOf(write([], { raw: Buffer.from('plain text, no gzip'), gzip: false })), 'corrupt_gzip')
    assert.equal(await reasonOf(write([END])), 'archive_empty')
  })
  test('entry-count and size caps', async () => {
    const many = archive(dir('uploads/'), file('uploads/1'), file('uploads/2'), file('uploads/3'))
    assert.equal(await reasonOf(many, 'uploads', { maxArchiveBytes: 1024 * 1024, maxArchiveEntries: 3 }), 'archive_too_many_entries')
    assert.equal(await reasonOf(many, 'uploads', { maxArchiveBytes: 1024 * 1024, maxArchiveEntries: 4 }), 'accepted')
    assert.equal(await reasonOf(archive(dir('uploads/'), file('uploads/big', 'b'.repeat(4096))), 'uploads', { maxArchiveBytes: 2048 }), 'decompressed_too_large')
  })
})

// ─── Default archive cap: 15 GiB uncompressed (owner decision, was 8 GiB) ─────
//
// The cap counts the bytes of the decompressed tar STREAM (headers + padded data
// + end blocks), not the sizes declared in headers — so these streams really push
// that many bytes into the scanner. One shared zero buffer is pushed repeatedly:
// in skip mode that is subarray arithmetic, so 15 GiB costs well under a second
// and no memory beyond the buffer. Each file stays under 8 GiB − 1 so its size
// fits the 11-digit octal field (base-256 sizes are refused on their own).

const GiB = 1024 ** 3
const NEW_ARCHIVE_CAP = 15 * GiB
/** `cdkt-media-20260925T191853Z-pre-sync.tar.gz` on the dev machine: tar stream measured at 11,373,357,056 bytes, 11,786 entries. */
const REAL_MEDIA_ARCHIVE_STREAM = 11_373_357_056
const ZERO = Buffer.alloc(16 * 1024 * 1024)

/** Stream `media/` + `files` regular files whose whole tar stream is exactly `total` bytes. */
function pushSyntheticMediaArchive(scanner: InstanceType<typeof TarHeaderScanner>, total: number, files = 3): void {
  const overhead = 512 + files * 512 + END.length
  const data = total - overhead
  assert.equal(data % 512, 0, 'total must keep 512-byte framing')
  const each = Math.floor(data / files / 512) * 512
  const sizes = Array.from({ length: files }, (_, i) => (i === files - 1 ? data - each * (files - 1) : each))
  for (const size of sizes) assert.ok(size < 8 * GiB - 1, `file size ${size} must fit the 11-digit octal field`)
  scanner.push(dir('media/'))
  sizes.forEach((size, i) => {
    scanner.push(header({ name: `media/videos/v${i}.mp4`, size }))
    for (let left = size; left > 0; left -= ZERO.length) scanner.push(left >= ZERO.length ? ZERO : ZERO.subarray(0, left))
  })
  scanner.push(END)
}

const defaultScanner = () => new TarHeaderScanner('media', DEFAULT_RESTORE_LIMITS.maxArchiveBytes, DEFAULT_MAX_ARCHIVE_ENTRIES)

describe('default archive cap is 15 GiB of uncompressed tar stream', () => {
  test('the archive cap is 15 GiB; the upload (512 MiB compressed) and SQL (256 MiB) caps did not move', () => {
    assert.equal(DEFAULT_RESTORE_LIMITS.maxArchiveBytes, NEW_ARCHIVE_CAP)
    assert.equal(DEFAULT_RESTORE_LIMITS.maxCompressedBytes, 512 * 1024 * 1024)
    assert.equal(DEFAULT_RESTORE_LIMITS.maxSqlBytes, 256 * 1024 * 1024)
  })

  test('an archive the size of the real 10.6 GiB media backup, and one of exactly 15 GiB, are accepted', () => {
    for (const total of [REAL_MEDIA_ARCHIVE_STREAM, NEW_ARCHIVE_CAP]) {
      const scanner = defaultScanner()
      pushSyntheticMediaArchive(scanner, total)
      assert.deepEqual(scanner.end(), { entries: 4 }, `total ${total}`)
    }
  })

  test('one byte past 15 GiB is refused with 413 decompressed_too_large, and the message names the cap', () => {
    const scanner = defaultScanner()
    pushSyntheticMediaArchive(scanner, NEW_ARCHIVE_CAP)
    assert.throws(() => scanner.push(Buffer.alloc(1)), (error: unknown) => {
      assert.ok(error instanceof BackupRestoreError)
      assert.equal(error.statusCode, 413)
      assert.equal(error.reason, 'decompressed_too_large')
      assert.match(error.message, /15360 MB/)
      return true
    })
  })

  test('a larger archive (files 512 bytes bigger than the exact-cap layout) is refused mid-stream with 413', () => {
    const scanner = defaultScanner()
    assert.throws(() => pushSyntheticMediaArchive(scanner, NEW_ARCHIVE_CAP + 512), (error: unknown) => {
      assert.ok(error instanceof BackupRestoreError)
      assert.equal(error.statusCode, 413)
      assert.equal(error.reason, 'decompressed_too_large')
      return true
    })
  })
})

describe('real tar CLI fixtures with links are refused', () => {
  test('symlink and hard link made by tar itself', async () => {
    const root = mkdtempSync(path.join(workdir, 'links-'))
    mkdirSync(path.join(root, 'uploads'))
    writeFileSync(path.join(root, 'uploads', 'a.txt'), 'a')
    symlinkSync('/etc/passwd', path.join(root, 'uploads', 'link'))
    const sym = path.join(workdir, 'sym.tar.gz')
    execFileSync('tar', ['czf', sym, '-C', root, 'uploads'])
    assert.equal(await reasonOf(sym), 'archive_link_entry')
    rmSync(path.join(root, 'uploads', 'link'))
    linkSync(path.join(root, 'uploads', 'a.txt'), path.join(root, 'uploads', 'h'))
    const hard = path.join(workdir, 'hard.tar.gz')
    execFileSync('tar', ['czf', hard, '-C', root, 'uploads'])
    assert.equal(await reasonOf(hard), 'archive_link_entry')
  })
})
