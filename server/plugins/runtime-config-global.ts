import { useRuntimeConfig } from 'nitropack/runtime/internal/config'
import { installRuntimeConfigGlobal } from '../utils/runtime-config'

/**
 * Nitro auto-imports `useRuntimeConfig` for bare identifiers only. A member
 * access — `globalThis.useRuntimeConfig`, the shape `tryRuntimeConfig()` probes
 * — is never transformed by unimport, and across nuxt@4.5.2 / nitropack@2.13.4
 * nothing assigns that global natively either. The probe therefore returned
 * `undefined` on every production boot.
 *
 * `analyticsConfig()` reads `collectionEnabled` through that probe and has no
 * process.env fallback, so from commit `1da1b22` (the typed-accessor refactor)
 * onward the page-view collector answered `202 {accepted: false}` forever while
 * every `NUXT_ANALYTICS_*` variable was correct — three weeks of silently
 * missing analytics, and the same empty secret took down chat session tokens
 * (`503`), old-chat claiming and the article view deduplication key with it.
 * Every other runtimeConfig reader survived only because it happened to carry a
 * `process.env` fallback.
 *
 * This plugin installs the REAL function — the same auto-import resolves to — on
 * `globalThis` before any request runs (nitro runs plugins synchronously at
 * bundle load, before the router serves anything). `tryRuntimeConfig()` then
 * finds it, and all five `analyticsConfig`/`analyticsHmacSecret` call sites plus
 * the fallback-bearing readers (db, client-ip, google-oauth) start reading the
 * config Nitro actually resolved, `NUXT_`-prefixed overrides included.
 *
 * Why a global assignment instead of `process.env` fallbacks per field: Nitro's
 * `applyEnv` already owns the mapping from `NUXT_ANALYTICS_HMAC_SECRET` to
 * `analytics.hmacSecret`. Re-deriving those names by hand would be a second
 * copy of that mapping — the exact two-implementations failure shape this
 * project keeps paying for. The probe docstring in `runtime-config.ts` has
 * always claimed the global exists inside the bundle; this makes the claim
 * true instead of adding a second mechanism beside it.
 *
 * Deliberately unconditional in every environment: dev runs the same bundle
 * shape, so the install is a no-op there too, not a difference to remember.
 * The guarded writer (`installRuntimeConfigGlobal`) never overwrites an
 * existing function, so a future Nitro providing the global natively wins.
 */
export default defineNitroPlugin(() => {
  installRuntimeConfigGlobal(useRuntimeConfig)
})
