/**
 * Đường ống chuyển mã cho một mục media tự lưu trữ.
 *
 * Bảy giai đoạn, và thứ tự giữa chúng là ràng buộc thật chứ không phải cách
 * trình bày:
 *
 *   1. Atomically claim a pending item within the global admission limit.
 *   2. Release the admission connection, locate and sniff the original.
 *   3. Probe metadata and transcode into this attempt's isolated generation.
 *   4. Chuyển mã từng độ phân giải, cắt HLS, và **công bố ngay khi mỗi bản xong**.
 *   5. Trích khung hình làm ảnh đại diện.
 *   6. Ghi `master.m3u8` — qua tệp tạm rồi `rename`, không bao giờ ghi tại chỗ.
 *   7. Dọn thư mục nháp, đánh dấu `ready`.
 *
 * Bốn quyết định trong tệp này đều có một kiểu hỏng **không nhìn thấy được**, và
 * đó là lý do chúng được viết ra thành lời:
 *
 *   • **Nhả kết nối trước khi spawn (giai đoạn 3).** Một lượt chuyển mã chạy hàng
 *     chục phút. Giữ một kết nối trong pool suốt thời gian đó — hoặc giữ khoá
 *     danh nghĩa vốn sở hữu một kết nối — sẽ vét cạn pool trên VPS 1–2 GB, và
 *     triệu chứng duy nhất là "cổng chậm", không có gì chỉ vào lượt chuyển mã.
 *     Khoá danh nghĩa bảo vệ **lúc bắt đầu** một công việc, không bảo vệ suốt
 *     thời gian của nó; hàng dữ liệu mới là bản ghi bền. Đó chính là lý do
 *     `claimed_by` tồn tại.
 *   • **Công bố lũy tiến (giai đoạn 4).** Một video trở nên xem được **trước khi**
 *     bản cuối cùng xong, và một công việc chết ở bản thứ ba vẫn đã công bố hai
 *     bản đầu. Ghi cả mảng vào cuối đường ống thì một lượt hỏng để lại đúng
 *     không gì cả, và không có gì nói ra là hai bản kia đã sẵn sàng từ lâu.
 *   • **Ghi `master.m3u8` qua tệp tạm rồi `rename` (giai đoạn 6).** Ghi tại chỗ
 *     mở ra một cửa sổ mà người đọc tải playlist về được **một nửa** nội dung;
 *     trình phát dừng lại và không có lỗi nào ở đâu cả. `rename` trên cùng một hệ
 *     thống tệp là thao tác thay thế nguyên tử, nên người đọc chỉ thấy bản cũ
 *     nguyên vẹn hoặc bản mới nguyên vẹn.
 *   • **`claimed_by` là điều kiện trong mệnh đề `WHERE` của mọi lượt ghi sau khi
 *     nhận việc.** Một công việc đã bị reaper thu hồi (8.x) mà còn sống dậy thì
 *     mọi lượt ghi của nó bị từ chối, thay vì ghi đè lên lượt chạy mới.
 *
 * **Tệp này cố ý KHÔNG chạm `activity_logs`.** Hành động đáng ghi vào nhật ký
 * kiểm toán là **lượt tải lên**, và cặp hàng + nhật ký đó đã nằm trong
 * transaction của `completeUpload` (`chunked-upload.ts`). Một lượt chuyển mã là
 * sự kiện của máy, không phải hành động của cán bộ; chép nó vào bảng kiểm toán
 * làm loãng đúng những dòng bảng đó tồn tại để giữ. Vì thế tệp này không cần
 * một mục nào trong `SERVICE_EXEMPTIONS` — cổng quét chỉ hỏi những tệp có chạm
 * `activityLogs`, và đây không phải một trong số đó.
 */
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import { and, eq } from 'drizzle-orm'
import { getDb, getPool, type Database } from '../utils/db'
import { mediaItems } from '../db/schema'
import { resolveMediaConfig, type MediaConfig } from '../utils/media-config'
import { withNamedLock } from '../utils/named-lock'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logInfo, logWarn } from '../utils/logger'
import { detectVideoMime, VIDEO_SNIFF_BYTES, UNSUPPORTED_VIDEO_MESSAGE } from '../utils/video-mime'
import { syncDirectoryToR2 } from './video-r2-sync'
// Dùng lại bản của đường tải lên thay vì viết bản thứ hai: hai bản định dạng
// dung lượng chỉ được đối chiếu khi một trong hai đọc sai, và lúc đó cán bộ đã
// đọc hai con số khác nhau cho cùng một tệp.
import { formatBytes } from './chunked-upload'

/** Cùng tên khoá với lượt bắt đầu đường ống — reaper (8.x) lấy đúng khoá này. */
export const TRANSCODE_LOCK_NAME = 'cdkt:media:transcode'
const LOCK_TIMEOUT_SECONDS = 0

/** Số bản chuyển mã chạy song song. Trần cho VPS 1–2 GB: 3 × 2 luồng ≤ 6 nhân. */
export const MAX_CONCURRENT_RENDITIONS = 3

/** Mỗi bản 2 luồng: nhiều hơn thì ba bản song song tranh hết nhân của máy chủ. */
const THREADS_PER_RENDITION = 2

/** Chu kỳ kiểm dung lượng đĩa. Một phút là đủ dày so với một lượt chuyển mã. */
export const DISK_CHECK_INTERVAL_MS = 60 * 1000

/** Độ dài một đoạn HLS. 4 giây: đủ ngắn để tua, đủ dài để không ngập request. */
const HLS_SEGMENT_SECONDS = 4

/** Cột `processing_error` là VARCHAR(512) — MySQL ở chế độ strict **từ chối** giá trị dài hơn. */
export const PROCESSING_ERROR_LIMIT = 512

export const PROCESSING_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export type ProcessingStatus = typeof PROCESSING_STATUSES[number]

export type Rendition = {
  name: string
  height: number
  videoBitrateKbps: number
  audioBitrateKbps: number
}

/**
 * Ba bản, xếp **nhỏ trước**. Thứ tự này là thứ tự công bố: bản 360p xong trước
 * nên mục trở nên xem được sớm nhất có thể, đúng tinh thần "công bố lũy tiến".
 */
export const RENDITIONS: readonly Rendition[] = [
  { name: '360p', height: 360, videoBitrateKbps: 800, audioBitrateKbps: 96 },
  { name: '720p', height: 720, videoBitrateKbps: 2500, audioBitrateKbps: 128 },
  { name: '1080p', height: 1080, videoBitrateKbps: 5000, audioBitrateKbps: 192 },
]

// ─── Hàm thuần ───────────────────────────────────────────────────────────────

