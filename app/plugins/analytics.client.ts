import { publicFetch } from '../composables/publicFetch'
import type { PublicPageViewResponse } from '../types/public-site-api'
import { ANALYTICS_ENDPOINT, classifyDevice, classifySource, createPageViewCollector, isConservativeBot } from '../utils/analytics-collector'

// The one page-view beacon: fire-and-forget (keepalive, no retry, 1.5 s), every failure
// swallowed — analytics never disturbs a page. `publicFetch` (D-FETCH lot G) instead of a
// `$fetch` cast, which TS2589 forced here before.
function postAnalytics(payload: unknown): Promise<void> {
  return publicFetch<PublicPageViewResponse>(ANALYTICS_ENDPOINT, {
    method: 'POST',
    body: payload as Record<string, unknown>,
    keepalive: true,
    retry: 0,
    timeout: 1500,
  }).then(() => undefined).catch(() => undefined)
}

export default defineNuxtPlugin((nuxtApp) => {
  const emit = createPageViewCollector({
    isBot: isConservativeBot(navigator.userAgent),
    sourceCategory: classifySource(document.referrer, window.location.hostname),
    deviceClass: classifyDevice(navigator.userAgent),
    transport: postAnalytics,
  })

  // The hooks expect void; emit() returns a boolean the collector uses for its
  // own bookkeeping, which must not be handed back as a hook result.
  nuxtApp.hook('app:mounted', () => { emit(nuxtApp.$router.currentRoute.value.fullPath) })
  nuxtApp.hook('page:finish', () => { emit(nuxtApp.$router.currentRoute.value.fullPath) })
})
