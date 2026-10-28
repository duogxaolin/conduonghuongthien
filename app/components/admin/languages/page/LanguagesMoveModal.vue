<script setup lang="ts">
/**
 * Hộp "chuyển đến vị trí nào?" của `/admin/languages` — mở từ huy hiệu "#n" trên thẻ ngôn
 * ngữ. Tách khỏi `pages/admin/languages/index.vue` (wave3 4.2): chỉ hiển thị — ngôn ngữ đang
 * chuyển và danh sách vào qua props, chọn một vị trí phát `move`, trang lưu thứ tự.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import { getFlagEmoji } from '~/utils/language-flags'
import type { LanguageItem } from '~/types/admin-languages'

defineProps<{
  open: boolean
  movingLang: LanguageItem | null
  languages: LanguageItem[]
}>()

const emit = defineEmits<{ 'close': [], 'move': [targetIndex: number] }>()
</script>

<template>
  <AdminModal
    :open="open && !!movingLang"
    :title="movingLang ? `${getFlagEmoji(movingLang.code)} ${movingLang.nativeName} — chuyển đến vị trí nào?` : ''"
    size="sm"
    @close="emit('close')"
  >
      <div v-if="movingLang">
        <p class="text-xs text-ink-muted mb-2.5">
          Bấm chọn số thứ tự bên dưới để chuyển ngôn ngữ <strong>{{ movingLang.name }}</strong> đến vị trí đó:
        </p>
        <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
          <button
            v-for="(_, idx) in languages"
            :key="idx"
            type="button"
            class="py-2.5 px-3 rounded-lg font-bold text-sm cursor-pointer transition-all border flex flex-col items-center justify-center gap-0.5"
            :class="languages[idx]?.code === movingLang.code
              ? 'bg-brand-900 text-white border-brand-900 shadow-sm'
              : 'bg-white hover:bg-surface-tint text-brand-950 border-line-strong hover:border-brand-700'"
            @click="emit('move', idx)"
          >
            <span>{{ idx + 1 }}</span>
            <span class="text-[0.62rem] opacity-75 font-normal">
              {{ languages[idx]?.code === movingLang.code ? 'Hiện tại' : languages[idx]?.code.toUpperCase() }}
            </span>
          </button>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-surface cursor-pointer"
          @click="emit('close')"
        >
          Đóng
        </button>
      </template>
  </AdminModal>
</template>
