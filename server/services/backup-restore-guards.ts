/**
 * Kiểm tra trước khi khôi phục — chạy TRƯỚC khi ghi, ghi nhận hay thực thi bất
 * cứ thứ gì của một file backup.
 *
 * Tách khỏi `backup.ts` để phần thuần (giới hạn kích thước, chữ ký gzip, giải
 * nén có trần, đọc header tar, nhận diện dump cũ) kiểm được mà không
 * cần CSDL hay container.
 *
 * Giới hạn là HẰNG SỐ trong mã (không phải biến môi trường) — `production/`
 * không phải đổi gì. Muốn nâng thì sửa ở đây.
 */
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

export interface RestoreLimits {
  /** Trần dung lượng file tải lên (đã nén). */
  maxCompressedBytes: number
  /**
   * Trần dung lượng SQL sau giải nén. Toàn bộ văn bản SQL phải nằm trong MỘT
   * chuỗi JavaScript để chạy bằng `multipleStatements` (giới hạn V8 ~512 MiB ký
   * tự); 256 MiB vượt xa các dump hiện tại (~2 MB gzip).
   */
  maxSqlBytes: number
  /**
   * Trần dung lượng archive file (`.tar.gz`) sau giải nén. Giới hạn chuỗi JS
   * KHÔNG áp ở đây (tar giải nén thẳng ra đĩa), nên trần này riêng và rộng hơn:
   * ảnh/video gần như không nén được, một archive uploads hợp lệ có thể lớn hơn
   * 256 MiB. Mục đích là chặn bom giải nén làm đầy đĩa, không phải giới hạn RAM —
   * đếm theo luồng nên RAM không phụ thuộc trần. Đếm byte của LUỒNG tar (header +
   * dữ liệu đã đệm + khối kết thúc), không phải kích thước khai trong header.
   */
  maxArchiveBytes: number
  /** Trần số mục của archive; vắng → `DEFAULT_MAX_ARCHIVE_ENTRIES`. */
  maxArchiveEntries?: number
}

export const DEFAULT_RESTORE_LIMITS: Readonly<RestoreLimits> = Object.freeze({
  maxCompressedBytes: 512 * MiB,
  maxSqlBytes: 256 * MiB,
  // 15 GiB (trước là 8 GiB — quyết định của chủ repo): archive media 10,9 GB nén
  // (luồng tar 10,6 GiB) trên máy dev phải khôi phục được từ giao diện. Lớn hơn →
  // `scripts/restore-media.sh`.
  maxArchiveBytes: 15 * GiB,
})

/**
 * Lỗi có mã HTTP đi kèm — endpoint đọc `statusCode` thay vì so khớp chuỗi.
 * `reason` là mã máy đọc được cho log bảo mật.
 */
export class BackupRestoreError extends Error {
  readonly statusCode: number
  readonly reason: string
  constructor(message: string, statusCode: number, reason: string) {
    super(message)
    this.name = 'BackupRestoreError'
    this.statusCode = statusCode
    this.reason = reason
  }
}

export type BackupKind = 'sql' | 'media'

export function backupKindOf(filename: string): BackupKind | null {
  if (filename.endsWith('.sql.gz')) return 'sql'
  if (filename.endsWith('.tar.gz')) return 'media'
  return null
}

const formatMiB = (bytes: number) => `${Math.round(bytes / MiB)} MB`

/** Tên an toàn trong thư mục backups: bỏ đường dẫn, chỉ giữ `[a-zA-Z0-9._-]`. */
export function sanitizeBackupFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Kiểm tra rẻ trên bộ đệm đã nhận, trước khi chạm đĩa: đuôi file, trần dung
 * lượng nén, chữ ký gzip `1f 8b`. Một file text đặt tên `.sql.gz` dừng ở đây.
 */
