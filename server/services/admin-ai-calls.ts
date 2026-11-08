/**
 * What the admin AI call endpoints (`POST /api/admin/ai/test-call`, `/editorial`, `/translate`)
 * ask the database around their paid call — moved out of the handlers verbatim, each called
 * exactly where the handler ran it. The spend check (`checkBudget`, utils/ai-budget.ts) and the
 * usage row (`logAiUsage`, utils/ai-usage.ts) are unchanged; this module only hands them the
 * database. The permission checks, the input limits, the key decryption, the outbound probe
 * (`safeProviderRequest`), `callAi`, every refusal and the response shaping stay in the handlers.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiProviders, aiServiceConfigs } from '../db/schema'
import { checkBudget } from '../utils/ai-budget'
import { logAiUsage, type AiUsageLogEntry } from '../utils/ai-usage'

/** `checkBudget` for `serviceKey` — whether this month's spend still allows a paid call. */
export async function checkAiBudget(serviceKey: string) {
  const db = getDb()
  return checkBudget(db, serviceKey)
}

/** `{ serviceKey }` in its stored spelling when a service config of that key exists; undefined if not. */
export async function findConfiguredServiceKey(requestedServiceKey: string) {
  const db = getDb()
  const [service] = await db.select({ serviceKey: aiServiceConfigs.serviceKey }).from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, requestedServiceKey))
    .limit(1)
  return service
}

/** The provider row named `providerName` (key envelope included — never returned to the browser); undefined if absent. */
export async function findProviderByName(providerName: string) {
  const db = getDb()
  const [provider] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, providerName))
    .limit(1)
  return provider
}

/**
 * Record a call in `ai_usage_logs` — `logAiUsage`, which catches its own errors and never throws.
 * Runs after the paid call; `getDb()` returns the pool the reads before it already opened.
 */
export async function logAiCallUsage(entry: AiUsageLogEntry) {
  const db = getDb()
  return logAiUsage(db, entry)
}