/**
 * Chọn những bản phù hợp với chiều cao nguồn.
 *
 * Không bao giờ nâng cấp độ phân giải: một nguồn 480p được chuyển thành 1080p
 * chỉ tốn thời gian và đĩa để cho ra một tệp mờ hơn cả bản gốc. Nhưng cũng
 * **không bao giờ trả về danh sách rỗng** — một nguồn 240p không khớp bản nào
 * trong ba bản trên, và trả về rỗng nghĩa là mục đó không bao giờ có bản nào
 * sẵn sàng, tức là không bao giờ xem được, mà không có gì báo lỗi.
 */
export function selectRenditions(sourceHeight: number | null | undefined): Rendition[] {
  const height = Number.isFinite(Number(sourceHeight)) && Number(sourceHeight) > 0
    ? Math.trunc(Number(sourceHeight))
    : 0
  if (height <= 0) return RENDITIONS.map(rendition => ({ ...rendition }))

  const fitting = RENDITIONS.filter(rendition => rendition.height <= height)
  if (fitting.length > 0) return fitting.map(rendition => ({ ...rendition }))

  const even = Math.max(2, height % 2 === 0 ? height : height - 1)
  return [{
    name: `${even}p`,
    height: even,
    videoBitrateKbps: Math.max(200, Math.round(even * 2.5)),
    audioBitrateKbps: 96,
  }]
}

/** Bề rộng sau `scale=-2:H`: giữ tỉ lệ, làm tròn về số chẵn (bộ giải mã yêu cầu). */
export function scaledWidth(sourceWidth: number, sourceHeight: number, targetHeight: number): number | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return null
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const width = Math.round((sourceWidth * targetHeight) / sourceHeight)
  const even = width % 2 === 0 ? width : width - 1
  return even >= 2 ? even : null
}

/**
 * Đọc kết quả `ffprobe -print_format json`.
 *
 * Trả `null` cho từng trường không đọc được thay vì ném: một tệp thiếu metadata
 * vẫn chuyển mã được, chỉ là không ghi được con số nào. Ném ở đây biến một video
 * hợp lệ thành một lượt hỏng.
 */
export function parseProbeJson(raw: string): {
  durationSeconds: number | null
  width: number | null
  height: number | null
} {
  let parsed: { format?: { duration?: unknown }, streams?: Array<Record<string, unknown>> }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return { durationSeconds: null, width: null, height: null }
  }

  const duration = Number(parsed.format?.duration)
  const video = (parsed.streams ?? []).find(stream => stream.codec_type === 'video')
  const width = Number(video?.width)
  const height = Number(video?.height)

  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    width: Number.isFinite(width) && width > 0 ? Math.trunc(width) : null,
    height: Number.isFinite(height) && height > 0 ? Math.trunc(height) : null,
  }
}

export type MasterVariant = { name: string, height: number, width: number | null, bandwidth: number }

/**
 * Dựng `master.m3u8` từ những bản **đã sẵn sàng**, không phải từ kế hoạch.
 *
 * Đây là điều làm cho việc công bố lũy tiến có nghĩa: playlist chỉ trỏ tới những
 * thư mục đã nằm trên đĩa. Trỏ tới một bản chưa cắt xong là đưa người đọc một
 * liên kết chết ngay giữa lượt phát.
 *
 * `CODECS` cố ý vắng mặt: một chuỗi codec sai làm trình phát **từ chối** cả
 * playlist, còn thiếu nó thì trình phát tự dò. `BANDWIDTH` và `RESOLUTION` là
 * hai thuộc tính nó thật sự cần để chọn bản.
 */
