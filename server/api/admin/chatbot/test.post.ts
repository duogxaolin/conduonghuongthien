import { requireChatbotSettingsPermission } from '../../../utils/permissions'
import { configuredChatbotSecret, getChatbotSettings } from '../../../services/chatbot-settings'
import { safeProviderRequest, redactOutboundError } from '../../../utils/chatbot/outbound'
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
    const url = new URL(`${settings.baseUrl.replace(/\/$/u, '')}/models`)
    const response = await safeProviderRequest({ url, allowedHosts: settings.allowedHosts || [], method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, timeoutMs: settings.requestTimeoutMs, maxResponseBytes: settings.maxResponseBytes })
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
