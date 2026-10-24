<script setup lang="ts">
/**
 * Khung hộp thoại modal dùng chung của trang quản trị (design D-MODAL, spec
 * `admin-dialogs`). Thay cho các lớp phủ `fixed inset-0` tự viết ở từng trang — mỗi
 * bản thiếu một thứ khác nhau (không vai trò, không tên, Tab lọt ra sau, Escape
 * không đóng, đóng xong focus rơi về `<body>`).
 *
 * - Props: `open`, `title` (tên truy cập — `aria-labelledby` trỏ vào tiêu đề), `busy`
 *   (đang lưu: khoá Escape, nút đóng và bấm nền), `size` (`sm|md|lg|xl`, hoặc
 *   `drawer` — ngăn kéo mép phải), `icon` (trang trí, ẩn với trình đọc màn hình).
 * - Slot: `default` (thân, tự cuộn) và `footer` (hàng nút). Biểu mẫu có nút submit
 *   giữ nút TRONG `<form>` ở slot mặc định — đưa ra `footer` là ra ngoài form.
 * - Phát `close`; trang tự quyết đóng (đặt cờ về false / bỏ `v-if`). Mở bằng
 *   `:open` hay bằng `v-if` của cha (`:open="true"`) đều được: dọn dẹp chạy cả lúc
 *   gỡ component.
 * - Hành vi dựng trên `~/utils/focus-return` như `ConfirmModal.vue`: nhớ nút mở →
 *   focus vào phần tử `data-autofocus`/`autofocus` nếu có, không thì điều khiển đầu tiên
 *   trong thân → `inertOutside` phần còn lại của trang → bẫy Tab → đóng thì gỡ `inert`
 *   TRƯỚC rồi trả focus về nút mở; nút mở đã bị gỡ thì tìm lại theo
 *   `data-admin-modal-opener`/`id`, không thấy thì về `<main>` (không bao giờ `<body>`).
 * - Phím Enter GIỮ trên nút mở: hộp mở ở `keydown` rồi đưa focus vào trong; các keydown
 *   lặp (autorepeat) và lần thả rơi vào điều khiển vừa nhận focus. Hộp nuốt chúng ở pha
 *   capture (`createHeldKeyGuard`) tới lần nhấn mới. Ô nhập trong hộp vẫn KHÔNG dùng
 *   `@keyup.enter` và lọc bằng `isDeliberateEnter` (guard `tests/admin-modal-dialog.test.ts`).
 * - Xếp lớp: `z-[9000]` + thứ tự mở (hộp mở sau nằm trên) — trên layout admin, DƯỚI
 *   `ConfirmModal` (`z-[9999]`) để hộp xác nhận mở đè được; khi đó hộp này bị `inert` và
 *   nhường bàn phím.
 * - Quyết định phím/nền là hàm thuần ở `~/utils/admin-modal` (kiểm không cần DOM).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type PropType } from 'vue'
import { createFocusReturn, inertOutside, isVisibleTabbable, trapTabTarget, visibleTabbables } from '~/utils/focus-return'
import {
  ADMIN_MODAL_AUTOFOCUS_SELECTOR,
  ADMIN_MODAL_OPENER_ATTR,
  adminModalBackdropCloses,
  adminModalKeyAction,
  adminModalLayerZ,
  adminModalLayers,
  adminModalOverlayClass,
  adminModalPanelClass,
  createHeldKeyGuard,
  focusFallbackTarget,
  isAdminModalSize,
  openerKeyOf,
  pickInitialFocus,
  type AdminModalSize,
  type OpenerKey,
} from '~/utils/admin-modal'

const props = defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, required: true },
  busy: { type: Boolean, default: false },
  size: { type: String as PropType<AdminModalSize>, default: 'md', validator: isAdminModalSize },
  icon: { type: String, default: '' },
})

const emit = defineEmits<{ close: [] }>()

const titleId = `admin-modal-title-${useId()}`
const overlayClass = computed(() => adminModalOverlayClass(props.size))
const panelClass = computed(() => adminModalPanelClass(props.size))

const rootEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const footerEl = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)

const focusReturn = createFocusReturn((el) => el === document.body)
let releaseOutside: (() => void) | null = null
let active = false
/** Lớp theo thứ tự mở (0 = chưa mở) — hộp mở sau nằm trên hộp mở trước. */
const layer = ref(0)
const zIndex = computed(() => adminModalLayerZ(layer.value))
let openerKey: OpenerKey | null = null

