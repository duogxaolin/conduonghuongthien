<script setup lang="ts">
// Nhãn "bản ngoài máy chủ" của một bản sao lưu trong danh sách (bảng + thẻ điện thoại).
// Chữ mang trạng thái, biểu tượng chỉ trang trí (openspec/ui-dna.md).
import { offsiteStatusDisplay } from '~~/shared/backup-offsite-status'

const props = defineProps<{
  item: { status: string, offsiteStatus: string | null, driveUploaded: boolean | null }
}>()

const display = computed(() => offsiteStatusDisplay(props.item))
</script>

<template>
  <span v-if="display" data-testid="backup-offsite-status" class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.72rem] font-bold" :class="display.className">
    <i :class="display.icon" aria-hidden="true"></i>{{ display.label }}
  </span>
  <span v-else class="text-ink-muted">—</span>
</template>
