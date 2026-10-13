<script setup lang="ts">
import { computed } from 'vue'
import { splitEmail } from '~/utils/email-parts'

// Email hiển thị công khai, viết sao cho Cloudflare không nhận ra mẫu `a@b` (xem app/utils/email-parts.ts).
const props = defineProps<{ email?: string | null }>()
const parts = computed(() => splitEmail(props.email))
</script>

<template>
  <span v-if="parts">{{ parts.local }}<span>@</span>{{ parts.domain }}</span>
  <span v-else>{{ email }}</span>
</template>
