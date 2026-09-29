# Design

## Context

The project has AI configuration scattered in a single-row `chatbot_settings` table (provider, base_url, model, system_prompt, API key ciphertext). The shared `secret-envelope.ts` factory (AES-256-GCM with context labels) already supports adding new encrypted-secret features. The `shared/permissions.ts` catalog (`PERMISSION_RESOURCES`) drives both RBAC validation and the role-editor UI. Seed in `server/db/seed.ts` has a `RESOURCES` array that mirrors `PERMISSION_RESOURCES`. DDL lives in `server/db/init.ts` (`CREATE TABLE IF NOT EXISTS`) + `server/db/migrations-additive.ts` (`ensureColumn` for existing tables). `db:drift` checks schema vs DDL for column name, type family, and nullability.

The chatbot call path is: `chat.ts` → `outbound.ts` (provider HTTP call) → `providers.ts` (request/response building). API key is decrypted via `chatbot/crypto.ts` which wraps `secret-envelope.ts` with label `cdkt-chatbot-provider-key:v1`.

## Goals / Non-Goals

**Goals:**
- Centralize AI provider management (keys, models, base URLs) in one place.
- Per-service prompt configuration without code changes.
- Automatic token + cost logging for every AI call.
- Monthly budget guard to prevent runaway spending.
- Backward-compatible migration of existing chatbot AI config.

**Non-Goals:**
- Multi-language content translation (separate future change).
- Chatbot knowledge base multilingual support.
- Replacing the existing chatbot small-talk / knowledge retrieval systems.
- New chart libraries — use inline SVG or existing patterns.
- Real-time streaming of cost data — dashboard fetches on page load only.

## Decisions

### D1: New tables vs extending `chatbot_settings`
**Decision: New tables.** `chatbot_settings` is a single-row table designed for one chatbot. Extending it with multi-provider, multi-service columns would bloat it beyond its purpose. Five new tables keep separation clean: `ai_providers`, `ai_service_configs`, `ai_usage_logs`, `ai_model_pricing`, `ai_budget_settings`.

### D2: Encryption context label
**Decision: `cdkt-ai-provider-key:v1`** — distinct from `cdkt-chatbot-provider-key:v1` and `cdkt-google-oauth-secret:v1`. Per the existing pattern in `secret-envelope.ts`, a distinct label means a ciphertext copied between tables fails authentication. The `ai_providers` table stores keys for all providers (Google, OpenAI, Anthropic, DeepSeek) — one label covers all, because the label separates *features*, not *providers*.

**Alternative considered:** One label per provider. Rejected — adds complexity for no security gain. All AI provider keys serve the same feature surface; the label's job is preventing cross-feature ciphertext confusion, which one label achieves.

### D3: AI Gateway as single entry point
**Decision: `server/services/ai-gateway.ts` exports `callAi(serviceKey, { prompt, variables, userId })`.** Every AI call — chatbot, translation, editorial — goes through this function. It:
1. Loads `ai_service_configs` row for `serviceKey` (cached in module-level variable with 60s TTL).
2. Loads `ai_providers` row for the service's provider (cached similarly).
3. Decrypts the API key.
4. Checks budget (queries `ai_usage_logs` SUM for current month, cached 60s).
5. Substitutes `{{variables}}` in `system_prompt`.
6. Builds the HTTP request using existing `chatbot/providers.ts` patterns (reuse `buildProviderChatCall`, `extractProviderAnswer`).
7. Sends via existing `chatbot/outbound.ts` `sendOutboundRequest`.
8. Parses usage tokens from the response (provider-specific strategy).
9. Calculates cost via `calculateAiCost`.
10. Logs to `ai_usage_logs` (awaited, errors caught).
11. Returns `{ ok: true, text }` or `{ ok: false, error }`.

**Alternative considered:** Multiple service-specific call functions. Rejected — defeats the purpose of centralized logging and budget enforcement. The gateway's value is being the single choke-point.

### D4: Chatbot backward compatibility
**Decision: The chatbot service config (`service_key = 'chatbot'`) BACKFILLS from `chatbot_settings` on first seed, then the chatbot code reads from `ai_service_configs` + `ai_providers` instead of `chatbot_settings` for AI-related fields.** The `chatbot_settings` table retains non-AI fields (`mode`, `outOfScopeBehavior`, `knowledgeGreeting`, `smallTalkEnabled`, `leadCaptureEnabled`, rate limits, etc.). The existing `/admin/chatbot/settings` page continues to work — its server endpoint reads AI fields from the new tables transparently.

