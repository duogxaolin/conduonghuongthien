/**
 * Bản chuyển mã: chọn bản nào, công bố chúng vào cây thế hệ, dựng playlist, và
 * một mục có phát được không.
 *
 * Tách từ `video-processing.ts` (wave2 5.4). Không import tệp anh em nào — chỉ
 * `fs`/`path` — nên mọi tệp `video-*` khác import được nó mà không sinh vòng.
 *
 * `writeManifestAtomically` là đường ghi `master.m3u8` duy nhất; lời gọi ghi tên
 * tệp đó nằm ở `video-transcode-pipeline.ts` (giai đoạn 4), và
 * `tests/media-processing.test.ts` khoá đúng một chỗ ghi.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Số bản chuyển mã chạy song song. Trần cho VPS 1–2 GB: 3 × 2 luồng ≤ 6 nhân. */
export const MAX_CONCURRENT_RENDITIONS = 3

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

export function masterVariants(
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

// ─── Công bố vào cây thế hệ ──────────────────────────────────────────────────

/**
 * Đưa một thư mục đã cắt xong từ thư mục nháp vào cây công bố.
 *
 * Xoá đích trước rồi `rename`: một lượt chạy lại có thể gặp thư mục của lần
 * trước còn sót, và `rename` lên một thư mục không rỗng sẽ ném. Khoảng trống
 * giữa hai lệnh không lộ ra ngoài vì playlist chỉ được ghi **sau** bước này.
 */
export async function publishDirectory(from: string, to: string): Promise<void> {
  await fs.rm(to, { recursive: true, force: true })
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
}

export async function publishFile(from: string, to: string): Promise<void> {
  await fs.rm(to, { force: true })
  await fs.rename(from, to)
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
export async function runBounded(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
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

// ─── Phát được hay chưa ──────────────────────────────────────────────────────

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
