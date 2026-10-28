<script setup lang="ts">
import type { RetentionResponse, RetentionRunResponse, RetentionSaveResponse, RetentionScopeStatus } from '~/types/admin-settings-api'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Automatic cleanup for the tables holding personal data.
 *
 * Deliberate framing: the numbers come first, the switches second. An operator
 * setting a row cap needs to know the table currently holds 812k rows, and an
 * operator who thinks cleanup is working needs to see the overdue count that
 * says it is not.
 *
 * "Đã dọn" is a banked counter, not a derived one — once rows are deleted, a
 * purge that worked looks exactly like one that never ran. Lifetime volume is
 * that counter plus the live count.
 */

/** One scope's policy and bookkeeping, as `GET /api/admin/settings/retention` sends it. */
type Scope = RetentionScopeStatus

const SCOPE_LABELS: Record<string, string> = {
  activity_logs: 'Lịch sử hoạt động',
  submissions: 'Đơn đăng ký hỗ trợ',
  chat_sessions: 'Phiên trò chuyện chatbot',
  reader_accounts: 'Tài khoản người đọc',
  livestream_sessions: 'Phiên phát trực tiếp',
}
const SCOPE_NOTES: Record<string, string> = {
  activity_logs: 'Mỗi lần đăng nhập và mọi thao tác thêm/sửa/xoá đều sinh một dòng, kèm IP và trình duyệt.',
  submissions: 'Chứa họ tên, số điện thoại, email và nội dung công dân tự nhập. Thời hạn lưu do quy định của cơ quan quyết định.',
  chat_sessions: 'Chứa nội dung hội thoại giữa khách và trợ lý AI, kèm IP và có khi cả số điện thoại. Tin nhắn tự xoá theo phiên (ON DELETE CASCADE) — chỉ cần đặt điều kiện dọn cho bảng phiên.',
  reader_accounts: 'Tài khoản đăng nhập Google để bình luận: email, tên hiển thị, IP và trình duyệt lần gần nhất. Tính tuổi theo lần truy cập gần nhất, không theo ngày tạo. Bình luận tự xoá theo tài khoản (ON DELETE CASCADE), kể cả phản hồi của Ban quản trị nằm dưới.',
  livestream_sessions: 'Một buổi phát trực tiếp cùng phần trò chuyện khách đã gõ. Tính tuổi theo thời điểm KẾT THÚC, không theo lúc bắt đầu — buổi phát mở từ lâu mà vừa kết thúc sáng nay vẫn là một ngày tuổi. Buổi đang phát trực tiếp không bao giờ bị xoá. Tin nhắn tự xoá theo phiên (ON DELETE CASCADE).',
}
const SOURCE_LABELS: Record<string, string> = {
  database: 'đang đặt tại đây',
  environment: 'đang lấy từ biến môi trường',
  default: 'đang dùng giá trị mặc định',
}
const TRIGGER_LABELS: Record<string, string> = {
  scheduler: 'tự động',
  cron: 'cron',
  manual: 'chạy tay',
}

const toast = useToast()
const { confirm } = useConfirm()
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const running = ref(false)
/** The last manual run deleted rows but its result row is not in the activity log (`auditFailed`) — shown outside the loading/error chain, which the reload after the run replaces. */
const runAuditFailed = ref(false)
const scopes = ref<Scope[]>([])
const command = ref('npm run analytics:maintenance')

/**
 * The two numeric inputs each scope owns. Spelled out as a union rather than
 * `keyof typeof form` so the map below can be typed: indexing `form` by a union
 * of keys yields `never` for assignment, which is how a "just iterate it"
 * refactor turns into a compile error instead of a working loop.
 */
type ScopeValueField =
  | 'activityLogDays' | 'activityLogMaxRows'
  | 'submissionDays' | 'submissionMaxRows'
  | 'chatSessionDays' | 'chatSessionMaxRows'
  | 'readerAccountDays' | 'readerAccountMaxRows'
  | 'livestreamSessionDays' | 'livestreamSessionMaxRows'

type RetentionForm = {
  autoEnabled: boolean
  runHour: number
} & Record<ScopeValueField, number>

const form = reactive<RetentionForm>({
  autoEnabled: true,
  runHour: 3,
  activityLogDays: 365,
  activityLogMaxRows: 0,
  submissionDays: 0,
  submissionMaxRows: 0,
  chatSessionDays: 90,
  chatSessionMaxRows: 0,
  readerAccountDays: 365,
  readerAccountMaxRows: 0,
  livestreamSessionDays: 90,
  livestreamSessionMaxRows: 0,
})

