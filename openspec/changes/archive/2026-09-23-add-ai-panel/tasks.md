# Tasks

## 1. Database Schema & DDL

### 1.1 Add 5 new tables to Drizzle schema
- Add `aiProviders`, `aiServiceConfigs`, `aiUsageLogs`, `aiModelPricing`, `aiBudgetSettings` to `server/db/schema.ts`
- Add corresponding TypeScript type exports (`$inferSelect` / `$inferInsert`)
- Column types must match spec R4-R7 exactly (int vs bigint, decimal precision, varchar lengths)

### 1.2 Add CREATE TABLE statements to DDL
- Add 5 `CREATE TABLE IF NOT EXISTS` blocks to `server/db/init.ts` (in the section after existing tables, before `applyAdditiveMigrations`)
- Column types and nullability must match Drizzle schema exactly
- `ai_usage_logs` needs indexes on `created_at` and `(service_key, created_at)`
- `ai_providers` needs `UNIQUE` on `provider` column
- `ai_service_configs` needs `UNIQUE` on `service_key` column

### 1.3 Add RBAC resource `ai`
- Add `{ key: 'ai', label: 'AI Panel' }` to `PERMISSION_RESOURCES` array in `shared/permissions.ts`
- Add `'ai'` to `RESOURCES` array in `server/db/seed.ts`

### 1.4 Seed default data
- Seed `ai_model_pricing` with 8 default model pricing rows (gemini-1.5-flash, gemini-1.5-pro, gpt-4o-mini, gpt-4o, claude-3-5-sonnet, claude-3-5-haiku, deepseek-chat, deepseek-reasoner)
- Seed `ai_service_configs` with 5 default service rows (chatbot, translation_article, translation_ui, editorial_assistant, moderation) with `is_active = false`
- Seed `ai_budget_settings` with single row (id=1, monthly_budget_vnd=0, warning_threshold_pct=80)
- Seed `ai` permissions for SuperAdmin role (all flags true)
- Backfill `ai_providers` from `chatbot_settings` if table empty and chatbot has configured provider
- Backfill `ai_service_configs` chatbot row from `chatbot_settings` if empty
- All seed operations are insert-only / idempotent ← (verify: running seed twice does not overwrite existing rows, db:drift passes)

## 2. Server Utilities & Services

### 2.1 Create AI encryption wrapper
- Create `server/utils/ai/crypto.ts` wrapping `secret-envelope.ts` with context label `cdkt-ai-provider-key:v1`
- Export `encryptAiSecret`, `decryptAiSecret`, `AiEncryptionError` class
- Pattern mirrors `server/utils/chatbot/crypto.ts`

### 2.2 Create AI cost calculation pure function
- Create `server/utils/ai-cost.ts`
- Export `calculateAiCost(model, promptTokens, completionTokens, pricing)` returning `{ costUsd, costVnd }`
- Pure function, no DB calls, no side effects
- `USD_TO_VND_RATE` read from env (default 25500)
- Returns `{ costUsd: 0, costVnd: 0 }` if pricing null or model not found ← (verify: function is pure, testable without DB, handles null pricing gracefully)

