/**
 * Trình sửa hạn mức chi AI theo tháng (`components/admin/ai/AiBudgetEditor.vue`, trong tab
 * Tổng quan của /admin/ai) — đọc ô nhập, cảnh báo, rồi `PUT /api/admin/ai/budget`
 * (`server/api/admin/ai/budget/index.put.ts`, quyền `ai.update`).
 *
 * Luật đầu vào CHẶT HƠN máy chủ, không bao giờ lỏng hơn: máy chủ nhận mọi số hữu hạn ≥ 0 làm
 * hạn mức (cột `BIGINT UNSIGNED`, trần `Number.MAX_SAFE_INTEGER`) và kẹp + làm tròn xuống
 * ngưỡng cảnh báo về 1–100; giá trị không phải số thì nó LẶNG LẼ bỏ qua và vẫn trả 200
 * "Không có thay đổi.". Ở đây chỉ nhận số nguyên đồng (chỉ chữ số) và ngưỡng nguyên 1–100;
 * ngoài khoảng thì từ chối, không kẹp — để thứ được lưu đúng là thứ cán bộ đã gõ, và không
 * bao giờ gửi đi một giá trị mà máy chủ sẽ bỏ qua rồi báo "thành công".
 *
 * Hạn mức có tác dụng gì — đúng như `checkBudget` (`server/utils/ai-budget.ts`) làm:
 *   - > 0: khi chi phí AI trong tháng (lịch Việt Nam) chạm hạn mức, máy chủ làm đúng
 *     `BUDGET_REACHED_EFFECTS` dưới đây. Hạn mức mới ≤ số đã chi tháng này → chặn NGAY khi lưu.
 *   - 0: cổng không đặt hạn mức; máy chủ hỏi khoá Delify (`checkBudget` ~180–203): không có
 *     khoá → không giới hạn; khoá bị tắt → chặn mọi lượt gọi AI; khoá có ngân sách (> 0 USD) →
 *     dùng ngân sách đó (× 25 500), so với TỔNG chi từ trước tới nay của `ai_usage_logs` (không
 *     phải tháng này); khoá không có ngân sách → không giới hạn; hỏi Delify hỏng mà chưa có bản
 *     đệm → không giới hạn. Dashboard đọc đúng hai con số đó ở `GET /api/admin/ai/delify/status`
 *     (`budgetVnd` = `budgetUsd` × 25 500, `usedCostVnd` = tổng `ai_usage_logs`), nên câu cảnh
 *     báo nói theo trạng thái thật (`delifyKeyState` → `zeroBudgetWarning`); lưu 0 luôn hỏi lại
 *     (`zeroBudgetConfirm`).
 *   - Ngưỡng cảnh báo chỉ làm máy chủ ghi một dòng cảnh báo vào nhật ký (tối đa mỗi ngày một
 *     lần) — không chặn gì, không đổi màu thanh ở thẻ hạn mức.
 */
import type { ConfirmOptions } from '../composables/useConfirm'
import { errorMessage } from './errorMessage'
import { formatVnd } from './ai-service-labels'

/** Trần hạn mức của máy chủ (`MAX_BUDGET_VND` trong handler) — trên đó máy chủ kẹp, ở đây từ chối. */
export const MAX_BUDGET_VND = Number.MAX_SAFE_INTEGER
export const MIN_THRESHOLD_PCT = 1
export const MAX_THRESHOLD_PCT = 100

export type FieldParse = { ok: true, value: number } | { ok: false, error: string }

const DIGITS = /^\d+$/

/** Hạn mức (đồng/tháng): số nguyên ≥ 0, chỉ chữ số — `2.000.000`, `1,5`, `-1`, `1e6` đều bị từ chối. */
export function parseBudgetVnd(raw: unknown): FieldParse {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Nhập hạn mức theo đồng (0 = không đặt hạn mức tại đây).' }
  if (!DIGITS.test(text)) return { ok: false, error: 'Hạn mức là số nguyên đồng, chỉ gồm chữ số, không dấu chấm/phẩy (VD: 2000000).' }
  const value = Number(text)
  // A safe integer is ≤ MAX_BUDGET_VND by definition, so above the server's cap is refused here.
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'Hạn mức quá lớn.' }
  return { ok: true, value }
}

/** Ngưỡng cảnh báo (%): số nguyên 1–100. */
export function parseThresholdPct(raw: unknown): FieldParse {
  const text = String(raw ?? '').trim()
  const outOfRange = `Ngưỡng cảnh báo là số nguyên từ ${MIN_THRESHOLD_PCT} đến ${MAX_THRESHOLD_PCT}.`
  if (!DIGITS.test(text)) return { ok: false, error: outOfRange }
  const value = Number(text)
  if (value < MIN_THRESHOLD_PCT || value > MAX_THRESHOLD_PCT) return { ok: false, error: outOfRange }
  return { ok: true, value }
}

