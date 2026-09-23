/** Local encoder relay. Every child is opened relative to a pinned directory fd. */
import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createError, getHeader, sendStream, setResponseHeaders, setResponseStatus, type H3Event } from 'h3'

const MAX_PLAYLIST_BYTES = 256 * 1024
const MAX_FILES = 1024
const TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg', '.vtt': 'text/vtt', '.key': 'application/octet-stream', '.bin': 'application/octet-stream',
}
export class HlsSourceError extends Error {}

export function hlsRoot(): string {
  return path.resolve(process.env.LIVESTREAM_HLS_ROOT || path.join(process.env.MEDIA_WORKDIR || '/var/lib/cdkt/media', 'live'))
}

function segments(value: string): string[] {
  const parts = value.split('/')
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) {
    throw new HlsSourceError('Mã luồng hoặc tên tệp HLS không hợp lệ.')
  }
  return parts
}

/** The first component is an isolated stream directory, never a filesystem path. */
export function normalizeHlsSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) throw new HlsSourceError('Vui lòng nhập mã luồng HLS.')
  const input = value.trim()
  const parts = segments(input)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(parts[0]!)) throw new HlsSourceError('Mã luồng HLS chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.')
  if (parts.length === 1) return `${input}/index.m3u8`
  if (path.posix.extname(input) !== '.m3u8') throw new HlsSourceError('Nguồn HLS phải trỏ tới danh sách phát .m3u8.')
  return input
}

function sourceParts(source: string) {
  const [key, ...manifest] = normalizeHlsSource(source).split('/')
  return { key: key!, manifest: manifest.join('/') }
}

/**
 * Linux containers expose /proc/self/fd. Opening each component through the
 * previous directory fd with O_NOFOLLOW prevents both symlink escapes and
 * rename/symlink substitution between validation and open. No raw user path
 * ever reaches open(); directory fds are always closed, including error paths.
 */
