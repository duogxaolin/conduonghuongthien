<template>
  <template v-for="(part, i) in parts" :key="i"><strong v-if="part.value" :class="strongClass">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template>
</template>

<script setup lang="ts">
/**
 * Một câu dịch có giá trị in đậm ở giữa: `t('sp_found')` = "Tìm thấy {n} kết quả…" /
 * "{n} matching results…". Giá trị đứng đúng chỗ bản dịch đặt nó, thay vì trang ghép
 * "chữ + <strong>số</strong> + chữ" theo thứ tự tiếng Việt.
 */
import { computed } from 'vue'
import { splitPlaceholders, type PlaceholderValues } from '~/utils/i18n-placeholders'

const props = defineProps<{
  text: string
  values: PlaceholderValues
  strongClass?: string
}>()
const parts = computed(() => splitPlaceholders(props.text, props.values))
</script>
