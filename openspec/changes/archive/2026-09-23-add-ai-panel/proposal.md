# Proposal

## Why

The project currently has AI configuration scattered across `chatbot_settings` (single-row table with Chatbot-specific provider/model/prompt). As the system expands to use AI for multiple services (chatbot, article translation, editorial assistant, content moderation), there is no centralized place to manage providers, per-service prompts, or track token usage and cost. Admins cannot see how much money each AI service is consuming, cannot set budget limits, and cannot configure prompts for new AI services without code changes.

## What Changes

- **New admin page** `/admin/ai` (AI Panel) with 4 tabs: Dashboard (usage & cost), Providers (API keys & models), Service Prompts (per-service system prompts), Request Logs (detailed AI call history).
- **New RBAC resource** `ai` with `read` and `update` permissions, granted to SuperAdmin role only by default.
- **New database tables**: `ai_providers` (encrypted API keys per provider), `ai_service_configs` (per-service prompts, model, temperature, max_tokens), `ai_usage_logs` (per-call token consumption and cost), `ai_model_pricing` (price tables for cost calculation), `ai_budget_settings` (monthly budget cap).
- **New cost calculation service** `server/utils/ai-cost.ts` — pure function computing USD→VND from token counts and pricing table, used by every AI call site.
- **New AI gateway service** `server/services/ai-gateway.ts` — unified entry point for all AI calls; replaces direct provider calls in chatbot flow; logs usage automatically after each call.
- **Migration of existing `chatbot_settings` AI config** — existing Chatbot provider/model/prompt is migrated to the new `ai_providers` + `ai_service_configs` tables via seed/init backfill, with backward compatibility (Chatbot settings page still reads from new tables).
- **Budget guard mechanism** — before each AI call, gateway checks monthly spend against budget cap; at 80% sends warning log, at 100% blocks non-critical AI services (keeps chatbot in knowledge-only mode).
- **New admin sidebar entry** "AI Panel" under the admin navigation.

## Capabilities

### New Capabilities
- `ai-panel`: Centralized AI management — providers, service prompts, usage tracking, cost calculation, budget guards, and the `/admin/ai` admin interface.

### Modified Capabilities
- None. The existing `chatbot_settings` integration is handled at the implementation level (backfill + backward-compatible read path), not a spec-level requirement change.
