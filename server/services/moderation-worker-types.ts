/**
 * Kiểu vào/ra của một lượt kiểm duyệt (`checkAndModerateContent`). Tách nguyên văn
 * từ moderation-worker.ts (wave3 D-SPLIT); barrel `moderation-worker.ts` xuất lại.
 * Tệp riêng vì cả đường ghi (`moderation-worker-persist.ts`) lẫn lượt kiểm
 * (`moderation-worker-check.ts`) đều cần — để chung tệp lượt kiểm sẽ thành vòng import.
 */

export interface ModerationCheckInput {
  content: string
  targetType: 'comment' | 'chat' | 'article' | 'livestream_chat'
  targetId?: number
  authorName?: string
  authorIp?: string
  contextTitle?: string
  contextUrl?: string
  sessionId?: string
}

export interface ModerationCheckOutput {
  flagged: boolean
  action: "allow" | "auto_hide" | "flag_only" | "block"
  severity: 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  matchedRules: string[]
  /**
   * Chỉ có khi `flagged`: hàng đích đã THẬT SỰ bị ẩn/gắn cờ/xoá chưa. `false` khi
   * không có `targetId`, khi hành động là `flag_only`, hoặc khi lệnh ghi hỏng.
   */
  hidden?: boolean
  /** Chỉ có khi `flagged`: các bước ghi đã hỏng (đã ghi log từng bước). */
  failures?: ModerationPersistFailure[]
  /**
   * `true` khi AI kiểm duyệt chưa cấu hình VÀ nơi gọi chọn `onAiUnavailable: 'skip'`
   * (lượt quét lại): không có hàng chờ duyệt nào được ghi, nơi gọi tự quyết làm gì.
   */
  aiUnavailable?: boolean
  /**
   * `true` when the AI pass was attempted and did not produce a usable answer: a
   * gateway error other than "not configured" (provider error, budget, …), an
   * empty or unparseable reply, an unknown verdict, or a thrown call. The verdict
   * fields above are UNCHANGED by it — the content is still allowed, or hidden by
   * the critical-keyword fallback, exactly as before. It only says the AI never
   * judged this content, so a caller that must not act on an unfinished
   * moderation (the reply e-mail — `replyEmailHoldReason` in
   * `comments-reply-email.ts`) can tell that apart from a clean
   * "safe". Absent on every other path. "Not configured" keeps its own path
   * (`flag_only` / `aiUnavailable`).
   */
  aiFailed?: true
  /** Only with `aiFailed`: the gateway error code, or `empty_response` / `parse_error` / `unrecognised_verdict` / `exception`. */
  aiFailure?: string
}

export interface ModerationCheckOptions {
  /**
   * AI chưa cấu hình (`service_not_found`/`service_inactive`/`no_api_key`):
   *  - `'queue'` (mặc định — đường nhận nội dung mới): đưa vào hàng chờ `flag_only`
   *    để con người đối soát;
   *  - `'skip'` (lượt quét lại nội dung CŨ): không ghi gì, trả `aiUnavailable: true`.
   *    Quét lại mọi bình luận cũ khi không có AI chỉ để dồn toàn bộ vào hàng chờ là
   *    làm ngập hàng chờ — lượt quét lại chuyển sang chỉ chạy luật.
   */
  onAiUnavailable?: 'queue' | 'skip'
}

export type ModerationPersistFailure = 'queue' | 'hide'
