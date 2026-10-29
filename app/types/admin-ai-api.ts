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

/** `GET /api/admin/ai/usage` — the dashboard's month: totals, per service, per day, the budget. */
export type AdminAiUsageResponse = Payload<UsageHandler>
/** `GET /api/admin/ai/logs` — one page of the call log (AiLogsTab). */
export type AdminAiLogsResponse = Payload<LogsHandler>
/** `GET /api/admin/ai/providers` and `/pricing` — the parent's fallback read for the Services/Logs tabs. */
export type AdminAiProvidersResponse = Payload<ProvidersHandler>
export type AdminAiPricingResponse = Payload<PricingHandler>

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
