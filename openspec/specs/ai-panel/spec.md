# Spec: ai-panel

## Requirements

### R1: Admin AI Panel Page
The system SHALL provide an admin page at `/admin/ai` accessible only to users with `ai.read` permission. The page contains 4 tabs: Dashboard, Providers, Service Prompts, and Request Logs.

- **R1.1**: The page MUST follow the admin layout (`admin.vue`), use Tailwind CSS v3 utilities exclusively, and follow existing UI DNA (green color scheme, 8px radius on inputs, 16px on dialogs).
- **R1.2**: The page MUST show loading/error/empty states for each tab section. Error states must use `role="alert"` and include retry buttons that call the same fetch function (per `tests/admin-error-retry-ui.test.ts` conventions).
- **R1.3**: The page MUST NOT be added to `routeRules` with SWR cache (admin pages are `cache: false`).
- **R1.4**: The page MUST be client-only for data fetching (all AI data is admin-managed, no SSR caching).

### R2: RBAC Resource
The system SHALL add a new RBAC resource `ai` with `read` and `update` permissions.

- **R2.1**: The seed MUST grant `ai:read` and `ai:update` to the SuperAdmin role only. Other roles receive nothing by default — admins must grant manually after deployment.
- **R2.2**: All `/admin/ai` page server-side endpoints MUST use `requireResourcePermission(event, 'ai', 'read' | 'update')`.
- **R2.3**: The resource `ai` MUST be added to the permissions seed matrix and the `RESOURCES` list in `server/utils/permissions.ts`.

### R3: Admin Sidebar Navigation
The system SHALL add an "AI Panel" entry to the admin sidebar navigation.

- **R3.1**: The entry MUST appear in `app/layouts/admin.vue` sidebar, positioned after existing settings entries.
- **R3.2**: The entry MUST use a FontAwesome icon (e.g., `fa-solid fa-robot`) consistent with existing sidebar icon conventions.
- **R3.3**: The entry MUST show active-state styling when the current route matches `/admin/ai`.

### R4: AI Providers Table & API
The system SHALL store AI provider configurations in a new `ai_providers` database table.

- **R4.1**: Table columns: `id` (PK auto-increment), `provider` (varchar 32, unique: `google`, `openai`, `anthropic`, `deepseek`), `label` (varchar 128), `base_url` (varchar 1024), `is_active` (boolean), `api_key_ciphertext` (text, AES-256-GCM encrypted), `api_key_nonce` (varchar 64), `api_key_auth_tag` (varchar 64), `api_key_last_four` (varchar 4), `created_at`, `updated_at`.
- **R4.2**: API keys MUST be encrypted using `CHATBOT_ENCRYPTION_SECRET` with label `cdkt-ai-provider-key:v1` (distinct from chatbot and Google OAuth labels). Plaintext keys MUST NEVER be returned to the client — only `last_four` and `is_active` are exposed.
- **R4.3**: The `GET /api/admin/ai/providers` endpoint MUST return provider list with masked keys (only `provider`, `label`, `base_url`, `is_active`, `api_key_last_four`, `updated_at`).
- **R4.4**: The `PUT /api/admin/ai/providers/[id]` endpoint MUST accept a new API key (plaintext), encrypt it server-side, and store the ciphertext. Passing `null` or empty string for the key field MUST keep the existing key unchanged.
- **R4.5**: The `POST /api/admin/ai/providers/[id]/test` endpoint MUST send a minimal test request to the provider's API using the stored key and return `{ ok: true, model?: string }` on success or `{ ok: false, error: string }` on failure. This endpoint MUST NOT log the API key in any form.

### R5: AI Service Configs Table & API
The system SHALL store per-service AI configuration in a new `ai_service_configs` table.

- **R5.1**: Table columns: `id` (PK), `service_key` (varchar 64, unique: `chatbot`, `translation_article`, `translation_ui`, `editorial_assistant`, `moderation`), `service_name` (varchar 128), `provider` (varchar 32, references `ai_providers.provider`), `model` (varchar 64), `system_prompt` (text), `temperature` (decimal 3,2, default 0.30), `max_tokens` (int, default 4096), `is_active` (boolean), `updated_by` (FK to users, ON DELETE SET NULL), `updated_at`, `created_at`.
- **R5.2**: The seed MUST insert 5 default service configs with placeholder prompts and `is_active = false`.
- **R5.3**: The `GET /api/admin/ai/services` endpoint MUST return all service configs.
- **R5.4**: The `PUT /api/admin/ai/services/[id]` endpoint MUST accept changes to `system_prompt`, `model`, `temperature`, `max_tokens`, `is_active`. Changes to `service_key` and `service_name` MUST be rejected. Every update MUST write an `activity_logs` entry within the same transaction.
- **R5.5**: System prompts support template variables in `{{variable}}` format. The stored prompt is raw text with placeholders; the AI gateway substitutes variables at call time.

