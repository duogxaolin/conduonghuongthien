/**
 * `useRuntimeConfig` is a Nitro auto-import — but auto-imports only materialise
 * for a BARE identifier. A member access like `globalThis.useRuntimeConfig` is
 * never transformed by unimport, and across nuxt@4.5.2 / nitropack@2.13.4
 * nothing assigns that global either. That combination held analytics collection
 * at `{ accepted: false }` for three weeks while every env var was correct (the
 * full post-mortem lives on `plugins/runtime-config-global.ts`).
 *
 * Inside the server bundle the global IS present — because
 * `plugins/runtime-config-global.ts` installs Nitro's real function on it before
 * any request runs. Outside the bundle (maintenance scripts, tests under plain
 * node) nothing installs it: `tryRuntimeConfig()` returns undefined and callers
 * keep falling back to process.env. Importing `nitropack/runtime/internal/config`
 * directly here would crash plain node on the `#nitro-internal-virtual/*`
 * specifier, which is why the plugin passes the function in rather than this
 * module importing it.
 *
 * Every caller used to inline `typeof globalThis.useRuntimeConfig === 'function'
 * ? globalThis.useRuntimeConfig() : undefined`, which reads as noise and, more
 * to the point, is untyped — `globalThis` has no such property as far as the
 * compiler is concerned. One helper, cast once, in a file whose name says why.
 */
/**
 * Khối `runtimeConfig` như `nuxt.config.ts` khai, phản chiếu từng trường.
 *
 * Trước đây hàm dò trả `Record<string, any>`, và **tám** nơi gọi mỗi nơi tự đoán
 * hình dạng của nó: `tryRuntimeConfig()?.[name]` (hai bản sao, khoá là chuỗi tuỳ
 * ý), `tryRuntimeConfig() as { publicBaseUrl?: unknown }`, `?? {}` rồi đọc
 * `config.dbHost`. Nghĩa là một khoá gõ sai — `dpHost`, `trustedProxyIp` —
 * biên dịch trót lọt rồi **âm thầm rơi về `process.env`**, tức là về đúng giá
 * trị mặc định. Trên máy dev không có biến đó thì kết quả giống hệt cấu hình
 * đúng; chỉ ở production, nơi biến `NUXT_`-prefix mới có tác dụng, nó mới lệch.
 *
 * `trustedProxyIps` là chỗ hậu quả nặng nhất: đọc trượt khoá đó là danh sách
 * proxy tin cậy thành rỗng, tức mọi khách sau nginx bị gộp thành **một** ô đếm
 * giới hạn tần suất (lỗi đã ghi trong CLAUDE.md), và không có gì báo.
 *
 * Khai một chỗ thì thêm trường vào `nuxt.config.ts` là thêm ở đây, và mọi nơi
 * đọc sai khoá đỏ ngay lượt typecheck.
 */
export interface AppRuntimeConfig {
  aiApiKey?: string
  aiBaseUrl?: string
  aiModel?: string
  trustedProxyIps?: string
  publicBaseUrl?: string
  analytics?: AnalyticsRuntimeConfig
  /** Nitro tự nạp `NUXT_`-prefix cho các khoá CSDL; không khai trong nuxt.config.ts. */
  dbHost?: string
  dbPort?: string
  dbUser?: string
  dbPassword?: string
  dbName?: string
  public?: Record<string, unknown>
}

export function tryRuntimeConfig(): AppRuntimeConfig | undefined {
  const candidate = (globalThis as Record<string, unknown>).useRuntimeConfig
  return typeof candidate === 'function'
    ? (candidate as () => AppRuntimeConfig)()
    : undefined
}

/**
 * Install Nitro's own `useRuntimeConfig` on globalThis — the single wiring point
 * the docstring above describes. Called once by `plugins/runtime-config-global.ts`
 * at server boot; plain node (scripts, tests) never calls it, preserving the
 * off-server contract.
 *
 * Never overwrites an existing function: if a future Nitro starts providing the
 * global natively, that version must win — ours is a bridge for the versions
 * that don't.
 */
export function installRuntimeConfigGlobal(useRuntimeConfig: () => AppRuntimeConfig): void {
  const globals = globalThis as Record<string, unknown>
  if (typeof globals.useRuntimeConfig === 'function') return
  globals.useRuntimeConfig = useRuntimeConfig
}

/**
 * The `analytics` block of runtimeConfig, as declared in nuxt.config.ts.
 *
 * Mirrors that declaration field for field. Five endpoints used to reach this
 * block through `useRuntimeConfig(event) as unknown as { analytics?: { … } }`,
 * each spelling out only the one or two fields it happened to need — so the
 * "type" at each call site was a fresh guess, and four of the five did not know
 * `collectionEnabled` existed at all.
 *
 * `as unknown as` *asserts* a shape rather than *checking* one. That is the same
 * construct that hid the `db.insert()` array bug: it survived typecheck, a fake
 * pool, and every source-text test, and only a real driver objected. One
 * declaration here means a field added to nuxt.config.ts is added in one place
 * and every reader sees it.
 */
export interface AnalyticsRuntimeConfig {
  hmacSecret?: string
  collectionEnabled?: boolean
  rawRetentionDays?: number
  aggregateRetentionDays?: number
  defaultRangeDays?: number
  maxRangeDays?: number
  freshnessThresholdHours?: number
  liveRetentionHours?: number
  nocRetentionDays?: number
}

/**
 * Read the analytics config, whether or not Nitro is present.
 *
 * `event` is accepted and ignored: `useRuntimeConfig(event)` and
 * `useRuntimeConfig()` return the same object on the server, and taking the
 * parameter keeps the call sites reading naturally. Returns an empty object
 * outside Nitro (maintenance scripts, tests) so callers can keep using optional
 * access without a null check that would only ever matter off-server.
 */
export function analyticsConfig(_event?: unknown): AnalyticsRuntimeConfig {
  const config = tryRuntimeConfig()
  const analytics = config?.analytics
  return (analytics && typeof analytics === 'object') ? analytics as AnalyticsRuntimeConfig : {}
}

/**
 * The HMAC secret used to sign chat-session and visitor tokens, or ''.
 *
 * Returns the empty string rather than undefined because every caller treats
 * "absent" and "empty" identically — a token cannot be signed or verified with
 * either — and collapsing the two here removes a `?? ''` from four call sites.
 */
export function analyticsHmacSecret(event?: unknown): string {
  return analyticsConfig(event).hmacSecret || ''
}