/** Hạn mức này chặn gọi AI ngay khi lưu: > 0 và số đã chi tháng này đã chạm nó (`usagePercent >= 100`). */
export function budgetBlocksAiNow(budgetVnd: number, monthSpendVnd: number): boolean {
  return budgetVnd > 0 && monthSpendVnd >= budgetVnd
}

export interface BudgetFormInput {
  budget: unknown
  threshold: unknown
}

/** A type alias, not an interface: it is handed to `adminFetch` as a `Record<string, unknown>` body. */
export type BudgetPayload = {
  monthlyBudgetVnd: number
  warningThresholdPct: number
}

export type BudgetFormCheck =
  | { ok: true, body: BudgetPayload }
  | { ok: false, errors: { budget?: string, threshold?: string } }

export function checkBudgetForm(input: BudgetFormInput): BudgetFormCheck {
  const budget = parseBudgetVnd(input.budget)
  const threshold = parseThresholdPct(input.threshold)
  if (budget.ok && threshold.ok) return { ok: true, body: { monthlyBudgetVnd: budget.value, warningThresholdPct: threshold.value } }
  return {
    ok: false,
    errors: {
      ...(budget.ok ? {} : { budget: budget.error }),
      ...(threshold.ok ? {} : { threshold: threshold.error }),
    },
  }
}

/**
 * Hạn mức đã chạm (hoặc quota Delify đã cạn khi hạn mức là 0) thì máy chủ làm gì — một câu, cho
 * gợi ý trong form và cả hai hộp xác nhận. `checkBudget` trả `budget_exceeded`:
 *   - dịch bài, trợ lý biên tập, gọi thử: bị từ chối;
 *   - chatbot: qua dịch vụ AI "Chatbot" thì không gọi model, chỉ trả lời từ kho
 *     (`chat-policy-provider.ts`, `budget_exceeded` → `null`). NHƯNG khi dịch vụ đó chưa tạo,
 *     đang tắt hoặc thiếu khoá, cổng AI trả `service_not_found`/`service_inactive`/`no_api_key`
 *     TRƯỚC khi xét hạn mức (`ai-gateway-call.ts` bước 1–2) và chatbot gọi thẳng nhà cung cấp cấu
 *     hình ở "Cài đặt Chatbot" — đường cũ này không qua hạn mức (chủ đích, ghim ở
 *     `tests/chat-policy-seams-behavior.test.ts`); câu dưới nói đúng như vậy. Nhà cung cấp đang TẮT
 *     (`provider_inactive`, CHANGELOG § 98) thì không bao giờ đi đường cũ — như `budget_exceeded`;
 *   - kiểm duyệt (`moderation-worker-check.ts`): `budget_exceeded` là lỗi tạm thời của AI —
 *     chặn tức thì (`fastPreModerate`) vẫn chạy trước; sau đó chỉ khi khớp một quy tắc mức
 *     `critical` (từ khoá HOẶC mẫu regex) thì tự ẩn (kèm hàng chờ); chỉ khớp quy tắc mức thấp
 *     hơn thì cho qua, không ghi hàng chờ.
 */
export const BUDGET_REACHED_EFFECTS = 'máy chủ từ chối mọi lượt gọi AI (dịch bài, trợ lý biên tập, gọi thử); '
  + 'chatbot chạy qua dịch vụ AI "Chatbot" chỉ còn trả lời từ kho kiến thức — riêng chatbot còn dùng nhà cung cấp cấu hình ở '
  + '"Cài đặt Chatbot" (dịch vụ "Chatbot" chưa tạo, đang tắt hoặc thiếu khoá) vẫn gọi nhà cung cấp đó, hạn mức không chặn đường này; '
  + 'kiểm duyệt tự động chỉ còn luật chặn tức thì và quy tắc từ khoá hoặc mẫu (regex) mức critical (tự ẩn) '
  + '— nội dung chỉ khớp quy tắc mức low, medium hoặc high được cho qua, không vào hàng chờ duyệt.'

/** Quy tắc chung của hạn mức 0 — gợi ý tĩnh trong form (câu theo trạng thái thật: `zeroBudgetWarning`). */
export const ZERO_BUDGET_RULE = 'Đặt 0: cổng không đặt hạn mức; máy chủ hỏi khoá Delify — khoá có ngân sách thì dùng ngân sách đó '
  + '(so với tổng chi AI từ trước tới nay, không phải tháng này), khoá bị tắt thì chặn mọi lượt gọi AI, '
  + 'không có khoá hoặc khoá không có ngân sách thì không giới hạn.'

