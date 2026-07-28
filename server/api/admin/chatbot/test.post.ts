import { requireChatbotSettingsPermission } from '../../../utils/permissions'
import { configuredChatbotSecret, getChatbotSettings } from '../../../services/chatbot-settings'
import { safeProviderRequest, redactOutboundError } from '../../../utils/chatbot/outbound'
import { buildProviderProbeCall } from '../../../utils/chatbot/providers'
import { buildChatbotSettingsAudit } from '../../../utils/chatbot/audit'
import { activityLogs } from '../../../db/schema'
import { getDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireChatbotSettingsPermission(event, 'test')
  const settings = await getChatbotSettings()
  const started = Date.now()
  let statusCode: number | undefined
  try {
    const key = configuredChatbotSecret(settings)
    if (!key || !settings.baseUrl || !settings.model) throw new Error('CONFIGURATION_UNAVAILABLE')
    // Path and auth header differ per provider dialect (Anthropic authenticates
    // with x-api-key), so the probe is built by the same adapter the chat uses.
    const probe = buildProviderProbeCall({ policy: settings.providerPolicy, baseUrl: settings.baseUrl, secret: key })
    const response = await safeProviderRequest({ url: new URL(probe.url), allowedHosts: settings.allowedHosts || [], method: 'GET', headers: probe.headers, timeoutMs: settings.requestTimeoutMs, maxResponseBytes: settings.maxResponseBytes })
    statusCode = response.status
    if (response.status < 200 || response.status >= 400) throw new Error('UPSTREAM_FAILURE')
    await getDb().insert(activityLogs).values(buildChatbotSettingsAudit({ actorId: user.id, operation: 'test_connection', outcome: 'success', statusCode, durationMs: Date.now() - started, requestId: event.context.requestId }))
    return { ok: true, result: { status: 'success', statusCode, durationMs: Date.now() - started } }
  } catch (error) {
    const safe = redactOutboundError(error)
    await getDb().insert(activityLogs).values(buildChatbotSettingsAudit({ actorId: user.id, operation: 'test_connection', outcome: 'failure', statusCode, durationMs: Date.now() - started, requestId: event.context.requestId }))
    return { ok: false, result: { status: 'failure', code: safe.code, message: 'Connection test failed.' } }
  }
})