async function openAsset(source: string, asset: string): Promise<FileHandle> {
  if (process.platform !== 'linux') throw new HlsSourceError('HLS tự lưu trữ cần máy chủ Linux.')
  const { key } = sourceParts(source)
  const parts = [key, ...segments(asset)]
  let current: FileHandle | undefined
  try {
    current = await open(await realpath(hlsRoot()), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    for (const [index, part] of parts.entries()) {
      const next = await open(`/proc/self/fd/${current.fd}/${part}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | (index < parts.length - 1 ? constants.O_DIRECTORY : 0))
      await current.close()
      current = next
    }
    const stat = await current.stat()
    if (!stat.isFile() || stat.size === 0) throw new HlsSourceError('Tệp HLS chưa sẵn sàng.')
    return current
  } catch {
    await current?.close().catch(() => undefined)
    throw new HlsSourceError('Không đọc được nguồn HLS. Kiểm tra bộ mã hóa và mã luồng.')
  }
}

function resolveUri(manifest: string, uri: string): string {
  // Query strings, encoded characters, schemes, absolute paths and variables are
  // intentionally unsupported. Local encoder output does not need any of them.
  if (!uri || !/^[A-Za-z0-9._/-]+$/.test(uri) || uri.startsWith('/')) throw new HlsSourceError('HLS chỉ được tham chiếu tệp tương đối trong cùng mã luồng.')
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(manifest), uri))
  segments(target)
  if (!TYPES[path.posix.extname(target)]) throw new HlsSourceError('Loại tệp HLS không được hỗ trợ.')
  return target
}

export function rewriteHlsPlaylist(text: string, manifest: string, sessionId: number): { body: string; references: string[] } {
  if (Buffer.byteLength(text) > MAX_PLAYLIST_BYTES || !text.startsWith('#EXTM3U\n') && !text.startsWith('#EXTM3U\r\n')) {
    throw new HlsSourceError('Danh sách phát HLS không hợp lệ.')
  }
  const references: string[] = []
  const rewrite = (uri: string) => {
    const target = resolveUri(manifest, uri)
    references.push(target)
    if (references.length > MAX_FILES) throw new HlsSourceError('Danh sách phát HLS quá lớn.')
    return `/api/public/livestream/${sessionId}/assets/${target}`
  }
  const lines = text.split(/\r?\n/).map(line => {
    if (!line) return ''
    if (!line.startsWith('#')) return rewrite(line.trim())
    // Includes URI on KEY/MAP/MEDIA/I-FRAME and any future *-URI attributes.
    // Requiring quoted values rejects ambiguous attribute parsing.
    return line.replace(/([A-Z0-9-]*URI)\s*=\s*("[^"]*"|[^,\s]*)/gi, (_all, name: string, value: string) => {
      if (!value.startsWith('"') || !value.endsWith('"')) throw new HlsSourceError('Tham chiếu HLS không hợp lệ.')
      return `${name}="${rewrite(value.slice(1, -1))}"`
    })
  })
  const master = /^#EXT-X-STREAM-INF:/m.test(text)
  const media = /^#EXT-X-TARGETDURATION:\d+\s*$/m.test(text) && /^#EXTINF:/m.test(text)
  if (master === media || !references.length) throw new HlsSourceError('Danh sách phát HLS chưa có nội dung để phát.')
  if (master && !references.some(reference => reference.endsWith('.m3u8'))) throw new HlsSourceError('Danh sách phát HLS thiếu luồng chất lượng.')
  if (media && !references.some(reference => !reference.endsWith('.m3u8') && !/\.(key|bin)$/.test(reference))) throw new HlsSourceError('Danh sách phát HLS thiếu phân đoạn video.')
  return { body: lines.join('\n'), references }
}

async function readPlaylist(source: string, asset: string, sessionId: number) {
  const file = await openAsset(source, asset)
  try {
    if ((await file.stat()).size > MAX_PLAYLIST_BYTES) throw new HlsSourceError('Danh sách phát HLS quá lớn.')
    const buffer = Buffer.alloc(MAX_PLAYLIST_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_PLAYLIST_BYTES) throw new HlsSourceError('Danh sách phát HLS quá lớn.')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)) }
    catch { throw new HlsSourceError('Danh sách phát HLS phải dùng UTF-8.') }
    return rewriteHlsPlaylist(text, asset, sessionId)
  } finally { await file.close() }
}

/** Validate a bounded manifest graph and its actual files before advertising live. */
export async function validateHlsSource(value: unknown): Promise<string> {
  const source = normalizeHlsSource(value)
  const visited = new Set<string>()
  const visit = async (asset: string, depth: number): Promise<void> => {
    if (visited.has(asset)) return
    if (depth > 8 || visited.size >= MAX_FILES) throw new HlsSourceError('Cấu trúc HLS quá lớn hoặc lồng quá sâu.')
    visited.add(asset)
    if (asset.endsWith('.m3u8')) {
      const playlist = await readPlaylist(source, asset, 0)
      for (const reference of playlist.references) await visit(reference, depth + 1)
    } else {
      const file = await openAsset(source, asset)
      await file.close()
    }
  }
  await visit(sourceParts(source).manifest, 0)
  if (![...visited].some(asset => !asset.endsWith('.m3u8') && !/\.(key|bin)$/.test(asset))) throw new HlsSourceError('Nguồn HLS chưa có phân đoạn để phát.')
  return source
}

export async function serveHlsAsset(event: H3Event, session: { id: number; storagePath: string | null }, requested?: string) {
  let file: FileHandle | undefined
  try {
    const source = normalizeHlsSource(session.storagePath)
    const asset = requested ?? sourceParts(source).manifest
    segments(asset)
    const type = TYPES[path.posix.extname(asset)]
    if (!type) throw new HlsSourceError('Loại tệp không được hỗ trợ.')
    setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
    if (asset.endsWith('.m3u8')) return (await readPlaylist(source, asset, session.id)).body
    file = await openAsset(source, asset)
    const { size } = await file.stat()
    let start = 0
    let end = size - 1
    const range = getHeader(event, 'range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) throw createError({ statusCode: 416, statusMessage: 'Invalid range' })
      if (!match[1]) start = Math.max(0, size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw createError({ statusCode: 416, statusMessage: 'Invalid range' })
      setResponseStatus(event, 206)
      setResponseHeaders(event, { 'Content-Range': `bytes ${start}-${end}/${size}` })
    }
    setResponseHeaders(event, { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    const stream = file.createReadStream({ start, end, autoClose: true })
    file = undefined // the stream now owns this fd
    const disconnect = () => stream.destroy()
    event.node.res.once('close', disconnect)
    stream.once('close', () => event.node.res.off('close', disconnect))
    return await sendStream(event, stream)
  } catch (error) {
    await file?.close().catch(() => undefined)
    if (error instanceof HlsSourceError) throw createError({ statusCode: 404, statusMessage: 'Nguồn HLS chưa sẵn sàng.' })
    throw error
  }
}