export function buildMasterPlaylist(variants: readonly MasterVariant[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS']
  for (const variant of variants) {
    const attributes = [`BANDWIDTH=${variant.bandwidth}`]
    if (variant.width) attributes.push(`RESOLUTION=${variant.width}x${variant.height}`)
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`)
    lines.push(`${variant.name}/index.m3u8`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Ghi playlist **nguyên tử**: tệp tạm rồi `rename`.
 *
 * Đây là **đường ghi duy nhất** cho `master.m3u8` trong toàn bộ mã nguồn, và đó
 * là chủ đích — một lối ghi tại chỗ thứ hai ở đâu đó sẽ mở lại đúng cửa sổ mà
 * hàm này tồn tại để đóng, và triệu chứng của nó là "trình phát thỉnh thoảng
 * đứng", không có lỗi ở đâu cả. `tests/media-processing.test.ts` khẳng định cả
 * hình dạng này lẫn việc không còn lối ghi nào khác.
 */
export async function writeManifestAtomically(targetPath: string, content: string): Promise<void> {
  const tempPath = `${targetPath}.tmp`
  await fs.writeFile(tempPath, content, 'utf8')
  await fs.rename(tempPath, targetPath)
}

export type StatfsFn = (target: string) => Promise<{ bavail: number, bsize: number }>

export type DiskCheck =
  | { ok: true, freeBytes: number }
  | { ok: false, kind: 'low' | 'error', reason: string }

/**
 * Kiểm dung lượng trống. **Không bao giờ ném** — lỗi đọc được trả về như một
 * lý do dừng.
 *
 * `statfs` chứ không `statvfs`: `statvfs` không tồn tại trong `fs` của Node.
 *
 * Nhánh lỗi **dừng công việc** chứ không đi tiếp: một phép kiểm đĩa hỏng mà vẫn
 * cho chạy tiếp là đúng trạng thái mà phép kiểm này sinh ra để tránh, chỉ khác
 * là lần này không có gì canh. `floorBytes <= 0` là tắt hẳn phép kiểm (volume
 * trên hệ thống tệp lạ), và đó là lựa chọn của người vận hành, không phải lỗi.
 */
export async function checkDiskSpace(
  target: string,
  floorBytes: number,
  statfs: StatfsFn = fs.statfs as unknown as StatfsFn,
): Promise<DiskCheck> {
  if (!Number.isFinite(floorBytes) || floorBytes <= 0) return { ok: true, freeBytes: Number.POSITIVE_INFINITY }

  try {
    const stats = await statfs(target)
    const freeBytes = Number(stats.bavail) * Number(stats.bsize)
    if (!Number.isFinite(freeBytes)) {
      return { ok: false, kind: 'error', reason: 'Không đọc được dung lượng trống của thư mục media.' }
    }
    if (freeBytes < floorBytes) {
      return {
        ok: false, kind: 'low',
        reason: `Hết chỗ trên thư mục media: còn ${formatBytes(freeBytes)}, cần tối thiểu ${formatBytes(floorBytes)}.`,
      }
    }
    return { ok: true, freeBytes }
  } catch (error) {
    return {
      ok: false, kind: 'error',
      reason: `Không kiểm được dung lượng đĩa: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export type DiskGuardOptions = {
  path: string
  floorBytes: number
  intervalMs: number
  statfs?: StatfsFn
  /** Gọi **một lần duy nhất**, ở lần kiểm đầu tiên thất bại. */
  onAbort: (failure: Extract<DiskCheck, { ok: false }>) => void
}

/**
 * Phép kiểm đĩa chạy nền trong lúc chuyển mã.
 *
 * Có `intervalMs` là tham số chứ không phải hằng số trong thân hàm: một chu kỳ
 * một phút là đúng cho production và không kiểm được trong một test. Cùng lối
 * với `now` / `limit` của `housekeepUploads`.
 */
export function startDiskGuard(options: DiskGuardOptions): { stop: () => void } {
  let stopped = false
  const timer = setInterval(() => {
    if (stopped) return
    void checkDiskSpace(options.path, options.floorBytes, options.statfs).then((check) => {
      if (stopped || check.ok) return
      // Dừng trước khi gọi `onAbort`: nhánh dừng có thể xoá thư mục nháp, và một
      // lượt kiểm đang bay không được phép gọi nó lần thứ hai.
      stopped = true
      options.onAbort(check)
    })
  }, Math.max(1, options.intervalMs))
  timer.unref?.()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}

/**
 * Mục này có phát được không?
 *
 * Hai câu hỏi, và cả hai đều phải đúng:
 *
 *   • **Có ít nhất một bản đã sẵn sàng.** Đây là điều làm cho việc công bố lũy
 *     tiến có nghĩa: một video trở nên xem được **trước khi** bản cuối cùng xong.
 *   • **Trạng thái xử lý không phải `failed`.** Yêu cầu "Failed job is recorded"
 *     của đặc tả nói thẳng một mục hỏng *không được trình bày như phát được*, và
 *     điều đó đúng kể cả khi vài bản đã nằm trên đĩa: một mục hỏng là một mục cần
 *     người xử lý, còn một mục hiện ra như đang chạy tốt thì không ai đi xử lý.
 *
 * Chỗ dễ nhầm là ở giữa: `processing_status = 'processing'` **vẫn phát được** khi
 * đã có bản sẵn sàng — đó chính là nhánh mà việc công bố lũy tiến sinh ra để mở.
 * Chỉ `failed` mới đóng lại.
 */
export function isPlayable(item: {
  processingStatus?: string | null
  resolutionsReady?: string[] | null
}): boolean {
  if (item.processingStatus === 'failed') return false
  // Có rendition HLS → phát được (giá trị cao nhất).
  if (Array.isArray(item.resolutionsReady) && item.resolutionsReady.length > 0) return true
  // `ready` mà chưa transcode rendition (`MEDIA_AUTO_TRANSCODE=false`): tệp gốc
  // vẫn phát được qua stream endpoint (byte-range mp4), chỉ không có HLS multi-bitrate.
  // Trước đây `ready` + `resolutionsReady=[]` đọc là "chưa phát được" — đúng khi
  // auto-transcode bật, sai khi tắt: video đã lên máy chủ, có tệp gốc, nhưng ẩn.
  if (item.processingStatus === 'ready') return true
  // `processing` — đang transcode nhưng tệp gốc `original.<ext>` đã có ngay sau
  // upload (probe xong là có). Stream endpoint lùi về tệp gốc qua
  // `isPassthroughManifest`, nên công dân xem được video gốc thay vì thấy lỗi
  // trong khi nền worker nén 360/720/1080p. Trả `false` ở đây ẩn player hoàn toàn
  // — "báo lỗi luôn ntn thì khó cho t quá" đúng là triệu chứng: chưa nén xong mà
  // đã không cho xem bản gốc. `streamKind='file'` báo MediaPlayer dùng `<video src>`
  // gốc, không hls.js.
  //
  // **Chỉ `processing`, không `pending`**: `pending` là chưa probe xong, tệp gốc
  // chưa chắc đã nằm sẵn trên đĩa, và stream endpoint sẽ 404 nếu tìm không thấy —
  // trình phát dựng lên rồi hỏng giây sau tệ hơn không có gì. `processing` nghĩa
  // là probe đã xong, `original.<ext>` đã có.
  if (item.processingStatus === 'processing') return true
  return false
}

/** Boot and attempt tokens prevent PID reuse and duplicate job ownership. */
const bootToken = randomUUID().slice(0, 8)
const activeClaims = new Map<string, AbortController>()

export function processingClaim(_hostname: string = os.hostname(), _pid: number = process.pid): string {
  return `${bootToken}:${randomUUID()}`
}

export function abortProcessingClaim(claim: string | null | undefined): void {
  if (claim) activeClaims.get(claim)?.abort()
}

export function stopMediaProcessingJobs(): void {
  for (const controller of activeClaims.values()) controller.abort()
}

export function retryAt(attempts: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1)) * 1000)
}

/** Stable asset root survives generations; new uploads may use a UUID instead of the slug. */
export function mediaAssetRoot(item: { storagePath?: string | null, slug: string }): string {
  const stored = item.storagePath || `media/${item.slug}`
  const root = stored.split('/generations/')[0]!
  if (!/^media\/[a-zA-Z0-9_-]+$/.test(root)) throw new Error('Invalid media asset root')
  return root
}

/**
 * Whether this exact attempt is running in this server. This diagnostic helper
 * never extends a database lease; only the worker heartbeat does that.
 */
export function isProcessAlive(claim: string | null | undefined, hostname: string = os.hostname()): boolean {
  return typeof claim === 'string' && activeClaims.has(claim)
}

// ─── Chạy tiến trình ngoài ───────────────────────────────────────────────────

export type ProcessOutcome = { code: number, stdout: string, stderr: string }

/**
 * Callback tiến trình — nhận chuỗi stderr FFmpeg theo từng chunk. Dùng để parse
 * `time=00:01:23` → % của bản đang transcode. Truyền qua `ProcessRunner` options
 * thay vì trả qua `ProcessOutcome` (vì stderr chỉ có nghĩa khi stream).
 */
export type ProcessProgressCb = (stderrLine: string) => void

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { signal: AbortSignal, onProgress?: ProcessProgressCb },
) => Promise<ProcessOutcome>

/** Trần cho phần thông báo giữ lại của một tiến trình. */
const OUTPUT_CAPTURE_LIMIT = 64 * 1024

/**
 * Chạy một tiến trình, **giết nó khi tín hiệu huỷ bật lên**.
 *
 * Giữ **cả hai** luồng ra, và đó không phải chuyện cho đủ: `ffprobe` ghi JSON ra
 * `stdout` còn FFmpeg ghi thông báo lỗi ra `stderr`. Chỉ đọc `stderr` thì lượt
 * dò metadata không bao giờ đọc được gì, và triệu chứng là thời lượng cùng kích
 * thước nguồn **luôn rỗng** trong khi mọi lượt chuyển mã vẫn chạy đúng — không
 * có gì đỏ, chỉ là cột trống.
 *
 * Phần giữ lại có trần: FFmpeg in tiến độ liên tục, và một video dài sinh ra hàng
 * trăm KB thông báo. Giữ tất cả là một rò rỉ bộ nhớ trong một tệp sinh ra để
 * tránh đúng điều đó.
 */
