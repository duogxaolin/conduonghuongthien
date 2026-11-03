<script setup lang="ts">
/**
 * Tài khoản của tôi — đổi mật khẩu, bật/tắt yếu tố thứ hai, xem lịch sử.
 *
 * Không gắn hasPermission ở bất kỳ chỗ nào: mọi thao tác trên trang này đều nhắm
 * vào chính tài khoản đang đăng nhập, và server lấy danh tính từ phiên chứ không
 * nhận id từ request. Ngoại lệ duy nhất là ô xem lịch sử tài khoản khác, chỉ hiện
 * với SuperAdmin.
 *
 * Tách theo đường khối (wave3 4.1): markup của từng khối là component chỉ trình bày
 * trong `components/admin/profile/`, luồng của biểu mẫu/hộp thoại là composable
 * (`useProfilePassword`, `useProfileMfaFactors`, `useProfileRecoveryCodes`). Trang
 * giữ trạng thái yếu tố thứ hai cùng nhánh tải/lỗi/thử lại của nó (`loadMfa`,
 * tests/admin-error-retry-ui.test.ts), khung chờ, cảnh báo mất quyền truy cập, khối
 * lịch sử và phím Escape. Hành vi: tests/admin-profile-page.test.ts.
 */
import ProfileDisableDialog from '~/components/admin/profile/ProfileDisableDialog.vue'
import ProfileEnrollDialog from '~/components/admin/profile/ProfileEnrollDialog.vue'
import ProfileMfaFactorList from '~/components/admin/profile/ProfileMfaFactorList.vue'
import ProfilePasswordSection from '~/components/admin/profile/ProfilePasswordSection.vue'
import ProfileRecoveryCodesCard from '~/components/admin/profile/ProfileRecoveryCodesCard.vue'
import ProfileRecoveryDialog from '~/components/admin/profile/ProfileRecoveryDialog.vue'
import { useMfaDisableDialog, useMfaEnrollDialog } from '~/composables/useProfileMfaFactors'
import { useProfilePassword } from '~/composables/useProfilePassword'
import { useProfileRecoveryCodes } from '~/composables/useProfileRecoveryCodes'
import type { MfaStatus } from '~/types/admin-profile'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const { user, fetchUser } = useAdminAuth()
const toast = useToast()

// ── Đổi mật khẩu ─────────────────────────────────────────────────────────────
const { pw, pwSaving, pwError, changePassword } = useProfilePassword(toast)

// ── Trạng thái yếu tố thứ hai ────────────────────────────────────────────────
const mfa = ref<MfaStatus | null>(null)
const mfaLoading = ref(true)
const mfaError = ref('')
// Hai lượt đọc có thể cùng bay (một hộp thoại bị "Huỷ" giữa chừng, rồi một thao tác
// khác): chỉ lượt gửi SAU CÙNG được ghi trạng thái và tắt khung chờ — lượt cũ về sau
// từng vẽ lại trạng thái trước khi đổi.
let mfaLoadSeq = 0

async function loadMfa() {
  const seq = ++mfaLoadSeq
  mfaLoading.value = true
  mfaError.value = ''
  try {
    const status = await adminFetch<MfaStatus>('/api/admin/profile/mfa')
    if (seq === mfaLoadSeq) mfa.value = status
  } catch (err: unknown) {
    if (seq === mfaLoadSeq) mfaError.value = errorMessage(err, 'Không tải được trạng thái xác thực hai bước.')
  } finally {
    if (seq === mfaLoadSeq) mfaLoading.value = false
  }
}

const activeFactors = computed(() => mfa.value?.factors.filter(f => f.state === 'active') ?? [])

/** Mỗi hộp thoại mở ra thì đưa tiêu điểm vào ô nhập đầu tiên: người dùng bàn
 *  phím không phải tab xuyên qua cả trang phía sau lớp phủ mới tới được nó. */
function focusFirstField(id: string) {
  nextTick(() => (document.getElementById(id) as HTMLInputElement | null)?.focus())
}

// ── Lịch sử truy cập & hoạt động ─────────────────────────────────────────────
// Khối này sống trong `ProfileActivityHistory.vue`. Trang cha chỉ giữ `ref` để
// làm mới danh sách sau khi bật/tắt một yếu tố — hai thao tác đó tự ghi thêm
// một dòng vào chính bảng đang hiển thị, và không làm mới thì người dùng nhìn
// vào một danh sách thiếu đúng dòng họ vừa tạo ra.
const historyRef = ref<{ reload: () => void } | null>(null)
function loadHistory() { historyRef.value?.reload() }