export function validateUploadedBackup(filename: string, data: Uint8Array, limits: RestoreLimits = DEFAULT_RESTORE_LIMITS): { safeName: string; kind: BackupKind } {
  const safeName = sanitizeBackupFilename(filename)
  const kind = backupKindOf(safeName)
  if (!kind || safeName.startsWith('.')) {
    throw new BackupRestoreError('Chỉ nhận file .sql.gz hoặc .tar.gz.', 400, 'bad_extension')
  }
  if (data.length > limits.maxCompressedBytes) {
    throw new BackupRestoreError(`File vượt quá giới hạn ${formatMiB(limits.maxCompressedBytes)}.`, 413, 'too_large')
  }
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new BackupRestoreError('File không phải định dạng gzip hợp lệ.', 400, 'not_gzip')
  }
  return { safeName, kind }
}

/**
 * Giải nén theo luồng với trần cứng. Vượt trần → huỷ luồng ngay (bom giải nén
 * không được nở hết trong RAM hay ra đĩa). `collect=false` chỉ đếm byte, không
 * giữ dữ liệu — dùng cho archive; `collect=true` trả nội dung (SQL).
 */
export async function gunzipFileBounded(filePath: string, maxBytes: number, collect: boolean): Promise<{ bytes: number; data: Buffer | null }> {
  return await new Promise((resolve, reject) => {
    const source = createReadStream(filePath)
    const gunzip = createGunzip()
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      source.destroy()
      gunzip.destroy()
      reject(error)
    }
    source.on('error', error => fail(new BackupRestoreError(`Không đọc được file backup: ${error.message}`, 400, 'unreadable')))
    gunzip.on('error', () => fail(new BackupRestoreError('File nén bị hỏng hoặc không phải gzip.', 400, 'corrupt_gzip')))
    gunzip.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        fail(new BackupRestoreError(`Dữ liệu sau giải nén vượt quá giới hạn ${formatMiB(maxBytes)}.`, 413, 'decompressed_too_large'))
        return
      }
      if (collect) chunks.push(chunk)
    })
    gunzip.on('end', () => {
      if (settled) return
      settled = true
      resolve({ bytes, data: collect ? Buffer.concat(chunks, bytes) : null })
    })
    source.pipe(gunzip)
  })
}

// ─── Archive (.tar.gz) ─────────────────────────────────────────────────────────

/**
 * Kiểm archive bằng cách ĐỌC THẲNG các header tar 512 byte trong Node — không
 * qua `tar -tzvf`.
 *
 * Vì sao không dùng danh sách của `tar`: bản trước tách cột của `tar -tzvf` bằng
 * regex, giả định cột chủ/nhóm không có khoảng trắng. Nhưng `uname`/`gname` là
 * dữ liệu do NGƯỜI TẠO archive viết: một uname `a 1 2026-01-01 00:00 uploads/ok`
 * làm dòng của mục `evil/x.txt` hay `/tmp/abs_pwn.txt` khớp regex với tên giả
 * `uploads/ok…` → qua kiểm tra, rồi `tar -x` ghi file ra ngoài cây. Văn bản dành
 * cho người đọc không phải một giao thức; header mới là thứ `tar -x` thực sự đọc.
 *
 * Nguyên tắc: MỌI cách hiểu tên mà một trình giải nén (GNU tar ở máy dev, BusyBox
 * tar trong image alpine) có thể dùng đều phải an toàn, và mọi chỗ hai bên có thể
 * hiểu khác nhau đều bị từ chối thay vì đoán:
 *  - tên: pax `path=` (nếu có), tên dài GNU `L` (nếu có), và tên trong header
 *    (ghép `prefix/` CHỈ khi magic là POSIX `ustar\0` `00`) — cả ba đều được kiểm;
 *  - chỉ nhận file thường (`0`, NUL) và thư mục (`5`), cùng siêu dữ liệu `L`/`K`/`x`.
 *    Liên kết (`1`/`2`), thiết bị/FIFO (`3`/`4`/`6`) → `archive_link_entry`; `g`
 *    (pax toàn cục), `S` (sparse), `7`, `V`, `M`, `N`, `D` và mọi cờ lạ →
 *    `archive_unsupported_entry`;
 *  - file thường/thư mục không được mang linkname; thư mục phải có size 0 (GNU bỏ
 *    qua size của thư mục còn BusyBox nhảy qua chừng đó byte — hai bên lệch nhịp,
 *    mục giấu sau đó chỉ một bên thấy); pax `size=` khác size trong header → từ chối;
 *  - checksum sai, magic lạ (kể cả v7 không magic), size dạng base-256, vùng prefix
 *    khác 0 dưới magic GNU (GNU dùng chỗ đó cho atime/ctime) → `archive_unparseable`;
 *  - sau khối 0 đầu tiên mọi byte còn lại phải là 0 (GNU dừng ở khối 0 đầu, BusyBox
 *    đọc tiếp nếu khối sau không phải 0); archive bị cắt cụt, thiếu khối kết thúc,
 *    hay siêu dữ liệu không có mục đi sau → `archive_unparseable`;
 *  - trần số mục và trần dung lượng sau giải nén; gzip hỏng hay không phải tar →
 *    từ chối (fail closed).
 * Giải nén sau đó vẫn chỉ định đúng một thành viên gốc (`tar -xzf … uploads`).
 */

