/**
 * Trích MỘT khung hình làm ảnh đại diện video — hai lối vào, một công thức.
 *
 * Tách từ `video-processing.ts` (wave2 5.4). Hai hàm ở chung một tệp vì chúng
 * dùng chung công thức FFmpeg (`-frames:v 1 -vf scale=-2:720 -q:v 3`) và chỉ khác
 * mốc thời gian: sửa công thức thì sửa cả hai ở một chỗ, nhìn thấy nhau.
 *
 *   • `extractThumbnail` — giai đoạn 5 của đường ống, biết thời lượng (10 %).
 *   • `extractThumbnailOnDemand` — lúc phục vụ, không có probe (giây thứ 2).
 *     Không gọi thẳng từ endpoint công khai: `thumbnail-on-demand.ts` bọc nó
 *     (gộp yêu cầu, trần đồng thời, hạn giờ, nhớ lỗi) và import nó qua
 *     `video-processing.ts`.
 */
import path from 'node:path'
import { defaultProcessRunner, ffmpegArgs, lastLine, ProcessingFailure, type ProcessRunner } from './video-process-runner'

export async function extractThumbnail(input: {
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
 *
 * Không gọi thẳng từ endpoint công khai: đi qua `onDemandThumbnails`
 * (`thumbnail-on-demand.ts` — gộp yêu cầu, trần đồng thời, hạn 15 s, nhớ lỗi).
 * `run` là điểm tiêm cho test (mặc định `defaultProcessRunner`, giết bằng SIGKILL
 * khi `signal` bật).
 */
export async function extractThumbnailOnDemand(
  input: string,
  outPath: string,
  options: { signal?: AbortSignal, run?: ProcessRunner } = {},
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
    const outcome = await (options.run ?? defaultProcessRunner)(command, args, { signal })
    return outcome.code === 0 && !signal.aborted
  } catch {
    return false
  }
}
