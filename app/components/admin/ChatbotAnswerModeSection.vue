<!--
 * Khối "Chế độ trả lời + giới hạn liên hệ" của trang /admin/chatbot/settings.
 *
 * Tách ra khi trang vượt 400 dòng (ratchet file-length) — đây là khối HIỂN THỊ thuần:
 * không tự gọi API, không giữ trạng thái nào ngoài `v-model` của chính nó. Trạng thái,
 * lưu, lỗi và nút thử vẫn ở trang cha (đúng khuôn các lần tách trước).
 *
 * `usingAi` do trang cha tính (cần đọc cấu hình AI), nên truyền vào chứ không suy lại ở đây.
 -->
<script setup lang="ts">
defineProps<{ usingAi: boolean }>()
const form = defineModel<{
  enabled: boolean
  mode: string
  outOfScopeBehavior: string
  knowledgeGreeting: string
  smallTalkEnabled: boolean
  smallTalkSemanticEnabled: boolean
  leadCaptureEnabled: boolean
  leadCaptureEmail: string
  fallbackMessage: string
}>({ required: true })
</script>

<template>
      <!-- Answer mode + lead capture -->
      <section class="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <div>
          <h2 class="m-0 text-base font-extrabold text-brand-950">Chế độ trả lời</h2>
          <p class="m-0 mt-1 text-sm text-ink-muted">Chọn cách trợ lý trả lời người dùng.</p>
        </div>

        <label class="flex items-center gap-3 text-sm font-semibold">
          <input v-model="form.enabled" type="checkbox" class="h-4 w-4 accent-brand-700 focus:ring-2 focus:ring-brand-700/30" />
          Bật chatbot cho người dùng
        </label>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors" :class="form.mode === 'knowledge' ? 'border-brand-700 bg-surface-tint' : 'border-line-strong hover:bg-surface'">
            <span class="flex items-center gap-2 text-sm font-bold text-brand-950"><input type="radio" value="knowledge" v-model="form.mode" class="h-4 w-4 accent-brand-700" /> Chỉ kho kiến thức (không AI)</span>
            <span class="pl-6 text-xs text-ink-muted">Trả lời vui vẻ dựa trên câu trả lời đã duyệt trong Kho kiến thức, khớp theo từ khoá. Không gọi AI, không cần API key.</span>
          </label>
          <label class="flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors" :class="form.mode === 'ai' ? 'border-brand-700 bg-surface-tint' : 'border-line-strong hover:bg-surface'">
            <span class="flex items-center gap-2 text-sm font-bold text-brand-950"><input type="radio" value="ai" v-model="form.mode" class="h-4 w-4 accent-brand-700" /> Dùng AI</span>
            <span class="pl-6 text-xs text-ink-muted">AI + system prompt, ưu tiên dữ liệu trong Kho kiến thức. Cấu hình nhà cung cấp và prompt tại <nuxt-link to="/admin/ai" class="font-semibold text-brand-700 underline">AI Panel</nuxt-link>.</span>
          </label>
        </div>

        <label v-if="usingAi" class="flex flex-col gap-1.5 text-sm font-bold">
          Khi câu hỏi nằm ngoài Kho kiến thức
          <select v-model="form.outOfScopeBehavior" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20">
            <option value="knowledge_only">Chỉ bám Kho kiến thức + mời để lại thông tin (an toàn)</option>
            <option value="ai_freeform">Cho AI tự trả lời theo hiểu biết chung</option>
          </select>
        </label>

        <label v-if="form.mode === 'knowledge'" class="flex flex-col gap-1.5 text-sm font-bold">
          Lời chào vui vẻ (tùy chọn)
          <span class="font-normal text-ink-muted">Thêm vào đầu mỗi câu trả lời ở chế độ Kho kiến thức. VD: "Dạ, em xin phép trả lời ạ 😊".</span>
          <input v-model="form.knowledgeGreeting" maxlength="500" autocomplete="off" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
        </label>

        <label class="flex items-start gap-3 border-t border-line pt-4 text-sm font-semibold">
          <input v-model="form.smallTalkEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand-700" />
          <span>Trả lời thường nhật<br /><span class="font-normal text-ink-muted">Áp dụng cho cả 2 chế độ. Các câu như "hi", "chào bạn", "cảm ơn", "bạn là ai", "tôi mới ra tù tôi lo lắm" sẽ được trả lời bằng nội dung trong kho <nuxt-link to="/admin/chatbot/knowledge?tab=small-talk" class="font-semibold text-brand-700 underline">Trả lời thường nhật</nuxt-link> quản lý được, thay vì hỏi ngay thông tin liên hệ. Câu trả lời trong Kho kiến thức luôn được ưu tiên. Tắt công tắc này thì mọi câu không khớp kho kiến thức đều quay về hỏi thông tin liên hệ.</span></span>
        </label>

        <!-- Lớp khớp thứ ba: chỉ có nghĩa khi Trả lời thường nhật đang bật. -->
        <label v-if="form.smallTalkEnabled" class="flex items-start gap-3 pl-7 text-sm font-semibold">
          <input v-model="form.smallTalkSemanticEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand-700" />
          <span>Nhận thêm cách nói khác của câu chào / cảm ơn<br /><span class="font-normal text-ink-muted">Bật lớp khớp thứ ba: so độ giống theo cụm ký tự, nên "helo", "thank you", "bye bye", "ngủ ngon nhé" vẫn vào đúng mục Trả lời thường nhật dù không trùng từ khoá nào. Chạy sau kho kiến thức và sau bộ luật từ khoá, không gọi AI, khoảng 0,5 mili-giây. Đo trên kho hiện tại: câu chào khớp tăng 16/26 → 19/26 và <strong>không</strong> câu hỏi nghiệp vụ nào bị trả lời nhầm thành lời chào (0/20). Tắt thì giữ đúng hành vi trước bản cập nhật.</span></span>
        </label>

        <div class="flex flex-col gap-3 border-t border-line pt-4">
          <label class="flex items-start gap-3 text-sm font-semibold">
            <input v-model="form.leadCaptureEnabled" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand-700" />
            <span>Khi không có câu trả lời, mời khách để lại thông tin liên hệ<br /><span class="font-normal text-ink-muted">Áp dụng cho cả 2 chế độ. Thông tin được lưu ở mục Đơn đăng ký và gửi email cho cán bộ.</span></span>
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Email nhận thông tin liên hệ
            <span class="font-normal text-ink-muted">Để trống sẽ dùng email liên hệ chung của trang (trong Cài đặt chung).</span>
            <input v-model="form.leadCaptureEmail" type="email" autocomplete="off" placeholder="canbo@donvi.gov.vn" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            Câu thông báo khi chưa có câu trả lời (tùy chọn)
            <input v-model="form.fallbackMessage" maxlength="1000" autocomplete="off" placeholder="Xin lỗi, hiện tôi chưa tìm thấy thông tin phù hợp…" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" />
          </label>
        </div>
      </section>
</template>
