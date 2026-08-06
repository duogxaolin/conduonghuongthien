/**
 * `useRuntimeConfig` is a Nitro auto-import: present on the global object when
 * the code runs inside the server bundle, absent when the same module is
 * imported by the maintenance scripts or the test suite under plain `node`.
 *
 * Every caller used to inline `typeof globalThis.useRuntimeConfig === 'function'
 * ? globalThis.useRuntimeConfig() : undefined`, which reads as noise and, more
 * to the point, is untyped — `globalThis` has no such property as far as the
 * compiler is concerned. One helper, cast once, in a file whose name says why.
 *
 * Returns undefined outside Nitro so callers keep falling back to process.env.
 */
export function tryRuntimeConfig(): Record<string, any> | undefined {
  const candidate = (globalThis as Record<string, unknown>).useRuntimeConfig
  return typeof candidate === 'function'
    ? (candidate as () => Record<string, any>)()
    : undefined
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
