import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { moduleCaches, ROOT } from './_module-caches'
import { handlerReaches } from './_cache-input-writes'

/**
 * Sổ đăng ký BỘ ĐỆM trong tiến trình — mỗi bộ đệm cấp module trong `server/**` phải nói nó được làm mới
 * bằng cách nào.
 *
 * Lỗi gốc (2026-11-06, CHANGELOG § 78): kho kiến thức và cấu hình gateway AI được giữ 60 s mà không biết
 * phiên bản cache câu trả lời. Sửa kho / đổi model xong, câu dựng từ dữ liệu CŨ được ghi dưới khoá MỚI và
 * phát lại tới 30 ngày. Không test nào hỏi "bộ đệm này bị làm mới bằng gì", nên câu hỏi chưa ai trả lời.
 * Sổ này buộc trả lời nó lúc thêm bộ đệm, và kiểm phần kiểm được bằng máy:
 *   - `versioned`: khoá/hàng mang phiên bản hoặc thế hệ (tệp phải còn dùng đúng cơ chế đó);
 *   - `invalidated`: có hàm xoá, hàm đó còn được gọi; nếu khai `tables`, MỌI handler admin ghi các bảng đó
 *     phải gọi tới hàm xoá (lần theo lời gọi, `tests/_cache-input-writes.ts`);
 *   - `ttl-only`: chỉ hết hạn theo thời gian — lý do phải nói vì sao dữ liệu cũ trong cửa sổ đó vô hại;
 *   - `memo`: hàm thuần của đầu vào (không bao giờ cũ); `state`: không phải bản sao dữ liệu đã lưu.
 * Bộ đệm mà câu trả lời chatbot dựng từ đó (`feedsChatbotAnswers`) phải là `versioned` — câu trả lời được
 * cache 30 ngày, nên "chỉ TTL 60 s" không đủ.
 */

type Entry =
  | { kind: 'versioned', by: string, feedsChatbotAnswers: boolean, why: string }
  | { kind: 'invalidated', invalidator: string, tables?: { drizzle: string[], sql: string[] }, why: string }
  | { kind: 'ttl-only', why: string }
  | { kind: 'memo', why: string }
  | { kind: 'state', why: string }

