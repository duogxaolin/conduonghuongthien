<script setup lang="ts">
import { pageRange } from '~/utils/pagination'

const props = defineProps<{
  page: number
  totalPages: number
  total?: number
  // nhãn phụ sau pager, vd "12 bình luận"; mặc định "12 mục"
  itemLabel?: string
}>()
const emit = defineEmits<{
  (e: 'update:page', value: number): void
}>()

function go(p: number) {
  if (p < 1 || p > props.totalPages || p === props.page) return
  emit('update:page', p)
}

// Cửa sổ số trang: 5 ô quanh page hiện tại + trang đầu/cuối, kèm "…" — cùng một
// quy tắc với thanh phân trang công khai, chỉ khác bán kính.
const windowPages = computed(() => pageRange(props.page, props.totalPages, 2))

// Chèn "…" (0) vào khoảng trống giữa các số liên tiếp.
const slots = computed(() => {
  const out: (number | 'ellipsis')[] = []
  windowPages.value.forEach((p, i) => {
    if (i > 0 && p - (windowPages.value[i - 1] as number) > 1) out.push('ellipsis')
    out.push(p)
  })
  return out
})

const jump = ref('')
watch(() => props.page, () => { jump.value = '' })
function applyJump() {
  const n = parseInt(jump.value, 10)
  if (Number.isFinite(n)) go(n)
  jump.value = ''
}
</script>

<template>
  <div v-if="totalPages > 1" class="flex flex-wrap items-center justify-between gap-3">
    <span class="text-sm text-ink-muted">
      {{ total != null ? total : '' }}{{ total != null && itemLabel ? ' ' : '' }}{{ itemLabel ?? '' }}
    </span>
    <nav class="flex flex-wrap items-center gap-1.5" aria-label="Phân trang">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-muted hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page <= 1"
        title="Trang đầu"
        aria-label="Trang đầu"
        @click="go(1)"
      >
        <i class="fa-solid fa-angles-left" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-muted hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page <= 1"
        title="Trang trước"
        aria-label="Trang trước"
        @click="go(page - 1)"
      >
        <i class="fa-solid fa-angle-left" aria-hidden="true"></i>
      </button>

      <template v-for="(s, i) in slots" :key="i">
        <span
          v-if="s === 'ellipsis'"
          class="flex h-9 w-9 items-center justify-center text-ink-muted"
          aria-hidden="true"
        >…</span>
        <button
          v-else
          type="button"
          class="flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-semibold"
          :class="s === page
            ? 'border-brand-700 bg-brand-700 text-white'
            : 'border-line-strong bg-white text-[#3d4f3f] hover:bg-surface'"
          :aria-current="s === page ? 'page' : undefined"
          :aria-label="`Trang ${s}`"
          @click="go(s as number)"
        >{{ s }}</button>
      </template>

      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-muted hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page >= totalPages"
        title="Trang sau"
        aria-label="Trang sau"
        @click="go(page + 1)"
      >
        <i class="fa-solid fa-angle-right" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-muted hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page >= totalPages"
        title="Trang cuối"
        aria-label="Trang cuối"
        @click="go(totalPages)"
      >
        <i class="fa-solid fa-angles-right" aria-hidden="true"></i>
      </button>

      <form
        class="ml-1 flex items-center gap-1.5"
        @submit.prevent="applyJump"
      >
        <label for="admin-pag-jump" class="sr-only">Nhập số trang</label>
        <input
          id="admin-pag-jump"
          v-model="jump"
          type="number"
          :min="1"
          :max="totalPages"
          inputmode="numeric"
          class="h-9 w-14 rounded-lg border border-line-strong bg-white px-2 text-center text-sm text-[#3d4f3f] focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/30"
          placeholder="Tr."
          :aria-label="`Nhập số trang (1-${totalPages})`"
        />
        <button
          type="submit"
          class="flex h-9 items-center justify-center rounded-lg border border-line-strong bg-white px-2.5 text-sm font-semibold text-brand-700 hover:bg-surface"
          :aria-label="`Đi đến trang đã nhập`"
        >Đi</button>
      </form>
    </nav>
  </div>
</template>
