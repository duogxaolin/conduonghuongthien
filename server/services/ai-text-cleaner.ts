/**
 * Làm sạch văn bản AI: bỏ phần "suy nghĩ" của model (`<think>`, `<|channel>…`,
 * "Actually, I'll try…") khỏi câu trả lời, cả trọn gói lẫn từng mẩu khi stream.
 *
 * Tách khỏi `ai-gateway.ts` (nguyên văn, không đổi hành vi) để `ai-sse.ts` dùng
 * được mà không phải import vòng. `ai-gateway.ts` vẫn re-export
 * `createStreamingCleaner` cho các nơi đã import từ đó.
 */

/** Core cleaner: applies the 8 regexes but does NOT trim. Trimming belongs
 *  to the final answer, not to incremental streaming — a per-chunk `trim()`
 *  strips the trailing space between words ("Chào " → "Chào") so the next
 *  chunk glues them together ("Chào" + "anh" = "Chàoanh"). That was half of
 *  the garbled-output bug: the slice() shift was the other half. */
function cleanAiContentCore(text: string): string {
  if (!text) return ''
  return text
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<\|channel\|>thought[\s\S]*?<\|channel\|>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|channel>[\s\S]*?<channel\|>/gi, '')
    .replace(/thought\s*<channel\|>/gi, '')
    .replace(/<\|channel>|channel\|>|<channel\|>|<\|channel\|>/gi, '')
    // "Actually, I'll try…" / "Actually, I will try…" leak. Both contractions
    // ("I'll") and full forms ("I will") appear across providers; the earlier
    // pattern only matched "I'll", so a "I will try" leak passed through raw
    // and showed on screen. Match up to the next Vietnamese sentence boundary.
    .replace(/(?:Actually|Wait),\s*I'?\s*(?:will|ll)\s*try[\s\S]*?(?=(?:Dạ|Chào|Theo|Hiện|Về|\d+\.|\n\n|$))/gi, '')
}

export function cleanAiContent(text: string): string {
  return cleanAiContentCore(text).trim()
}

/** Incremental cleaner for streaming: avoids re-running 8 regexes on the full
 *  `streamText` for every chunk (O(n²)). Holds an incomplete trailing tag in
 *  `carry` so a split like `<thi` + `nk>` does not leak.
 *
 * Emits by **prefix diff**, not by byte length. `cleanAiContent` runs 8 regexes
 * that *delete* spans (reasoning tags like ``, "Actually, I'll
 * try…" leaks) and those spans can straddle chunk boundaries: the opening tag
 * arrives in chunk N (already emitted), the closing tag in chunk M. Once the
 * closer arrives, `cleaned` shrinks *ahead of* the emit point, so
 * `slice(emittedLen)` indexes into the wrong position and emits garbled text
 * (missing spaces, duplicated/merged words — "Chào anh/chị" → "Chàochị"). We
 * track the emitted *string* and only emit the suffix of `cleaned` that extends
 * it; if a regex deletes inside the already-emitted region we emit nothing
 * rather than emitting from a shifted offset. The already-shown text stays
 * (a trailing reasoning fragment may linger briefly) which is the safe
 * failure mode — corrupting the answer text is not. */
/**
 * Finds the index at which an unclosed reasoning span begins in `text`, so the
 * cleaner can hold it back instead of emitting reasoning markers (``,
 * `<|channel>…`, "Actually, I'll try…" leaks) that the regexes cannot yet
 * strip because their closer has not arrived. Returns -1 when nothing is
 * pending.
 *
 * The reasoning regexes match `open … close` pairs. While the closer is still
 * in transit, the open marker sits in the buffer and would emit raw to the
 * visitor. We hold from the open marker onward; once the closer arrives the
 * full span deletes in one regex pass and `emittedText.startsWith(cleaned)`
 * resyncs silently (the divergent-continuation branch never fires, because
 * the held region produces no `emittedText` growth).
 */
