import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiServiceConfigs, aiProviders, aiModelPricing } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { DEFAULT_MODERATION_SYSTEM_PROMPT } from '../../../../utils/ai/prompt-defaults'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()

  const [config] = await db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
    .limit(1)

  const activeProviders = await db
    .select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      label: aiProviders.label,
      isActive: aiProviders.isActive,
    })
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))

  const activePricing = await db
    .select()
    .from(aiModelPricing)
    .where(eq(aiModelPricing.isActive, true))

  // Annotated so the page's type (derived from this handler, app/types/moderation.ts)
  // is the two modes, not the `string` an object literal widens it to.
  const mode: 'ai' | 'keyword_only' = config?.isActive ? 'ai' : 'keyword_only'

  return {
    ok: true,
    settings: {
      enabled: config ? config.isActive : true,
      mode,
      provider: config?.provider ?? 'delify',
      model: config?.model ?? 'delify-5.5',
      systemPrompt: config?.systemPrompt ?? DEFAULT_MODERATION_SYSTEM_PROMPT,
      defaultSystemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT,
    },
    activeProviders,
    activeModels: activePricing,
  }
})
