<script setup lang="ts">
/**
 * Chi tiết một đơn đăng ký: thông tin người dân, nhật ký xử lý, và bốn hành động
 * (đổi trạng thái, ghi chú, ghi nhận đã liên hệ, gọi điện).
 *
 * Tách khỏi `pages/admin/submissions/index.vue` vì nó **tự fetch**: bảng danh sách
 * không chở theo nhật ký xử lý (một truy vấn N+1 cho một cột không ai đọc trên
 * bảng), nên mở hồ sơ là một lượt tải riêng — và một thứ tự fetch thì cần đủ ba
 * nhánh tải / lỗi / rỗng của chính nó.
 */
import type { AdminSubmissionDetail, AdminSubmissionEvent } from '~/types/admin-api'
import {
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  SUBMISSION_NOTE_MAX,
  SUBMISSION_STATUS_META,
  allowedTransitions,
  isSubmissionStatus,
  type ContactChannel,
  type SubmissionStatus,
} from '~/utils/submission-status'

const props = defineProps<{ id: number | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const toast = useToast()

const loading = ref(false)
const error = ref('')
const submission = ref<AdminSubmissionDetail | null>(null)
const events = ref<AdminSubmissionEvent[]>([])

/** Hành động đang bay. Một chuỗi thay vì ba cờ boolean — chỉ một chạy mỗi lúc. */
const busy = ref<'' | 'status' | 'note' | 'contact'>('')

const noteDraft = ref('')
const contactChannel = ref<ContactChannel>('phone')
const contactNote = ref('')

const load = async () => {
  if (!props.id) return
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch(`/api/admin/submissions/${props.id}`)
    submission.value = res.submission
    events.value = res.events
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được chi tiết đơn đăng ký.')
  } finally {
    loading.value = false
  }
}

// Mở một hồ sơ khác thì phải dọn nháp của hồ sơ trước: một ghi chú gõ dở cho đơn
// #12 mà còn nằm đó khi mở đơn #13 là cách ghi chú về một người dân bị gắn vào
// hồ sơ của người khác.
watch(() => props.id, (id) => {
  submission.value = null
  events.value = []
  noteDraft.value = ''
  contactNote.value = ''
  contactChannel.value = 'phone'
  error.value = ''
  if (id) load()
}, { immediate: true })

const currentStatus = computed<SubmissionStatus>(() => {
  const value = submission.value?.status
  return isSubmissionStatus(value) ? value : 'new'
})

const statusChoices = computed(() => allowedTransitions(currentStatus.value))

const extraAnswers = computed<Array<{ label: string; value: string }>>(() => {
  const raw = submission.value?.answers
  if (!raw) return []
  const arr = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw) } catch { return [] } })()
    : raw
  return Array.isArray(arr) ? arr.filter((a) => a && (a.label || a.value)) : []
})

const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('vi-VN') : '—')

/** Một dòng nhật ký đọc thành câu. Nhãn lấy từ sổ dùng chung, không viết lại. */
const eventText = (e: AdminSubmissionEvent): string => {
  if (e.eventType === 'view') return 'Đã mở xem hồ sơ lần đầu'
  if (e.eventType === 'status') {
    const from = isSubmissionStatus(e.fromStatus) ? SUBMISSION_STATUS_META[e.fromStatus].label : '—'
    const to = isSubmissionStatus(e.toStatus) ? SUBMISSION_STATUS_META[e.toStatus].label : '—'
    return `Chuyển trạng thái: ${from} → ${to}`
  }
  if (e.eventType === 'contact') {
    const channel = e.channel && e.channel in CONTACT_CHANNEL_LABELS
      ? CONTACT_CHANNEL_LABELS[e.channel as ContactChannel]
      : 'Cách khác'
    return `Đã liên hệ người dân — ${channel}`
  }
  return 'Ghi chú nghiệp vụ'
}