/** Trạng thái khoá Delify mà `checkBudget` hỏi khi hạn mức của cổng là 0 — đọc từ dashboard. */
export type DelifyKeyState =
  /** Chưa đọc được (đang tải, lỗi, router không trả lời): không nói chắc được. */
  | { kind: 'unknown' }
  /** Chưa tạo nhà cung cấp Delify hoặc chưa có khoá: máy chủ không có hạn mức nào. */
  | { kind: 'none' }
  /** Delify báo khoá đang tắt: máy chủ chặn mọi lượt gọi AI. */
  | { kind: 'inactive' }
  /** Khoá không có ngân sách (> 0): không giới hạn. */
  | { kind: 'unlimited' }
  /** Khoá có ngân sách: so với tổng chi từ trước tới nay. */
  | { kind: 'budget', budgetVnd: number, spentVnd: number }

/** Phần `GET /api/admin/ai/delify/status` cần ở đây (`server/api/admin/ai/delify/status.get.ts`). */
export interface DelifyStatusLike {
  ok?: boolean
  configured?: boolean
  keyInfo?: { active?: boolean, budgetUsd?: number | null, usedCostVnd?: number }
}

/** Tỉ giá máy chủ dùng cho ngân sách khoá (`checkBudget`, `delify/status.get.ts`). */
const DELIFY_VND_PER_USD = 25_500

export function delifyKeyState(status: DelifyStatusLike | null | undefined): DelifyKeyState {
  if (!status) return { kind: 'unknown' }
  if (status.ok === true && status.keyInfo) {
    const { active, budgetUsd, usedCostVnd } = status.keyInfo
    if (active === false) return { kind: 'inactive' }
    if (typeof budgetUsd === 'number' && budgetUsd > 0) {
      return { kind: 'budget', budgetVnd: budgetUsd * DELIFY_VND_PER_USD, spentVnd: Number.isFinite(usedCostVnd) ? Number(usedCostVnd) : 0 }
    }
    return { kind: 'unlimited' }
  }
  if (status.ok === false && status.configured === false) return { kind: 'none' }
  return { kind: 'unknown' }
}

/** Lưu 0 thì máy chủ chặn ngay không: `true`/`false` khi biết, `null` khi chưa đọc được khoá. */
export function zeroBudgetBlocks(state: DelifyKeyState): boolean | null {
  if (state.kind === 'inactive') return true
  if (state.kind === 'budget') return state.spentVnd >= state.budgetVnd
  if (state.kind === 'none' || state.kind === 'unlimited') return false
  return null
}

/** Cảnh báo cạnh ô khi hạn mức gõ vào là 0 — theo trạng thái thật của khoá Delify. */
export function zeroBudgetWarning(state: DelifyKeyState): string {
  switch (state.kind) {
    case 'none':
      return 'Hạn mức 0 = không giới hạn: chưa có khoá Delify, máy chủ không áp hạn mức chi AI nào.'
    case 'unlimited':
      return 'Hạn mức 0 = không giới hạn: khoá Delify không có ngân sách riêng, máy chủ không áp hạn mức chi AI nào.'
    case 'inactive':
      return 'Hạn mức 0 = dùng khoá Delify, mà khoá đang tắt: máy chủ chặn mọi lượt gọi AI ngay khi lưu.'
    case 'budget': {
      const head = `Hạn mức 0 = dùng hạn mức của khoá Delify: ${formatVnd(state.budgetVnd)}, so với tổng chi AI từ trước tới nay `
        + `(${formatVnd(state.spentVnd)}) — không phải tháng này.`
      return zeroBudgetBlocks(state)
        ? `${head} Tổng đó đã chạm hạn mức của khoá: AI bị chặn ngay khi lưu.`
        : `${head} Khi tổng đó chạm hạn mức của khoá, AI bị chặn.`
    }
    default:
      return 'Hạn mức 0 = cổng không đặt hạn mức; máy chủ hỏi khoá Delify, mà chưa đọc được trạng thái khoá: '
        + 'khoá tắt hoặc đã hết ngân sách thì AI bị chặn ngay khi lưu, không có khoá hay ngân sách thì không giới hạn.'
  }
}

