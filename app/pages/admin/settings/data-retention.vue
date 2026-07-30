<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Automatic cleanup for the two tables holding personal data.
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

type Scope = {
  scope: 'activity_logs' | 'submissions'
  days: number
  daysSource: string
  maxRows: number
  maxRowsSource: string
  total: number
  oldest: string | null
  overdue: number
  overRowCap: number
  purgedTotal: number
  lifetimeTotal: number
  lastRunAt: string | null
  lastDeleted: number
  lastTrigger: string | null
  lastStatus: string | null
  lastMessage: string | null
}

const SCOPE_LABELS: Record<string, string> = {
  activity_logs: 'Lịch sử hoạt động',
  submissions: 'Đơn đăng ký hỗ trợ',
}
const SCOPE_NOTES: Record<string, string> = {
  activity_logs: 'Mỗi lần đăng nhập và mọi thao tác thêm/sửa/xoá đều sinh một dòng, kèm IP và trình duyệt.',
  submissions: 'Chứa họ tên, số điện thoại, email và nội dung công dân tự nhập. Thời hạn lưu do quy định của cơ quan quyết định.',
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
const loading = ref(true)
const saving = ref(false)
const running = ref(false)
const scopes = ref<Scope[]>([])
const command = ref('npm run analytics:maintenance')

const form = reactive({
  autoEnabled: true,
  runHour: 3,
  activityLogDays: 365,
  activityLogMaxRows: 0,
  submissionDays: 0,
  submissionMaxRows: 0,
})
const autoEnabledSource = ref('default')
const runHourSource = ref('default')

const activity = computed(() => scopes.value.find(s => s.scope === 'activity_logs') ?? null)
const submission = computed(() => scopes.value.find(s => s.scope === 'submissions') ?? null)

/** Nothing configured to delete anything — the switch being on changes nothing. */
const nothingWillBeDeleted = computed(() =>
  scopes.value.length > 0 && scopes.value.every(s => s.days === 0 && s.maxRows === 0))
const anyOverdue = computed(() => scopes.value.some(s => s.overdue > 0 || s.overRowCap > 0))

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value || 0)
}
function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<any>('/api/admin/settings/retention')
    if (!res?.ok) return
    scopes.value = res.scopes || []
    command.value = res.command || command.value
    form.autoEnabled = res.autoEnabled === true
    form.runHour = Number(res.runHour ?? 3)
    autoEnabledSource.value = res.autoEnabledSource || 'default'
    runHourSource.value = res.runHourSource || 'default'
    for (const scope of scopes.value) {
      if (scope.scope === 'activity_logs') {
        form.activityLogDays = scope.days
        form.activityLogMaxRows = scope.maxRows
      } else {
        form.submissionDays = scope.days
        form.submissionMaxRows = scope.maxRows
      }
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không tải được cấu hình dọn dữ liệu.')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await $fetch('/api/admin/settings/retention', {
      method: 'PUT',
      body: {
        autoEnabled: form.autoEnabled,
        runHour: Number(form.runHour),
        activityLogDays: Number(form.activityLogDays),
        activityLogMaxRows: Number(form.activityLogMaxRows),
        submissionDays: Number(form.submissionDays),
        submissionMaxRows: Number(form.submissionMaxRows),
      },
    })
    toast.success('Đã lưu cấu hình dọn dữ liệu.')
    await load()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không lưu được cấu hình.')
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
  if (!confirm(`Chạy dọn dữ liệu ngay theo cấu hình đang lưu? Bản ghi bị xoá không lấy lại được.${detail}`)) return

  running.value = true
  try {
    const res = await $fetch<any>('/api/admin/settings/retention-run', { method: 'POST', body: { confirm: true } })
    const deleted = (res?.tables || []).reduce((sum: number, t: any) => sum + Number(t.deleted || 0), 0)
    if (res?.status === 'warning') toast.info(`Đã xoá ${formatNumber(deleted)} bản ghi. Còn bản ghi chờ lượt sau.`)
    else toast.success(deleted > 0 ? `Đã xoá ${formatNumber(deleted)} bản ghi.` : 'Không có bản ghi nào cần xoá.')
    await load()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Chạy dọn dữ liệu thất bại.')
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
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Tự Động Dọn Dữ Liệu</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">
          Giới hạn thời gian lưu và số bản ghi của lịch sử hoạt động và đơn đăng ký — hai bảng chứa dữ liệu cá nhân
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2.5 border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg font-bold cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="running || loading"
          @click="runNow"
        >
          <i class="fa-solid" :class="running ? 'fa-spinner animate-spin' : 'fa-broom'"></i>
          {{ running ? 'Đang dọn...' : 'Dọn ngay' }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="saving || loading"
          @click="save"
        >
          <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="py-10 text-center text-[#667768]">Đang tải cấu hình...</div>

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
            Không có bản ghi nào bị xoá tự động. Hai bảng sẽ tiếp tục lớn lên đến khi anh/chị bật lại hoặc bấm
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
        class="rounded-xl border border-[#e8b4b4] bg-[#fdf1f1] px-5 py-4 flex gap-3 items-start"
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
        class="rounded-xl border border-[#c8d6c9] bg-[#eef6ef] px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-circle-check text-[#2c6e33] mt-0.5"></i>
        <div class="text-[0.85rem] text-[#1e4620]">
          <p class="font-bold m-0 mb-1">Đang trong ngưỡng cho phép</p>
          <p class="m-0">Không có bản ghi nào vượt số ngày lưu hay số bản ghi tối đa đã đặt.</p>
        </div>
      </div>

      <!-- Số liệu từng bảng -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div
          v-for="scope in scopes"
          :key="scope.scope"
          class="bg-white rounded-xl border border-[#e2ece3] p-6"
        >
          <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">{{ SCOPE_LABELS[scope.scope] }}</h3>
          <p class="text-[0.78rem] text-[#667768] mt-0 mb-4">{{ SCOPE_NOTES[scope.scope] }}</p>

          <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="rounded-lg bg-[#f4f7f4] px-3 py-3">
              <p class="text-[0.7rem] text-[#667768] m-0 mb-1 uppercase tracking-wide">Đang lưu</p>
              <p class="text-[1.15rem] font-extrabold text-[#122815] m-0">{{ formatNumber(scope.total) }}</p>
            </div>
            <div class="rounded-lg bg-[#f4f7f4] px-3 py-3">
              <p class="text-[0.7rem] text-[#667768] m-0 mb-1 uppercase tracking-wide">Đã dọn</p>
              <p class="text-[1.15rem] font-extrabold text-[#122815] m-0">{{ formatNumber(scope.purgedTotal) }}</p>
            </div>
            <div class="rounded-lg bg-[#e2ece3] px-3 py-3">
              <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">Tổng đã qua</p>
              <p class="text-[1.15rem] font-extrabold text-[#1e4620] m-0">{{ formatNumber(scope.lifetimeTotal) }}</p>
            </div>
          </div>

          <dl class="text-[0.82rem] m-0 flex flex-col gap-2">
            <div class="flex justify-between gap-3">
              <dt class="text-[#667768]">Bản ghi cũ nhất</dt>
              <dd class="m-0 font-semibold text-[#122815]">{{ formatMoment(scope.oldest) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[#667768]">Quá số ngày lưu</dt>
              <dd class="m-0 font-semibold" :class="scope.overdue > 0 ? 'text-[#a83232]' : 'text-[#122815]'">
                {{ scope.days === 0 ? 'không giới hạn' : formatNumber(scope.overdue) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[#667768]">Vượt số bản ghi tối đa</dt>
              <dd class="m-0 font-semibold" :class="scope.overRowCap > 0 ? 'text-[#a83232]' : 'text-[#122815]'">
                {{ scope.maxRows === 0 ? 'không giới hạn' : formatNumber(scope.overRowCap) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[#667768]">Lượt dọn gần nhất</dt>
              <dd class="m-0 font-semibold text-[#122815] text-right">
                {{ formatMoment(scope.lastRunAt) }}
                <span v-if="scope.lastRunAt" class="font-normal text-[#667768]">
                  ({{ TRIGGER_LABELS[scope.lastTrigger || ''] || 'không rõ' }}, xoá {{ formatNumber(scope.lastDeleted) }})
                </span>
              </dd>
            </div>
          </dl>
          <p v-if="scope.lastMessage" class="text-[0.75rem] text-[#b07d1f] mt-3 mb-0">{{ scope.lastMessage }}</p>
        </div>
      </div>

      <!-- Cấu hình -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Điều kiện dọn</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-5">
          Hai điều kiện chạy độc lập. <strong>Số ngày lưu</strong> xoá bản ghi quá cũ;
          <strong>số bản ghi tối đa</strong> giữ bảng không vượt kích cỡ máy chủ chịu được, xoá từ cũ nhất trở đi.
          Đặt <strong>0</strong> để tắt riêng từng điều kiện.
        </p>

        <label class="flex items-start gap-3 rounded-lg border border-[#c8d6c9] bg-[#f4f7f4] px-4 py-3 cursor-pointer mb-5">
          <input type="checkbox" v-model="form.autoEnabled" class="mt-0.5 w-4 h-4 accent-[#2c6e33] cursor-pointer" />
          <span>
            <span class="block text-[0.88rem] font-bold text-[#122815]">Tự động dọn theo lịch hằng ngày</span>
            <span class="block text-[0.78rem] text-[#667768] mt-0.5">
              Máy chủ tự chạy, không cần đặt cron. Tắt đi thì chỉ còn cách bấm “Dọn ngay” hoặc chạy
              <code class="bg-[#e2ece3] px-1 rounded">{{ command }}</code>.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[autoEnabledSource] }})</span>
            </span>
          </span>
        </label>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Giờ chạy hằng ngày</label>
            <select v-model.number="form.runHour" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border bg-white">
              <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">
                {{ String(hour - 1).padStart(2, '0') }}:00
              </option>
            </select>
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Theo giờ máy chủ. Nếu máy tắt qua giờ này, lượt dọn sẽ chạy bù ở lần kiểm tra kế tiếp.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[runHourSource] }})</span>
            </p>
          </div>
          <div></div>

          <div class="rounded-lg border border-[#e2ece3] p-4">
            <p class="text-[0.88rem] font-bold text-[#122815] m-0 mb-3">Lịch sử hoạt động</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-[#2c3e2e]">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.activityLogDays" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <p class="text-[0.72rem] text-[#8a9a8c] m-0">
                  0 hoặc từ 30 đến 3650. <span v-if="activity">Hiện {{ SOURCE_LABELS[activity.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-[#2c3e2e]">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.activityLogMaxRows" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <p class="text-[0.72rem] text-[#8a9a8c] m-0">0 (không giới hạn) hoặc từ 1.000 trở lên.</p>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-[#e2ece3] p-4">
            <p class="text-[0.88rem] font-bold text-[#122815] m-0 mb-3">Đơn đăng ký hỗ trợ</p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-[#2c3e2e]">Số ngày lưu</label>
                <input type="number" min="0" max="3650" v-model.number="form.submissionDays" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <p class="text-[0.72rem] text-[#8a9a8c] m-0">
                  Mặc định 0 (giữ vô thời hạn) vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định.
                  <span v-if="submission">Hiện {{ SOURCE_LABELS[submission.daysSource] }}.</span>
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.8rem] font-bold text-[#2c3e2e]">Số bản ghi tối đa</label>
                <input type="number" min="0" v-model.number="form.submissionMaxRows" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <p class="text-[0.72rem] text-[#8a9a8c] m-0">Nên để 0: đơn của công dân không nên bị xoá vì bảng đầy.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
