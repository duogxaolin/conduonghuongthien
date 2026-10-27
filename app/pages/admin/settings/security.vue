<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Chính sách bắt buộc xác thực hai bước (spec admin-mfa-policy, design D1).
 *
 * Chỉ SuperAdmin đọc/ghi (máy chủ kiểm, trang chỉ là nơi bấm). Bật chính sách đặt
 * mốc cưỡng chế 14 ngày sau; trong thời gian đó tài khoản thuộc diện thấy banner
 * báo ngày. Trang liệt kê ai sẽ bị chặn ở từng mức để SuperAdmin nhắc họ trước khi
 * bật — một chính sách khoá người vận hành ra ngoài là thứ phải thấy trước, không
 * phải phát hiện sau.
 */
type Policy = 'off' | 'privileged' | 'all'
type Account = { id: number; username: string; roleName: string | null }
type Overview = {
  ok: boolean
  policy: Policy
  enforceAfter: string | null
  graceDays: number
  killSwitch: boolean
  withoutFactor: Record<'privileged' | 'all', Account[]>
}

const OPTIONS: Array<{ value: Policy; label: string; hint: string }> = [
  { value: 'off', label: 'Không bắt buộc', hint: 'Mỗi tài khoản tự quyết định có bật xác thực hai bước hay không.' },
  { value: 'privileged', label: 'Bắt buộc với tài khoản đặc quyền', hint: 'SuperAdmin và mọi tài khoản có quyền sửa hoặc xoá Người dùng, Vai trò, Cài đặt (gồm sao lưu).' },
  { value: 'all', label: 'Bắt buộc với mọi tài khoản quản trị', hint: 'Mọi tài khoản đăng nhập trang quản trị.' },
]

const toast = useToast()
const { confirm } = useConfirm()
const { fetchUser } = useAdminAuth()

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const overview = ref<Overview | null>(null)
const selected = ref<Policy>('off')

const affected = computed<Account[]>(() => (selected.value === 'off' || !overview.value ? [] : overview.value.withoutFactor[selected.value]))
const changed = computed(() => overview.value !== null && selected.value !== overview.value.policy)

function formatDay(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string) => Promise<Overview>)('/api/admin/security/mfa-policy')
    overview.value = res
    selected.value = res.policy
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được chính sách xác thực hai bước.')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!overview.value || !changed.value || saving.value) return
  const next = selected.value
  const message = next === 'off'
    ? 'Tắt chính sách: không tài khoản nào còn bị buộc bật xác thực hai bước.'
    : `Bật chính sách. Sau ${overview.value.graceDays} ngày, tài khoản thuộc diện mà chưa bật xác thực hai bước chỉ còn vào được trang "Tài khoản của tôi".`
      + (affected.value.length ? ` Hiện ${affected.value.length} tài khoản chưa bật: ${affected.value.map(a => a.username).join(', ')}.` : '')
  if (!await confirm({ message, confirmLabel: next === 'off' ? 'Tắt chính sách' : 'Bật chính sách', danger: next !== 'off' })) return
  saving.value = true
  try {
    await ($fetch as (u: string, o: Record<string, unknown>) => Promise<unknown>)('/api/admin/security/mfa-policy', {
      method: 'PUT',
      body: { policy: next },
    })
    toast.success(next === 'off' ? 'Đã tắt chính sách.' : 'Đã bật chính sách. Thời hạn chuyển tiếp bắt đầu từ bây giờ.')
    // Chính SuperAdmin cũng có thể thuộc diện: đọc lại `me` để banner hiện ngay.
    await Promise.all([load(), fetchUser()])
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không lưu được chính sách.'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-brand-950">Bắt buộc xác thực hai bước</h1>
      <p class="m-0 mt-1 text-sm text-ink-muted">
        Chỉ SuperAdmin thay đổi được. Khi bật, tài khoản thuộc diện có thời hạn chuyển tiếp để tự bật ở trang "Tài khoản của tôi";
        lúc bật yếu tố đầu tiên, hệ thống phát kèm mã dự phòng.
      </p>
    </div>

    <SkeletonForm v-if="loading" label="Đang tải chính sách xác thực hai bước" :fields="3" />

    <div
      v-else-if="error"
      role="alert"
      class="rounded-lg border border-dashed border-[#e0a3a1] bg-white px-5 py-6 text-center text-sm text-[#b0403c]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="load">Thử lại</button>
    </div>

    <form v-else-if="overview" class="flex flex-col gap-4 rounded-xl border border-line bg-white p-5" @submit.prevent="save">
      <p v-if="overview.killSwitch" class="m-0 flex items-start gap-2 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3.5 py-2.5 text-sm text-[#7a5a12]">
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>Máy chủ đang tắt cưỡng chế (<code>MFA_ENFORCEMENT=0</code>): chính sách vẫn lưu được nhưng không chặn tài khoản nào.</span>
      </p>
      <p v-if="overview.policy !== 'off' && overview.enforceAfter" class="m-0 text-sm text-[#3d4f3f]">
        <i class="fa-regular fa-calendar mr-1.5 text-brand-700" aria-hidden="true"></i>
        Cưỡng chế từ <strong>{{ formatDay(overview.enforceAfter) }}</strong>.
      </p>

      <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
        <legend class="mb-2 text-sm font-bold text-brand-950">Phạm vi bắt buộc</legend>
        <label
          v-for="option in OPTIONS"
          :key="option.value"
          class="flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3"
          :class="selected === option.value ? 'border-brand-700 bg-surface-tint' : 'border-line'"
        >
          <input v-model="selected" type="radio" name="mfa-policy" :value="option.value" class="mt-1 accent-brand-700 focus:ring-2 focus:ring-brand-600" />
          <span class="flex flex-col gap-0.5">
            <span class="text-sm font-bold text-brand-950">{{ option.label }}</span>
            <span class="text-[0.82rem] text-ink-muted">{{ option.hint }}</span>
          </span>
        </label>
      </fieldset>

      <div v-if="selected !== 'off'" class="rounded-lg border border-line bg-surface px-3.5 py-3 text-sm">
        <p v-if="!affected.length" class="m-0 text-brand-700">
          <i class="fa-solid fa-circle-check mr-1.5" aria-hidden="true"></i>Mọi tài khoản thuộc diện đã bật xác thực hai bước.
        </p>
        <template v-else>
          <p class="m-0 mb-1.5 font-semibold text-[#7a5a12]">
            <i class="fa-solid fa-user-clock mr-1.5" aria-hidden="true"></i>{{ affected.length }} tài khoản thuộc diện chưa bật:
          </p>
          <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
            <li v-for="account in affected" :key="account.id" class="rounded bg-white px-2 py-0.5 text-[0.82rem] text-[#3d4f3f] ring-1 ring-line">
              {{ account.username }}<span v-if="account.roleName" class="text-ink-muted"> · {{ account.roleName }}</span>
            </li>
          </ul>
        </template>
      </div>

      <div>
        <button
          type="submit"
          :disabled="!changed || saving"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:opacity-60"
        >
          <i v-if="saving" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          Lưu
        </button>
      </div>
    </form>
  </div>
</template>
