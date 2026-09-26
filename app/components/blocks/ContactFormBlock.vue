<template>
  <section class="section bg-[#F8FAF7]" id="tro-giup">
    <div class="container" :class="hasInfo ? '' : 'max-w-[720px] mx-auto'">
      <!-- Two-column layout when an info panel is configured; single centered column otherwise. -->
      <div :class="hasInfo ? 'grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-[60px] items-start' : ''">
        <!-- Left: contact info panel (only when configured) -->
        <div v-if="hasInfo" class="flex flex-col gap-8">
          <div v-if="d.infoTitle || infoRows.length">
            <h3 class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ (currentLang !== 'vi' ? t('contact_info') : '') || d.infoTitle || 'Thông tin liên hệ' }}</h3>
            <p v-for="(row, i) in infoRows" :key="i" class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong v-if="row.label" class="text-[#1E251C]">{{ row.label }}</strong>
              <template v-if="row.label"> </template>{{ row.value }}
            </p>
          </div>
          <div v-if="d.noteTitle || d.noteText">
            <h3 v-if="d.noteTitle" class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ (currentLang !== 'vi' ? t('support_mechanism_title') : '') || d.noteTitle }}</h3>
            <p v-if="d.noteText" class="text-[0.95rem] text-[#4A5545] leading-relaxed text-justify">{{ (currentLang !== 'vi' ? t('support_mechanism_desc') : '') || d.noteText }}</p>
          </div>
        </div>

        <!-- Right: the form -->
        <div>
          <div v-if="!hasInfo" class="text-center mb-8">
            <h2 class="text-[2rem] md:text-[1.5rem] font-extrabold text-[#1E251C]">{{ (currentLang !== 'vi' ? t('register_help') : '') || d.title || 'Đăng ký nhận trợ giúp' }}</h2>
          </div>
          <form @submit.prevent="submitForm" class="bg-white p-10 sm:p-6 rounded-lg shadow-md border border-[#E2E8DF]">
            <h3 v-if="hasInfo" class="text-[1.3rem] font-bold text-[#4A6741] mb-6">{{ (currentLang !== 'vi' ? t('register_help') : '') || d.title || 'Đăng ký nhận trợ giúp' }}</h3>

            <!-- Dynamic fields -->
            <div v-for="field in renderFields" :key="field.id" class="mb-5">
              <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">
                {{ field.label }}<span v-if="field.required" class="text-[#b71c1c]"> *</span>
              </label>

              <textarea
                v-if="field.type === 'textarea'"
                rows="4"
                v-model="values[field.id]"
                :placeholder="field.placeholder || ''"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]"
                :class="errors[field.id] ? 'border-[#f5c6cb]' : 'border-[#E2E8DF]'"
              ></textarea>

              <select
                v-else-if="field.type === 'select'"
                v-model="values[field.id]"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741] bg-white"
                :class="errors[field.id] ? 'border-[#f5c6cb]' : 'border-[#E2E8DF]'"
              >
                <option value="">{{ t('form_select_placeholder') }}</option>
                <option v-for="(opt, oi) in selectOptions(field)" :key="oi" :value="opt">{{ opt }}</option>
              </select>

              <input
                v-else
                :type="inputType(field.type)"
                v-model="values[field.id]"
                :placeholder="field.placeholder || ''"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]"
                :class="errors[field.id] ? 'border-[#f5c6cb]' : 'border-[#E2E8DF]'"
              />

              <p v-if="errors[field.id]" class="mt-1.5 text-[0.78rem] font-semibold text-[#b71c1c]">{{ errors[field.id] }}</p>
            </div>

            <button type="submit" class="btn btn-primary w-full text-lg" :disabled="submitStatus === 'loading'">
              {{ submitStatus === 'loading' ? (t('form_sending') || 'Đang gửi...') : (t('form_submit') || 'Gửi đăng ký') }}
            </button>
            <div
              v-if="submitMessage"
              class="mt-4 px-[18px] py-[14px] rounded-lg text-[0.9rem] font-semibold leading-[1.5]"
              :class="submitStatus === 'success' ? 'bg-[#e8f5e9] text-[#2e6b32] border border-[#b6d7b8]' : 'bg-[#fdecea] text-[#b71c1c] border border-[#f5c6cb]'"
              role="status"
              aria-live="polite"
            >
              {{ submitMessage }}
            </div>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { errorMessage } from '~/utils/errorMessage'
import { useI18n } from '~/composables/useI18n'

const { t, currentLang } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

/** Một dòng của bảng thông tin bên phải, như cán bộ cấu hình nó. */
interface InfoRow {
  label?: string
  value?: string
}

/** Kiểu ô nhập được phép. Template phân nhánh theo giá trị này. */
type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select'

/** Một trường của biểu mẫu sau khi đã chuẩn hoá — mọi trường đều có mặt. */
interface RenderField {
  id: string
  label: string
  type: FieldType
  required: boolean
  placeholder: string
  map: string
  optionsText: string
}

// The info panel renders only when the block opts in (showInfo) and has content —
// keeps old single-column blocks unchanged, enables the two-column contact layout.
const infoRows = computed<InfoRow[]>(() => {
  const rows = Array.isArray(d.value.infoRows)
    ? (d.value.infoRows as InfoRow[]).filter((r) => r && (r.label || r.value))
    : []
  if (currentLang.value === 'vi') return rows
  const labelMap: Record<string, string> = {
    'Đơn vị chủ quản:': t('footer_agency') || 'Supervisory Authority:',
    'Địa chỉ:': t('address') || 'Address:',
    'Hotline:': t('phone') || 'Hotline:',
    'Email:': t('email') || 'Email:',
  }
  return rows.map((r) => ({
    label: labelMap[r.label?.trim() || ''] || r.label,
    value: r.value,
  }))
})
const hasInfo = computed(() => !!d.value.showInfo && (!!d.value.infoTitle || infoRows.value.length > 0 || !!d.value.noteTitle || !!d.value.noteText))

