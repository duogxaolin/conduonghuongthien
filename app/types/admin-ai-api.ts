/**
 * Responses of the AI panel (`/admin/ai`, `pages/admin/ai/index.vue` and its tabs under
 * `components/admin/ai/`, wave3 7.1 batch F).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). The provider and
 * pricing rows the tabs pass to each other keep their shared shapes `ProviderOption` /
 * `PricingRow` (app/utils/ai-service-labels.ts); the parent's fallback read of the two lists is
 * typed by the handlers here and assigned into those shapes, so a field the tabs read and the
 * handler stops sending fails the typecheck.
 */
import type { Payload } from './handler-payload'

type ServicesHandler = typeof import('~~/server/api/admin/ai/services/index.get').default
type ServiceUpdateHandler = typeof import('~~/server/api/admin/ai/services/[id].put').default
type TestCallHandler = typeof import('~~/server/api/admin/ai/test-call.post').default
type UsageHandler = typeof import('~~/server/api/admin/ai/usage.get').default
type LogsHandler = typeof import('~~/server/api/admin/ai/logs/index.get').default
type ProvidersHandler = typeof import('~~/server/api/admin/ai/providers/index.get').default
type PricingHandler = typeof import('~~/server/api/admin/ai/pricing/index.get').default
type EditorialHandler = typeof import('~~/server/api/admin/ai/editorial.post').default
type BudgetUpdateHandler = typeof import('~~/server/api/admin/ai/budget/index.put').default

/** `GET /api/admin/ai/usage` — the dashboard's month: totals, per service, per day, the budget. */
export type AdminAiUsageResponse = Payload<UsageHandler>
/**
 * `PUT /api/admin/ai/budget` — the dashboard's budget editor (`AiBudgetEditor.vue`). `{ ok }` when
 * the row was written; `{ ok, message: 'Không có thay đổi.' }` when the body held nothing usable
 * (the handler ignores a non-number instead of refusing it), so the editor never reads that as saved.
 */
export type AdminAiBudgetUpdateResponse = Payload<BudgetUpdateHandler>
/** `GET /api/admin/ai/logs` — one page of the call log (AiLogsTab). */
export type AdminAiLogsResponse = Payload<LogsHandler>
/** `GET /api/admin/ai/providers` and `/pricing` — the parent's fallback read for the Services/Logs tabs. */
export type AdminAiProvidersResponse = Payload<ProvidersHandler>
export type AdminAiPricingResponse = Payload<PricingHandler>

/**
 * `POST /api/admin/ai/editorial` — the article editor's AI panel (`ArticleAIPanel.vue`): titles,
 * summaries, or the polish (`polishedContent` and `changes[].suggested` sanitised by the handler).
 */
export type AdminAiEditorialResponse = Payload<EditorialHandler>

/** `GET /api/admin/ai/services` — one row per AI service, plus its `defaultSystemPrompt`. */
export type AdminAiServicesResponse = Payload<ServicesHandler>
export type AdminAiServiceRow = AdminAiServicesResponse['services'][number]
/** `PUT /api/admin/ai/services/:id`. */
export type AdminAiServiceUpdateResponse = Payload<ServiceUpdateHandler>
/**
 * `POST /api/admin/ai/test-call` — `ok: false` with an `error` sentence when the call could not
 * be made or the provider refused (budget, missing key, bad URL); `ok: true` with the reply.
 *
 * Named gap: the handler answers three object literals whose `ok` is `boolean` (no
 * discriminant), and echoes `model`/`provider` from `readBody` (`any`, which `Serialize` drops).
 * So the answer is stated as the success and failure variants of the handler merged, every
 * field optional (the tab reads them after testing `ok`), plus `model` — a string, as sent.
 */
type TestCallVariant = Payload<TestCallHandler>
type TestCallSuccess = Extract<TestCallVariant, { reply: string }>
type TestCallFailure = Extract<TestCallVariant, { error: string }>
export type AdminAiTestCallResponse = Partial<TestCallSuccess & TestCallFailure> & { ok: boolean, model?: string }

/**
 * `GET /api/admin/ai/delify/status` (the dashboard tab, `AiDashboardTab.vue`) — STATED, not
 * derived: the router's own fields are picked by `plainFields` as "any plain value" (string |
 * number | boolean), so their types are the router's, which the handler does not know (named gap,
 * docs/decisions/fetch-rollout-d-fetch.md). Moved here from the tab unchanged, so the tab stays
 * under its 400-line cap.
 */
export interface DelifyStatusResponse {
  ok: boolean
  configured: boolean
  host?: string | null // the host the server asked: the delify provider's base URL
  error?: string
  keyInfo?: {
    name: string
    groupName: string
    active: boolean
    budgetUsd: number | null
    budgetVnd?: number | null
    usedCostUsd: number
    usedCostVnd?: number
    remainingBudgetUsd: number | null
    remainingBudgetVnd?: number | null
    totalRequests: number
    allowedModels: string[]
    rpm: number | null
    windowStartedAt: string | null
  }
  period: string
  periodSummary?: {
    items?: Array<{ model: string; input: number; output: number; requests: number; cost: number }>
    totals?: { input: number; output: number; requests: number; cost: number }
  } | null
  recentHistory?: Array<{ timestamp: string; model: string; status: string; cost: number; input: number; output: number; tok: number }>
  availableModels?: Array<{ name: string; input: number; output: number }>
}

/**
 * `POST /api/admin/ai/config/wipe` — số hàng ĐÃ XOÁ theo từng nhóm, đếm trước khi xoá.
 * `budget` là 0 hoặc 1 (`ai_budget_settings` là bảng một hàng); giữ dạng số để trang
 * đọc cùng một kiểu với ba nhóm còn lại.
 */
export type AdminAiConfigWipeResponse = {
  ok: boolean
  deleted: {
    providers: number
    services: number
    pricing: number
    budget: number
  }
}