function unclosedReasoningStart(text: string): number {
  const thinkOpen = '<' + 'thi' + 'nk>'
  const thinkClose = '<' + '/thi' + 'nk>'
  // Count unmatched opening think tags.
  let pos = 0
  while ((pos = text.indexOf(thinkOpen, pos)) !== -1) {
    const closeIdx = text.indexOf(thinkClose, pos + thinkOpen.length)
    if (closeIdx === -1) return pos
    pos = closeIdx + thinkClose.length
  }
  // Channel-tag span: `<|channel>…<channel|>` (the `thought` prefix variants
  // are subsumed by the plain `<channel|>` closer — note the `<` and `|`
  // swap positions between open and close).
  const chOpen = '<|' + 'channel' + '>'
  const chClose = '<' + 'channel' + '|>'
  pos = 0
  while ((pos = text.indexOf(chOpen, pos)) !== -1) {
    const closeIdx = text.indexOf(chClose, pos + chOpen.length)
    if (closeIdx === -1) return pos
    pos = closeIdx + chClose.length
  }
  // "Actually, I'll try…" leak: deleted up to the next sentence boundary
  // (Dạ/Chào/Theo/Hiện/Về/digit./\n\n). If we have an opening but none of the
  // boundaries have arrived yet, hold from the opening so the visible answer
  // is not corrupted by reasoning text that the regex *will* delete once the
  // boundary lands.
  const leakRe = /(?:Actually|Wait),\s*I'?\s*(?:will|ll)\s*try/i
  const leakMatch = leakRe.exec(text)
  if (leakMatch) {
    const after = text.slice(leakMatch.index + leakMatch[0].length)
    if (!/(?:Dạ|Chào|Theo|Hiện|Về|\d+\.|\n\n)/.test(after)) return leakMatch.index
  }
  return -1
}