/** Hộp xác nhận khi hạn mức mới chặn gọi AI ngay. */
export function blockingBudgetConfirm(budgetVnd: number, monthSpendVnd: number): ConfirmOptions {
  return {
    title: 'Hạn mức này chặn gọi AI ngay',
    message: `Tháng này đã chi ${formatVnd(monthSpendVnd)}, không thấp hơn hạn mức mới ${formatVnd(budgetVnd)}.\n\n`
      + `Ngay khi lưu và cho tới khi nâng hạn mức hoặc sang tháng mới, ${BUDGET_REACHED_EFFECTS}`,
    confirmLabel: 'Vẫn lưu',
    danger: true,
  }
}

/**
 * Hộp xác nhận mỗi lần lưu hạn mức 0 (bỏ hạn mức của cổng là quyết định đáng hỏi lại dù kết quả
 * là chặn hay không giới hạn) — tiêu đề và câu theo trạng thái thật của khoá Delify.
 */
export function zeroBudgetConfirm(state: DelifyKeyState): ConfirmOptions {
  const blocks = zeroBudgetBlocks(state)
  const title = blocks === true ? 'Hạn mức 0 chặn gọi AI ngay'
    : state.kind === 'budget' ? 'Lưu hạn mức 0 — dùng hạn mức của khoá Delify'
      : blocks === false ? 'Lưu hạn mức 0 — không giới hạn chi AI'
        : 'Lưu hạn mức 0 — khoá Delify quyết định'
  const effects = blocks === true ? `Ngay khi lưu, ${BUDGET_REACHED_EFFECTS}`
    : state.kind === 'budget' ? `Khi tổng chi chạm hạn mức của khoá, ${BUDGET_REACHED_EFFECTS}`
      : blocks === null ? `Nếu khoá tắt hoặc đã hết ngân sách, ngay khi lưu ${BUDGET_REACHED_EFFECTS}`
        : 'Máy chủ không chặn lượt gọi AI nào vì chi phí cho tới khi đặt lại hạn mức.'
  return { title, message: `${zeroBudgetWarning(state)}\n\n${effects}`, confirmLabel: 'Vẫn lưu 0', danger: true }
}

export interface SaveBudgetDeps {
  /** Số đã chi tháng này (`usage.monthlyCostVnd` của `GET /api/admin/ai/usage` — cùng tổng `checkBudget` so). */
  monthSpendVnd: number
  /** Khoá Delify mà hạn mức 0 trao quyền cho (`delifyKeyState` của dashboard). */
  delifyKey: DelifyKeyState
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** `{ ok }` when written, `{ ok, message }` when the handler used nothing (`AdminAiBudgetUpdateResponse`). */
  request: (url: string, options: { method: 'PUT', body: BudgetPayload }) => Promise<{ ok?: boolean, message?: string }>
}

export type SaveBudgetOutcome =
  | { status: 'invalid', errors: { budget?: string, threshold?: string } }
  | { status: 'cancelled' }
  /** `saved`: the two numbers the PUT wrote — the dashboard shows them before its re-read answers. */
  | { status: 'saved', saved: BudgetPayload }
  | { status: 'unchanged', message: string }
  | { status: 'failed', message: string }

/**
 * Kiểm ô nhập → (hạn mức 0, hoặc hạn mức chặn ngay, thì hỏi lại) → đúng một `PUT` với hai SỐ.
 * Câu máy chủ trả khi không ghi gì ("Không có thay đổi.") là `unchanged`, không phải `saved`.
 * Lỗi → câu máy chủ soạn (403, 400), không bao giờ dòng `[PUT] "…"` của ofetch.
 * `deps.request` chỉ được gọi SAU khi câu hỏi đã được trả lời — nơi gọi bật trạng thái "đang
 * lưu" ở trong nó, để nút mở hộp không bị khoá trong lúc hộp hỏi (hộp trả focus về nút đó).
 */
export async function saveAiBudget(input: BudgetFormInput, deps: SaveBudgetDeps): Promise<SaveBudgetOutcome> {
  const checked = checkBudgetForm(input)
  if (!checked.ok) return { status: 'invalid', errors: checked.errors }
  const { body } = checked
  const question = body.monthlyBudgetVnd === 0
    ? zeroBudgetConfirm(deps.delifyKey)
    : budgetBlocksAiNow(body.monthlyBudgetVnd, deps.monthSpendVnd) ? blockingBudgetConfirm(body.monthlyBudgetVnd, deps.monthSpendVnd) : null
  if (question && !await deps.confirm(question)) return { status: 'cancelled' }
  try {
    const res = await deps.request('/api/admin/ai/budget', { method: 'PUT', body })
    if (res?.message) return { status: 'unchanged', message: res.message }
    return { status: 'saved', saved: body }
  } catch (err: unknown) {
    return { status: 'failed', message: errorMessage(err, 'Không lưu được hạn mức chi AI.') }
  }
}