const eventIcon = (e: AdminSubmissionEvent): string => {
  if (e.eventType === 'view') return 'fa-solid fa-eye'
  if (e.eventType === 'status') return 'fa-solid fa-arrow-right-arrow-left'
  if (e.eventType === 'contact') return 'fa-solid fa-phone-volume'
  return 'fa-solid fa-note-sticky'
}

/**
 * Sau mỗi hành động: tải lại nhật ký **và** báo cho danh sách bên ngoài. Chỉ tải
 * lại nhật ký thì huy hiệu trạng thái trên bảng vẫn giữ giá trị cũ, và cán bộ đọc
 * hai con số khác nhau cho cùng một hồ sơ trên cùng một màn hình.
 */
const afterAction = async () => {
  await load()
  emit('changed')
}

const changeStatus = async (next: SubmissionStatus) => {
  if (!props.id || busy.value) return
  busy.value = 'status'
  try {
    await $fetch(`/api/admin/submissions/${props.id}/status`, { method: 'PUT', body: { status: next } })
    toast.success(`Đã chuyển sang "${SUBMISSION_STATUS_META[next].label}".`)
    await afterAction()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đổi trạng thái đơn.'))
  } finally {
    busy.value = ''
  }
}

const saveNote = async () => {
  if (!props.id || busy.value) return
  const note = noteDraft.value.trim()
  if (!note) {
    toast.error('Vui lòng nhập nội dung ghi chú.')
    return
  }
  busy.value = 'note'
  try {
    await $fetch(`/api/admin/submissions/${props.id}/notes`, { method: 'POST', body: { note } })
    noteDraft.value = ''
    toast.success('Đã lưu ghi chú.')
    await afterAction()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu ghi chú.'))
  } finally {
    busy.value = ''
  }
}