export const defaultProcessRunner: ProcessRunner = (command, args, options) => {
  return new Promise<ProcessOutcome>((resolve) => {
    if (options.signal.aborted) { resolve({ code: -1, stdout: '', stderr: 'Processing cancelled' }); return }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (outcome: ProcessOutcome) => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => { child.kill('SIGKILL') }

    options.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAPTURE_LIMIT) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stderr.length < OUTPUT_CAPTURE_LIMIT) stderr += text
      // Stream dòng cho onProgress — FFmpeg ghi `time=HH:MM:SS` mỗi ~1s trên stderr.
      if (options.onProgress) {
        for (const line of text.split(/\r?\n/)) {
          if (line.includes('time=')) options.onProgress(line)
        }
      }
    })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * `nice -n 19` để một lượt chuyển mã làm cổng chậm đi chứ không bỏ đói nó.
 *
 * `cpuLimitPercent` (< 100) bọc ffmpeg qua `cpulimit -l <p> -z` nếu binary có sẵn
 * — giới hạn % CPU thật (không phải chỉ ưu tiên thấp). Không có `cpulimit` thì
 * lùi về `nice` + giảm luồng (`threads`) ở `transcodeRendition`: VPS đa nhân thì
 * 1 luồng ≈ 25–50% CPU, vẫn hơn full 6 luồng ăn sạch mọi nhân.
 */
function ffmpegArgs(args: string[], cpuLimitPercent = 100): { command: string, args: string[] } {
  if (cpuLimitPercent < 100 && cpulimitAvailable) {
    return { command: 'cpulimit', args: ['-l', String(cpuLimitPercent), '-z', 'ffmpeg', ...args] }
  }
  return { command: 'nice', args: ['-n', '19', 'ffmpeg', ...args] }
}

// Phát hiện `cpulimit` một lần lúc import — khôngговорит mỗi lượt transcode.
let cpulimitAvailable = false
try {
  execSync('command -v cpulimit', { stdio: 'ignore' })
  cpulimitAvailable = true
} catch {
  cpulimitAvailable = false
}

// ─── Đường ống ───────────────────────────────────────────────────────────────

export type ProcessingDeps = {
  db?: Database
  pool?: Pool | null
  config?: MediaConfig
  /** Chạy tiến trình ngoài. Có tham số để test ghim được thứ tự nhả-kết-nối-trước-khi-spawn. */
  run?: ProcessRunner
  statfs?: StatfsFn
  /**
   * Chu kỳ nhịp tim. Mặc định lấy từ `config.processingHeartbeatSeconds`.
   *
   * Là tham số vì nhịp thật là **năm phút**, và một test không thể chờ năm phút
   * để khẳng định nhịp tim lấy một kết nối rồi trả lại ngay. Cùng lối với `now`
   * của `housekeepUploads`.
   */
  heartbeatMs?: number
  /**
   * Chu kỳ phép kiểm đĩa. Mặc định một phút.
   *
   * Cùng lý do như `heartbeatMs`: một phút là đúng cho production và không kiểm
   * được trong một test — mà nhánh "đĩa vơi dần **trong lúc** chuyển mã" là nhánh
   * duy nhất phân biệt một phép kiểm chạy nền với một phép kiểm chạy một lần ở
   * đầu công việc.
   */
  diskCheckIntervalMs?: number
}

/**
 * `renditions` (tuỳ chọn): danh sách tên bản cán bộ chọn ở nút "Chuyển mã" (vd
 * `['360p','720p']`). Vắng = pipeline tự chọn theo chiều cao nguồn qua
 * `selectRenditions(probe.height)`.
 *
 * Giá trị đã được endpoint kiểm tra: chỉ tên trong `RENDITIONS` mới tới đây, và
 * đã loại trùng. Service **vẫn kiểm lại** — defense-in-depth: một lời gọi trực
 * tiếp (test, script) không đi qua endpoint, nên tin giá trị này là sai.
 */
export type ProcessInput = {
  mediaItemId: number
  renditions?: string[]
}

export type ProcessResult =
  | { ok: true, slug: string, renditions: string[] }
  | { ok: false, code: ProcessFailureCode, message: string }

export type ProcessFailureCode =
  | 'not_found'
  | 'not_upload'
  | 'busy'
  | 'source_missing'
  | 'unsupported_video'
  | 'failed'

/** Lỗi nội bộ mang theo lý do sẽ đi thẳng vào `processing_error`. */
class ProcessingFailure extends Error {
  readonly code: ProcessFailureCode

  constructor(message: string, code: ProcessFailureCode = 'failed') {
    super(message)
    this.name = 'ProcessingFailure'
    this.code = code
  }
}

/** Bật lên khi phép kiểm đĩa dừng công việc; lý do đã nằm trong `abortReason`. */
class ProcessingAborted extends Error {
  readonly code: ProcessFailureCode = 'failed'

  constructor(message: string) {
    super(message)
    this.name = 'ProcessingAborted'
  }
}

function deps(options: ProcessingDeps) {
  return {
    db: options.db ?? getDb(),
    config: options.config ?? resolveMediaConfig(),
    run: options.run ?? defaultProcessRunner,
  }
}

/**
 * Chạy một lượt chuyển mã cho một mục media đã tải lên.
 *
 * A busy admission leaves the durable pending row untouched. The scheduler
 * picks it up later; processing/failed rows cannot bypass their current claim
 * or retry budget by repeatedly calling this function.
 */
