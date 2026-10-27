<template>
  <section class="section bg-surface" id="tro-giup">
    <div class="container" :class="hasInfo ? '' : 'max-w-[720px] mx-auto'">
      <!-- Two-column layout when an info panel is configured; single centered column otherwise. -->
      <div :class="hasInfo ? 'grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-[60px] items-start' : ''">
        <!-- Left: contact info panel (only when configured) -->
        <div v-if="hasInfo" class="flex flex-col gap-8">
          <div v-if="d.infoTitle || infoRows.length">
            <h3 class="text-[1.4rem] font-bold text-brand-600 mb-5 border-b-2 border-line pb-2">{{ (currentLang !== 'vi' ? t('contact_info') : '') || d.infoTitle || 'Thông tin liên hệ' }}</h3>
            <p v-for="(row, i) in infoRows" :key="i" class="text-[0.95rem] text-ink-secondary mb-3 leading-relaxed">
              <strong v-if="row.label" class="text-ink">{{ row.label }}</strong>
              <template v-if="row.label"> </template>{{ row.value }}
            </p>
          </div>
          <div v-if="d.noteTitle || d.noteText">
            <h3 v-if="d.noteTitle" class="text-[1.4rem] font-bold text-brand-600 mb-5 border-b-2 border-line pb-2">{{ (currentLang !== 'vi' ? t('support_mechanism_title') : '') || d.noteTitle }}</h3>
            <p v-if="d.noteText" class="text-[0.95rem] text-ink-secondary leading-relaxed text-justify">{{ (currentLang !== 'vi' ? t('support_mechanism_desc') : '') || d.noteText }}</p>
          </div>
        </div>

        <!-- Right: the form -->
        <div>
          <div v-if="!hasInfo" class="text-center mb-8">
            <h2 class="text-[2rem] md:text-[1.5rem] font-extrabold text-ink">{{ (currentLang !== 'vi' ? t('register_help') : '') || d.title || 'Đăng ký nhận trợ giúp' }}</h2>
          </div>
          <form @submit.prevent="submitForm" class="bg-white p-5 sm:p-8 lg:p-10 rounded-lg shadow-md border border-line">
            <h3 v-if="hasInfo" class="text-[1.3rem] font-bold text-brand-600 mb-6">{{ (currentLang !== 'vi' ? t('register_help') : '') || d.title || 'Đăng ký nhận trợ giúp' }}</h3>

            <!-- Dynamic fields -->
            <!--
              Nhãn ↔ điều khiển gắn bằng id/for sinh từ `useId()` + chỉ số (không dùng
              `field.id` do cán bộ đặt: có thể trùng khi block xuất hiện hai lần).
              Không dùng `required` native: validate riêng ở `validate()` và báo lỗi
              tiếng Việt ngay dưới trường; `aria-required` công bố bắt buộc cho
              trình đọc màn hình. Viền lỗi #b71c1c đạt 6.57:1 trên nền trắng (≥3:1).
            -->
            <div v-for="(field, fi) in renderFields" :key="field.id" class="mb-5">
              <label :for="controlId(uid, fi)" class="block text-[0.85rem] font-bold text-ink mb-[6px]">
                {{ field.label }}<span v-if="field.required" class="text-[#b71c1c]" aria-hidden="true"> *</span>
              </label>

              <textarea
                v-if="field.type === 'textarea'"
                :id="controlId(uid, fi)"
                rows="4"
                v-model="values[field.id]"
                @input="revalidate(field)"
                @blur="revalidate(field)"
                :placeholder="field.placeholder || ''"
                :aria-required="field.required ? 'true' : undefined"
                :aria-invalid="errors[field.id] ? 'true' : undefined"
                :aria-describedby="errors[field.id] ? errorId(uid, fi) : undefined"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-brand-600"
                :class="errors[field.id] ? 'border-[#b71c1c]' : 'border-[#E2E8DF]'"
              ></textarea>

              <select
                v-else-if="field.type === 'select'"
                :id="controlId(uid, fi)"
                v-model="values[field.id]"
                @change="revalidate(field)"
                @blur="revalidate(field)"
                :aria-required="field.required ? 'true' : undefined"
                :aria-invalid="errors[field.id] ? 'true' : undefined"
                :aria-describedby="errors[field.id] ? errorId(uid, fi) : undefined"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-brand-600 bg-white"
                :class="errors[field.id] ? 'border-[#b71c1c]' : 'border-[#E2E8DF]'"
              >
                <option value="">{{ t('form_select_placeholder') }}</option>
                <option v-for="(opt, oi) in selectOptions(field)" :key="oi" :value="opt">{{ opt }}</option>
              </select>

              <input
                v-else
                :id="controlId(uid, fi)"
                :type="inputType(field.type)"
                v-model="values[field.id]"
                @input="revalidate(field)"
                @blur="revalidate(field)"
                :placeholder="field.placeholder || ''"
                :autocomplete="autocompleteFor(field.map, field.type)"
                :aria-required="field.required ? 'true' : undefined"
                :aria-invalid="errors[field.id] ? 'true' : undefined"
                :aria-describedby="errors[field.id] ? errorId(uid, fi) : undefined"
                class="w-full px-[14px] py-[10px] border rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-brand-600"
                :class="errors[field.id] ? 'border-[#b71c1c]' : 'border-[#E2E8DF]'"
              />

              <!-- KHÔNG `role="alert"` ở từng trường: lượt gửi sai năm trường từng bắn
                   năm thông báo cùng lúc. Trình đọc màn hình nghe MỘT tóm tắt
                   (`submitMessage`, role="alert" bên dưới), focus nhảy tới trường lỗi
                   đầu tiên, và lỗi của trường được đọc qua `aria-describedby`. -->
              <p v-if="errors[field.id]" :id="errorId(uid, fi)" class="mt-1.5 text-[0.78rem] font-semibold text-[#b71c1c]">{{ errors[field.id] }}</p>
            </div>

            <button type="submit" class="btn btn-primary w-full text-lg" :disabled="submitStatus === 'loading'">
              {{ submitStatus === 'loading' ? (t('form_sending') || 'Đang gửi...') : (t('form_submit') || 'Gửi đăng ký') }}
            </button>
            <div
              v-if="submitMessage"
              class="mt-4 px-[18px] py-[14px] rounded-lg text-[0.9rem] font-semibold leading-[1.5]"
              :class="submitStatus === 'success' ? 'bg-[#e8f5e9] text-[#2e6b32] border border-[#b6d7b8]' : 'bg-danger-bg text-[#b71c1c] border border-[#f5c6cb]'"
              :role="submitStatus === 'error' ? 'alert' : 'status'"
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
import { reactive, ref, computed, nextTick, useId } from 'vue'
import { errorMessage } from '~/utils/errorMessage'
import { useI18n } from '~/composables/useI18n'
import { autocompleteFor, controlId, errorId, validateFormField } from '~/utils/form-a11y'