// Phím Enter giữ trên nút mở: các keydown lặp + lần thả không được tới điều khiển vừa
// nhận focus trong hộp (xem `createHeldKeyGuard`). Pha capture của `document` chạy
// TRƯỚC handler của điều khiển và trước hành vi kích hoạt nút của trình duyệt.
const heldKeys = createHeldKeyGuard()
function onCaptureKeydown(event: KeyboardEvent) {
  if (!heldKeys.keydown(event)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}
function onCaptureKeyup(event: KeyboardEvent) {
  if (!heldKeys.keyup()) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function requestClose() {
  if (!props.busy) emit('close')
}

/** Ở mức `document`: xem `adminModalKeyAction` vì sao không chỉ nghe trên hộp. */
function onDocumentKeydown(event: KeyboardEvent) {
  const root = rootEl.value
  if (!root) return
  const target = event.target instanceof Node ? event.target : null
  const action = adminModalKeyAction({
    key: event.key,
    busy: props.busy,
    defaultPrevented: event.defaultPrevented,
    covered: root.hasAttribute('inert'),
    inside: !!target && root.contains(target),
    focusLost: !target || target === document.body || target === document.documentElement,
  })
  if (action === 'close') {
    event.preventDefault()
    emit('close')
    return
  }
  if (action !== 'trap') return
  const items = visibleTabbables<HTMLElement>(root)
  if (!items.length) {
    event.preventDefault()
    root.focus()
    return
  }
  const next = trapTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
  if (next === null) return
  event.preventDefault()
  items[next]?.focus()
}

let pressStartedOnBackdrop = false
function onBackdropPointerdown(event: PointerEvent) {
  pressStartedOnBackdrop = event.target === event.currentTarget
}
function onBackdropClick(event: MouseEvent) {
  const closes = adminModalBackdropCloses({
    busy: props.busy,
    pressStartedOnBackdrop,
    clickOnBackdrop: event.target === event.currentTarget,
  })
  pressStartedOnBackdrop = false
  if (closes) emit('close')
}

/** Xem `pickInitialFocus`: chỉ định → thân → hàng nút → nút đóng → chính hộp. */
function initialFocus(root: HTMLElement): HTMLElement {
  const designated = root.querySelector<HTMLElement>(ADMIN_MODAL_AUTOFOCUS_SELECTOR)
  const firstIn = (region: HTMLElement | null) => (region ? visibleTabbables<HTMLElement>(region)[0] ?? null : null)
  const close = closeBtn.value
  return pickInitialFocus({
    designated: designated && isVisibleTabbable(designated) ? designated : null,
    body: firstIn(bodyEl.value),
    footer: firstIn(footerEl.value),
    close: close && !close.disabled ? close : null,
    root,
  })
}

/** Nút cùng khoá trong danh sách đã vẽ lại — phải đang hiện và Tab tới được. */
function findOpener(key: OpenerKey): HTMLElement | null {
  const found = key.attr === 'id'
    ? document.getElementById(key.value)
    : document.querySelector<HTMLElement>(`[${ADMIN_MODAL_OPENER_ATTR}="${CSS.escape(key.value)}"]`)
  return found && isVisibleTabbable(found) ? found : null
}

/**
 * Vùng nội dung chính, nhận focus được bằng script (`tabindex="-1"`, không vào thứ tự
 * Tab). Thuộc tính chỉ gắn tạm: rời focus là gỡ (chỉ khi chính hộp này gắn), để bấm vào
 * chỗ trống của trang sau đó không đưa focus (và viền focus) lên cả vùng nội dung.
 */
function mainLandmark(): HTMLElement | null {
  const main = document.querySelector<HTMLElement>('main')
  if (main && !main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1')
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
  }
  return main
}

async function activate() {
  if (active || typeof document === 'undefined') return
  active = true
  layer.value = adminModalLayers.open()
  const opener = document.activeElement as HTMLElement | null
  focusReturn.remember(opener)
  openerKey = openerKeyOf(opener)
  heldKeys.arm()
  document.addEventListener('keydown', onCaptureKeydown, true)
  document.addEventListener('keyup', onCaptureKeyup, true)
  document.addEventListener('keydown', onDocumentKeydown)
  await nextTick()
  const root = rootEl.value
  if (!active || !root) return
  if (!releaseOutside) releaseOutside = inertOutside(root)
  initialFocus(root).focus()
}

function deactivate() {
  if (!active) return
  active = false
  adminModalLayers.close()
  heldKeys.disarm()
  document.removeEventListener('keydown', onCaptureKeydown, true)
  document.removeEventListener('keyup', onCaptureKeyup, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  // Chỉ lấy focus về nếu nó còn trong hộp (hoặc đã rơi về <body>) — không giật focus
  // của người đã tự chuyển đi nơi khác.
  const focused = document.activeElement
  const shouldRestore = !focused || focused === document.body || !!rootEl.value?.contains(focused)
  // Gỡ `inert` TRƯỚC: nút mở nằm trong vùng đang `inert` thì `focus()` lên nó vô hiệu.
  releaseOutside?.()
  releaseOutside = null
  const key = openerKey
  openerKey = null
  void nextTick(() => {
    if (focusReturn.restore(shouldRestore) || !shouldRestore) return
    // Nút mở đã bị gỡ (danh sách tải lại sau một thao tác trong hộp) hoặc hộp mở bằng
    // script: tìm lại nút theo khoá, không thì về vùng nội dung chính.
    focusFallbackTarget(key, { find: findOpener, main: mainLandmark })?.focus()
  })
}

// Watcher mặc định chạy TRƯỚC khi DOM cập nhật: lúc đóng, hộp còn trong tài liệu nên
// biết được focus có đang ở trong nó không.
watch(() => props.open, (open) => {
  if (open) void activate()
  else deactivate()
})
onMounted(() => {
  if (props.open) void activate()
})
onBeforeUnmount(deactivate)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="pointer-events-none transition-opacity duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="rootEl"
        class="fixed inset-0 z-[9000] bg-black/50 outline-none"
        :class="overlayClass"
        :style="{ zIndex }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-busy="busy ? 'true' : undefined"
        tabindex="-1"
        @pointerdown="onBackdropPointerdown"
        @click="onBackdropClick"
      >
        <div data-admin-modal-panel :class="panelClass">
          <div class="flex shrink-0 items-start justify-between gap-3 border-b border-[#e2ece3] bg-[#f8faf8] px-6 py-4">
            <h2 :id="titleId" class="m-0 min-w-0 text-[1.05rem] font-extrabold leading-normal text-[#122815] break-words">
              <i v-if="icon" :class="icon" class="mr-2 text-[#2c6e33]" aria-hidden="true"></i>{{ title }}
            </h2>
            <button
              ref="closeBtn"
              type="button"
              class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-[#667768] transition-colors hover:bg-[#e2ece3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Đóng"
              :disabled="busy"
              @click="requestClose"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <div ref="bodyEl" class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            ref="footerEl"
            class="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[#e2ece3] px-6 py-4"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
