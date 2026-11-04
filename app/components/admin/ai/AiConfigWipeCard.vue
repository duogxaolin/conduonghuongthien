<script setup lang="ts">
/**
 * "Xoá toàn bộ cấu hình AI" — vùng nguy hiểm ở cuối tab Tổng quan.
 *
 * Gọi `POST /api/admin/ai/config/wipe` với HAI cổng phía máy chủ: `ai.update` VÀ
 * SuperAdmin. Ở đây nút chỉ hiện khi người đang đăng nhập là SuperAdmin — một nút mà
 * lần bấm nào cũng trả 403 là cái bẫy.
 *
 * Hộp xác nhận nêu ĐÚNG cái mất và cái còn (luật kiểm duyệt, đích AI của chatbot, nhật
 * ký chi phí đều ở lại) và nói rõ khoá API không khôi phục được: người bấm phải biết
 * mình đang phải nhập lại khoá, giá model và prompt.
 *
 * Emit `wiped` để dashboard/tab cha đọc lại số liệu — hàng `ai_budget_settings` vừa bị
 * xoá nên thẻ "Hạn mức ngân sách" phải về 0 ngay, không đợi người dùng tải lại trang.
 */
import type { AdminAiConfigWipeResponse } from '~/types/admin-ai-api'

const emit = defineEmits<{ wiped: [] }>()

const { user, hasPermission } = useAdminAuth()
const { confirm } = useConfirm()
const toast = useToast()

// Cả hai cổng máy chủ, không chỉ một: người có `ai.update` mà không phải SuperAdmin
// nhận 403, nên nút không được hiện với họ.
const canWipe = computed(() => user.value?.isSuperAdmin === true && hasPermission('ai', 'update'))
const wiping = ref(false)

async function wipe() {
  if (!canWipe.value || wiping.value) return
  const accepted = await confirm({
    title: 'Xoá toàn bộ cấu hình AI',
    message:
      'Sẽ xoá VĨNH VIỄN: nhà cung cấp AI kèm khoá API đã lưu, cấu hình model + prompt của 5 dịch vụ, '
      + 'giá model và hạn mức ngân sách.\n\n'
      + 'Khoá API không khôi phục được — sau thao tác này trợ lý AI và các tính năng AI ngừng chạy cho tới khi '
      + 'ai đó nhập lại khoá, giá và prompt.\n\n'
      + 'KHÔNG bị xoá: luật kiểm duyệt an ninh, đích AI của chatbot và nhật ký chi phí đã phát sinh.',
    confirmLabel: 'Xoá toàn bộ cấu hình',
    cancelLabel: 'Huỷ',
    danger: true,
  })
  if (!accepted) return

  wiping.value = true
  try {
    const res = await adminFetch<AdminAiConfigWipeResponse>('/api/admin/ai/config/wipe', { method: 'POST' })
    const counts = res.deleted
    const total = counts.providers + counts.services + counts.pricing + counts.budget
    if (total === 0) toast.info('Không có cấu hình AI nào để xoá — hệ thống đang ở trạng thái trắng.')
    else toast.success(
      `Đã xoá ${counts.providers} nhà cung cấp, ${counts.services} cấu hình dịch vụ, `
      + `${counts.pricing} giá model và ${counts.budget} hạn mức ngân sách. Nhập lại khoá API trước khi dùng AI.`,
    )
    emit('wiped')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá cấu hình AI.'))
  } finally {
    wiping.value = false
  }
}
</script>

<template>
  <section v-if="canWipe" class="rounded-xl border border-danger-soft/45 bg-white p-4">
    <h2 class="m-0 text-sm font-bold text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
      Vùng nguy hiểm
    </h2>
    <p class="m-0 mt-1.5 text-[0.85rem] text-ink-muted">
      Xoá toàn bộ cấu hình AI do con người nhập để bắt đầu lại từ đầu: nhà cung cấp kèm khoá API, cấu hình dịch vụ
      (model + prompt), giá model và hạn mức ngân sách. Luật kiểm duyệt, đích AI của chatbot và nhật ký chi phí
      <strong>không</strong> bị đụng tới. Sau khi xoá, trợ lý AI ngừng chạy cho tới khi nhập lại khoá API.
    </p>
    <button
      type="button"
      class="mt-3 rounded-lg border border-danger-soft/45 px-3.5 py-2 text-[0.85rem] font-bold text-danger-soft hover:bg-danger-bg focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="wiping"
      @click="wipe"
    >
      <i class="fa-solid fa-trash-can mr-1 text-[0.75rem]" aria-hidden="true"></i>
      {{ wiping ? 'Đang xoá…' : 'Xoá toàn bộ cấu hình AI' }}
    </button>
  </section>
</template>
