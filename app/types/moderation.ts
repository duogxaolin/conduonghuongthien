/**
 * Types of the `/admin/ai/moderation` page, its panels
 * (`app/components/admin/ai/moderation/*`) and `useModerationWorker`.
 *
 * Responses are DERIVED FROM THE HANDLERS under `server/api/admin/ai/moderation/**`, the
 * technique of `app/types/admin-api.ts`: `Payload<…>` is the handler's return value
 * after JSON (`Date` → string), so a changed projection changes the type, and every
 * `adminFetch<T>()` on the page names the endpoint's own answer instead of a hand-written
 * shape that could drift from it. (`adminFetch`'s `T` is still an unchecked assertion —
 * see app/composables/adminFetch.ts — but it is the right assertion.)
 *
 * Differences from the hand-written interfaces this replaces, all display-only:
 *   - pricing `promptCostPerMillion`/`completionCostPerMillion` are DECIMAL columns, so
 *     they arrive as strings ("1.0000"), not numbers — the page only prints them;
 *   - queue rows and rules carry their `createdAt` as `string | null` (nullable column).
 */
/** What the browser holds after JSON, not what the handler returned (one definition: handler-payload.ts). */
import type { Payload } from './handler-payload'

type ItemOf<T> = T extends readonly (infer U)[] ? U : never

type SettingsGetHandler = typeof import('~~/server/api/admin/ai/moderation/settings.get').default
type SettingsPutHandler = typeof import('~~/server/api/admin/ai/moderation/settings.put').default
type QueueGetHandler = typeof import('~~/server/api/admin/ai/moderation/queue.get').default
type QueueResolveHandler = typeof import('~~/server/api/admin/ai/moderation/queue/[id]/resolve.post').default
type RulesGetHandler = typeof import('~~/server/api/admin/ai/moderation/rules.get').default
type RulesPostHandler = typeof import('~~/server/api/admin/ai/moderation/rules.post').default
type RulePutHandler = typeof import('~~/server/api/admin/ai/moderation/rules/[id].put').default
type RuleDeleteHandler = typeof import('~~/server/api/admin/ai/moderation/rules/[id].delete').default
type WorkerStatusHandler = typeof import('~~/server/api/admin/ai/moderation/worker-status.get').default
type RestartWorkerHandler = typeof import('~~/server/api/admin/ai/moderation/restart-worker.post').default
type RestartServerHandler = typeof import('~~/server/api/admin/ai/moderation/restart-server.post').default
type RescanAllHandler = typeof import('~~/server/api/admin/ai/moderation/rescan-all.post').default

// ─── Settings ────────────────────────────────────────────────────────────────
export type ModerationSettingsResponse = Payload<SettingsGetHandler>
export type ModerationMode = ModerationSettingsResponse['settings']['mode']
export type ModerationProviderOption = ItemOf<ModerationSettingsResponse['activeProviders']>
export type ModerationModelOption = ItemOf<ModerationSettingsResponse['activeModels']>
export type ModerationSettingsSaveResponse = Payload<SettingsPutHandler>

// ─── Review queue ────────────────────────────────────────────────────────────
export type ModerationQueueResponse = Payload<QueueGetHandler>
export type ModerationQueueItem = ItemOf<ModerationQueueResponse['items']>
export type ModerationResolveResponse = Payload<QueueResolveHandler>
/** The three outcomes `POST …/queue/:id/resolve` accepts. */
export type ModerationResolveAction = 'approve' | 'reject_delete' | 'ban_ip'

// ─── Rules ───────────────────────────────────────────────────────────────────
export type ModerationRulesResponse = Payload<RulesGetHandler>
export type ModerationRule = ItemOf<ModerationRulesResponse['rules']>
export type ModerationRuleCreateResponse = Payload<RulesPostHandler>
export type ModerationRuleUpdateResponse = Payload<RulePutHandler>
export type ModerationRuleDeleteResponse = Payload<RuleDeleteHandler>

// ─── Worker & emergency actions ──────────────────────────────────────────────
export type ModerationWorkerStatusResponse = Payload<WorkerStatusHandler>
export type ModerationWorkerStatus = ModerationWorkerStatusResponse['worker']
/** The background "Quét & dọn" run: state, x/y progress, and the summary when it ends. */
export type ModerationRescanStatus = ModerationWorkerStatusResponse['rescan']
export type ModerationRescanStartResponse = Payload<RescanAllHandler>
export type ModerationRestartWorkerResponse = Payload<RestartWorkerHandler>
export type ModerationRestartServerResponse = Payload<RestartServerHandler>

// ─── Page ────────────────────────────────────────────────────────────────────
export type ModerationTabKey = 'settings' | 'queue' | 'rules' | 'worker'