// Legacy fallback: blocks created before the field builder have no data.fields.
// Reproduce the original four-field layout so those pages stay pixel-stable.
// `Partial<RenderField>[]`, không phải `RenderField[]`: không trường nào ở đây là
// `select`, nên `optionsText` vắng mặt là đúng — chúng đi qua cùng lượt chuẩn hoá
// của `renderFields`, nơi mọi khoá thiếu được điền giá trị mặc định.
const LEGACY_FIELDS = computed<Partial<RenderField>[]>(() => [
  { id: 'f_name', label: t('form_name'), type: 'text', required: true, placeholder: t('form_name_ph'), map: 'name' },
  { id: 'f_phone', label: t('form_phone'), type: 'tel', required: true, placeholder: t('form_phone_ph'), map: 'phone' },
  { id: 'f_city', label: t('form_city'), type: 'text', required: true, placeholder: t('form_city_ph'), map: 'address' },
  { id: 'f_message', label: t('form_message'), type: 'textarea', required: true, placeholder: t('form_message_ph'), map: 'message' },
])

// `as const` + hàm thu hẹp: `VALID_TYPES.includes(f.type)` trên một mảng
// `string[]` không thu hẹp được kiểu, nên `type` vẫn là `string` và không gán được
// vào `FieldType`. Một hàm thu hẹp tường minh nói đúng điều phép kiểm kia định nói.
const VALID_TYPES = ['text', 'email', 'tel', 'number', 'textarea', 'select'] as const

function toFieldType(value: unknown): FieldType {
  return (VALID_TYPES as readonly string[]).includes(String(value)) ? value as FieldType : 'text'
}

const FIELD_LABEL_MAP: Record<string, string> = {
  'Họ và tên': 'form_name',
  'Số điện thoại': 'form_phone',
  'Tỉnh / Thành phố': 'form_city',
  'Nội dung cần hỗ trợ': 'form_message',
}

// Normalize configured fields; assign stable ids for rendering/validation.
const renderFields = computed<RenderField[]>(() => {
  const configured = Array.isArray(d.value.fields) ? d.value.fields as Partial<RenderField>[] : []
  const raw = configured.filter((f) => f && f.label)
  const source: Partial<RenderField>[] = raw.length ? raw : LEGACY_FIELDS.value
  return source.map((f, i) => {
    const rawLabel = String(f.label || '')
    let localizedLabel = rawLabel
    if (currentLang.value !== 'vi') {
      const key = FIELD_LABEL_MAP[rawLabel.trim()]
      if (key) {
        localizedLabel = t(key) || rawLabel
      } else {
        localizedLabel = t(rawLabel) || rawLabel
      }
    }
    return {
      id: String(f.id || `f_${i}`),
      label: localizedLabel,
      type: toFieldType(f.type),
      required: !!f.required,
      placeholder: f.placeholder || '',
      map: f.map || 'none',
      optionsText: f.optionsText || '',
    }
  })
})

const selectOptions = (field: RenderField) => String(field.optionsText || '').split('\n').map((s) => s.trim()).filter(Boolean)
const inputType = (type: FieldType) => (type === 'email' ? 'email' : type === 'tel' ? 'tel' : type === 'number' ? 'number' : 'text')

// Khoá là `field.id` do cán bộ cấu hình, nên đây là map động — `reactive({})` trần
// suy ra `{}` và mọi phép đọc theo khoá thành lỗi `TS7053`.
const values = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})
const submitStatus = ref<null | 'loading' | 'success' | 'error'>(null)
const submitMessage = ref('')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

const validate = () => {
  for (const k of Object.keys(errors)) delete errors[k]
  let ok = true
  for (const field of renderFields.value) {
    const val = String(values[field.id] ?? '').trim()
    if (field.required && !val) {
      errors[field.id] = t('form_validation_required')
      ok = false
      continue
    }
    if (!val) continue
    if (field.type === 'email' && !EMAIL_RE.test(val)) { errors[field.id] = t('form_validation_email'); ok = false }
    else if (field.type === 'tel' && !PHONE_RE.test(val)) { errors[field.id] = t('form_validation_phone'); ok = false }
    else if (field.type === 'number' && !NUMBER_RE.test(val)) { errors[field.id] = t('form_validation_number'); ok = false }
  }
  return ok
}

const submitForm = async () => {
  submitMessage.value = ''
  if (!validate()) {
    submitStatus.value = 'error'
    submitMessage.value = t('form_validation_check')
    return
  }
  submitStatus.value = 'loading'
  try {
    const answers = renderFields.value.map((field) => ({
      id: field.id,
      label: field.label,
      value: String(values[field.id] ?? '').trim(),
      map: field.map,
      type: field.type,
      required: field.required,
    }))
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/submissions', {
      method: 'POST',
      body: {
        type: 'support',
        formTitle: d.value.title || '',
        recipientEmail: d.value.recipientEmail || '',
        answers,
      },
    })
    submitStatus.value = 'success'
    const named = answers.find((a) => a.map === 'name')?.value
    submitMessage.value = named
      ? t('form_success_named').replace('{name}', named)
      : t('form_success_generic')
    for (const field of renderFields.value) values[field.id] = ''
  } catch (err: unknown) {
    submitStatus.value = 'error'
    submitMessage.value = errorMessage(err, t('form_error'))
  }
}
</script>