### 2.3 Create AI gateway service
- Create `server/services/ai-gateway.ts`
- Export `callAi(serviceKey, { prompt, variables, userId, db })` → `{ ok, text?, error? }`
- Modules: config cache (60s TTL), budget cache (60s TTL), provider strategy map for response parsing
- On budget exceeded: returns `{ ok: false, error: 'budget_exceeded' }`
- On missing key: returns `{ ok: false, error: 'no_api_key' }`, logs `ai_gateway.key_unavailable`
- Usage logging: await + catch own errors
- Records `execution_ms` from before provider call to after parsing ← (verify: gateway logs usage for every call, budget check runs before call, non-blocking log errors don't break response)

### 2.4 Create AI budget guard
- Create `server/utils/ai-budget.ts`
- Export `checkBudget(db, serviceKey)` → `{ allowed: boolean, reason?: string }`
- Queries `SUM(cost_vnd)` from `ai_usage_logs` WHERE `created_at` >= start of current month
- If `monthly_budget_vnd = 0`, always returns `{ allowed: true }`
- At 80%: logs `ai_budget.warning` (once per day, tracked via module-level timestamp)
- At 100%: blocks non-critical services (`translation_article`, `editorial_assistant`, `moderation`, `translation_ui`); chatbot always allowed (falls back to knowledge-only in its own code)

### 2.5 Create AI usage logger
- Create `server/utils/ai-usage.ts`
- Export `logAiUsage(db, entry)` → `void`
- Catches own errors, logs `ai_usage.log_failed` on failure
- Entry shape: `{ serviceKey, provider, model, promptTokens, completionTokens, totalTokens, costUsd, costVnd, executionMs, userId, success, errorMessage? }`

## 3. Server API Endpoints

### 3.1 Providers endpoints
- `GET /api/admin/ai/providers` — list providers, masked keys (only `provider, label, base_url, is_active, api_key_last_four, updated_at`), requires `ai.read`
- `PUT /api/admin/ai/providers/[id]` — update provider, accepts new API key (encrypt + store), empty key = keep existing, requires `ai.update`, writes `activity_logs` in same transaction
- `POST /api/admin/ai/providers/[id]/test` — test connection, requires `ai.read`, returns `{ ok, model? }` or `{ ok: false, error }`
- All endpoints use `requireResourcePermission(event, 'ai', 'read' | 'update')`

### 3.2 Service configs endpoints
- `GET /api/admin/ai/services` — list all service configs, requires `ai.read`
- `PUT /api/admin/ai/services/[id]` — update prompt/model/temperature/max_tokens/is_active, reject `service_key`/`service_name` changes, requires `ai.update`, writes `activity_logs` in same transaction ← (verify: audit log is in same transaction as update, service_key and service_name are immutable)

### 3.3 Usage endpoints
- `GET /api/admin/ai/usage` — usage summary (current month cost, total tokens, request count by service, daily breakdown for 30 days), requires `ai.read`
- `GET /api/admin/ai/logs` — paginated detailed logs with filters (service_key, provider, date range, success status), requires `ai.read`, page via `finitePositive()`, max 50 rows

### 3.4 Pricing endpoints
- `GET /api/admin/ai/pricing` — list all pricing rows, requires `ai.read`
- `PUT /api/admin/ai/pricing/[model]` — update pricing, requires SuperAdmin only, writes `activity_logs`

### 3.5 Budget endpoints
- `GET /api/admin/ai/budget` — get budget settings, requires `ai.read`
- `PUT /api/admin/ai/budget` — update `monthly_budget_vnd` and `warning_threshold_pct`, requires `ai.update`, writes `activity_logs`

## 4. Admin UI — Page Shell & Navigation

### 4.1 Add admin sidebar entry
- Add "AI Panel" (icon `fa-solid fa-microchip` or `fa-solid fa-robot`) to `app/layouts/admin.vue` menuGroups
- Position: new group "AI & Tự động hóa" or add to "Hệ thống & Cài đặt" group
- Gated by `hasPermission('ai', 'read')`

### 4.2 Create admin page `/admin/ai/index.vue`
- 4-tab interface: Dashboard, Providers, Service Prompts, Request Logs ← (verify: page loads, tabs switch, loading/error/empty states present with role="alert")

## 5. Admin UI — Dashboard Tab

### 5.1 KPI cards
- 4 cards: "Chi phí tháng này" (VND), "Tổng Tokens" (input/output), "Số lượt gọi AI" (count + success rate), "Hạn mức ngân sách" (budget VND + percentage bar)
- Each card fetches its own data independently with retry button per project convention

### 5.2 Charts (inline SVG)
- Daily cost bar chart (last 30 days)
- Cost-by-service donut chart
- No external chart library — inline SVG components

### 5.3 Budget progress bar
- Green < 80%, yellow 80-100%, red > 100%
- Shows exact VND amounts

## 6. Admin UI — Providers Tab

### 6.1 Provider list & edit form
- List all providers with columns: Provider name, label, base URL, status (active/inactive), last four digits, last updated
- Edit drawer/modal for each provider: label, base_url, is_active toggle, new API key field (password type, placeholder "•••• сохранено" if key exists), test connection button
- Test button calls `POST /api/admin/ai/providers/[id]/test` and shows result toast

## 7. Admin UI — Service Prompts Tab

### 7.1 Service list & prompt editor
- List all 5 services with columns: Service name, provider, model, active toggle, last updated
- Edit drawer for each service: system_prompt textarea (large), model dropdown (populated from ai_providers.active), temperature slider (0-1), max_tokens input, is_active toggle
- Save button calls PUT endpoint
- Show template variable hints below the prompt textarea (list of available `{{variables}}` for that service)

## 8. Admin UI — Request Logs Tab

### 8.1 Logs table with filters
- Table: Time, Service, Provider, Model, Input tokens, Output tokens, Cost VND, Duration ms, Status
- Filters: service_key dropdown, provider dropdown, date range, success/error
- Pagination with `finitePositive()`, 20 rows/page
- Error rows: expandable detail showing error_message
- Note: "Chỉ hiển thị nhật ký 90 ngày gần nhất"
← (verify: filters work, pagination uses finitePositive, error rows expandable, date range filter applied)

## 9. Chatbot Migration

### 9.1 Migrate chatbot call path to AI gateway
- Update `server/utils/chatbot/chat.ts` (or whichever file makes the provider HTTP call) to use `callAi('chatbot', { prompt, variables, userId, db })` instead of directly calling `outbound.ts` + `providers.ts`
- The existing `chatbot_settings` AI fields (`providerPolicy`, `baseUrl`, `model`, `systemPrompt`, API key columns) are no longer read by the call path
- `chatbot_settings` non-AI fields remain in use (mode, knowledge_greeting, small_talk, lead capture, rate limits)
- The `/admin/chatbot/settings` page endpoint reads AI-related fields from `ai_providers` + `ai_service_configs` transparently ← (verify: existing chatbot functionality unchanged, AI calls go through gateway, usage logs appear)

## 10. Validation & Testing

### 10.1 Schema drift
- Run `npm run db:drift` and ensure all 5 new tables pass (no drift between schema.ts and init.ts)
- Column types, nullability, and names must match

### 10.2 Typecheck
- Run `npm run typecheck` and ensure 0 errors
- New files must have proper TypeScript types (no `any`)
- Vue files must have `lang="ts"`

### 10.3 Build
- Run `npm run build` and ensure success
- No `fonts.googleapis.com` references in `.output/`

### 10.4 Tests
- Run `npm test` and ensure all existing tests pass
- Write unit test for `calculateAiCost` pure function (pricing null → 0, normal calculation, model not found → 0)
- Write unit test for budget guard (budget 0 = unlimited, 80% warning, 100% block)
← (verify: all existing tests pass, new pure function tests cover edge cases, no regressions)