export async function processMediaItem(input: ProcessInput, options: ProcessingDeps = {}): Promise<ProcessResult> {
  const { db, config, run } = deps(options)
  const pool = options.pool ?? getPool()
  if (!pool) return { ok: false, code: 'failed', message: 'Không có kết nối cơ sở dữ liệu.' }

  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, input.mediaItemId)).limit(1)
  if (!item) return { ok: false, code: 'not_found', message: 'Không tìm thấy mục media này.' }
  if (item.source !== 'upload') {
    return { ok: false, code: 'not_upload', message: 'Chỉ mục tự lưu trữ mới cần chuyển mã.' }
  }
  let assetRoot: string
  try { assetRoot = mediaAssetRoot(item) } catch {
    await db.update(mediaItems).set({ processingStatus: 'failed', processingError: 'Đường dẫn media không hợp lệ.' })
      .where(and(eq(mediaItems.id, item.id), eq(mediaItems.processingStatus, 'pending')))
    return { ok: false, code: 'source_missing', message: 'Đường dẫn media không hợp lệ.' }
  }

  const alreadyReady = Array.isArray(item.resolutionsReady) ? item.resolutionsReady : []
  if (item.processingStatus === 'ready') {
    return { ok: true, slug: item.slug, renditions: alreadyReady }
  }

  const claim = processingClaim()
  const attempts = Number(item.processingAttempts ?? 0) + 1
  const now = new Date()
  if (item.processingStatus === 'pending' && attempts > (config.processingMaxAttempts ?? 3)) {
    await db.update(mediaItems).set({ processingStatus: 'failed', processingError: 'Đã hết số lượt tự động thử lại.' })
      .where(and(eq(mediaItems.id, item.id), eq(mediaItems.processingStatus, 'pending'), eq(mediaItems.processingAttempts, attempts - 1)))
  }
  if (item.processingStatus !== 'pending' || attempts > (config.processingMaxAttempts ?? 3)
    || (item.processingNextAttemptAt && item.processingNextAttemptAt > now)) {
    return { ok: false, code: 'busy', message: 'Mục chưa sẵn sàng nhận lượt xử lý.' }
  }

  // ── Giai đoạn 3a: nhận việc, TRONG khoá danh nghĩa ────────────────────────
  //
  // Khoá chỉ sống trong lời gọi này. `withNamedLock` trả kết nối về pool ở khối
  // `finally` của nó, tức là **trước** khi dòng dưới đây chạy tiếp. Từ đây trở
  // đi, sự sống của công việc nằm trên hàng dữ liệu (`claimed_by` + `updated_at`)
  // chứ không nằm trên một kết nối nào.
  const outcome = await withNamedLock(pool, TRANSCODE_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    const active = await db.select({ id: mediaItems.id }).from(mediaItems)
      .where(eq(mediaItems.processingStatus, 'processing')).limit(config.processingMaxJobs ?? 1)
    if (active.length >= (config.processingMaxJobs ?? 1)) return false
    const [claimed] = await db
      .update(mediaItems)
      .set({ processingStatus: 'processing', claimedBy: claim, processingError: null,
        processingAttempts: attempts, processingNextAttemptAt: null, processingHeartbeatAt: now })
      .where(and(eq(mediaItems.id, item.id), eq(mediaItems.processingStatus, 'pending'),
        eq(mediaItems.processingAttempts, attempts - 1)))
    return affectedRowsOrZero(claimed) > 0
  })

  if (!outcome.acquired) {
    return { ok: false, code: 'busy', message: 'Một lượt chuyển mã khác đang chạy.' }
  }
  if (!outcome.value) {
    return { ok: false, code: 'busy', message: 'Một lượt chuyển mã khác đang chạy.' }
  }

  // ── Từ đây mới spawn FFmpeg. Kết nối đã về pool ở trên. ───────────────────

  const scratchRoot = path.resolve(config.workdir, 'processing')
  const scratch = path.join(scratchRoot, `${item.id}-${claim}`)
  const sourceDirectory = path.resolve(config.workdir, assetRoot)
  const storagePath = `${assetRoot}/generations/${claim}`
  const published = path.resolve(config.workdir, storagePath)
  const ready: string[] = []
  const controller = new AbortController()
  activeClaims.set(claim, controller)
  let abortReason: string | null = null

  const stop = (reason: string) => {
    if (abortReason) return
    abortReason = reason
    controller.abort()
  }

  const guard = startDiskGuard({
    path: config.workdir,
    floorBytes: config.diskFloorBytes,
    intervalMs: options.diskCheckIntervalMs ?? DISK_CHECK_INTERVAL_MS,
    statfs: options.statfs,
    onAbort: (failure) => {
      // Hai sự kiện khác nhau vì chúng đòi hai cách xử lý khác nhau: `low` là
      // dọn đĩa, `error` là đi xem vì sao `statfs` hỏng.
      if (failure.kind === 'low') logWarn({ event: 'media.disk_full', mediaItemId: item.id, reason: failure.reason })
      else logWarn({ event: 'media.disk_guard_failed', mediaItemId: item.id, reason: failure.reason })
      stop(failure.reason)
    },
  })
  const heartbeatMs = options.heartbeatMs ?? config.processingHeartbeatSeconds * 1000
  const heartbeat = setInterval(() => {
    // Nhịp tim lấy một kết nối từ pool, ghi, rồi trả ngay — nó không giữ gì giữa
    // hai nhịp. Ghi thẳng `updated_at` thay vì dựa vào `ON UPDATE CURRENT_TIMESTAMP`:
    // MySQL chỉ tự cập nhật dấu thời gian khi **có** một cột khác đổi giá trị, và
    // một nhịp tim không đổi gì cả sẽ lặng lẽ không đóng dấu gì.
    void db
      .update(mediaItems)
      .set({ processingHeartbeatAt: new Date() })
      .where(and(eq(mediaItems.id, item.id), eq(mediaItems.claimedBy, claim), eq(mediaItems.processingStatus, 'processing')))
      .then(([result]) => { if (affectedRowsOrZero(result) === 0) stop('Lượt xử lý đã mất quyền sở hữu.') })
      .catch(() => stop('Không thể xác nhận quyền sở hữu lượt xử lý.'))
  }, Math.max(1, heartbeatMs))
  heartbeat.unref?.()

  try {
    // ── Giai đoạn 1: định vị tệp gốc và kiểm byte đầu ───────────────────────
    const original = await locateOriginal(sourceDirectory)
    if (!original) throw new ProcessingFailure('Không tìm thấy tệp gốc đã lưu của mục này.', 'source_missing')

    const container = await sniffFile(original)
    if (!container) throw new ProcessingFailure(UNSUPPORTED_VIDEO_MESSAGE, 'unsupported_video')

    const preCheck = await checkDiskSpace(config.workdir, config.diskFloorBytes, options.statfs)
    if (!preCheck.ok) throw new ProcessingFailure(preCheck.reason)

    await fs.mkdir(scratch, { recursive: true })
    await fs.mkdir(published, { recursive: true })

    // ── Giai đoạn 2: ffprobe ────────────────────────────────────────────────
    const probe = await probeMedia(original, run, controller.signal)
    if (probe.durationSeconds !== null || probe.width !== null || probe.height !== null) {
      await db
        .update(mediaItems)
        .set({
          durationSeconds: probe.durationSeconds,
          width: probe.width,
          height: probe.height,
        })
        .where(and(eq(mediaItems.id, item.id), eq(mediaItems.claimedBy, claim)))
    }

    // ── Giai đoạn 4: chuyển mã + cắt HLS, công bố ngay khi mỗi bản xong ─────
    // Cán bộ có thể chọn bản cụ thể ở nút "Chuyển mã" (vd chỉ 360p+720p cho video
    // nhẹ). Vắng → `selectRenditions` tự chọn theo chiều cao nguồn (không nâng
    // cấp, không bao giờ rỗng). Lọc `RENDITIONS` theo tên đã chọn; tên lạ đã bị
    // endpoint chặn nên ở đây chỉ là an toàn lớp hai và giữ `plan` luôn đúng shape.
    const autoPlan = selectRenditions(probe.height)
    const manualRenditions = input.renditions && input.renditions.length > 0
    const plan = manualRenditions
      ? RENDITIONS.filter((render) => input.renditions!.includes(render.name)).map((render) => ({ ...render }))
      : autoPlan
    // `autoTranscode=false` = chỉ probe + thumbnail, giữ tệp gốc; cán bộ bấm
    // "Xử lý sau" (endpoint `process.post.ts` → `enqueueMediaProcessing`) để
    // transcode khi rảnh. Tránh lag máy chủ lúc upload video lớn.
    //
    // Nhưng một yêu cầu **tường minh** `renditions` (cán bộ bấm "Nén chất lượng"
    // chọn 360p/720p) phải chạy **bất kể** `autoTranscode` — config đó quyết định
    // hành vi tự động lúc upload, không phải phủ một thao tác thủ công. Nếu không
    // có ngoại lệ này thì nút "Nén chất lượng" báo "đã đưa vào hàng chờ" rồi lặng
    // lẽ skip, và cán bộ không bao giờ thấy bản nào được sinh ra.
    if (!config.autoTranscode && !manualRenditions) {
      logInfo({ event: 'media.transcode_skipped', mediaItemId: item.id, slug: item.slug, reason: 'autoTranscode disabled' })
    } else {
      // Các bước công bố chạy **nối đuôi nhau**, không song song: chúng cùng ghi
      // một `master.m3u8` qua cùng một tệp tạm, nên hai bản xong cùng lúc sẽ tranh
      // nhau đúng tệp tạm đó — bản sau ghi đè bản trước, rồi một lượt `rename`
      // ném ENOENT. Việc chuyển mã vẫn song song; chỉ phần công bố là tuần tự.
      let publishChain: Promise<void> = Promise.resolve()

      // CPU limit < 100 → chạy tuần tự (1 bản/lúc) để ffmpeg không ăn hết nhân;
      // = 100 → song song 3 bản như cũ (VPS đủ mạnh).
      const concurrency = config.processingCpuLimit >= 100 ? MAX_CONCURRENT_RENDITIONS : 1

      await runBounded(plan.map(rendition => async () => {
        if (controller.signal.aborted) throw new ProcessingAborted(abortReason ?? 'Lượt xử lý đã bị hủy.')

        // Đặt phase + rendition cho bản sắp transcode — UI hiện "đang nén 720p".
        await db.update(mediaItems)
          .set({ processingRendition: rendition.name, processingPercent: 0, processingPhase: 'transcode' })
          .where(eq(mediaItems.id, item.id))

        // Throttle ghi % — FFmpeg stderr ~1/s, nhưng ghi DB mỗi giây là quá nhiều
        // round-trip. 2s đủ mượt cho UI (poll 3s) mà không úp bảng.
        let lastProgressWrite = 0
        const PROGRESS_WRITE_INTERVAL_MS = 2000

        await transcodeRendition({
          input: original, rendition, scratch, run, signal: controller.signal,
          cpuLimitPercent: config.processingCpuLimit,
          durationSeconds: probe.durationSeconds,
          onProgress: (percent) => {
            const now = Date.now()
            if (now - lastProgressWrite < PROGRESS_WRITE_INTERVAL_MS && percent < 100) return
            lastProgressWrite = now
            // Best-effort — không await: một lượt ghi hỏng không làm hỏng transcode.
            void db.update(mediaItems)
              .set({ processingPercent: percent })
              .where(eq(mediaItems.id, item.id))
              .catch(() => {})
          },
        })
        // Bản xong → % 100, giữ rendition để UI thấy "vừa xong" cho đến khi sang bản kế.
        await db.update(mediaItems)
          .set({ processingPercent: 100 })
          .where(eq(mediaItems.id, item.id))
          .catch(() => {})
        if (controller.signal.aborted) throw new ProcessingAborted(abortReason ?? 'Lượt xử lý đã bị hủy.')

        publishChain = publishChain.then(async () => {
          await publishDirectory(path.join(scratch, rendition.name), path.join(published, rendition.name))
          ready.push(rendition.name)
          // Playlist TRƯỚC, cơ sở dữ liệu SAU. Ngược lại thì một lượt ghi hỏng để
          // `resolutions_ready` khai một bản mà playlist không trỏ tới, và trình
          // phát không tìm thấy nó. Chiều này thì tệ nhất là playlist có một bản
          // đã nằm trên đĩa nhưng cơ sở dữ liệu chưa biết — lượt chạy sau ghi lại.
          await writeManifestAtomically(
            path.join(published, 'master.m3u8'),
            buildMasterPlaylist(masterVariants(ready, plan, probe)),
          )
          const [publication] = await db
            .update(mediaItems)
            .set({ resolutionsReady: [...ready], storagePath })
            .where(and(eq(mediaItems.id, item.id), eq(mediaItems.claimedBy, claim)))
          if (affectedRowsOrZero(publication) === 0) throw new ProcessingAborted('Lượt xử lý đã mất quyền sở hữu.')
        })
        await publishChain
      }), concurrency)
    }

    if (controller.signal.aborted) throw new ProcessingAborted(abortReason ?? 'Lượt xử lý đã bị hủy.')

    // ── Giai đoạn 5: ảnh đại diện ──────────────────────────────────────────
    //
    // Hỏng ở đây **không** làm hỏng công việc: một video phát được mà thiếu ảnh
    // đại diện vẫn là một video phát được, còn đánh hỏng cả lượt chuyển mã vì
    // không trích được một khung hình là đánh đổi sai.
    try {
      await extractThumbnail({ input: original, probe, scratch, run, signal: controller.signal })
      await publishFile(path.join(scratch, 'thumb.jpg'), path.join(published, 'thumb.jpg'))
    } catch (error) {
      logWarn({
        event: 'media.thumbnail_failed',
        mediaItemId: item.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    // ── Giai đoạn 6: playlist đã được ghi nguyên tử ở trên, mỗi lượt công bố ─

    // ── Giai đoạn 7: đồng bộ R2 (nếu bật) + dọn và đóng ──────────────────────
    if (controller.signal.aborted) throw new ProcessingAborted(abortReason ?? 'Lượt xử lý đã bị hủy.')

    // R2 cho video: nếu `provider='r2'` và đủ credential, sync cây `published`
    // lên R2 rồi xoá local (R2 là nguồn chính). Sync fail → giữ local + đánh dấu
    // `storageProvider='local'` (lùi an toàn, video vẫn phát được từ đĩa).
    // FFmpeg cần filesystem local nên không thể transcode thẳng lên R2.
    let finalStorageProvider: 'local' | 'r2' = 'local'
    const r2Config = config.videoStorage.provider === 'r2' ? config.videoStorage.r2 : undefined
    if (r2Config) {
      try {
        const { files, bytes } = await syncDirectoryToR2(published, storagePath, r2Config)
        finalStorageProvider = 'r2'
        logInfo({
          event: 'media.r2_synced',
          mediaItemId: item.id,
          slug: item.slug,
          files,
          bytes,
        })
        // Sync thành công → xoá cây local published (R2 là nguồn chính).
        await fs.rm(published, { recursive: true, force: true }).catch(() => undefined)
      } catch (error) {
        // Sync fail — giữ local, đánh dấu 'local', log cảnh báo. Video vẫn phát
        // được từ đĩa. Không ném: một lượt R2 hỏng không được làm hỏng cả lượt
        // transcode đã thành công.
        logWarn({
          event: 'media.r2_sync_failed',
          mediaItemId: item.id,
          slug: item.slug,
          message: error instanceof Error ? error.message : String(error),
        })
        finalStorageProvider = 'local'
      }
    }

    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    const [finished] = await db
      .update(mediaItems)
      .set({
        processingStatus: 'ready',
        claimedBy: null,
        processingError: null,
        resolutionsReady: [...ready],
        storageProvider: finalStorageProvider,
        // Reset tiến trình — không giữ lại % của lượt cũ khi đã ready.
        processingRendition: null,
        processingPercent: null,
        processingPhase: 'sync',
      })
      .where(and(eq(mediaItems.id, item.id), eq(mediaItems.claimedBy, claim)))
    if (affectedRowsOrZero(finished) === 0) throw new ProcessingAborted('Lượt xử lý đã mất quyền sở hữu.')

    logInfo({ event: 'media.transcode_ready', mediaItemId: item.id, slug: item.slug, renditions: ready })
    return { ok: true, slug: item.slug, renditions: ready }
  } catch (error) {
    // Khi phép kiểm đĩa dừng công việc, nó `SIGKILL` tiến trình FFmpeg — nên
    // thứ ném ra trước tiên là một `ProcessingFailure` mang thông báo của FFmpeg
    // ("mã thoát -1"), **không phải** lý do hết đĩa. Ghi lý do đó vào
    // `processing_error` là để lại đúng một câu vô nghĩa ở chỗ cán bộ đọc, và
    // xoá mất thứ duy nhất chỉ vào nguyên nhân thật. `abortReason` thắng.
    const reason = abortReason ?? (error instanceof Error ? error.message : String(error))
    const permanent = error instanceof ProcessingFailure && ['source_missing', 'unsupported_video'].includes(error.code)
    await markProcessingFailed(db, item.id, claim, reason, attempts, config.processingMaxAttempts ?? 3, permanent)
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined)
    logWarn({
      event: 'media.transcode_failed',
      mediaItemId: item.id,
      slug: item.slug,
      renditions: ready,
      reason,
    })
    if (abortReason) return { ok: false, code: 'failed', message: reason }
    if (error instanceof ProcessingAborted) return { ok: false, code: error.code, message: reason }
    if (error instanceof ProcessingFailure) return { ok: false, code: error.code, message: reason }
    return { ok: false, code: 'failed', message: reason }
  } finally {
    controller.abort()
    activeClaims.delete(claim)
    clearInterval(heartbeat)
    guard.stop()
  }
}

/**
 * Đánh dấu hỏng kèm lý do — và **giữ nguyên** `resolutions_ready`.
 *
 * Mục hỏng thì không phát được (`isPlayable` đọc `processing_status`), nên mảng
 * này không còn là thứ mở cửa cho trình phát. Nó được giữ vì một lý do khác: nó
 * là **bằng chứng về việc đã làm được tới đâu**, và là thứ duy nhất cho biết lượt
 * chạy lại có thể bỏ qua những bản đã cắt xong. Xoá nó đi thì một lượt hỏng ở bản
 * thứ ba trông y hệt một lượt hỏng ở giây đầu tiên, và cả hai đều dẫn tới cùng
 * một hành động: chạy lại từ đầu.
 */
async function markProcessingFailed(db: Database, mediaItemId: number, claim: string, reason: string,
  attempts: number, maximum: number, permanent: boolean): Promise<void> {
  await db
    .update(mediaItems)
    .set({
      processingStatus: permanent || attempts >= maximum ? 'failed' : 'pending',
      processingNextAttemptAt: permanent || attempts >= maximum ? null : retryAt(attempts),
      processingError: reason.slice(0, PROCESSING_ERROR_LIMIT),
      claimedBy: null,
      processingRendition: null,
      processingPercent: null,
      processingPhase: null,
    })
    .where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.claimedBy, claim)))
    .catch(() => undefined)
}

