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
import fs from 'node:fs/promises'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { getPool } from '../utils/db'
import { mediaItems } from '../db/schema'
import { withNamedLock } from '../utils/named-lock'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logInfo, logWarn } from '../utils/logger'
import { UNSUPPORTED_VIDEO_MESSAGE } from '../utils/video-mime'
import { syncDirectoryToR2 } from './video-r2-sync'
import { ProcessingAborted, ProcessingFailure, probeMedia, transcodeRendition } from './video-process-runner'
import { extractThumbnail } from './video-thumbnail-frame'
import { MAX_CONCURRENT_RENDITIONS, RENDITIONS, buildMasterPlaylist, masterVariants, publishDirectory, publishFile, runBounded, selectRenditions, writeManifestAtomically } from './video-renditions'
import { DISK_CHECK_INTERVAL_MS, checkDiskSpace, startDiskGuard } from './video-disk-guard'
import { deps, forgetProcessingClaim, locateOriginal, markProcessingFailed, mediaAssetRoot, processingClaim, sniffFile, trackProcessingClaim, type ProcessInput, type ProcessingDeps, type ProcessResult } from './video-processing-job'

/** Cùng tên khoá với lượt bắt đầu đường ống — reaper (8.x) lấy đúng khoá này. */
export const TRANSCODE_LOCK_NAME = 'cdkt:media:transcode'
const LOCK_TIMEOUT_SECONDS = 0

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
  trackProcessingClaim(claim, controller)
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
    forgetProcessingClaim(claim)
    clearInterval(heartbeat)
    guard.stop()
  }
}
