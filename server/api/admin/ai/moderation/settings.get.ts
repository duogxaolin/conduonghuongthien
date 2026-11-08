import { requireResourcePermission } from '../../../../utils/permissions'
import { DEFAULT_MODERATION_SYSTEM_PROMPT, effectiveSystemPrompt } from '../../../../utils/ai/prompt-defaults'
import { readModerationSettingsSources } from '../../../../services/admin-ai-moderation-settings'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  // The configuration row, then the active providers (no key material), then the active models.
  const { config, activeProviders, activePricing } = await readModerationSettingsSources()

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
      // What `callAi` will run: the stored prompt, or the default when it is null/blank.
      systemPrompt: effectiveSystemPrompt('moderation', config?.systemPrompt),
      defaultSystemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT,
    },
    activeProviders,
    activeModels: activePricing,
  }
})