const logContact = async () => {
  if (!props.id || busy.value) return
  busy.value = 'contact'
  try {
    await $fetch(`/api/admin/submissions/${props.id}/contact`, {
      method: 'POST',
      body: { channel: contactChannel.value, note: contactNote.value.trim() || undefined },
    })
    contactNote.value = ''
    toast.success('Đã ghi nhận lượt liên hệ.')
    await afterAction()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể ghi nhận lượt liên hệ.'))
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div
    v-if="id"
    class="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4"
    @click.self="emit('close')"
  >
    <div class="max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-2xl bg-white p-6 sm:p-7">
      <div class="mb-4 flex items-start justify-between gap-3">
        <h3 class="m-0 text-[1.15rem] font-extrabold text-[#122815]">
          <i class="fa-solid fa-clipboard-list mr-2 text-[#2c6e33]" aria-hidden="true"></i>
          Chi tiết Đơn đăng ký #{{ id }}
        </h3>
        <button
          type="button"
          class="rounded-lg border border-[#c8d6c9] bg-white px-2.5 py-1.5 text-sm text-[#2c3e2e] hover:bg-[#f4f7f4]"
          aria-label="Đóng"
          @click="emit('close')"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-3">
        <span class="sr-only">Đang tải chi tiết đơn đăng ký</span>
        <div
          v-for="n in 5"
          :key="n"
          class="h-12 animate-pulse rounded-lg bg-[#EEF2EC] motion-reduce:animate-none"
          aria-hidden="true"
        ></div>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        role="alert"
        class="rounded-xl border border-[#e8c3c1] bg-[#f7e8e8] px-4 py-5 text-center text-[0.9rem] text-[#8c2f2b]"
      >
        <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        {{ error }}
        Vui lòng
        <button type="button" class="font-bold text-[#2c6e33] underline" @click="load()">thử lại</button>.
      </div>

      <template v-else-if="submission">
        <!-- Status + provenance -->
        <div class="mb-5 flex flex-wrap items-center gap-2 text-[0.8rem]">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold"
            :class="SUBMISSION_STATUS_META[currentStatus].badgeClass"
          >
            <i :class="SUBMISSION_STATUS_META[currentStatus].icon" aria-hidden="true"></i>
            {{ SUBMISSION_STATUS_META[currentStatus].label }}
          </span>
          <span class="text-[#667768]">Gửi lúc {{ fmtDate(submission.createdAt) }}</span>
          <span v-if="submission.formTitle" class="font-medium text-[#2c6e33]">{{ submission.formTitle }}</span>
        </div>

        <!-- Email notification state. NULL đọc ra là "chưa ai được báo", và trước
             thay đổi này thì đó là MỌI hàng mà không có gì trên màn hình nói ra. -->
        <p
          v-if="submission.notifiedAt"
          class="mb-4 flex items-center gap-2 rounded-lg bg-[#e6f5e8] px-3 py-2 text-[0.82rem] text-[#22662b]"
        >
          <i class="fa-solid fa-envelope-circle-check" aria-hidden="true"></i>
          Đã gửi email thông báo lúc {{ fmtDate(submission.notifiedAt) }}
        </p>
        <p
          v-else
          class="mb-4 flex items-center gap-2 rounded-lg bg-[#fdf3e2] px-3 py-2 text-[0.82rem] text-[#8a5a12]"
        >
          <i class="fa-solid fa-envelope" aria-hidden="true"></i>
          Chưa gửi được email thông báo. Kiểm tra cấu hình SMTP và email nhận đơn trong Cài đặt.
        </p>

        <!-- Citizen details -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-if="submission.fullName" class="flex flex-col gap-1">
            <span class="text-[0.78rem] font-bold text-[#667768]">Họ và tên:</span>
            <strong class="text-[#122815]">{{ submission.fullName }}</strong>
          </div>
          <div v-if="submission.phone" class="flex flex-col gap-1">
            <span class="text-[0.78rem] font-bold text-[#667768]">Số điện thoại:</span>
            <code class="self-start rounded bg-[#f4f7f4] px-2 py-1 text-sm">{{ submission.phone }}</code>
          </div>
          <div v-if="submission.email" class="flex flex-col gap-1">
            <span class="text-[0.78rem] font-bold text-[#667768]">Email:</span>
            <span>{{ submission.email }}</span>
          </div>
          <div v-if="submission.address" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] font-bold text-[#667768]">Địa chỉ:</span>
            <span>{{ submission.address }}</span>
          </div>
          <div v-if="submission.message" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] font-bold text-[#667768]">Nội dung yêu cầu / Hoàn cảnh:</span>
            <div class="whitespace-pre-wrap rounded-lg border border-[#e2ece3] bg-[#f8faf8] px-3 py-3 text-[0.9rem] leading-relaxed">{{ submission.message }}</div>
          </div>
          <div v-for="(a, i) in extraAnswers" :key="i" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] font-bold text-[#667768]">{{ a.label }}:</span>
            <span class="whitespace-pre-wrap">{{ a.value || '—' }}</span>
          </div>
        </div>

        <!-- Status actions -->
        <div class="mt-6 rounded-xl border border-[#e2ece3] p-4">
          <h4 class="m-0 mb-1 text-[0.92rem] font-bold text-[#122815]">Cập nhật trạng thái</h4>
          <p class="m-0 mb-3 text-[0.78rem] text-[#667768]">{{ SUBMISSION_STATUS_META[currentStatus].description }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="choice in statusChoices"
              :key="choice"
              type="button"
              :disabled="busy !== ''"
              class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[0.82rem] font-bold transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60"
              :class="SUBMISSION_STATUS_META[choice].badgeClass"
              @click="changeStatus(choice)"
            >
              <i :class="SUBMISSION_STATUS_META[choice].icon" aria-hidden="true"></i>
              {{ SUBMISSION_STATUS_META[choice].label }}
            </button>
          </div>
        </div>

        <!-- Contact log -->
        <div class="mt-4 rounded-xl border border-[#e2ece3] p-4">
          <h4 class="m-0 mb-1 text-[0.92rem] font-bold text-[#122815]">Ghi nhận đã liên hệ</h4>
          <p class="m-0 mb-3 text-[0.78rem] text-[#667768]">Ghi lại việc đã liên hệ người dân. Không tự đổi trạng thái đơn.</p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <select
              v-model="contactChannel"
              aria-label="Hình thức liên hệ"
              class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
            >
              <option v-for="channel in CONTACT_CHANNELS" :key="channel" :value="channel">
                {{ CONTACT_CHANNEL_LABELS[channel] }}
              </option>
            </select>
            <input
              v-model="contactNote"
              type="text"
              placeholder="Kết quả liên hệ (không bắt buộc)"
              :maxlength="SUBMISSION_NOTE_MAX"
              class="flex-1 rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
            />
            <button
              type="button"
              :disabled="busy !== ''"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2 text-sm font-bold text-white hover:bg-[#2c6e33] disabled:cursor-not-allowed disabled:opacity-60"
              @click="logContact"
            >
              <i class="fa-solid fa-check" aria-hidden="true"></i> Ghi nhận
            </button>
          </div>
        </div>

        <!-- Note -->
        <div class="mt-4 rounded-xl border border-[#e2ece3] p-4">
          <h4 class="m-0 mb-3 text-[0.92rem] font-bold text-[#122815]">Thêm ghi chú nghiệp vụ</h4>
          <textarea
            v-model="noteDraft"
            rows="3"
            :maxlength="SUBMISSION_NOTE_MAX"
            placeholder="Ví dụ: đã chuyển hồ sơ cho Công an xã Tam Hưng, chờ phản hồi."
            class="w-full rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
          ></textarea>
          <div class="mt-2 flex items-center justify-between gap-3">
            <span class="text-[0.75rem] text-[#667768]">{{ noteDraft.length }}/{{ SUBMISSION_NOTE_MAX }}</span>
            <button
              type="button"
              :disabled="busy !== ''"
              class="inline-flex items-center gap-2 rounded-lg border border-[#8ed694] bg-[#f0f7f1] px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-[#e4f2e5] disabled:cursor-not-allowed disabled:opacity-60"
              @click="saveNote"
            >
              <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Lưu ghi chú
            </button>
          </div>
        </div>

        <!-- Timeline -->
        <div class="mt-5">
          <h4 class="m-0 mb-3 text-[0.92rem] font-bold text-[#122815]">Nhật ký xử lý</h4>
          <p v-if="events.length === 0" class="m-0 text-[0.85rem] text-[#667768]">
            Chưa có thao tác nào được ghi lại cho đơn này.
          </p>
          <ol v-else class="m-0 flex list-none flex-col gap-3 p-0">
            <li v-for="e in events" :key="e.id" class="flex gap-3 border-l-2 border-[#e2ece3] pl-3">
              <i :class="eventIcon(e)" class="mt-0.5 text-[0.8rem] text-[#2c6e33]" aria-hidden="true"></i>
              <div class="min-w-0 flex-1">
                <p class="m-0 text-[0.85rem] font-medium text-[#122815]">{{ eventText(e) }}</p>
                <p class="m-0 text-[0.75rem] text-[#667768]">
                  {{ e.actorUsername || e.actorName || 'Tài khoản đã xoá' }} · {{ fmtDate(e.createdAt) }}
                </p>
                <p v-if="e.note" class="m-0 mt-1 whitespace-pre-wrap text-[0.82rem] text-[#2c3e2e]">{{ e.note }}</p>
              </div>
            </li>
          </ol>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-lg border-0 bg-[#f0f0f0] px-4 py-2.5 font-medium"
            @click="emit('close')"
          >
            Đóng
          </button>
          <a
            v-if="submission.phone"
            :href="`tel:${submission.phone}`"
            class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white no-underline transition-colors hover:bg-[#2c6e33]"
          >
            <i class="fa-solid fa-phone" aria-hidden="true"></i> Gọi Điện Tư Vấn
          </a>
        </div>
      </template>
    </div>
  </div>
</template>
