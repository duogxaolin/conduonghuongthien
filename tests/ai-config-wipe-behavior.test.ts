import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/ai/config/wipe` (server/api/admin/ai/config/wipe.post.ts) — xoá toàn bộ
 * cấu hình AI do con người nhập.
 *
 * Bốn bất biến:
 *   - hai cổng: `ai.update` VÀ SuperAdmin. Người có `ai.update` mà không phải SuperAdmin
 *     nhận 403 và không mất gì; không phiên thì 401;
 *   - phạm vi ĐÚNG bốn bảng: `ai_providers`, `ai_service_configs`, `ai_model_pricing`,
 *     `ai_budget_settings`. Luật kiểm duyệt, `chatbot_settings` và `ai_usage_logs` phải
 *     còn nguyên — xoá luật an ninh hoặc sổ chi phí là hậu quả không ai bấm nút này
 *     mong đợi;
 *   - số liệu trả về và dòng audit là số hàng CÓ THẬT trước khi xoá, kể cả khi bảng rỗng
 *     (0 vẫn là một lượt wipe hợp lệ, không phải lỗi);
 *   - hàng và audit commit cùng nhau: audit không ghi được thì cấu hình còn nguyên.
 *
 * h3 thật + `admin-auth` thật; SQL của Drizzle trên SQLite (transaction thật).
 */

process.env.JWT_SECRET = 'ai-config-wipe-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const {
  roles, permissions, users, settings, userMfaFactors, activityLogs,
  aiProviders, aiServiceConfigs, aiModelPricing, aiBudgetSettings,
  aiModerationRules, aiUsageLogs, chatbotSettings,
} = await import('../server/db/schema')
const harness = createSqliteMysqlDb([
  roles, permissions, users, settings, userMfaFactors, activityLogs,
  aiProviders, aiServiceConfigs, aiModelPricing, aiBudgetSettings,
  aiModerationRules, aiUsageLogs, chatbotSettings,
])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const wipe = (await import('../server/api/admin/ai/config/wipe.post')).default
const { signToken } = await import('../server/utils/auth')

const server = await startHandlerServer(
  [{ method: 'post', path: '/api/admin/ai/config/wipe', handler: wipe }],
  [adminAuth],
)
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPER: Account = { id: 1, username: 'super', roleId: 1, roleName: 'Quản trị hệ thống' }
const AI_ADMIN: Account = { id: 2, username: 'aiadmin', roleId: 2, roleName: 'Quản trị AI' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

const wipeAs = (account: Account | null) =>
  server.request('POST', '/api/admin/ai/config/wipe', account ? { cookie: cookieFor(account) } : {})

const snapshot = () => ({
  providers: harness.rows(aiProviders).length,
  services: harness.rows(aiServiceConfigs).length,
  pricing: harness.rows(aiModelPricing).length,
  budget: harness.rows(aiBudgetSettings).length,
  rules: harness.rows(aiModerationRules).length,
  usage: harness.rows(aiUsageLogs).length,
  chatbot: harness.rows(chatbotSettings).length,
})

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(roles).values([
    { id: 1, name: 'Quản trị hệ thống', isSystem: true },
    { id: 2, name: 'Quản trị AI', isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 2, resource: 'ai', canRead: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([SUPER, AI_ADMIN].map(account => ({
    id: account.id,
    username: account.username,
    email: `${account.username}@example.vn`,
    passwordHash: 'x',
    roleId: account.roleId,
    isSuperAdmin: account === SUPER,
  })))

  await harness.db.insert(aiProviders).values([
    { id: 1, provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKeyCiphertext: 'cipher-a' },
    { id: 2, provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', isActive: false, apiKeyCiphertext: 'cipher-b' },
  ])
  await harness.db.insert(aiServiceConfigs).values([
    { serviceKey: 'chatbot', serviceName: 'Chatbot', provider: 'delify', model: 'delify-5.5', systemPrompt: 'prompt' },
    { serviceKey: 'editorial_assistant', serviceName: 'Biên tập', provider: 'delify', model: 'delify-5.5' },
  ])
  await harness.db.insert(aiModelPricing).values([
    { model: 'delify-5.5', provider: 'delify' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'gpt-4o-mini', provider: 'openai' },
  ])
  await harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 500_000, warningThresholdPct: 80 })
  // Thứ phải SỐNG SÓT qua lượt wipe.
  await harness.db.insert(aiModerationRules).values({ category: 'ma_tuy', pattern: ' heroin ', severity: 'high' })
  await harness.db.insert(aiUsageLogs).values({ serviceKey: 'chatbot', provider: 'delify', totalTokens: 120 })
  await harness.db.insert(chatbotSettings).values({ id: 1, enabled: true, mode: 'ai', baseUrl: 'https://router.delify.vn/v1', model: 'delify-5.5' })
})

test('a non-SuperAdmin with ai.update cannot wipe — nothing is removed', async () => {
  const before = snapshot()
  assert.equal((await wipeAs(AI_ADMIN)).status, 403)
  assert.equal((await wipeAs(null)).status, 401)
  assert.deepEqual(snapshot(), before)
  assert.equal(harness.rows(activityLogs).length, 0, 'a refused wipe writes no audit row')
})

test('the SuperAdmin wipes providers, service configs, pricing and budget — and only those', async () => {
  const response = await wipeAs(SUPER)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.deleted, { providers: 2, services: 2, pricing: 3, budget: 1 })

  assert.deepEqual(snapshot(), {
    providers: 0,
    services: 0,
    pricing: 0,
    budget: 0,
    rules: 1,
    usage: 1,
    chatbot: 1,
  })
})

test('the audit row records the actor and what each table lost', async () => {
  await wipeAs(SUPER)
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, SUPER.id)
  assert.equal(audit[0]!.action, 'delete')
  assert.equal(audit[0]!.resource, 'ai')
  const meta = audit[0]!.meta as Record<string, unknown>
  assert.equal(meta.type, 'ai_config_wipe')
  assert.equal(meta.providers, 2)
  assert.equal(meta.services, 2)
  assert.equal(meta.pricing, 3)
  assert.equal(meta.budget, 1)
})

test('wiping an already-empty config is not an error: 200 with zeros', async () => {
  await wipeAs(SUPER)
  const again = await wipeAs(SUPER)
  assert.equal(again.status, 200)
  assert.deepEqual(again.body.deleted, { providers: 0, services: 0, pricing: 0, budget: 0 })
  assert.equal(harness.rows(activityLogs).length, 2, 'each wipe is audited, including the empty one')
})

test('if the audit row cannot be written, every table is still intact', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await wipeAs(SUPER)).status, 500)
  assert.deepEqual(snapshot(), before)
})