const REGISTRY: Record<string, Entry> = {
  'server/utils/tracking-settings.ts#cache': {
    kind: 'invalidated', invalidator: 'clearTrackingSettingsCache',
    why: 'cấu hình mã theo dõi (kể cả script tự viết của SuperAdmin), 30 s; settings PUT xoá ngay khi khoá TRACKING_KEYS đổi, '
      + 'TRƯỚC khi xoá đệm swr — không xoá thì lượt dựng kế tiếp chèn lại mã cũ và swr giữ thêm 60 s (tests/tracking-settings-cache.test.ts)',
  },
  'server/services/ai-gateway-config.ts#configCache': {
    kind: 'versioned', by: 'configGeneration()', feedsChatbotAnswers: true,
    why: 'model/prompt/nhiệt độ của mọi dịch vụ AI; thế hệ tăng ở bumpAnswerCacheVersion (tests/ai-gateway-config-generation.test.ts)',
  },
  'server/services/ai-gateway-config.ts#providerCache': {
    kind: 'versioned', by: 'configGeneration()', feedsChatbotAnswers: true,
    why: 'hàng nhà cung cấp (baseUrl, khoá API); cùng cơ chế thế hệ với configCache',
  },
  'server/services/livestream.ts#activeLivestreamCache': {
    kind: 'invalidated', invalidator: 'invalidateActiveLivestreamCache',
    why: 'buổi phát đang chạy, 3 s; service bắt đầu/kết thúc buổi phát tự xoá',
  },
  'server/services/moderation-regex-analysis.ts#charsetCache': {
    kind: 'memo', why: 'tập ký tự suy từ chính chuỗi mẫu regex — hàm thuần của khoá',
  },
  'server/services/moderation-regex-check.ts#compiled': {
    kind: 'memo', why: 'RegExp biên dịch theo chuỗi mẫu (khoá là chính mẫu) — hàm thuần; xoá cùng cache luật',
  },
  'server/services/moderation-rules-cache.ts#cachedRules': {
    kind: 'invalidated', invalidator: 'invalidateModerationRulesCache',
    tables: { drizzle: ['aiModerationRules'], sql: ['ai_moderation_rules'] },
    why: 'luật kiểm duyệt đang bật, 60 s; mọi đường ghi luật phải xoá ngay — luật mới phải chặn từ lượt kế tiếp',
  },
  'server/services/moderation-rules-cache.ts#cacheExpiresAt': {
    kind: 'invalidated', invalidator: 'invalidateModerationRulesCache',
    why: 'mốc hết hạn của cachedRules (cùng cơ chế)',
  },
  'server/utils/ai-budget.ts#cachedDelifyQuota': {
    kind: 'versioned', by: 'configGeneration()', feedsChatbotAnswers: false,
    why: 'quota khoá Delify (API ngoài), 60 s — CHẶN mọi lượt gọi AI khi khoá bị treo; tra lại khi thế hệ cấu hình đổi '
      + '(mọi thao tác nhà cung cấp AI), và về null khi hàng/khoá Delify không còn (tests/ai-budget-delify-quota-staleness.test.ts)',
  },
  'server/utils/chatbot/chat.ts#publishedCache': {
    kind: 'versioned', by: 'dataVersion', feedsChatbotAnswers: true,
    why: 'kho kiến thức đã xuất bản, 60 s; gắn phiên bản cache câu trả lời (tests/chatbot-published-entries-version.test.ts)',
  },
  'server/utils/client-ip.ts#cachedTrustedProxies': {
    kind: 'memo', why: 'danh sách proxy tin cậy phân tích từ biến môi trường — không đổi trong đời tiến trình',
  },
  'server/utils/favicon-setting.ts#cache': {
    kind: 'invalidated', invalidator: 'clearFaviconSettingCache',
    why: 'favicon, 30 s; ba đường ghi (settings PUT, favicon POST/DELETE) xoá ngay — bảng `settings` dùng chung nhiều khoá nên không kiểm theo bảng',
  },
  'server/utils/mfa/policy.ts#factorCache': {
    kind: 'versioned', by: 'tokenVersion', feedsChatbotAnswers: false,
    why: '"tài khoản có yếu tố MFA", khoá theo (user, tokenVersion); mọi thao tác đổi yếu tố tăng tokenVersion',
  },
  'server/utils/mfa/policy.ts#policyCache': {
    kind: 'invalidated', invalidator: 'clearMfaPolicyCache',
    why: 'chính sách cưỡng chế MFA, 30 s; service lưu chính sách xoá ngay',
  },
  'server/utils/og-image-setting.ts#cache': {
    kind: 'invalidated', invalidator: 'clearOgImageSettingCache',
    why: 'ảnh OG mặc định, 30 s; settings PUT xoá ngay khi khoá og_image_url đổi',
  },
  'server/utils/rate-limit-store.ts#fallbackMemory': {
    kind: 'state', why: 'bộ đếm rate limit dự phòng khi CSDL không với tới — trạng thái, không phải bản sao dữ liệu',
  },
  'server/utils/sanitize-html.ts#linkFieldCache': {
    kind: 'memo', why: 'trường liên kết của từng loại khối, suy từ registry khối viết trong mã — hàm thuần',
  },
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const fileOf = (id: string) => id.split('#')[0]!

function adminHandlers(dir = path.join(ROOT, 'server/api/admin')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? adminHandlers(full) : entry.name.endsWith('.ts') ? [full] : []
  })
}

test('every module-level cache in server/ is in the registry, and every entry still exists', () => {
  const detected = moduleCaches().map(cache => cache.id)
  const unregistered = detected.filter(id => !REGISTRY[id])
  const stale = Object.keys(REGISTRY).filter(id => !detected.includes(id))
  assert.deepEqual(unregistered, [], 'a new in-process cache must say how it is refreshed: add it to REGISTRY (versioned / invalidated / ttl-only / memo / state)')
  assert.deepEqual(stale, [], 'a registry entry whose cache is gone is how the registry quietly drifts')
})

test('the detector finds a new cache in the shapes it knows (name with "cache", or a timestamped entry)', () => {
  // Giới hạn nói rõ: bộ đệm đặt tên kiểu `snapshot`, không mang trường thời hạn, vẫn lọt — thêm nó vào
  // KNOWN_UNNAMED_CACHES (`tests/_module-caches.ts`).
  const fake = path.join(ROOT, 'server/utils/__registry-probe.ts')
  const found = moduleCaches(new Map([[fake, [
    'let settingsCache: string | null = null',
    'const rows = new Map<string, { value: string, loadedAt: number }>()',
    'let memo = { data: [] as string[], expiresAt: 0 }',
    'const rowsCache = {}',
    'const remote = new Map<string, { body: string, fetchedAt: number }>()',
    'const FIXED = new Set([\'a\'])',
    'const CACHE_TTL_MS = 30_000',
    'const CACHEABLE = new Set([\'x\'])',
    'let counter = 0',
  ].join('\n')]])).map(cache => cache.id).filter(id => id.startsWith('server/utils/__registry-probe.ts'))
  assert.deepEqual(found.sort(), [
    'server/utils/__registry-probe.ts#memo',
    'server/utils/__registry-probe.ts#remote',
    'server/utils/__registry-probe.ts#rows',
    'server/utils/__registry-probe.ts#rowsCache',
    'server/utils/__registry-probe.ts#settingsCache',
  ])
})