const { t, currentLang } = useI18n()
// Duy nhất theo thể hiện (hai block cùng trang không đụng id), ổn định SSR↔hydrate.
const uid = useId()
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

const validationMessages = () => ({
  required: t('form_validation_required'),
  email: t('form_validation_email'),
  phone: t('form_validation_phone'),
  number: t('form_validation_number'),
})

const validate = () => {
  for (const k of Object.keys(errors)) delete errors[k]
  const messages = validationMessages()
  let ok = true
  for (const field of renderFields.value) {
    const error = validateFormField(field, values[field.id], messages)
    if (error) {
      errors[field.id] = error
      ok = false
    }
  }
  return ok
}

/**
 * Kiểm lại MỘT trường đang báo lỗi khi người dùng sửa nó (`@input`/`@blur`): sửa
 * đúng thì `aria-invalid` + dòng lỗi biến mất ngay, không phải đợi bấm gửi lần nữa.
 * Trường chưa từng lỗi thì để yên — không bắt bẻ người đang gõ dở trước lượt gửi.
 */
const revalidate = (field: RenderField) => {
  if (!errors[field.id]) return
  const error = validateFormField(field, values[field.id], validationMessages())
  if (error) errors[field.id] = error
  else delete errors[field.id]
  if (submitStatus.value === 'error' && !Object.keys(errors).length) {
    submitStatus.value = null
    submitMessage.value = ''
  }
}

// Đưa focus tới trường lỗi đầu tiên để người dùng bàn phím/trình đọc màn hình
// thấy ngay chỗ cần sửa (lỗi của trường được đọc nhờ aria-describedby; thông báo
// chung duy nhất là tóm tắt `submitMessage` role="alert").
const focusFirstInvalid = async () => {
  await nextTick()
  const index = renderFields.value.findIndex((f) => errors[f.id])
  if (index >= 0) document.getElementById(controlId(uid, index))?.focus()
}

const submitForm = async () => {
  submitMessage.value = ''
  if (!validate()) {
    submitStatus.value = 'error'
    submitMessage.value = t('form_validation_check')
    await focusFirstInvalid()
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
