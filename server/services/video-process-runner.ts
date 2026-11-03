/**
 * Chạy tiến trình ngoài và dựng lệnh FFmpeg/ffprobe cho đường ống chuyển mã.
 *
 * Tách từ `video-processing.ts` (wave2 5.4). Tầng dưới cùng của nhóm tệp
 * `video-*`: không import tệp anh em nào ngoài kiểu `Rendition`, nên tệp nào
 * trong nhóm cũng import được nó mà không sinh vòng.
 *
 *   • `defaultProcessRunner` — spawn, giữ cả hai luồng ra có trần, giết khi hủy.
 *   • `ffmpegArgs` — bọc `nice`/`cpulimit`; phép dò `cpulimit` chạy MỘT lần lúc
 *     import, và chỉ ở tệp này (test ép nhánh qua `setCpulimitAvailableForTests`).
 *   • Lệnh của từng bước: `probeMedia` (ffprobe), `transcodeRendition` (HLS).
 *     Hai lệnh trích ảnh đại diện ở `video-thumbnail-frame.ts`.
 *   • Từ vựng lỗi chung của một lượt xử lý: `ProcessFailureCode`,
 *     `ProcessingFailure`, `ProcessingAborted` — một định nghĩa duy nhất, để
 *     `instanceof` ở đường ống khớp với lỗi ném ra ở đây.
 */
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Rendition } from './video-renditions'

/** Mỗi bản 2 luồng: nhiều hơn thì ba bản song song tranh hết nhân của máy chủ. */
const THREADS_PER_RENDITION = 2

/** Độ dài một đoạn HLS. 4 giây: đủ ngắn để tua, đủ dài để không ngập request. */
const HLS_SEGMENT_SECONDS = 4

// ─── Lỗi của một lượt xử lý ──────────────────────────────────────────────────

export type ProcessFailureCode =
  | 'not_found'
  | 'not_upload'
  | 'busy'
  | 'source_missing'
  | 'unsupported_video'
  | 'failed'

/** Lỗi nội bộ mang theo lý do sẽ đi thẳng vào `processing_error`. */
export class ProcessingFailure extends Error {
  readonly code: ProcessFailureCode

  constructor(message: string, code: ProcessFailureCode = 'failed') {
    super(message)
    this.name = 'ProcessingFailure'
    this.code = code
  }
}

/** Bật lên khi phép kiểm đĩa dừng công việc; lý do đã nằm trong `abortReason`. */
export class ProcessingAborted extends Error {
  readonly code: ProcessFailureCode = 'failed'

  constructor(message: string) {
    super(message)
    this.name = 'ProcessingAborted'
  }
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
export function ffmpegArgs(args: string[], cpuLimitPercent = 100): { command: string, args: string[] } {
  if (cpuLimitPercent < 100 && cpulimitAvailable) {
    return { command: 'cpulimit', args: ['-l', String(cpuLimitPercent), '-z', 'ffmpeg', ...args] }
  }
  return { command: 'nice', args: ['-n', '19', 'ffmpeg', ...args] }
}

// Phát hiện `cpulimit` một lần lúc import — không dò lại ở mỗi lượt chuyển mã.
let cpulimitDetected = false
try {
  execSync('command -v cpulimit', { stdio: 'ignore' })
  cpulimitDetected = true
} catch {
  cpulimitDetected = false
}
let cpulimitAvailable = cpulimitDetected

/**
 * Chỉ cho test: ép nhánh `cpulimit` có/không. `null` = trả về kết quả dò lúc import.
 *
 * Máy dev và CI không có `cpulimit`, còn image chạy thật luôn có (Dockerfile cài
 * nó, giới hạn CPU mặc định 50) — nên không có điểm tiêm này thì argv của nhánh
 * chạy ở production không test nào chạm tới được.
 */
export function setCpulimitAvailableForTests(next: boolean | null): void {
  cpulimitAvailable = next ?? cpulimitDetected
}

export function lastLine(text: string): string {
  const lines = text.trim().split('\n')
  return (lines[lines.length - 1] ?? '').trim()
}

// ─── ffprobe ─────────────────────────────────────────────────────────────────

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

export async function probeMedia(filePath: string, run: ProcessRunner, signal: AbortSignal) {
  const outcome = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { signal })
  if (outcome.code !== 0) return { durationSeconds: null, width: null, height: null }
  // `stdout` chứ không `stderr`: `-print_format json` ghi JSON ra luồng chuẩn.
  return parseProbeJson(outcome.stdout)
}

// ─── Chuyển mã một bản sang HLS ──────────────────────────────────────────────

export async function transcodeRendition(input: {
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
