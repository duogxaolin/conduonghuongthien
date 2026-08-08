/**
 * Hiệu ứng chữ hiện dần cho câu trả lời của trợ lý.
 *
 * Tách khỏi `useChatbot.ts` (939 dòng) — composable đó gộp bốn việc không liên
 * quan: chuẩn hoá dữ liệu hội thoại, lưu vào localStorage, gọi API, và phần
 * này. Đây là khối tách sạch nhất: nó không đọc state hội thoại nào, chỉ nhận
 * một `message` và một chuỗi, nên nó kiểm được **mà không cần dựng cả trợ lý**
 * — đúng điều `tests/chatbot-typing-playback.test.ts` đang làm.
 *
 * `useChatbot.ts` re-export lại `playTypewriter` và hai hằng số để mọi nơi gọi
 * cũ (và bộ test) giữ nguyên một đường import.
 */
import type { ChatMessage } from './useChatbot'

/**
 * Playback pacing — a reading pace, not a progress bar.
 *
 * These two numbers answer different questions and the earlier pair had both
 * wrong in the same direction. `TYPEWRITER_WORD_DELAY_MS` sets how fast words
 * appear; at 30ms it revealed ~33 words per second, and since the everyday
 * replies measure a median of 33 words, a whole answer flashed into place in
 * under a second. Nothing was legible while it moved, so the effect read as a
 * glitch rather than as typing. 70ms is roughly 14 words per second — the pace
 * of the streaming chat interfaces a visitor has already seen, and slow enough
 * that the text can be followed as it lands.
 *
 * `TYPEWRITER_MAX_MS` only exists for the long tail: the knowledge bank's legal
 * answers run to ~330 words, which at 70ms each would hold the visitor for 23
 * seconds over text already sitting in memory. The cap engages past ~85 words,
 * so every everyday reply and most approved answers keep the full per-word pace
 * and only the genuinely long ones compress.
 */
export const TYPEWRITER_WORD_DELAY_MS = 70
export const TYPEWRITER_MAX_MS = 6000

let typewriterTimer: ReturnType<typeof setTimeout> | null = null
let typewriterFinish: (() => void) | null = null

// ─── Typewriter playback ─────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (!import.meta.client || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Monotonic where available, so a clock adjustment mid-answer cannot skew pacing. */
function now(): number {
  return typeof performance?.now === 'function' ? performance.now() : Date.now()
}

/**
 * One playback step per animation frame, so the DOM write and the scroll that
 * follows it happen at the rate the browser actually paints. A background tab
 * stops painting and therefore stops firing these — which is correct here,
 * because there is nobody watching the words appear. Pacing is read from the
 * clock, so the frame that arrives on return reveals everything now due.
 */
function schedule(step: () => void): ReturnType<typeof setTimeout> {
  if (import.meta.client && typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(step) as unknown as ReturnType<typeof setTimeout>
  }
  return setTimeout(step, 16)
}

function cancel(handle: ReturnType<typeof setTimeout>): void {
  if (import.meta.client && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle as unknown as number)
    return
  }
  clearTimeout(handle)
}

/**
 * Ends playback. `complete` fills in whatever had not been typed yet, so an
 * interrupted message is left whole rather than truncated mid-sentence.
 */
export function stopTypewriter(complete: boolean): void {
  if (typewriterTimer) {
    cancel(typewriterTimer)
    typewriterTimer = null
  }
  if (complete && typewriterFinish) typewriterFinish()
  typewriterFinish = null
}

/**
 * Reveals `fullText` on `message` progressively.
 *
 * The server sends the whole answer in a single SSE event, so this is a
 * presentation effect rather than transport streaming. Splitting on whitespace
 * while *keeping* the separators means the reassembled text is byte-identical to
 * what arrived — a plain `split(' ')` would collapse newlines and double spaces,
 * quietly reformatting legal text.
 *
 * Paced by *elapsed time* rather than by counting timer firings. A `setInterval`
 * at one word per tick made three separate promises the browser does not keep:
 * that ticks arrive on schedule (they are throttled to ~1/second in a background
 * tab, so switching away mid-answer stretched playback to minutes), that a tick
 * costs nothing (each one wrote to the DOM and forced a synchronous
 * `scrollHeight` read — one layout per word), and that answer length is bounded
 * (it was not; ~330-word answers ran ~23 seconds at the current pace). Reading
 * the clock each frame makes a late or coalesced frame catch up by revealing more
 * words, so the answer always lands within `TYPEWRITER_MAX_MS` regardless of
 * length or tab state.
 */
export function playTypewriter(
  message: ChatMessage,
  fullText: string,
  options: { onTick?: () => void, delayMs?: number } = {},
): Promise<void> {
  stopTypewriter(true)

  const chunks = fullText.match(/\S+\s*/g) ?? []
  if (chunks.length === 0) {
    message.text = fullText
    message.isStreaming = false
    return Promise.resolve()
  }

  // Reduced motion is an accessibility setting for people who get motion sick.
  // Text appearing progressively is exactly the kind of movement it turns off.
  if (prefersReducedMotion() || options.delayMs === 0) {
    message.text = fullText
    message.isStreaming = false
    options.onTick?.()
    return Promise.resolve()
  }

  message.text = ''
  message.isStreaming = true

  // Cap engages past ~85 words; everything shorter runs at the full per-word
  // pace. `perWord` is also the whole answer's rate now that no per-frame floor
  // overrides it, so this figure is what a visitor actually experiences.
  const perWord = options.delayMs ?? TYPEWRITER_WORD_DELAY_MS
  const totalMs = Math.min(chunks.length * perWord, TYPEWRITER_MAX_MS)

  return new Promise<void>((resolve) => {
    let index = 0
    const settle = () => {
      message.text = fullText
      message.isStreaming = false
      resolve()
    }
    typewriterFinish = settle

    // The first word lands in this tick, not after the first delay. Waiting meant
    // the bubble appeared empty for one interval right as the typing indicator
    // disappeared — a blank white box flickering between the two states.
    message.text += chunks[index]!
    index += 1
    options.onTick?.()
    if (index >= chunks.length) {
      typewriterFinish = null
      message.isStreaming = false
      resolve()
      return
    }

    const startedAt = now()
    const step = () => {
      // How many words are due by now. No floor of `index + 1` here, and that
      // absence is the point: with it, every frame advanced at least one word, so
      // playback ran at the refresh rate (~60 words/second at 60fps) and the
      // per-word constant only ever governed answers long enough to hit the cap.
      // Raising it changed nothing a visitor could see. Reading the clock alone
      // makes the pace mean what it says.
      const elapsed = now() - startedAt
      const target = Math.min(
        chunks.length,
        Math.ceil((elapsed / totalMs) * chunks.length),
      )

      // A frame with no word due writes nothing and fires no tick. `onTick` makes
      // the surfaces read `scrollHeight`, so an unconditional call here would
      // force a layout on every frame to display text that had not changed.
      if (target > index) {
        message.text = chunks.slice(0, target).join('')
        index = target
        options.onTick?.()
      }

      if (index >= chunks.length) {
        typewriterTimer = null
        typewriterFinish = null
        message.isStreaming = false
        resolve()
        return
      }
      typewriterTimer = schedule(step)
    }
    typewriterTimer = schedule(step)
  })
}

// ─── Session token ───────────────────────────────────────────────────────────

/**
 * Fetches the conversation's session token, once, lazily.
 *
 * The server mints it because signing needs a secret the browser must never
 * hold. A failure here is not fatal: the reply still goes out, only the
 * transcript is skipped, so this never blocks a send.
 */