### R6: AI Usage Logs Table
The system SHALL log every AI API call in a new `ai_usage_logs` table.

- **R6.1**: Table columns: `id` (bigint PK auto-increment), `service_key` (varchar 64), `provider` (varchar 32), `model` (varchar 64), `prompt_tokens` (int), `completion_tokens` (int), `total_tokens` (int), `cost_usd` (decimal 10,6), `cost_vnd` (decimal 12,2), `execution_ms` (int), `user_id` (FK to users, nullable, ON DELETE SET NULL), `success` (boolean), `error_message` (text, nullable), `created_at` (timestamp, indexed).
- **R6.2**: Logging MUST be non-blocking — if the log insert fails, the AI response to the user MUST NOT be affected. The logger handler MUST catch its own errors.
- **R6.3**: The `GET /api/admin/ai/usage` endpoint MUST return usage summary (total cost, total tokens, request count) broken down by service_key and by day, with pagination support.
- **R6.4**: The `GET /api/admin/ai/logs` endpoint MUST return paginated detailed logs with filtering by `service_key`, `provider`, and date range. Results are ordered by `created_at DESC`.

### R7: AI Model Pricing Table
The system SHALL maintain a `ai_model_pricing` table for cost calculation.

- **R7.1**: Table columns: `model` (varchar 64, PK), `provider` (varchar 32), `prompt_cost_per_million` (decimal 8,4), `completion_cost_per_million` (decimal 8,4), `updated_at`.
- **R7.2**: The seed MUST insert pricing for: `gemini-1.5-flash`, `gemini-1.5-pro`, `gpt-4o-mini`, `gpt-4o`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `deepseek-chat`, `deepseek-reasoner`.
- **R7.3**: The `PUT /api/admin/ai/pricing/[model]` endpoint MUST allow updating pricing (SuperAdmin only).
- **R7.4**: If a model is called but has no entry in `ai_model_pricing`, cost MUST be logged as `0` with a warning `ai_usage.no_pricing` log entry. The call MUST NOT be blocked.

### R8: Cost Calculation Service
The system SHALL provide a pure function for AI cost calculation.

- **R8.1**: `calculateAiCost(model, promptTokens, completionTokens)` returns `{ costUsd: number, costVnd: number }`.
- **R8.2**: Formula: `costUsd = (promptTokens * promptCostPerMillion + completionTokens * completionCostPerMillion) / 1_000_000`.
- **R8.3**: `costVnd = costUsd * USD_TO_VND_RATE` where `USD_TO_VND_RATE` is read from environment variable `USD_TO_VND_RATE` (default 25500).
- **R8.4**: The function MUST be pure (no side effects, no DB calls) for testability. It receives pricing as a parameter: `calculateAiCost(model, promptTokens, completionTokens, pricing)`.
- **R8.5**: If `pricing` is null or model not found, returns `{ costUsd: 0, costVnd: 0 }`.

### R9: AI Budget Settings
The system SHALL support a monthly budget cap for AI spending.

- **R9.1**: A new `ai_budget_settings` single-row table: `id` (PK, default 1), `monthly_budget_vnd` (bigint, default 0 = unlimited), `warning_threshold_pct` (int, default 80), `updated_by` (FK), `updated_at`.
- **R9.2**: The `PUT /api/admin/ai/budget` endpoint MUST require `ai.update` permission and write an `activity_logs` entry.
- **R9.3**: Before each AI call, the gateway MUST check current month's total spend against budget. At `warning_threshold_pct` of budget, a `ai_budget.warning` log is emitted (once per day). At 100% of budget, non-critical AI services (`translation_article`, `editorial_assistant`, `moderation`) MUST be blocked; the chatbot service MUST fall back to knowledge-only mode.
- **R9.4**: If `monthly_budget_vnd` is 0, budget checks are skipped (unlimited).

### R10: AI Gateway Service
The system SHALL provide a unified AI call service at `server/services/ai-gateway.ts`.

