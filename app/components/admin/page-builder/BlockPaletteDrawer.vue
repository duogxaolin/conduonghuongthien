<script setup lang="ts">
/**
 * Ngăn kéo "Thêm khối" của trình dựng trang — các nhóm khối đã lọc theo vị trí sẽ thêm vào
 * (`useBuilderTreeEdits`). Tách khỏi `pages/admin/content/pages/[id].vue` (wave3 4.2): chỉ hiển
 * thị — nhóm và nhãn vị trí vào qua props, chọn một khối phát `add`, trang thêm vào cây.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { PaletteGroup } from '~/composables/useBuilderTreeEdits'

defineProps<{
  open: boolean
  adding: boolean
  /** "Thêm vào cấp gốc của trang." / "Thêm Cột vào …" … */
  contextLabel: string
  groups: PaletteGroup[]
}>()

const emit = defineEmits<{ 'close': [], 'add': [type: string] }>()
</script>

<template>
  <AdminModal :open="open" title="Thêm khối" size="drawer" :busy="adding" @close="emit('close')">
      <p class="mb-4 mt-0 text-xs text-gray-500">{{ contextLabel }}</p>
      <div v-for="group in groups" :key="group.key" class="mb-6">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{{ group.title }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="item in group.items"
            :key="item.type"
            class="flex flex-col items-start gap-2 rounded-lg border border-gray-200 p-3 text-left transition hover:border-green-500 hover:bg-green-50 disabled:opacity-50"
            :disabled="adding"
            @click="emit('add', item.type)"
          >
            <i :class="[item.icon, 'text-green-700']"></i>
            <span class="text-sm font-semibold text-gray-700">{{ item.label }}</span>
          </button>
        </div>
      </div>
      <p v-if="!groups.length" class="py-8 text-center text-sm text-gray-400">Không có khối phù hợp cho vị trí này.</p>
  </AdminModal>
</template>