/** Trần số mục của một archive (mặc định). Thư mục uploads thật vài chục nghìn file. */
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 1_000_000
/** Trần dữ liệu của một bản ghi siêu dữ liệu (`L`/`K`/`x`). Tên dài thật vài trăm byte. */
const MAX_META_BYTES = 64 * 1024
const BLOCK = 512

type ArchiveTop = 'uploads' | 'media'

const unparseable = (detail: string) => new BackupRestoreError(`Archive không đúng định dạng tar mong đợi (${detail}) — từ chối khôi phục.`, 400, 'archive_unparseable')

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false
  return true
}

/** Chuỗi C trong một trường cố định (tới NUL đầu tiên), byte-chính-xác (latin1). */
function cString(block: Buffer, start: number, length: number): string {
  const end = block.indexOf(0, start)
  return block.toString('latin1', start, end === -1 || end > start + length ? start + length : end)
}

/** Số bát phân nghiêm ngặt; base-256 (bit cao) hay ký tự lạ → `null`. */
function octalField(block: Buffer, start: number, length: number): number | null {
  if ((block[start]! & 0x80) !== 0) return null
  const text = block.toString('latin1', start, start + length).replace(/^ +/, '').replace(/[\0 ]+$/, '')
  if (!/^[0-7]{1,12}$/.test(text)) return null
  return parseInt(text, 8)
}

function checksumMatches(block: Buffer): boolean {
  const stored = octalField(block, 148, 8)
  if (stored === null) return false
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!
  return sum === stored
}

/** Dữ liệu `L`/`K`: tên tới NUL đầu; sau NUL chỉ được là NUL (không có hai cách đọc). */
function longNameOf(data: Buffer): string {
  const end = data.indexOf(0)
  if (end !== -1 && data.subarray(end).some(byte => byte !== 0)) throw unparseable('tên dài GNU có dữ liệu sau NUL')
  return data.toString('latin1', 0, end === -1 ? data.length : end)
}

/** Bản ghi pax `"<len> <key>=<value>\n"` — sai một byte độ dài là từ chối. */
function parsePax(data: Buffer): Map<string, string> {
  const records = new Map<string, string>()
  let offset = 0
  while (offset < data.length) {
    if (data[offset] === 0 && data.subarray(offset).every(byte => byte === 0)) break
    const space = data.indexOf(0x20, offset)
    if (space === -1 || space - offset > 10) throw unparseable('bản ghi pax hỏng')
    const lengthText = data.toString('latin1', offset, space)
    if (!/^[1-9]\d*$/.test(lengthText)) throw unparseable('bản ghi pax hỏng')
    const length = Number(lengthText)
    const end = offset + length
    if (end > data.length || data[end - 1] !== 0x0a) throw unparseable('bản ghi pax hỏng')
    const record = data.toString('latin1', space + 1, end - 1)
    const equals = record.indexOf('=')
    if (equals <= 0) throw unparseable('bản ghi pax hỏng')
    const key = record.slice(0, equals)
    if (key.startsWith('GNU.sparse.')) throw new BackupRestoreError('Archive chứa mục sparse — không hỗ trợ khôi phục.', 400, 'archive_unsupported_entry')
    records.set(key, record.slice(equals + 1))
    offset = end
  }
  return records
}