// ── Mã dự phòng; bật / tắt một yếu tố ────────────────────────────────────────
const {
  recoveryDialog, revealedCodes, codesTicket, revealCodes, hideCodes,
  openRecovery, closeRecovery, submitRecovery, copyCodes, downloadCodes,
} = useProfileRecoveryCodes({
  toast, focusField: focusFirstField, username: () => user.value?.username, afterChange: () => loadMfa(),
})
const { enrollDialog, openEnroll, closeEnroll, submitEnroll, submitConfirm, resendEnrollCode } = useMfaEnrollDialog({
  toast,
  focusField: focusFirstField,
  codes: { ticket: codesTicket, reveal: revealCodes },
  afterEnabled: () => Promise.all([loadMfa(), loadHistory(), fetchUser()]),
})
const { disableDialog, openDisable, closeDisable, submitDisable } = useMfaDisableDialog({
  toast, focusField: focusFirstField, afterDisabled: () => Promise.all([loadMfa(), loadHistory()]),
})

/** Escape đóng hộp thoại đang mở — cùng cách làm với ConfirmModal. Bắt ở window
 *  vì tiêu điểm có thể đang nằm trên nút đóng hay một ô nhập bất kỳ bên trong
 *  hộp thoại. Hộp thoại đang bận gọi API thì không đóng, để không bỏ dở một
 *  thao tác đã gửi đi. Không bắt Enter: mỗi ô nhập đã tự nối @keydown.enter tới
 *  đúng bước của nó, còn ở đây thì không biết đang ở bước nào. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (enrollDialog.open && !enrollDialog.busy) return closeEnroll()
  if (disableDialog.open && !disableDialog.busy) return closeDisable()
  if (recoveryDialog.open && !recoveryDialog.busy) return closeRecovery()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await loadMfa()
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Tài khoản của tôi</h1>
      <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">
        Đổi mật khẩu, bật xác thực hai bước và xem lịch sử truy cập của chính bạn.
      </p>
    </div>

    <!-- Thông tin tài khoản -->
    <div class="rounded-xl border border-line bg-white p-5 flex items-center gap-4 flex-wrap">
      <div class="w-12 h-12 rounded-full bg-brand-700 text-white flex items-center justify-center font-extrabold text-lg shrink-0">
        {{ (user?.username || '?').charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0">
        <div class="text-[1rem] font-extrabold text-brand-950">{{ user?.username }}</div>
        <div class="text-[0.82rem] text-ink-muted">
          {{ user?.isSuperAdmin ? 'SuperAdmin (Toàn quyền)' : (user?.roleName || 'Chưa gán vai trò') }}
          <template v-if="mfa?.email"> · {{ mfa.email }}</template>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2 text-[0.78rem] font-bold px-3 py-1.5 rounded-full border"
           :class="activeFactors.length > 0
             ? 'bg-[#eef7ee] border-[#cce5cd] text-brand-900'
             : 'bg-[#fdf6e7] border-[#f0dcae] text-warn-ink'">
        <i class="fa-solid" :class="activeFactors.length > 0 ? 'fa-shield-halved' : 'fa-shield'" aria-hidden="true"></i>
        <span>{{ activeFactors.length > 0 ? `Đã bật ${activeFactors.length} yếu tố thứ hai` : 'Chưa bật xác thực hai bước' }}</span>
      </div>
    </div>

    <!-- ── Đổi mật khẩu ──────────────────────────────────────────────── -->
    <ProfilePasswordSection
      v-model:current-password="pw.current"
      v-model:new-password="pw.next"
      v-model:confirm-password="pw.confirm"
      :saving="pwSaving"
      :error="pwError"
      @submit="changePassword"
    />

    <!-- ── Xác thực hai bước ─────────────────────────────────────────── -->
    <!-- `#security`: đích chuyển trang của chính sách bắt buộc MFA (middleware + banner). -->
    <section id="security" class="rounded-xl border border-line bg-white p-5 scroll-mt-4">
      <div class="flex items-center gap-3 mb-4">
        <span class="w-1 h-5 rounded-full bg-brand-700" aria-hidden="true"></span>
        <h2 class="text-[1rem] font-extrabold text-brand-950 m-0">Xác thực hai bước</h2>
      </div>
      <p class="text-[0.82rem] text-ink-muted mt-0 mb-4">
        Tự nguyện — bật cái nào cũng được, bật nhiều cái thì lúc đăng nhập chỉ cần vượt qua một trong số đó.
        Bật hoặc tắt sẽ thu hồi các phiên đăng nhập khác.
      </p>

      <!-- Loading — three factor cards, the shape the list below always renders -->
      <div v-if="mfaLoading" class="flex flex-col gap-3" role="status" aria-busy="true">
        <span class="sr-only">Đang tải trạng thái xác thực hai bước</span>
        <div
          v-for="n in 3"
          :key="'mf-' + n"
          class="rounded-xl border border-line bg-white p-4 flex items-start gap-4 flex-wrap"
          aria-hidden="true"
        >
          <div class="w-10 h-10 rounded-xl bg-line animate-pulse motion-reduce:animate-none shrink-0"></div>
          <div class="flex-1 min-w-[220px] flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <div class="h-4 w-44 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
              <div class="h-4 w-24 rounded-full bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
            </div>
            <div class="h-3 w-full max-w-[420px] rounded bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
          </div>
          <div class="h-9 w-28 rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="mfaError" class="flex items-start gap-2 bg-danger-bg border border-[#ffc1ba] text-danger px-3.5 py-3 rounded-lg text-[0.84rem]" role="alert">
        <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
        <div>
          <div>{{ mfaError }}</div>
          <button type="button" class="mt-2 text-[0.82rem] font-bold underline bg-transparent border-0 cursor-pointer text-danger rounded focus:outline-none focus:ring-2 focus:ring-danger/40" @click="loadMfa">Thử lại</button>
        </div>
      </div>

      <template v-else-if="mfa">
        <!-- Cảnh báo nguy cơ mất quyền truy cập: theo `lockoutRisk` của máy chủ -->
        <div v-if="mfa.lockoutRisk" class="flex items-start gap-2.5 bg-[#fdf6e7] border border-[#f0dcae] text-warn-ink px-3.5 py-3 rounded-lg text-[0.84rem] mb-4" role="alert">
          <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
          <span>
            Bạn đã bật xác thực hai bước nhưng <strong>không có cách dự phòng nào</strong>. Mất thiết bị là mất quyền vào hệ thống —
            chỉ quản trị viên cấp cao mới mở lại được. Nên tạo mã dự phòng hoặc bật thêm mã OTP qua email.
          </span>
        </div>

        <ProfileMfaFactorList
          :factors="mfa.factors"
          :email="mfa.email"
          :smtp-ready="mfa.smtpReady"
          @enroll="openEnroll"
          @disable="openDisable"
        />

        <ProfileRecoveryCodesCard
          :enabled="mfa.recoveryCodesEnabled"
          :remaining="mfa.recoveryCodesRemaining"
          :active-factor-count="activeFactors.length"
          :codes="revealedCodes"
          @open="openRecovery"
          @copy="copyCodes"
          @download="downloadCodes"
          @hide="hideCodes"
        />
      </template>
    </section>

    <!-- ── Lịch sử truy cập & hoạt động ──────────────────────────────── -->
    <!-- Bật/tắt một yếu tố ghi thêm một dòng vào bảng này, nên trang cha giữ
         `ref` để gọi `reload()` sau hai thao tác đó. -->
    <!-- Ẩn khi chính sách MFA đang khoá tài khoản: endpoint lịch sử không nằm trong
         danh sách được mở lúc đó, nên khối này chỉ hiện được một lỗi 403.
         Tên CÓ tiền tố thư mục (`Admin…`, quy ước auto-import của nuxt.config): tên
         trần `<ProfileActivityHistory>` không phân giải được — khối lịch sử không
         bao giờ hiện, và `historyRef.reload()` ném lỗi làm hỏng `Promise.all` của
         lượt bật/tắt yếu tố (lượt đọc lại `me` sau khi bật MFA không chạy). -->
    <AdminProfileActivityHistory v-if="!user?.mfaEnrollmentRequired" ref="historyRef" />

    <!-- ── Hộp thoại: bật một yếu tố / tắt một yếu tố / mã dự phòng ──── -->
    <ProfileEnrollDialog
      v-if="enrollDialog.open"
      v-model:current-password="enrollDialog.currentPassword"
      v-model:second-password="enrollDialog.secondPassword"
      v-model:second-password-confirm="enrollDialog.secondPasswordConfirm"
      v-model:code="enrollDialog.code"
      :factor-type="enrollDialog.factorType"
      :stage="enrollDialog.stage"
      :totp-secret="enrollDialog.totpSecret"
      :otpauth-uri="enrollDialog.otpauthUri"
      :sent-to="enrollDialog.sentTo"
      :email="mfa?.email"
      :busy="enrollDialog.busy"
      :error="enrollDialog.error"
      @close="closeEnroll"
      @enroll="submitEnroll"
      @confirm="submitConfirm"
      @resend="resendEnrollCode"
    />
    <ProfileDisableDialog
      v-if="disableDialog.open"
      v-model:current-password="disableDialog.currentPassword"
      :factor-type="disableDialog.factorType"
      :busy="disableDialog.busy"
      :error="disableDialog.error"
      @close="closeDisable"
      @submit="submitDisable"
    />
    <ProfileRecoveryDialog
      v-if="recoveryDialog.open"
      v-model:current-password="recoveryDialog.currentPassword"
      :mode="recoveryDialog.mode"
      :replaces-codes="mfa?.recoveryCodesEnabled === true"
      :busy="recoveryDialog.busy"
      :error="recoveryDialog.error"
      @close="closeRecovery"
      @submit="submitRecovery"
    />
  </div>
</template>
