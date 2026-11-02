<script setup lang="ts">
/**
 * "Sửa hạn mức" on the AI dashboard (`AiDashboardTab.vue`) — the monthly AI spending cap and its
 * warning threshold, written by `PUT /api/admin/ai/budget` (`ai.update`). Parsing, the warnings
 * and the request: `app/utils/ai-budget-form.ts` (what the cap does is `checkBudget`'s behaviour,
 * described there).
 *
 * The current values come from the dashboard's own `GET /api/admin/ai/usage` (`budget` — the same
 * `ai_budget_settings` row `GET /api/admin/ai/budget` reads, under the same `ai.read`), so this
 * makes no request of its own until "Lưu" and has no load to fail. After a save it emits `saved`
 * with the two numbers written; the dashboard shows them at once and re-reads in place
 * (`loadUsage({ refresh: true })`: this card stays mounted). Without the first step the card would
 * keep the OLD props until the re-read answers — and "Sửa hạn mức", focused right then, would open
 * on the old cap and a second save would revert the first. A failed save stays open with the
 * server's sentence in `role="alert"`; the button is the retry.
 *
 * Focus: opening moves it to the first field; closing (Hủy, saved, "Không có thay đổi.") gives it
 * back to "Sửa hạn mức" — the control that opened the form, shown again in its place.
 */
import type { AdminAiBudgetUpdateResponse } from '~/types/admin-ai-api'
import type { BudgetPayload } from '~/utils/ai-budget-form'
import { BUDGET_REACHED_EFFECTS, budgetBlocksAiNow, parseBudgetVnd, saveAiBudget, ZERO_BUDGET_WARNING } from '~/utils/ai-budget-form'
import { formatVnd } from '~/utils/ai-service-labels'

const props = defineProps<{
  /** The cap set here (0 = none set here). */
  monthlyBudgetVnd: number
  warningThresholdPct: number
  /** This Vietnam month's spend — the total `checkBudget` compares the cap with. */
  monthSpendVnd: number
}>()
const emit = defineEmits<{ saved: [saved: BudgetPayload] }>()

const { hasPermission } = useAdminAuth()
const { confirm } = useConfirm()
const toast = useToast()

// The PUT takes `ai.update`; a reader of the dashboard (`ai.read`) sees the cap on its card only.
const canEdit = computed(() => hasPermission('ai', 'update'))

const editing = ref(false)
const saving = ref(false)
const form = reactive({ budget: '', threshold: '' })
const errors = reactive({ budget: '', threshold: '' })
const saveError = ref('')

const typedBudget = computed(() => parseBudgetVnd(form.budget))
const budgetPreview = computed(() => (typedBudget.value.ok ? formatVnd(typedBudget.value.value) : ''))
const blocksNow = computed(() => typedBudget.value.ok && budgetBlocksAiNow(typedBudget.value.value, props.monthSpendVnd))
const zeroTyped = computed(() => typedBudget.value.ok && typedBudget.value.value === 0)

const editButton = ref<HTMLButtonElement | null>(null)
const budgetField = ref<HTMLInputElement | null>(null)

async function open() {
  form.budget = String(props.monthlyBudgetVnd)
  form.threshold = String(props.warningThresholdPct)
  errors.budget = ''
  errors.threshold = ''
  saveError.value = ''
  editing.value = true
  await nextTick()
  budgetField.value?.focus()
}

async function close() {
  editing.value = false
  await nextTick()
  editButton.value?.focus()
}