- **R10.1**: `callAi(serviceKey, { prompt, context, userId })` is the single entry point for all AI calls. It: (1) reads service config from DB, (2) reads provider key from DB and decrypts, (3) checks budget, (4) substitutes template variables in system_prompt, (5) calls the provider API, (6) parses usage tokens from response, (7) calculates cost, (8) logs to `ai_usage_logs`, (9) returns the response text.
- **R10.2**: The gateway MUST handle provider-specific response parsing (Google Gemini returns `usageMetadata`, OpenAI returns `usage`, Anthropic returns `usage`). Provider-specific logic is isolated in a strategy map.
- **R10.3**: If budget is exceeded for the service, gateway returns `{ ok: false, error: 'budget_exceeded' }` without making the API call.
- **R10.4**: If the provider key is missing or decryption fails, gateway returns `{ ok: false, error: 'no_api_key' }` and logs `ai_gateway.key_unavailable`.
- **R10.5**: Usage logging MUST be awaited but errors caught — `await logAiUsage(...)` inside try/catch; log failures must not propagate.
- **R10.6**: The gateway MUST record `execution_ms` as wall-clock time from just before the provider call to just after response parsing.

### R11: Backfill & Backward Compatibility
The system SHALL migrate existing Chatbot AI settings to the new tables without breaking existing functionality.

- **R11.1**: `init.ts` (or `migrations-additive.ts`) MUST create the 5 new tables on startup.
- **R11.2**: The seed MUST backfill `ai_providers` from existing `chatbot_settings` (provider, base_url, api_key_ciphertext, etc.) if `ai_providers` is empty and `chatbot_settings` has a configured provider.
- **R11.3**: The seed MUST backfill `ai_service_configs` for `service_key = 'chatbot'` from existing `chatbot_settings` (system_prompt, model, temperature equivalent, max_tokens equivalent) if that service config is empty.
- **R11.4**: The existing `/admin/chatbot/settings` page MUST continue to work — it reads from the new `ai_service_configs` + `ai_providers` tables transparently. The `chatbot_settings` table is kept for non-AI fields (mode, knowledge_greeting, small_talk, etc.).
- **R11.5**: The existing chatbot call path in `server/utils/chatbot/retrieval.ts` or wherever the provider is called MUST be migrated to use `callAi('chatbot', ...)` instead of direct provider calls.
- **R11.6**: `db:drift` MUST pass — all 5 new tables' columns must match between Drizzle schema (`schema.ts`) and DDL (`init.ts` + `migrations-additive.ts`).

### R12: Dashboard Tab UI
The Dashboard tab SHALL display usage and cost summary.

- **R12.1**: 4 KPI cards: "Chi phí tháng này" (current month VND), "Tổng Tokens" (input/output split), "Số lượt gọi AI" (request count + success rate), "Hạn mức ngân sách" (budget VND + percentage bar).
- **R12.2**: A daily cost bar chart for the last 30 days. Chart implementation uses inline SVG or a lightweight approach consistent with existing project patterns (no new chart library).
- **R12.3**: A pie/donut breakdown of cost by service_key.
- **R12.4**: Budget progress bar showing current spend vs budget cap with color coding (green < 80%, yellow 80-100%, red > 100%).

### R13: Request Logs Tab UI
The Request Logs tab SHALL display a paginated table of AI API calls.

- **R13.1**: Table columns: Time, Service, Provider, Model, Input tokens, Output tokens, Cost VND, Duration (ms), Status (success/error).
- **R13.2**: Filters: service_key dropdown, provider dropdown, date range (start/end), success status.
- **R13.3**: Pagination with `finitePositive()` for page number (per project convention). Default 20 rows per page, max 50.
- **R13.4**: Error rows MUST show error message in an expandable detail row.
- **R13.5**: Logs older than 90 days are excluded by default (consistent with activity_logs retention scope). A note explains this to the admin.

### R14: Schema Drift Compliance
All new tables and columns MUST pass `npm run db:drift`.

- **R14.1**: Every column in the 5 new tables must be defined in BOTH `server/db/schema.ts` (Drizzle) AND `server/db/init.ts` (DDL `CREATE TABLE IF NOT EXISTS`).
- **R14.2**: Column types and nullability must match between Drizzle and DDL (int-vs-bigint, TIMESTAMP-vs-DATETIME, NOT NULL defaults).
- **R14.3**: `ensureColumn` calls in `migrations-additive.ts` are NOT needed for entirely new tables (they use `CREATE TABLE IF NOT EXISTS`). But if any column is added later via ALTER, it must use `ensureColumn` with single-quote definitions only (per the `db:drift` regex rule).
