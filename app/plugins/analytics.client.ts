import { ANALYTICS_ENDPOINT, classifyDevice, classifySource, createPageViewCollector, isConservativeBot } from '../utils/analytics-collector'

// Separate the $fetch call from the inline arrow so TS doesn't instantiate the
// full $fetch generic chain at the inference site (TS2589).
function postAnalytics(payload: unknown): Promise<void> {
  return ($fetch as (url: string, opts: Record<string, unknown>) => Promise<unknown>)(ANALYTICS_ENDPOINT, {
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