async function save() {
  if (saving.value) return
  errors.budget = ''
  errors.threshold = ''
  saveError.value = ''
  saving.value = true
  try {
    const outcome = await saveAiBudget(form, {
      monthSpendVnd: props.monthSpendVnd,
      confirm,
      request: (url, options) => adminFetch<AdminAiBudgetUpdateResponse>(url, options),
    })
    if (outcome.status === 'invalid') {
      errors.budget = outcome.errors.budget ?? ''
      errors.threshold = outcome.errors.threshold ?? ''
    } else if (outcome.status === 'failed') {
      saveError.value = outcome.message
    } else if (outcome.status === 'unchanged') {
      toast.info(outcome.message)
      await close()
    } else if (outcome.status === 'saved') {
      toast.success('Đã lưu hạn mức chi AI.')
      emit('saved', outcome.saved)
      await close()
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section v-if="canEdit" class="rounded-xl border border-line bg-white p-4" aria-labelledby="ai-budget-editor-title">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h2 id="ai-budget-editor-title" class="m-0 text-sm font-bold text-brand-950">Hạn mức chi AI đặt tại cổng</h2>
        <p class="m-0 mt-1 text-xs text-ink-muted">
          {{ monthlyBudgetVnd > 0 ? `${formatVnd(monthlyBudgetVnd)} mỗi tháng` : 'Chưa đặt (0)' }} · Ngưỡng cảnh báo {{ warningThresholdPct }}%
        </p>
      </div>
      <button
        v-if="!editing"
        ref="editButton"
        type="button"
        class="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-line-strong bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-surface-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:self-auto"
        @click="open"
      ><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Sửa hạn mức</button>
    </div>

    <form v-if="editing" class="mt-4 flex flex-col gap-4" novalidate @submit.prevent="save">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <label for="ai-budget-vnd" class="text-[0.82rem] font-bold text-ink-admin">Hạn mức mỗi tháng (đồng)</label>
          <input
            id="ai-budget-vnd"
            ref="budgetField"
            v-model="form.budget"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :aria-invalid="errors.budget ? 'true' : undefined"
            :aria-describedby="errors.budget ? 'ai-budget-vnd-error' : 'ai-budget-vnd-hint'"
            class="w-full rounded-lg border border-line-strong px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
          />
          <p v-if="errors.budget" id="ai-budget-vnd-error" class="m-0 text-xs font-semibold text-danger">{{ errors.budget }}</p>
          <p v-else id="ai-budget-vnd-hint" class="m-0 text-xs text-ink-muted">{{ budgetPreview ? `= ${budgetPreview}` : 'Số nguyên đồng, chỉ gồm chữ số.' }}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ai-budget-threshold" class="text-[0.82rem] font-bold text-ink-admin">Ngưỡng cảnh báo (%)</label>
          <input
            id="ai-budget-threshold"
            v-model="form.threshold"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :aria-invalid="errors.threshold ? 'true' : undefined"
            :aria-describedby="errors.threshold ? 'ai-budget-threshold-error' : 'ai-budget-threshold-hint'"
            class="w-full rounded-lg border border-line-strong px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
          />
          <p v-if="errors.threshold" id="ai-budget-threshold-error" class="m-0 text-xs font-semibold text-danger">{{ errors.threshold }}</p>
          <p v-else id="ai-budget-threshold-hint" class="m-0 text-xs text-ink-muted">Số nguyên 1–100. Chi tới ngưỡng này, máy chủ ghi một dòng cảnh báo vào nhật ký (tối đa mỗi ngày một lần); ngưỡng không chặn gọi AI.</p>
        </div>
      </div>

      <div class="rounded-lg border border-line bg-surface p-3 text-xs leading-relaxed text-ink-admin">
        <p class="m-0">Khi chi phí AI trong tháng (theo lịch Việt Nam) chạm hạn mức, {{ BUDGET_REACHED_EFFECTS }}</p>
        <p class="m-0 mt-1">Đặt 0: cổng không đặt hạn mức. Khi đó, nếu khoá Delify có ngân sách riêng, máy chủ dùng ngân sách đó (so với tổng chi từ trước tới nay).</p>
      </div>

      <p v-if="zeroTyped" class="m-0 flex items-start gap-2 rounded-lg border border-line-strong bg-surface p-3 text-xs font-semibold text-warn-ink">
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>{{ ZERO_BUDGET_WARNING }}</span>
      </p>

      <p v-if="blocksNow" class="m-0 flex items-start gap-2 rounded-lg border border-danger bg-danger-bg p-3 text-xs font-semibold text-danger">
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>Tháng này đã chi {{ formatVnd(monthSpendVnd) }} — hạn mức này chặn mọi lượt gọi AI ngay khi lưu.</span>
      </p>

      <div v-if="saveError" role="alert" class="rounded-lg bg-danger-bg px-3 py-2 text-[0.82rem] text-danger">{{ saveError }}</div>

      <div class="flex justify-end gap-3">
        <button
          type="button"
          class="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-admin hover:bg-surface-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="saving"
          @click="close"
        >Hủy</button>
        <button
          type="submit"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="saving"
          :aria-busy="saving"
        >{{ saving ? 'Đang lưu…' : 'Lưu hạn mức' }}</button>
      </div>
    </form>
  </section>
</template>