export function createStreamingCleaner() {
  let carry = ''
  let emittedText = ''
  let rawBuffer = ''
  return {
    push(delta: string): string {
      rawBuffer += delta
      // Fast path: if the buffer contains NO reasoning markers that the
      // cleaner would delete, emit it verbatim. This is the common case — a
      // well-behaved provider sends plain Vietnamese with no think-tags,
      // `<|channel>` or "Actually, I'll try" leaks, and the prefix-diff
      // machinery only needs to engage when there is something to clean.
      // "AI trả sao thì giữ nguyên": when there is nothing to strip, return
      // the input untouched, byte for byte — no regex pass, no prefix-diff,
      // no hold-back. The earlier implementation re-ran 8 regexes + a
      // prefix-diff on every chunk even when they could never match; that is
      // complexity with no benefit, and any bug in the prefix-diff branch
      // (e.g. emittedText tracking off-by-one after a partial tag hold)
      // corrupts plain text that should never have entered that path.
      const hasMarker =
        rawBuffer.includes('<') ||
        rawBuffer.includes('|channel') ||
        rawBuffer.includes('channel') ||
        rawBuffer.includes('think') ||
        /\b(?:Actually|Wait),\s*I'?\s*(?:will|ll)\s*try/i.test(rawBuffer)
      if (!hasMarker) {
        const newChunk = rawBuffer.slice(emittedText.length)
        emittedText = rawBuffer
        carry = ''
        return newChunk
      }
      // Hold incomplete trailing "<...": don't emit tail that hasn't closed yet.
      // We compute the hold on the *full* raw buffer so a tag that opens in
      // chunk N and is still open here is held back regardless of how many
      // chunks the span already spans.
      const lastOpen = rawBuffer.lastIndexOf('<')
      const lastClose = rawBuffer.lastIndexOf('>')
      let usable: string
      let nextCarry = ''
      if (lastOpen !== -1 && lastOpen > lastClose) {
        usable = rawBuffer.slice(0, lastOpen)
        nextCarry = rawBuffer.slice(lastOpen)
      } else {
        usable = rawBuffer
      }
      // Also hold any unclosed reasoning span (think-tag, channel-tag, or the
      // "Actually, I'll try…" leak) whose closer has not arrived yet. Without
      // this, the open marker would emit raw to the visitor and the suffix
      // beyond it would be prematurely committed to `emittedText`.
      const unclosedAt = unclosedReasoningStart(usable)
      if (unclosedAt !== -1) {
        nextCarry = usable.slice(unclosedAt) + nextCarry
        usable = usable.slice(0, unclosedAt)
      }
      // Clean the **whole usable raw buffer**, not just the current delta. A
      // reasoning span like `<think>…` (or the "Actually, I'll try…"
      // lookahead match) can straddle chunk boundaries: the opening arrives
      // in chunk N, the closing in chunk M. Cleaning only the per-chunk
      // `toClean` means no chunk ever contains both ends, so the regex never
      // matches and the reasoning text leaks through. Cleaning the full
      // buffer makes the regex match once the closer arrives, and the
      // emit-side prefix-diff below correctly suppresses the now-deleted
      // region instead of emitting garbled shifted text.
      const cleaned = cleanAiContentCore(usable)
      carry = nextCarry
      let newChunk = ''
      if (cleaned.startsWith(emittedText)) {
        // Normal extension: `cleaned` grew by appending to the already-emitted
        // text. Emit only the new suffix.
        newChunk = cleaned.slice(emittedText.length)
      } else if (emittedText.startsWith(cleaned)) {
        // A regex deleted the **tail** of the already-emitted region (e.g. a
        // reasoning tag that opened inside the emit point and closed in this
        // chunk). Emit nothing — the shown text keeps its tail (a reasoning
        // fragment may linger briefly) and we resync so future chunks extend
        // from the shorter cleaned form. Resyncing here is safe precisely
        // because we are not emitting: the alternative would be emitting from
        // a shifted offset, which is the garbled-output bug.
        newChunk = ''
      } else {
        // Divergence: `cleaned` and `emittedText` share a coincidental prefix
        // (or none) but the regexes only *delete* spans, never rewrite in
        // place — so a real "rewrite keeping the prefix" case is already
        // covered by `emittedText.startsWith(cleaned)` above. Anything left is
        // genuinely new text that is not an extension of what was shown, so
        // emit the whole `cleaned`. Using a common-prefix slice here would
        // drop a coincidental shared character (e.g. "Cục " then "C11."
        // shared "C", and slice(1) ate it → "11.").
        newChunk = cleaned
      }
      emittedText = cleaned
      return newChunk
    },
    flush(): string {
      // Fast path: if we never saw a reasoning marker, there is nothing to
      // clean and `emittedText` already equals `rawBuffer`. Any tailBeyond
      // `emittedText` was already returned by `push`. Return '' so we don't
      // re-emit anything or run regexes on plain Vietnamese.
      const hasMarker =
        rawBuffer.includes('<') ||
        rawBuffer.includes('|channel') ||
        rawBuffer.includes('channel') ||
        rawBuffer.includes('think') ||
        /\b(?:Actually|Wait),\s*I'?\s*(?:will|ll)\s*try/i.test(rawBuffer)
      if (!hasMarker) {
        const tail = rawBuffer.slice(emittedText.length)
        carry = ''
        return tail
      }
      // Final pass: clean the whole raw buffer. Any held-back trailing span
      // is now part of `rawBuffer`; if it never closed, the regexes leave it
      // and it emits as-is (the caller's `finalText(streamText)` fallback is
      // the safety net for a provider that never closed its tag).
      const cleaned = cleanAiContentCore(rawBuffer)
      carry = ''
      let tail = ''
      if (cleaned.startsWith(emittedText)) {
        tail = cleaned.slice(emittedText.length)
      } else if (emittedText.startsWith(cleaned)) {
        tail = ''
      } else {
        tail = cleaned
      }
      emittedText = cleaned
      return tail
    },
    finalText(raw: string): string {
      // Only the final, complete answer is trimmed. Intermediate chunks must
      // keep their boundary whitespace or words glue together.
      return cleanAiContentCore(raw).trim()
    },
  }
}
