import { ANALYTICS_ENDPOINT, classifyDevice, classifySource, createPageViewCollector, isConservativeBot } from '../utils/analytics-collector'

export default defineNuxtPlugin((nuxtApp) => {
  const emit = createPageViewCollector({
    isBot: isConservativeBot(navigator.userAgent),
    sourceCategory: classifySource(document.referrer, window.location.hostname),
    deviceClass: classifyDevice(navigator.userAgent),
    transport: payload => $fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      body: payload,
      keepalive: true,
      retry: 0,
      timeout: 1500,
    }),
  })

  nuxtApp.hook('app:mounted', () => emit(nuxtApp.$router.currentRoute.value.fullPath))
  nuxtApp.hook('page:finish', () => emit(nuxtApp.$router.currentRoute.value.fullPath))
})
