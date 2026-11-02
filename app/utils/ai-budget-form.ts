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
 *   - 0: cổng không đặt hạn mức; máy chủ hỏi khoá Delify: khoá bị tắt (`active === false`) →
 *     chặn mọi lượt gọi AI; khoá có ngân sách → dùng ngân sách đó, so với TỔNG chi từ trước tới
 *     nay của bảng `ai_usage_logs` (không phải tháng này). Giao diện không biết trước quota
 *     Delify còn hay hết, nên lưu 0 luôn hỏi lại (`zeroBudgetConfirm`); hỏi Delify hỏng mà chưa
 *     có bản đệm thì không có hạn mức nào.
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
 *   - chatbot: không gọi model, chỉ trả lời từ kho (`chat-policy-provider.ts`);
 *   - kiểm duyệt (`moderation-worker-check.ts`): `budget_exceeded` là lỗi tạm thời của AI —
 *     chặn tức thì (`fastPreModerate`) vẫn chạy trước; sau đó chỉ khi khớp một luật mức
 *     `critical` thì tự ẩn (kèm hàng chờ); chỉ khớp luật mức thấp hơn thì cho qua, không ghi
 *     hàng chờ.
 */
export const BUDGET_REACHED_EFFECTS = 'máy chủ từ chối mọi lượt gọi AI (dịch bài, trợ lý biên tập, gọi thử); '
  + 'chatbot chỉ trả lời từ kho kiến thức; kiểm duyệt tự động chỉ còn luật chặn tức thì và luật từ khoá mức critical (tự ẩn) '
  + '— nội dung chỉ khớp từ khoá mức low, medium hoặc high được cho qua, không vào hàng chờ duyệt.'

/** Cảnh báo cạnh ô khi hạn mức gõ vào là 0. */
export const ZERO_BUDGET_WARNING = 'Hạn mức 0 = dùng hạn mức của khoá Delify (so với tổng chi từ trước tới nay, không phải tháng này). '
  + 'Nếu quota Delify đã cạn hoặc khoá bị tắt thì AI bị chặn ngay khi lưu.'

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

/** Hộp xác nhận mỗi lần lưu hạn mức 0: quyền chặn chuyển sang khoá Delify, giao diện không biết quota còn hay hết. */
export function zeroBudgetConfirm(): ConfirmOptions {
  return {
    title: 'Lưu hạn mức 0 — dùng hạn mức của khoá Delify',
    message: 'Hạn mức 0: cổng không đặt hạn mức; máy chủ dùng hạn mức của khoá Delify (nếu khoá có ngân sách), '
      + 'so với tổng chi AI từ trước tới nay — không phải tháng này.\n\n'
      + `Nếu quota Delify đã cạn hoặc khoá bị tắt, ngay khi lưu ${BUDGET_REACHED_EFFECTS}`,
    confirmLabel: 'Vẫn lưu 0',
    danger: true,
  }
}

export interface SaveBudgetDeps {
  /** Số đã chi tháng này (`usage.monthlyCostVnd` của `GET /api/admin/ai/usage` — cùng tổng `checkBudget` so). */
  monthSpendVnd: number
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
 */
export async function saveAiBudget(input: BudgetFormInput, deps: SaveBudgetDeps): Promise<SaveBudgetOutcome> {
  const checked = checkBudgetForm(input)
  if (!checked.ok) return { status: 'invalid', errors: checked.errors }
  const { body } = checked
  const question = body.monthlyBudgetVnd === 0
    ? zeroBudgetConfirm()
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
