<script setup lang="ts">
import { createFocusReturn, inertOutside, trapTabTarget } from '~/utils/focus-return'

const { confirmState, accept, cancel } = useConfirm()

// Không còn Enter-gắn-trên-window = xác nhận: trình xử lý đó chạy TRƯỚC cú click của
// nút đang focus, nên đứng ở "Hủy" bấm Enter vẫn thành đồng ý. Giờ Enter chỉ kích
// hoạt nút đang focus (hành vi gốc của <button>); Escape vẫn là Hủy.
function onKeydown(e: KeyboardEvent) {
  if (!confirmState.visible) return
  if (e.key === 'Escape') cancel()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ── Quản lý focus theo DNA hộp thoại: mở → vào trong hộp; đóng → về nút đã mở nó ──
const dialogEl = ref<HTMLElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const focusReturn = createFocusReturn((el) => el === document.body)

// Gỡ `inert` đã đặt lên phần còn lại của trang — phải chạy TRƯỚC khi trả focus, vì
// nút mở hộp nằm trong vùng đang `inert` thì `focus()` lên nó vô hiệu.
let releaseOutside: (() => void) | null = null
const releasePage = () => {
  releaseOutside?.()
  releaseOutside = null
}
onBeforeUnmount(releasePage)

// Theo dõi `seq` chứ không chỉ `visible`: hộp mở ngay sau khi hộp trước đóng (vd.
// hỏi lý do rồi xác nhận chặn) đổi `visible` true → false → true trong cùng một
// nhịp, watcher chỉ thấy true → true và hộp thứ hai không nhận focus.
watch(
  () => (confirmState.visible ? confirmState.seq : 0),
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      // Hộp nối hộp: hộp vẫn đang hiển thị, focus ở trong nó (hoặc đã rơi về <body>
      // khi ô nhập biến mất) — giữ nút mở ban đầu, không ghi đè.
      if (!dialogEl.value) focusReturn.remember(document.activeElement as HTMLElement | null)
      await nextTick()
      if (dialogEl.value && !releaseOutside) releaseOutside = inertOutside(dialogEl.value)
      // Thao tác nguy hiểm mở ra ở nút "Hủy": một cú Enter vô tình không xoá gì cả.
      const target = confirmState.input
        ? inputEl.value
        : confirmState.options.danger ? cancelBtn.value : confirmBtn.value
      target?.focus()
      return
    }
    const active = document.activeElement
    // Chỉ trả focus nếu nó còn trong hộp (hoặc đã rơi về <body>).
    const shouldRestore = !active || active === document.body || !!dialogEl.value?.contains(active)
    releasePage()
    await nextTick()
    focusReturn.restore(shouldRestore)
  },
)

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"])'
function onTrapTab(event: KeyboardEvent) {
  const root = dialogEl.value
  if (!confirmState.visible || !root) return
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  const target = trapTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
  if (target === null) return
  event.preventDefault()
  items[target]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="confirmState.visible"
        ref="dialogEl"
        class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
        @click.self="cancel"
        @keydown.tab="onTrapTab"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="confirmState.options.title ? 'confirm-title' : undefined"
        aria-describedby="confirm-message"
      >
        <div class="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
          <!-- Header -->
          <div class="flex items-start gap-3 px-5 pt-5 pb-4">
            <div
              class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              :class="confirmState.options.danger ? 'bg-red-100' : 'bg-amber-100'"
            >
              <i
                class="text-lg"
                :class="confirmState.options.danger ? 'fa-solid fa-triangle-exclamation text-red-500' : 'fa-solid fa-circle-question text-amber-500'"
                aria-hidden="true"
              ></i>
            </div>
            <div class="flex-1 min-w-0 pt-1">
              <h3
                v-if="confirmState.options.title"
                id="confirm-title"
                class="m-0 text-[1rem] font-extrabold text-[#122815] leading-tight"
              >
                {{ confirmState.options.title }}
              </h3>
              <p
                id="confirm-message"
                class="m-0 text-[0.9rem] text-[#4a5e4d] leading-relaxed whitespace-pre-line"
                :class="confirmState.options.title ? 'mt-1' : ''"
              >
                {{ confirmState.options.message }}
              </p>
            </div>
          </div>

          <!-- Ô nhập (chỉ với prompt) -->
          <div v-if="confirmState.input" class="px-5 pb-4">
            <label for="confirm-input" class="block mb-1.5 text-[0.85rem] font-semibold text-[#122815]">
              {{ confirmState.input.label }}
            </label>
            <input
              id="confirm-input"
              ref="inputEl"
              v-model="confirmState.input.value"
              type="text"
              :placeholder="confirmState.input.placeholder"
              class="w-full rounded-lg border border-[#dce8dd] px-3 py-2 text-sm text-[#122815] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]"
              @keydown.enter.prevent="accept"
            >
          </div>

          <!-- Actions -->
          <div class="flex gap-2 justify-end px-5 pb-5">
            <button
              ref="cancelBtn"
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border border-[#dce8dd] bg-white px-4 py-2 text-sm font-semibold text-[#4a5e4d] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
              @click="cancel"
            >
              {{ confirmState.options.cancelLabel || 'Hủy' }}
            </button>
            <button
              ref="confirmBtn"
              type="button"
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              :class="confirmState.options.danger
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                : 'bg-[#2c6e33] hover:bg-[#245b2a] focus:ring-[#2c6e33]'"
              @click="accept"
            >
              {{ confirmState.options.confirmLabel || 'Xác nhận' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.15s ease;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
.confirm-fade-enter-active > div,
.confirm-fade-leave-active > div {
  transition: transform 0.15s ease;
}
.confirm-fade-enter-from > div,
.confirm-fade-leave-to > div {
  transform: scale(0.95);
}
</style>