/**
 * Which form field holds each scope's two numbers.
 *
 * `load()` and `save()` both iterate this instead of the hand-written
 * `else if (scope.scope === …)` chain that was here before. That chain failed
 * silently in exactly the way this page exists to make visible: a scope the
 * chain did not name still got a card and still got inputs, but the inputs
 * bound to `undefined` and the save body omitted the fields — so the server kept
 * the old window while the form showed something else, with no error anywhere.
 *
 * Keyed by `Scope['scope']`, so a sixth scope is a compile error here rather
 * than a row of inputs that posts nothing.
 */
const SCOPE_FORM_FIELDS: Record<Scope['scope'], { days: ScopeValueField; maxRows: ScopeValueField }> = {
  activity_logs: { days: 'activityLogDays', maxRows: 'activityLogMaxRows' },
  submissions: { days: 'submissionDays', maxRows: 'submissionMaxRows' },
  chat_sessions: { days: 'chatSessionDays', maxRows: 'chatSessionMaxRows' },
  reader_accounts: { days: 'readerAccountDays', maxRows: 'readerAccountMaxRows' },
  livestream_sessions: { days: 'livestreamSessionDays', maxRows: 'livestreamSessionMaxRows' },
}
const autoEnabledSource = ref('default')
const runHourSource = ref('default')

/** Each scope's status by name, for the "Hiện …" source notes under the inputs. */
const scopeNamed = computed(() => Object.fromEntries(scopes.value.map(s => [s.scope, s])) as Partial<Record<Scope['scope'], Scope>>)

/** Nothing configured to delete anything — the switch being on changes nothing. */
const nothingWillBeDeleted = computed(() =>
  scopes.value.length > 0 && scopes.value.every(s => s.days === 0 && s.maxRows === 0))
const anyOverdue = computed(() => scopes.value.some(s => s.overdue > 0 || s.overRowCap > 0))

const formatNumber = (value: number) => new Intl.NumberFormat('vi-VN').format(value || 0)
function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await adminFetch<RetentionResponse>(`/api/admin/settings/retention`)
    if (!res?.ok) {
      error.value = 'Không tải được cấu hình dọn dữ liệu.'
      return
    }
    scopes.value = res.scopes || []
    command.value = res.command || command.value
    form.autoEnabled = res.autoEnabled === true
    form.runHour = Number(res.runHour ?? 3)
    autoEnabledSource.value = res.autoEnabledSource || 'default'
    runHourSource.value = res.runHourSource || 'default'
    for (const scope of scopes.value) {
      const fields = SCOPE_FORM_FIELDS[scope.scope]
      if (!fields) continue
      form[fields.days] = scope.days
      form[fields.maxRows] = scope.maxRows
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được cấu hình dọn dữ liệu.')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const body: Record<string, number | boolean> = {
      autoEnabled: form.autoEnabled,
      runHour: Number(form.runHour),
    }
    for (const scope of scopes.value) {
      const fields = SCOPE_FORM_FIELDS[scope.scope]
      if (!fields) continue
      body[fields.days] = Number(form[fields.days])
      body[fields.maxRows] = Number(form[fields.maxRows])
    }
    await adminFetch<RetentionSaveResponse>(`/api/admin/settings/retention`, { method: 'PUT', body })
    toast.success('Đã lưu cấu hình dọn dữ liệu.')
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không lưu được cấu hình.'))
  } finally {
    saving.value = false
  }
}

/**
 * Confirmed in the browser before the request goes out. The endpoint also
 * requires `confirm: true`, so this dialog is convenience, not the guard.
 */