/**
 * Kiểm MỘT cách hiểu tên của một mục. `strictShape` chỉ bật cho tên hiệu lực
 * (pax > `L` > header): tên trong header của một mục có tên dài là bản CẮT 100
 * byte, có thể kết thúc bằng `/` dù mục là file — vẫn phải an toàn, nhưng không
 * mang ý nghĩa "đây là thư mục".
 */
function checkEntryName(name: string, expectedTop: ArchiveTop, isDirectory: boolean, strictShape: boolean): void {
  const shown = JSON.stringify(name)
  if (name === '') throw unparseable('mục không có tên')
  // eslint-disable-next-line no-control-regex -- cố ý: chính là ký tự điều khiển cần chặn
  if (/[\x00-\x1f\x7f\\]/.test(name)) {
    throw new BackupRestoreError(`Archive chứa tên mục có ký tự điều khiển hoặc dấu \\: ${shown}`, 400, 'archive_unsafe_name')
  }
  if (name.startsWith('/')) {
    throw new BackupRestoreError(`Archive chứa đường dẫn tuyệt đối: ${shown}`, 400, 'archive_absolute_path')
  }
  const segments = name.split('/')
  if (segments.includes('..')) {
    throw new BackupRestoreError(`Archive chứa đường dẫn vượt thư mục (..): ${shown}`, 400, 'archive_traversal')
  }
  if (segments[0] !== expectedTop) {
    throw new BackupRestoreError(`Archive chứa mục ngoài thư mục ${expectedTop}/: ${shown}`, 400, 'archive_outside_tree')
  }
  if (!strictShape) return
  const meaningful = segments.filter(segment => segment !== '')
  if (!isDirectory && (name.endsWith('/') || meaningful.length < 2)) {
    // `uploads` là một FILE thì giải nén thay cả thư mục gốc bằng một file.
    throw new BackupRestoreError(`Archive chứa file mang tên thư mục: ${shown}`, 400, 'archive_outside_tree')
  }
}

const LINK_TYPES = new Set(['1', '2', '3', '4', '6'])

interface PendingMeta { longName?: string; longLink?: string; pax?: Map<string, string> }

/**
 * Máy trạng thái đọc luồng tar đã giải nén theo từng khối. Thuần (không I/O) để
 * kiểm thử với bộ đệm dựng tay.
 */
export class TarHeaderScanner {
  private pending: Buffer = Buffer.alloc(0)
  private mode: 'header' | 'skip' | 'meta' | 'trailer' = 'header'
  private skipRemaining = 0
  private metaType = ''
  private metaSize = 0
  private metaChunks: Buffer[] = []
  private metaCollected = 0
  private meta: PendingMeta = {}
  private sawEnd = false
  private totalBytes = 0
  entries = 0

  private readonly expectedTop: ArchiveTop
  private readonly maxBytes: number
  private readonly maxEntries: number

  constructor(expectedTop: ArchiveTop, maxBytes: number, maxEntries: number) {
    this.expectedTop = expectedTop
    this.maxBytes = maxBytes
    this.maxEntries = maxEntries
  }

  push(input: Buffer): void {
    this.totalBytes += input.length
    if (this.totalBytes > this.maxBytes) {
      throw new BackupRestoreError(`Dữ liệu sau giải nén vượt quá giới hạn ${formatMiB(this.maxBytes)}.`, 413, 'decompressed_too_large')
    }
    let data = input
    while (data.length > 0) {
      if (this.mode === 'trailer') {
        if (!isZeroBlock(data)) throw unparseable('có dữ liệu sau khối kết thúc')
        return
      }
      if (this.mode === 'skip') {
        const take = Math.min(this.skipRemaining, data.length)
        this.skipRemaining -= take
        data = data.subarray(take)
        if (this.skipRemaining === 0) this.mode = 'header'
        continue
      }
      if (this.mode === 'meta') {
        const padded = Math.ceil(this.metaSize / BLOCK) * BLOCK
        const take = Math.min(padded - this.metaCollected, data.length)
        this.metaChunks.push(data.subarray(0, take))
        this.metaCollected += take
        data = data.subarray(take)
        if (this.metaCollected === padded) this.finishMeta(Buffer.concat(this.metaChunks).subarray(0, this.metaSize))
        continue
      }
      const need = BLOCK - this.pending.length
      const take = Math.min(need, data.length)
      this.pending = this.pending.length === 0 && take === BLOCK ? data.subarray(0, BLOCK) : Buffer.concat([this.pending, data.subarray(0, take)])
      data = data.subarray(take)
      if (this.pending.length === BLOCK) {
        const block = Buffer.from(this.pending)
        this.pending = Buffer.alloc(0)
        this.header(block)
      }
    }
  }

