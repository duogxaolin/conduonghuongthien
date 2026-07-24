<template>
  <section class="section bg-[#F8FAF7]" id="tro-giup">
    <div class="container" :class="hasInfo ? '' : 'max-w-[720px] mx-auto'">
      <!-- Two-column layout when an info panel is configured; single centered column otherwise. -->
      <div :class="hasInfo ? 'grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-[60px] items-start' : ''">
        <!-- Left: contact info panel (only when configured) -->
        <div v-if="hasInfo" class="flex flex-col gap-8">
          <div v-if="d.infoTitle || infoRows.length">
            <h3 class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ d.infoTitle || 'Thông tin liên hệ' }}</h3>
            <p v-for="(row, i) in infoRows" :key="i" class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong v-if="row.label" class="text-[#1E251C]">{{ row.label }}</strong>
              <template v-if="row.label"> </template>{{ row.value }}
            </p>
          </div>
          <div v-if="d.noteTitle || d.noteText">
            <h3 v-if="d.noteTitle" class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ d.noteTitle }}</h3>
            <p v-if="d.noteText" class="text-[0.95rem] text-[#4A5545] leading-relaxed text-justify">{{ d.noteText }}</p>
          </div>
        </div>

        <!-- Right: the form -->
        <div>
          <div v-if="!hasInfo" class="text-center mb-8">
            <h2 class="text-[2rem] md:text-[1.5rem] font-extrabold text-[#1E251C]">{{ d.title || 'Đăng ký nhận trợ giúp' }}</h2>
          </div>
          <form @submit.prevent="submitForm" class="bg-white p-10 sm:p-6 rounded-lg shadow-md border border-[#E2E8DF]">
            <h3 v-if="hasInfo" class="text-[1.3rem] font-bold text-[#4A6741] mb-6">{{ d.title || 'Đăng ký nhận trợ giúp' }}</h3>

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
                <option value="">-- Chọn --</option>
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
              {{ submitStatus === 'loading' ? 'Đang gửi...' : 'Gửi đăng ký' }}
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

<script setup>
import { reactive, ref, computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

// The info panel renders only when the block opts in (showInfo) and has content —
// keeps old single-column blocks unchanged, enables the two-column contact layout.
const infoRows = computed(() => Array.isArray(d.value.infoRows) ? d.value.infoRows.filter((r) => r && (r.label || r.value)) : [])
const hasInfo = computed(() => !!d.value.showInfo && (!!d.value.infoTitle || infoRows.value.length > 0 || !!d.value.noteTitle || !!d.value.noteText))

// Legacy fallback: blocks created before the field builder have no data.fields.
// Reproduce the original four-field layout so those pages stay pixel-stable.
const LEGACY_FIELDS = [
  { id: 'f_name', label: 'Họ và tên', type: 'text', required: true, placeholder: 'Nguyễn Văn A', map: 'name' },
  { id: 'f_phone', label: 'Số điện thoại', type: 'tel', required: true, placeholder: '09xx xxx xxx', map: 'phone' },
  { id: 'f_city', label: 'Tỉnh / Thành phố', type: 'text', required: true, placeholder: 'Hà Nội', map: 'address' },
  { id: 'f_message', label: 'Nội dung cần hỗ trợ', type: 'textarea', required: true, placeholder: 'Mô tả ngắn gọn vấn đề bạn cần được tư vấn...', map: 'message' },
]

const VALID_TYPES = ['text', 'email', 'tel', 'number', 'textarea', 'select']

// Normalize configured fields; assign stable ids for rendering/validation.
const renderFields = computed(() => {
  const raw = Array.isArray(d.value.fields) ? d.value.fields.filter((f) => f && f.label) : []
  const source = raw.length ? raw : LEGACY_FIELDS
  return source.map((f, i) => ({
    id: String(f.id || `f_${i}`),
    label: String(f.label || ''),
    type: VALID_TYPES.includes(f.type) ? f.type : 'text',
    required: !!f.required,
    placeholder: f.placeholder || '',
    map: f.map || 'none',
    optionsText: f.optionsText || '',
  }))
})

const selectOptions = (field) => String(field.optionsText || '').split('\n').map((s) => s.trim()).filter(Boolean)
const inputType = (type) => (type === 'email' ? 'email' : type === 'tel' ? 'tel' : type === 'number' ? 'number' : 'text')

const values = reactive({})
const errors = reactive({})
const submitStatus = ref(null)
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
      errors[field.id] = 'Trường này là bắt buộc.'
      ok = false
      continue
    }
    if (!val) continue
    if (field.type === 'email' && !EMAIL_RE.test(val)) { errors[field.id] = 'Email không hợp lệ.'; ok = false }
    else if (field.type === 'tel' && !PHONE_RE.test(val)) { errors[field.id] = 'Số điện thoại không hợp lệ.'; ok = false }
    else if (field.type === 'number' && !NUMBER_RE.test(val)) { errors[field.id] = 'Vui lòng nhập một số hợp lệ.'; ok = false }
  }
  return ok
}

const submitForm = async () => {
  submitMessage.value = ''
  if (!validate()) {
    submitStatus.value = 'error'
    submitMessage.value = 'Vui lòng kiểm tra lại các trường được đánh dấu.'
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
    await $fetch('/api/submissions', {
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
      ? `Cám ơn ${named}. Thông tin đăng ký của bạn đã được ghi nhận. Cán bộ chuyên môn sẽ liên hệ tư vấn trong vòng 24 giờ.`
      : 'Thông tin đăng ký của bạn đã được ghi nhận. Cán bộ chuyên môn sẽ liên hệ tư vấn trong vòng 24 giờ.'
    for (const field of renderFields.value) values[field.id] = ''
  } catch (err) {
    submitStatus.value = 'error'
    submitMessage.value = err?.data?.statusMessage || 'Có lỗi xảy ra, vui lòng thử lại hoặc gọi hotline 0903.480.985.'
  }
}
</script>