test('a cache the chatbot builds answers from is versioned, never TTL-only', () => {
  for (const [id, entry] of Object.entries(REGISTRY)) {
    if (entry.kind === 'versioned' && entry.feedsChatbotAnswers) continue
    assert.ok(!('feedsChatbotAnswers' in entry && entry.feedsChatbotAnswers), `${id}: feeds chatbot answers but is ${entry.kind}`)
  }
  // Hai bộ đệm đã biết: thiếu một trong hai ở đây là sổ đã bị sửa sai.
  for (const id of ['server/utils/chatbot/chat.ts#publishedCache', 'server/services/ai-gateway-config.ts#configCache', 'server/services/ai-gateway-config.ts#providerCache']) {
    const entry = REGISTRY[id]
    assert.ok(entry?.kind === 'versioned' && entry.feedsChatbotAnswers, `${id} must stay versioned`)
  }
})

test('a versioned cache still uses the mechanism it names', () => {
  for (const [id, entry] of Object.entries(REGISTRY)) {
    if (entry.kind !== 'versioned') continue
    assert.ok(read(fileOf(id)).includes(entry.by), `${id}: no longer mentions ${entry.by}`)
  }
})

test('an invalidated cache has its invalidator exported and actually called', () => {
  const sources = adminHandlers(path.join(ROOT, 'server')).map(file => readFileSync(file, 'utf8'))
  for (const [id, entry] of Object.entries(REGISTRY)) {
    if (entry.kind !== 'invalidated') continue
    assert.match(read(fileOf(id)), new RegExp(`export function ${entry.invalidator}\\(`), `${id}: ${entry.invalidator} is not exported from its file`)
    // Lời gọi, không tính chính dòng khai báo (`export function X(`).
    const calls = sources.reduce((total, text) => total + (text.match(new RegExp(`(?<!function )\\b${entry.invalidator}\\(`, 'g'))?.length ?? 0), 0)
    assert.ok(calls > 0, `${id}: nothing calls ${entry.invalidator} — the cache only expires by time`)
  }
})

test('every admin handler that writes an invalidated cache\'s tables reaches its invalidator', () => {
  const handlers = adminHandlers()
  let checked = 0
  for (const [id, entry] of Object.entries(REGISTRY)) {
    if (entry.kind !== 'invalidated' || !entry.tables) continue
    const writers = handlers.filter(file => handlerReaches(file, { tables: new Set(entry.tables!.drizzle), sqlTables: entry.tables!.sql }))
    assert.ok(writers.length > 0, `${id}: no admin handler writes ${entry.tables.drizzle.join(', ')} — the table list is stale`)
    const missing = writers
      .filter(file => !handlerReaches(file, { calls: new Set([entry.invalidator]) }))
      .map(file => path.relative(ROOT, file).split(path.sep).join('/'))
    assert.deepEqual(missing, [], `${id}: these handlers change ${entry.tables.drizzle.join(', ')} but never call ${entry.invalidator}`)
    checked += writers.length
  }
  assert.ok(checked >= 3, 'the moderation-rule write paths must be found')
})

/**
 * Trạng thái gắn lên `globalThis` không phải biến cấp module, nên bộ dò ở trên không thấy. Kiểm vắng mặt (đọc
 * chữ là đủ): chỉ những chỗ có tên dưới đây được giữ trạng thái kiểu đó.
 */
const GLOBAL_STATE: Record<string, string> = {
  'server/utils/chatbot/small-talk-semantic.ts': 'ranker ngữ nghĩa small-talk; chấm theo ví dụ của chính ứng viên nên không cũ được (tests/chatbot-small-talk-trigram.test.ts)',
  'server/utils/runtime-config.ts': 'cầu nối hàm `useRuntimeConfig` cho mã ngoài Nitro — hàm, không phải bản sao dữ liệu',
  'server/plugins/runtime-config-global.ts': 'cài cầu nối `useRuntimeConfig` lên globalThis lúc khởi động — hàm, không phải bản sao dữ liệu',
}

test('only the named files touch globalThis at all', () => {
  // Mọi cách ghi (`globalThis.x =`, ép kiểu, bí danh, Object.assign) đều bắt đầu bằng việc nhắc tới globalThis — kiểm
  // vắng mặt trên chữ là đủ, và tệp mới nào nhắc tới nó phải nói nó giữ gì ở đó.
  const offenders = adminHandlers(path.join(ROOT, 'server'))
    .filter(file => /\bglobalThis\b/.test(readFileSync(file, 'utf8')))
    .map(file => path.relative(ROOT, file).split(path.sep).join('/'))
    .filter(rel => !GLOBAL_STATE[rel])
  assert.deepEqual(offenders, [], 'state on globalThis escapes the cache registry: say what is kept there and how it is refreshed, and name the file above')
  for (const file of Object.keys(GLOBAL_STATE)) assert.match(read(file), /\bglobalThis\b/, `${file} no longer touches globalThis — drop it`)
})