  /** Gọi khi luồng hết: archive phải kết thúc gọn ở khối 0, không dở dang gì. */
  end(): { entries: number } {
    if (this.mode !== 'trailer' || !this.sawEnd || this.pending.length !== 0) throw unparseable('archive bị cắt cụt hoặc thiếu khối kết thúc')
    if (this.entries === 0) throw new BackupRestoreError('Archive rỗng hoặc không đọc được danh sách mục.', 400, 'archive_empty')
    return { entries: this.entries }
  }

  private finishMeta(data: Buffer): void {
    this.metaChunks = []
    this.metaCollected = 0
    this.mode = 'header'
    if (this.metaType === 'L') {
      if (this.meta.longName !== undefined) throw unparseable('hai tên dài GNU liên tiếp')
      this.meta.longName = longNameOf(data)
    } else if (this.metaType === 'K') {
      if (this.meta.longLink !== undefined) throw unparseable('hai linkname dài GNU liên tiếp')
      this.meta.longLink = longNameOf(data)
    } else {
      if (this.meta.pax !== undefined) throw unparseable('hai header pax liên tiếp')
      this.meta.pax = parsePax(data)
    }
  }

  private header(block: Buffer): void {
    if (isZeroBlock(block)) {
      if (this.meta.longName !== undefined || this.meta.longLink !== undefined || this.meta.pax !== undefined) {
        throw unparseable('siêu dữ liệu không có mục đi sau')
      }
      this.sawEnd = true
      this.mode = 'trailer'
      return
    }
    if (!checksumMatches(block)) throw unparseable('checksum header sai')

    const magic = block.toString('latin1', 257, 265)
    const posix = magic === 'ustar\u000000'
    const gnu = magic === 'ustar  \u0000'
    if (!posix && !gnu) throw unparseable('magic header lạ')
    if (gnu && !isZeroBlock(block.subarray(345, 500))) throw unparseable('vùng prefix khác 0 dưới magic GNU')

    const size = octalField(block, 124, 12)
    if (size === null) throw unparseable('trường kích thước không đọc được')

    const typeflag = String.fromCharCode(block[156]!)
    if (typeflag === 'L' || typeflag === 'K' || typeflag === 'x') {
      if (size > MAX_META_BYTES) throw unparseable('bản ghi siêu dữ liệu quá lớn')
      this.metaType = typeflag
      this.metaSize = size
      if (size === 0) this.finishMeta(Buffer.alloc(0))
      else this.mode = 'meta'
      return
    }

    const meta = this.meta
    this.meta = {}
    const fieldName = cString(block, 0, 100)
    const prefix = posix ? cString(block, 345, 155) : ''
    const headerName = prefix ? `${prefix}/${fieldName}` : fieldName
    const effective = meta.pax?.get('path') ?? meta.longName ?? headerName

    if (LINK_TYPES.has(typeflag)) {
      throw new BackupRestoreError(`Archive chứa mục không phải file/thư mục (liên kết hoặc thiết bị): ${JSON.stringify(effective)}`, 400, 'archive_link_entry')
    }
    const isDirectory = typeflag === '5'
    if (!isDirectory && typeflag !== '0' && typeflag !== '\0') {
      throw new BackupRestoreError(`Archive chứa loại mục không hỗ trợ (cờ ${JSON.stringify(typeflag)}): ${JSON.stringify(effective)}`, 400, 'archive_unsupported_entry')
    }
    // File/thư mục không có lý do mang đích liên kết — ở BẤT KỲ nguồn nào trong ba.
    if ([meta.pax?.get('linkpath'), meta.longLink, cString(block, 157, 100)].some(link => link !== undefined && link !== '')) {
      throw new BackupRestoreError(`Archive chứa mục mang đích liên kết: ${JSON.stringify(effective)}`, 400, 'archive_link_entry')
    }
    const paxSize = meta.pax?.get('size')
    if (paxSize !== undefined && paxSize !== String(size)) throw unparseable('kích thước pax khác header')
    if (isDirectory && size !== 0) throw unparseable('thư mục có kích thước khác 0')

    // Mọi cách hiểu tên đều phải an toàn; chỉ tên hiệu lực chịu luật hình dạng.
    checkEntryName(effective, this.expectedTop, isDirectory, true)
    for (const candidate of [meta.pax?.get('path'), meta.longName, headerName]) {
      if (candidate !== undefined && candidate !== effective) checkEntryName(candidate, this.expectedTop, isDirectory, false)
    }

    this.entries += 1
    if (this.entries > this.maxEntries) {
      throw new BackupRestoreError(`Archive có quá nhiều mục (hơn ${this.maxEntries}).`, 413, 'archive_too_many_entries')
    }
    const padded = Math.ceil(size / BLOCK) * BLOCK
    if (padded > 0) {
      this.skipRemaining = padded
      this.mode = 'skip'
    }
  }
}