/** Tệp gốc do `completeUpload` chuyển vào: `original.<đuôi suy từ nội dung>`. */
async function locateOriginal(published: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(published)
  } catch {
    return null
  }
  const found = entries.find(entry => entry.startsWith('original.'))
  return found ? path.join(published, found) : null
}

/** Đọc 64 byte đầu. Không `readFile`: tệp ở đây nặng tới 10 GB. */
async function sniffFile(filePath: string): Promise<ReturnType<typeof detectVideoMime>> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(VIDEO_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, VIDEO_SNIFF_BYTES, 0)
    return detectVideoMime(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function probeMedia(filePath: string, run: ProcessRunner, signal: AbortSignal) {
  const outcome = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { signal })
  if (outcome.code !== 0) return { durationSeconds: null, width: null, height: null }
  // `stdout` chứ không `stderr`: `-print_format json` ghi JSON ra luồng chuẩn.
  return parseProbeJson(outcome.stdout)
}

async function transcodeRendition(input: {
  input: string
  rendition: Rendition
  scratch: string
  run: ProcessRunner
  signal: AbortSignal
  cpuLimitPercent?: number
  /** Thời lượng gốc (giây) để parse % từ `time=`. Vắng → không gọi onProgress. */
  durationSeconds?: number | null
  /** Callback tiến trình — nhận % (0–100) của bản hiện tại. */
  onProgress?: (percent: number) => void
}): Promise<void> {
  const { input: source, rendition, scratch, run, signal, cpuLimitPercent = 100, durationSeconds, onProgress } = input
  const outputDir = path.join(scratch, rendition.name)
  await fs.mkdir(outputDir, { recursive: true })

  // Giảm luồng khi CPU limit thấp: 100% → THREADS_PER_RENDITION, ≤50% → 1 luồng.
  const threads = cpuLimitPercent >= 100 ? THREADS_PER_RENDITION : 1

  const { command, args } = ffmpegArgs([
    '-hide_banner', '-nostdin', '-y',
    '-i', source,
    '-vf', `scale=-2:${rendition.height}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-threads', String(threads),
    // Cắt đoạn chỉ sạch khi mỗi đoạn bắt đầu ở một keyframe; ép keyframe đúng
    // chu kỳ đoạn để trình phát tua được mà không phải giải mã từ đầu video.
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    '-c:a', 'aac', '-b:a', `${rendition.audioBitrateKbps}k`, '-ac', '2',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outputDir, 'seg_%03d.ts'),
    path.join(outputDir, 'index.m3u8'),
  ], cpuLimitPercent)

  const outcome = await run(command, args, {
    signal,
    onProgress: onProgress && durationSeconds && durationSeconds > 0
      ? (line) => {
        const sec = parseFfmpegTime(line)
        if (sec != null) {
          const pct = Math.min(100, Math.max(0, Math.round((sec / durationSeconds) * 100)))
          onProgress(pct)
        }
      }
      : undefined,
  })
  if (outcome.code !== 0) {
    throw new ProcessingFailure(
      `FFmpeg thất bại ở bản ${rendition.name}: ${lastLine(outcome.stderr) || `mã thoát ${outcome.code}`}`,
    )
  }
}

/**
 * Parse `time=HH:MM:SS.mmm` từ dòng stderr FFmpeg → số giây. Trả `null` khi dòng
 * không có `time=` (vd dòng `frame=`, `Stream mapping`). FFmpeg ghi `time=` mỗi
 * ~1 giây trên stderr khi transcode, nên callback tiến trình nhận cập nhật định
 * kỳ mà không cần poll trạng thái.
 */
function parseFfmpegTime(line: string): number | null {
  const m = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2]), s = Number(m[3])
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(s)) return null
  return h * 3600 + min * 60 + s
}

async function extractThumbnail(input: {
  input: string
  probe: { durationSeconds: number | null }
  scratch: string
  run: ProcessRunner
  signal: AbortSignal
}): Promise<void> {
  const { input: source, probe, scratch, run, signal } = input
  // 10% thời lượng, không phải khung đầu: khung đầu của phần lớn video là một
  // tấm nền đen, và một ảnh đại diện đen không nói lên điều gì.
  const at = probe.durationSeconds && probe.durationSeconds > 0
    ? Math.min(probe.durationSeconds * 0.1, 10)
    : 0

  const { command, args } = ffmpegArgs([
    '-hide_banner', '-nostdin', '-y',
    '-ss', String(Math.max(0, at)),
    '-i', source,
    '-frames:v', '1',
    '-vf', 'scale=-2:720',
    '-q:v', '3',
    path.join(scratch, 'thumb.jpg'),
  ])

  const outcome = await run(command, args, { signal })
  if (outcome.code !== 0) {
    throw new ProcessingFailure(`Không trích được ảnh đại diện: ${lastLine(outcome.stderr)}`)
  }
}

/**
 * Trích một khung hình làm ảnh đại diện **lúc phục vụ** — fallback khi thumb
 * tĩnh không có ở đâu (pipeline upload fail giai đoạn 5, hoặc item cũ chưa từng
 * qua `processMediaItem`).
 *
 * Khác `extractThumbnail` (pipeline): không có `probe` sẵn nên không biết 10%
 * thời lượng. Dùng **2 giây cố định** — đa số video dài hơn 2s, và khung đầu (0s)
 * thường là tấm nền đen. Một video <2s sẽ trượt về khung đầu, vẫn hơn không có
 * ảnh gì. Trần 2s cố định thay vì probe riêng vì: probe tốn thêm một lượt FFmpeg,
 * và đây là nhánh dự phòng — nếu chạy thường thì thumb tĩnh phải được sửa ở nguồn.
 *
 * Trả `true` nếu thành công, `false` nếu FFmpeg fail (file hỏng, codec lạ). Không
 * ném: endpoint gọi sẽ lùi về 404, và một ảnh thiếu vẫn đọc ra là "chưa có thumb"
 * thay vì "cổng gãy".
 */
export async function extractThumbnailOnDemand(
  input: string,
  outPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const { command, args } = ffmpegArgs([
    '-hide_banner', '-nostdin', '-y',
    '-ss', '2',
    '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=-2:720',
    '-q:v', '3',
    outPath,
  ])
  try {
    const signal = options.signal ?? new AbortController().signal
    const outcome = await defaultProcessRunner(command, args, { signal })
    return outcome.code === 0
  } catch {
    return false
  }
}

/**
 * Đưa một thư mục đã cắt xong từ thư mục nháp vào cây công bố.
 *
 * Xoá đích trước rồi `rename`: một lượt chạy lại có thể gặp thư mục của lần
 * trước còn sót, và `rename` lên một thư mục không rỗng sẽ ném. Khoảng trống
 * giữa hai lệnh không lộ ra ngoài vì playlist chỉ được ghi **sau** bước này.
 */
async function publishDirectory(from: string, to: string): Promise<void> {
  await fs.rm(to, { recursive: true, force: true })
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
}

async function publishFile(from: string, to: string): Promise<void> {
  await fs.rm(to, { force: true })
  await fs.rename(from, to)
}

function masterVariants(
  ready: readonly string[],
  plan: readonly Rendition[],
  probe: { width: number | null, height: number | null },
): MasterVariant[] {
  const variants: MasterVariant[] = []
  for (const name of ready) {
    const rendition = plan.find(entry => entry.name === name)
    if (!rendition) continue
    variants.push({
      name: rendition.name,
      height: rendition.height,
      width: probe.width && probe.height
        ? scaledWidth(probe.width, probe.height, rendition.height)
        : null,
      bandwidth: (rendition.videoBitrateKbps + rendition.audioBitrateKbps) * 1000,
    })
  }
  return variants
}

/**
 * Chạy tối đa `limit` việc cùng lúc; việc đầu tiên ném ra thì **dừng cả hàng đợi**.
 *
 * Dừng hàng đợi chứ không chỉ ném ra là điều đáng nói: `Promise.allSettled` một
 * mình sẽ để những worker còn lại chạy nốt những bản chuyển mã còn lại của một
 * công việc đã hỏng. Trên VPS 1–2 GB, đó là vài tiến trình FFmpeg đốt CPU trong
 * nhiều phút cho một kết quả sẽ bị vứt đi — và chúng còn tranh CPU với lượt chạy
 * lại mà cán bộ vừa bấm.
 */
async function runBounded(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  const queue = [...tasks]
  let failure: unknown = null

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), Math.max(1, queue.length)) },
    async () => {
      while (queue.length > 0 && failure === null) {
        const task = queue.shift()
        if (!task) return
        try {
          await task()
        } catch (error) {
          if (failure === null) failure = error
          return
        }
      }
    },
  )
  await Promise.all(workers)
  if (failure !== null) throw failure
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n')
  return (lines[lines.length - 1] ?? '').trim()
}