async function runNow() {
  const lines = scopes.value
    .filter(s => s.overdue > 0 || s.overRowCap > 0)
    .map(s => `• ${SCOPE_LABELS[s.scope]}: khoảng ${formatNumber(s.overdue + s.overRowCap)} bản ghi`)
  const detail = lines.length ? `\n\nDự kiến xoá:\n${lines.join('\n')}` : '\n\nHiện không có bản ghi nào quá hạn.'
  if (!await confirm({
    message: `Chạy dọn dữ liệu ngay theo cấu hình đang lưu? Bản ghi bị xoá không lấy lại được.${detail}`,
    confirmLabel: 'Chạy dọn dữ liệu',
    danger: true,
  })) return

  running.value = true
  runAuditFailed.value = false
  try {
    const res = await adminFetch<RetentionRunResponse>(`/api/admin/settings/retention-run`, { method: 'POST', body: { confirm: true } })
    runAuditFailed.value = res?.auditFailed === true
    const deleted = (res?.tables || []).reduce((sum, t) => sum + Number(t.deleted || 0), 0)
    if (res?.status === 'warning') toast.info(`Đã xoá ${formatNumber(deleted)} bản ghi. Còn bản ghi chờ lượt sau.`)
    else toast.success(deleted > 0 ? `Đã xoá ${formatNumber(deleted)} bản ghi.` : 'Không có bản ghi nào cần xoá.')
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Chạy dọn dữ liệu thất bại.'))
  } finally {
    running.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">Tự Động Dọn Dữ Liệu</h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">
          Giới hạn thời gian lưu và số bản ghi của lịch sử hoạt động, đơn đăng ký, phiên trò chuyện chatbot, tài khoản người đọc và phiên phát trực tiếp — năm bảng chứa dữ liệu cá nhân
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2.5 border border-line-strong bg-surface text-brand-900 rounded-lg font-bold cursor-pointer hover:bg-line hover:border-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="running || loading"
          @click="runNow"
        >
          <i class="fa-solid" :class="running ? 'fa-spinner animate-spin' : 'fa-broom'"></i>
          {{ running ? 'Đang dọn...' : 'Dọn ngay' }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="saving || loading"
          @click="save"
        >
          <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <p v-if="runAuditFailed" role="alert" class="m-0 rounded-xl border border-warn-ink/30 bg-warn-ink/5 px-5 py-4 text-[0.85rem] text-warn-ink"><i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i><strong>Đã dọn xong nhưng chưa ghi được nhật ký kết quả.</strong> Lịch sử hoạt động chỉ có dòng ghi ai đã bắt đầu lượt dọn; số bản ghi đã xoá vẫn hiện ở "Lượt dọn gần nhất" của từng bảng bên dưới.</p>
    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-line p-6">
      <span class="sr-only">Đang tải cấu hình dọn dữ liệu</span>
      <div class="flex flex-col gap-4">
        <div v-for="n in 5" :key="n" class="animate-pulse motion-reduce:animate-none">
          <div class="h-4 bg-surface-tint rounded w-1/4 mb-2" aria-hidden="true"></div>
          <div class="h-10 bg-surface-tint rounded" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-danger-soft text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-brand-600 font-bold underline" @click="load()">thử lại</button>.
    </div>

    <template v-else>
      <!-- Trạng thái nổi bật -->
      <div
        v-if="!form.autoEnabled"
        class="rounded-xl border border-[#f0c98a] bg-[#fdf6e9] px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-circle-pause text-[#b07d1f] mt-0.5"></i>
        <div class="text-[0.85rem] text-[#6b5418]">
          <p class="font-bold m-0 mb-1">Tự động dọn đang tắt</p>
          <p class="m-0">
            Không có bản ghi nào bị xoá tự động. Các bảng sẽ tiếp tục lớn lên đến khi anh/chị bật lại hoặc bấm
            <strong>Dọn ngay</strong>.
          </p>
        </div>
      </div>
      <div
        v-else-if="nothingWillBeDeleted"
        class="rounded-xl border border-[#f0c98a] bg-[#fdf6e9] px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-triangle-exclamation text-[#b07d1f] mt-0.5"></i>
        <div class="text-[0.85rem] text-[#6b5418]">
          <p class="font-bold m-0 mb-1">Đã bật nhưng chưa đặt điều kiện nào</p>
          <p class="m-0">Cả số ngày lưu và số bản ghi tối đa đều bằng 0, nên lượt chạy nào cũng không xoá gì.</p>
        </div>
      </div>
      <div
        v-else-if="anyOverdue"
        class="rounded-xl border border-[#e8b4b4] bg-danger-bg px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-triangle-exclamation text-[#a83232] mt-0.5"></i>
        <div class="text-[0.85rem] text-[#7a2323]">
          <p class="font-bold m-0 mb-1">Có bản ghi vượt điều kiện chưa được xoá</p>
          <p class="m-0">
            Lượt dọn tự động tiếp theo sẽ xử lý. Nếu con số này không giảm sau {{ form.runHour }} giờ ngày hôm sau,
            bấm <strong>Dọn ngay</strong> để chạy thủ công và xem kết quả.
          </p>
        </div>
      </div>
      <div
        v-else
        class="rounded-xl border border-line-strong bg-surface-tint px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-circle-check text-brand-700 mt-0.5"></i>
        <div class="text-[0.85rem] text-brand-900">
          <p class="font-bold m-0 mb-1">Đang trong ngưỡng cho phép</p>
          <p class="m-0">Không có bản ghi nào vượt số ngày lưu hay số bản ghi tối đa đã đặt.</p>
        </div>
      </div>

      <!-- Số liệu từng bảng -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div
          v-for="scope in scopes"
          :key="scope.scope"
          class="bg-white rounded-xl border border-line p-6"
        >
          <h3 class="text-[1.05rem] font-bold text-brand-950 m-0 mb-1">{{ SCOPE_LABELS[scope.scope] }}</h3>
          <p class="text-[0.78rem] text-ink-muted mt-0 mb-4">{{ SCOPE_NOTES[scope.scope] }}</p>

          <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="rounded-lg bg-surface px-3 py-3">
              <p class="text-[0.7rem] text-ink-muted m-0 mb-1 uppercase tracking-wide">Đang lưu</p>
              <p class="text-[1.15rem] font-extrabold text-brand-950 m-0">{{ formatNumber(scope.total) }}</p>
            </div>
            <div class="rounded-lg bg-surface px-3 py-3">
              <p class="text-[0.7rem] text-ink-muted m-0 mb-1 uppercase tracking-wide">Đã dọn</p>
              <p class="text-[1.15rem] font-extrabold text-brand-950 m-0">{{ formatNumber(scope.purgedTotal) }}</p>
            </div>
            <div class="rounded-lg bg-line px-3 py-3">
              <p class="text-[0.7rem] text-brand-900 m-0 mb-1 uppercase tracking-wide">Tổng đã qua</p>
              <p class="text-[1.15rem] font-extrabold text-brand-900 m-0">{{ formatNumber(scope.lifetimeTotal) }}</p>
            </div>
          </div>

          <dl class="text-[0.82rem] m-0 flex flex-col gap-2">
            <div class="flex justify-between gap-3">
              <dt class="text-ink-muted">Bản ghi cũ nhất</dt>
              <dd class="m-0 font-semibold text-brand-950">{{ formatMoment(scope.oldest) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-muted">Quá số ngày lưu</dt>
              <dd class="m-0 font-semibold" :class="scope.overdue > 0 ? 'text-[#a83232]' : 'text-[#122815]'">
                {{ scope.days === 0 ? 'không giới hạn' : formatNumber(scope.overdue) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-muted">Vượt số bản ghi tối đa</dt>
              <dd class="m-0 font-semibold" :class="scope.overRowCap > 0 ? 'text-[#a83232]' : 'text-[#122815]'">
                {{ scope.maxRows === 0 ? 'không giới hạn' : formatNumber(scope.overRowCap) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-ink-muted">Lượt dọn gần nhất</dt>
              <dd class="m-0 font-semibold text-brand-950 text-right">
                {{ formatMoment(scope.lastRunAt) }}
                <span v-if="scope.lastRunAt" class="font-normal text-ink-muted">
                  ({{ TRIGGER_LABELS[scope.lastTrigger || ''] || 'không rõ' }}, xoá {{ formatNumber(scope.lastDeleted) }})
                </span>
              </dd>
            </div>
          </dl>
          <p v-if="scope.lastMessage" class="text-[0.75rem] text-[#b07d1f] mt-3 mb-0">{{ scope.lastMessage }}</p>
        </div>
      </div>

      <!-- Cấu hình -->
      <div class="bg-white rounded-xl border border-line p-6">
        <h3 class="text-[1.05rem] font-bold text-brand-950 m-0 mb-1">Điều kiện dọn</h3>
        <p class="text-[0.8rem] text-ink-muted mt-0 mb-5">
          Hai điều kiện chạy độc lập. <strong>Số ngày lưu</strong> xoá bản ghi quá cũ;
          <strong>số bản ghi tối đa</strong> giữ bảng không vượt kích cỡ máy chủ chịu được, xoá từ cũ nhất trở đi.
          Đặt <strong>0</strong> để tắt riêng từng điều kiện.
        </p>

        <label class="flex items-start gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 cursor-pointer mb-5">
          <input type="checkbox" v-model="form.autoEnabled" class="mt-0.5 w-4 h-4 accent-brand-700 cursor-pointer" />
          <span>
            <span class="block text-[0.88rem] font-bold text-brand-950">Tự động dọn theo lịch hằng ngày</span>
            <span class="block text-[0.78rem] text-ink-muted mt-0.5">
              Máy chủ tự chạy, không cần đặt cron. Tắt đi thì chỉ còn cách bấm “Dọn ngay” hoặc chạy
              <code class="bg-line px-1 rounded">{{ command }}</code>.
              <span class="text-ink-faint">({{ SOURCE_LABELS[autoEnabledSource] }})</span>
            </span>
          </span>
        </label>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-ink-admin">Giờ chạy hằng ngày</label>
            <select v-model.number="form.runHour" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border bg-white">
              <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">
                {{ String(hour - 1).padStart(2, '0') }}:00
              </option>
            </select>
            <p class="text-[0.72rem] text-ink-faint m-0">
              Theo giờ máy chủ. Nếu máy tắt qua giờ này, lượt dọn sẽ chạy bù ở lần kiểm tra kế tiếp.
              <span class="text-ink-faint">({{ SOURCE_LABELS[runHourSource] }})</span>
            </p>
          </div>
          <div></div>

          <div class="rounded-lg border border-line p-4">
            <p class="text-[0.88rem] font-bold text-brand-950 m-0 mb-3">Lịch sử hoạt động</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.activityLogDays" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">
                  0 hoặc từ 30 đến 3650. <span v-if="scopeNamed.activity_logs">Hiện {{ SOURCE_LABELS[scopeNamed.activity_logs.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.activityLogMaxRows" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">0 (không giới hạn) hoặc từ 1.000 trở lên.</p>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-line p-4">
            <p class="text-[0.88rem] font-bold text-brand-950 m-0 mb-3">Đơn đăng ký hỗ trợ</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.submissionDays" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">
                  Mặc định 0 (giữ vô thời hạn) vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định.
                  <span v-if="scopeNamed.submissions">Hiện {{ SOURCE_LABELS[scopeNamed.submissions.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.submissionMaxRows" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">Nên để 0: đơn của công dân không nên bị xoá vì bảng đầy.</p>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-line p-4">
            <p class="text-[0.88rem] font-bold text-brand-950 m-0 mb-3">Phiên trò chuyện chatbot</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.chatSessionDays" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">
                  0 hoặc từ 30 đến 3650. Tin nhắn trong phiên tự xoá theo (ON DELETE CASCADE) — chỉ cần đặt điều kiện dọn cho bảng phiên.
                  <span v-if="scopeNamed.chat_sessions">Hiện {{ SOURCE_LABELS[scopeNamed.chat_sessions.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.chatSessionMaxRows" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">0 (không giới hạn) hoặc từ 1.000 trở lên.</p>
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-line p-4">
            <p class="text-[0.88rem] font-bold text-brand-950 m-0 mb-3">Tài khoản người đọc</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.readerAccountDays" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">
                  0 hoặc từ 30 đến 3650. Tính theo lần truy cập gần nhất, không theo ngày tạo — một tài khoản mở từ lâu nhưng vừa bình luận hôm qua vẫn là người đọc đang hoạt động.
                  <span v-if="scopeNamed.reader_accounts">Hiện {{ SOURCE_LABELS[scopeNamed.reader_accounts.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.readerAccountMaxRows" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">Nên để 0: xoá một tài khoản là xoá luôn toàn bộ bình luận công khai của người đó.</p>
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-line p-4">
            <p class="text-[0.88rem] font-bold text-brand-950 m-0 mb-3">Phiên phát trực tiếp</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.livestreamSessionDays" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">
                  0 hoặc từ 30 đến 3650. Tính theo thời điểm kết thúc buổi phát, không theo lúc bắt đầu. Buổi đang phát không bao giờ bị xoá.
                  <span v-if="scopeNamed.livestream_sessions">Hiện {{ SOURCE_LABELS[scopeNamed.livestream_sessions.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-ink-admin">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.livestreamSessionMaxRows" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border" />
                <p class="text-[0.72rem] text-ink-faint m-0">Nên để 0: xoá một phiên là xoá luôn phần trò chuyện của khách trong buổi phát đó.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