/**
 * Kiểm toàn bộ archive (giải nén theo luồng, đọc header) TRƯỚC khi giải nén bất
 * cứ gì. Một mục không an toàn → không mục nào được giải nén.
 */
export async function inspectArchive(
  filePath: string,
  expectedTop: ArchiveTop,
  limits: Pick<RestoreLimits, 'maxArchiveBytes' | 'maxArchiveEntries'> = DEFAULT_RESTORE_LIMITS,
): Promise<{ entries: number }> {
  const scanner = new TarHeaderScanner(expectedTop, limits.maxArchiveBytes, limits.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES)
  const source = createReadStream(filePath)
  const gunzip = createGunzip()
  let sourceError: Error | null = null
  source.on('error', (error) => { sourceError = error; gunzip.destroy(error) })
  source.pipe(gunzip)
  try {
    for await (const chunk of gunzip) scanner.push(chunk as Buffer)
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error
    if (sourceError) throw new BackupRestoreError(`Không đọc được file backup: ${(sourceError as Error).message}`, 400, 'unreadable')
    throw new BackupRestoreError('File nén bị hỏng hoặc không phải gzip.', 400, 'corrupt_gzip')
  } finally {
    source.destroy()
    gunzip.destroy()
  }
  return scanner.end()
}

/** Thư mục gốc mà một archive backup phải chứa, suy từ tên file (như `archiveFiles` đặt). */
export function expectedArchiveTop(filename: string): 'uploads' | 'media' {
  return filename.includes('-media-') ? 'media' : 'uploads'
}

// ─── Dump cũ ────────────────────────────────────────────────────────────────────

export const DUMP_FORMAT_MARKER = '-- CDKT dump-format: 2'
const CDKT_HEADER = '-- CDKT backup:'

/**
 * Dump do app sinh TRƯỚC bản vá ngày giờ: có header `-- CDKT backup:` nhưng
 * không có dấu định dạng 2. Ngày giờ trong dump đó đã bị ghi lệch theo UTC
 * (sớm 7 giờ so với giá trị CSDL lưu). Không sửa được đáng tin cậy bằng SQL —
 * chỉ cảnh báo. Dump từ `mysqldump` (`scripts/backup-db.sh`) không bị gắn cờ.
 */
export function isLegacyAppDump(sqlHead: string): boolean {
  const head = sqlHead.slice(0, 4096)
  if (!head.startsWith(CDKT_HEADER)) return false
  return !head.split('\n').slice(0, 10).some(line => line.trim() === DUMP_FORMAT_MARKER)
}
