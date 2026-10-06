/**
 * Hằng số dùng chung giữa các tab của AI Panel — tách khỏi `ai/index.vue` khi
 * 5 tab tách thành component con, để Logs tab (filter dịch vụ), Providers tab
 * (preset nhà cung cấp) và Moderation tab (nhãn danh mục quy tắc) không phải
 * giữ bản sao riêng.
 *
 * Đây là dữ liệu tĩnh định nghĩa nghiệp vụ, không phải state — đặt ở `utils/`
 * cùng phân lớp với `nav-config.ts` / `submission-status.ts`.
 */

/** Subset của `ProviderRow` dùng làm prop cho filter dropdown ở Services tab +
 *  Logs tab — chỉ cần đủ để render `<option value=p.provider>p.label</option>`
 *  và lọc `isActive`. Giữ subsetInterface riêng (thay vì dùng `ProviderRow`) để
 *  prop không bắt buộc field không dùng (apiKeyLastFour, baseUrl…); structure
 *  typing cho phép gán từ `ProviderRow[]` (superset) sang `ProviderOption[]`. */
export interface ProviderOption {
  id: number
  provider: string
  label: string
  isActive: boolean
}

/** Hàng nhà cung cấp đầy đủ — chỉ Providers tab giữ state này; cha orch biến nó
 *  bridge prop loại `ProviderOption[]` xuống Services/Logs (subset). `updatedAt`
 *  là optional vì API thường trả về nhưng UI list providers đôi khi không cần. */
export interface ProviderRow extends ProviderOption {
  baseUrl: string | null
  apiKeyLastFour: string | null
  updatedAt?: string | null
  totalModels?: number
  activeModels?: number
}

/** Hàng giá model — Providers tab giữ full state, Services tab nhận prop subset
 *  (chỉ đọc `model`/`provider`/`label`/`isActive`/`promptCostPerMillion`/
 *  `completionCostPerMillion`). `updatedAt` optional cùng lý do. */
export interface PricingRow {
  model: string
  provider: string
  label: string | null
  isActive: boolean
  promptCostPerMillion: number
  completionCostPerMillion: number
  updatedAt?: string | null
}

/** Nhãn hiển thị cho từng `service_key` — dùng ở dashboard (donut), logs (filter),
 *  services tab (tên dịch vụ). */
export const SERVICE_LABELS: Record<string, string> = {
  chatbot: 'Chatbot',
  translation_article: 'Dịch bài viết',
  translation_ui: 'Dịch UI',
  editorial_assistant: 'Trợ lý biên tập',
  moderation: 'Kiểm duyệt',
  test_call: 'Kiểm tra (Test Call)',
  delify_router: 'Delify Router Gateway',
}

/** Preset cho form "Thêm nhà cung cấp" — chọn preset thì tự điền label + baseUrl.
 *  Chỉ dùng ở Providers tab, nhưng đặt chung để test guard không phụ thuộc component. */
export const PROVIDER_PRESETS = [
  { value: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', hint: 'glm-5.3, claude-opus-5, flash — hỗ trợ tự động tải model & giá' },
  { value: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'Gemini 1.5 Flash / Pro' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hint: 'GPT-4o, GPT-4o-mini' },
  { value: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', hint: 'Claude 3.5 Sonnet / Haiku' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: 'DeepSeek-V3 / R1' },
  { value: 'custom', label: 'Tùy chỉnh (OpenAI-compatible)', baseUrl: '', hint: 'Bất kỳ API tương thích OpenAI nào' },
] as const

/** Nhãn danh mục quy tắc kiểm duyệt — dùng ở Moderation tab (form thêm quy tắc +
 *  bảng quy tắc). */
export const RULE_CATEGORY_LABELS: Record<string, string> = {
  hostile_forces: 'Thế lực thù địch / Phản động',
  anti_state: 'Chống phá / Xuyên tạc chính sách',
  defamation: 'Bôi nhọ / Xúc phạm uy tín',
  spam_fraud: 'Spam / Cờ bạc / Lừa đảo',
  profanity: 'Từ ngữ thô tục',
  custom: 'Tùy biến',
}

/** Format VNĐ — dùng ở dashboard (KPI, donut), providers (model test call cost),
 *  services (test call cost). */
export function formatVnd(vnd: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(vnd)) + ' ₫'
}

/** Format số — dùng ở dashboard (KPI tokens, requests, donut legend). */
export function formatNum(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n)
}

/** Format thời gian — dùng ở Logs tab, Services tab, Moderation tab. */
export function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

/** Màu cho donut chart chi phí theo dịch vụ — chỉ dùng ở Dashboard nhưng đặt
 *  chung để Thumbnail này không bị trôi khi tách component. */
export const CHART_COLORS = ['#2c6e33', '#4A6741', '#6b9f47', '#8ed694', '#a8d5a8', '#c2e4c2']