**Migration path:**
1. Seed backfills `ai_providers` from `chatbot_settings` (provider policy → provider name, base_url, API key ciphertext) on first run if `ai_providers` is empty.
2. Seed backfills `ai_service_configs` for `chatbot` from `chatbot_settings` (model, system_prompt) on first run if `ai_service_configs` is empty.
3. `chatbot/outbound.ts` call path is updated to use `callAi('chatbot', ...)` instead of reading `chatbot_settings` directly.
4. `chatbot_settings` API key columns remain but are no longer read by the chatbot call path — they serve as the source for backfill only.

### D5: Budget guard granularity
**Decision: Budget check is per-month, per-service.** A monthly cap applies to all AI services combined. When exceeded:
- `chatbot`: falls back to knowledge-only mode (no AI call, knowledge retrieval still works).
- `translation_article`, `editorial_assistant`, `moderation`: blocked entirely, returns `budget_exceeded`.
- `translation_ui`: blocked, returns `budget_exceeded`.

Warning at 80%: logged once per day (`ai_budget.warning`), not on every call. Tracked via a module-level timestamp.

### D6: Cost calculation purity
**Decision: `calculateAiCost(model, promptTokens, completionTokens, pricing)` is a pure function.** It takes pricing as a parameter so it's testable without DB. The gateway service loads pricing from `ai_model_pricing` before calling it.

### D7: Usage logging non-blocking
**Decision: `logAiUsage(db, entry)` is awaited but catches its own errors.** Per the project pattern (like `touchReader`, `session-db.ts` persistence), the logging must never break the AI response. A failed log entry means a cost record is lost, not that the user's chatbot answer or translation fails.

### D8: Provider response parsing strategy
**Decision: A strategy map in the gateway.** Different providers return usage data in different shapes:
- Google Gemini: `response.usageMetadata({promptTokenCount, candidatesTokenCount})`
- OpenAI: `response.usage({prompt_tokens, completion_tokens})`
- Anthropic: `response.usage({input_tokens, output_tokens})`
- DeepSeek: OpenAI-compatible shape.

The strategy map isolates this provider-specific logic from the rest of the gateway.

### D9: RBAC resource `ai`
**Decision: New resource `ai` in `shared/permissions.ts` `PERMISSION_RESOURCES`**. Added as `{ key: 'ai', label: 'AI Panel' }`. SuperAdmin gets full permissions in seed. `requireResourcePermission(event, 'ai', 'read' | 'update')` gates all `/admin/ai/*` endpoints.

**Alternative considered:** Reusing `chatbot_settings` resource. Rejected — AI Panel manages more than chatbot (translation, editorial, moderation), so reusing the chatbot resource would conflate permissions.

### D10: Dashboard chart approach
**Decision: Inline SVG bar chart and donut chart.** No new chart library (per UI DNA: "không thêm thư viện giao diện"). The dashboard tab creates simple SVG views from the usage data — a 30-day cost bar chart and a cost-by-service donut. Consistent with the project's self-hosted philosophy.

## Risks / Trade-offs

### Risk: Chatbot migration breaks existing deployments
**Mitigation:** Backfill is idempotent and only runs when new tables are empty. Old `chatbot_settings` table is kept — no columns removed, no data destroyed. If anything goes wrong, the chatbot can fall back to reading `chatbot_settings` (feature flag or runtime check).

### Risk: Cost calculation drift from actual provider billing
**Mitigation:** `ai_model_pricing` is editable via admin UI. When providers change pricing, admin updates the table. No-code fix. The `USD_TO_VND_RATE` is also configurable via env var.

### Risk: Budget guard false-positive blocking legitimate AI usage
**Mitigation:** Budget cap defaults to 0 (unlimited). Admin must explicitly set a budget. 80% warning is logged, not blocking. Only 100% triggers blocking, and only for non-critical services (chatbot falls back gracefully).

### Trade-off: Module-level caching of service configs and budget check
The gateway caches service configs and budget status for 60s to avoid a DB query on every AI call. This means: prompt changes take up to 60s to take effect, and budget exhaustion takes up to 60s to detect. Acceptable — AI calls are not real-time-critical for config propagation, and 60s budget lag means at most one extra call batch over budget.
