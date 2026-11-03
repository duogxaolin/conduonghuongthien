/**
 * Service config, provider row and pricing reads for `callAi`, with the two 60 s caches
 * and the provider→wire-format map — part of the `ai-gateway.ts` family
 * (wave3-long-term 4.3, D-SPLIT). Moved verbatim.
 *
 * This file is the ONE owner of the gateway's module-level state (`configCache`,
 * `providerCache`, `PROVIDER_POLICY`): none of it is exported, and only the loaders below
 * write it (`tests/service-split-boundaries.test.ts`, rule 4).
 */
import { eq } from 'drizzle-orm'
import type { Database } from '../utils/db'
import {
  aiServiceConfigs, aiProviders, aiModelPricing,
  type AiServiceConfig, type AiProvider, type AiModelPricing,
} from '../db/schema'

interface CachedConfig {
  config: AiServiceConfig | null
  loadedAt: number
}

interface CachedProvider {
  provider: AiProvider | null
  loadedAt: number
}

const CACHE_TTL_MS = 60_000

// ─── Module-level caches ───────────────────────────────────────────────

const configCache = new Map<string, CachedConfig>()
const providerCache = new Map<string, CachedProvider>()

// ─── Provider→policy mapping ────────────────────────────────────────────

/** Map AI Panel provider names to the policy used by `buildProviderChatCall`.
 *  Anthropic uses its own message format; everything else is OpenAI-compatible
 *  (including Google Gemini via OpenAI-compatible proxy endpoints). */
const PROVIDER_POLICY: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai-compatible',
  google: 'openai-compatible',
  deepseek: 'openai-compatible',
}

function policyForProvider(provider: string): string {
  return PROVIDER_POLICY[provider] ?? 'openai-compatible'
}

// ─── Template variable substitution ────────────────────────────────────

/** Replace `{{key}}` placeholders in the prompt with values from `variables`.
 *  Unknown placeholders are left as-is — a missing variable should be visible
 *  in the prompt, not silently replaced with empty string (spec R5.5). */
export function substituteVariables(prompt: string, variables: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match
  })
}

// ─── Cached reads ───────────────────────────────────────────────────────

async function loadServiceConfig(db: Database, serviceKey: string): Promise<AiServiceConfig | null> {
  const cached = configCache.get(serviceKey)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.config

  const [row] = await db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.serviceKey, serviceKey)).limit(1)
  configCache.set(serviceKey, { config: row ?? null, loadedAt: Date.now() })
  return row ?? null
}

async function loadProvider(db: Database, providerName: string): Promise<AiProvider | null> {
  const cached = providerCache.get(providerName)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.provider

  const [row] = await db.select().from(aiProviders).where(eq(aiProviders.provider, providerName)).limit(1)
  providerCache.set(providerName, { provider: row ?? null, loadedAt: Date.now() })
  return row ?? null
}

async function loadPricing(db: Database, model: string): Promise<AiModelPricing | null> {
  const [row] = await db.select().from(aiModelPricing).where(eq(aiModelPricing.model, model)).limit(1)
  return row ?? null
}

export { policyForProvider, loadServiceConfig, loadProvider, loadPricing }
