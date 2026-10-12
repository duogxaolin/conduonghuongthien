<script setup lang="ts">
/**
 * Mermaid diagram renderer — .client.vue (mermaid needs DOM, cannot SSR).
 * Lazy import('mermaid') in onMounted. Pattern matches AnalyticsTrafficChart.client.vue.
 */
const props = defineProps<{ source: string }>()

const svg = ref('')
const loading = ref(true)
const error = ref(false)

onMounted(async () => {
  try {
    const mermaid = await import('mermaid')
    mermaid.default.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor: '#1e4620',
        primaryTextColor: '#f0f7f1',
        primaryBorderColor: '#0d1f11',
        lineColor: '#425845',
        secondaryColor: '#e2ede3',
        tertiaryColor: '#f0f7f1',
        background: '#ffffff',
        mainBkg: '#1e4620',
        secondBkg: '#e2ede3',
        fontSize: '14px',
        fontFamily: 'Inter, sans-serif',
      },
      flowchart: {
        curve: 'basis',
        padding: 20,
        nodeSpacing: 50,
        rankSpacing: 50,
      },
    })
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`
    const { svg: rendered } = await mermaid.default.render(id, props.source)
    svg.value = rendered
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="mermaid-container">
    <div v-if="loading" role="status" aria-busy="true" class="flex items-center justify-center py-12">
      <span class="sr-only">Đang tải sơ đồ</span>
      <div class="h-8 w-8 animate-pulse motion-reduce:animate-none rounded-full bg-[#e2ede3]" aria-hidden="true"></div>
    </div>
    <pre v-else-if="error" class="bg-[#f0f7f1] border border-[#e2ede3] rounded-lg p-4 overflow-x-auto text-sm text-[#122815]"><code>{{ source }}</code></pre>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else v-html="svg" class="mermaid-svg overflow-x-auto"></div>
  </div>
</template>
