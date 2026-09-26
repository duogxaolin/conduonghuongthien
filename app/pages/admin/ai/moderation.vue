<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="w-8 h-8 rounded-lg bg-[#1e4620] text-white flex items-center justify-center text-sm shadow-xs">
          <i class="fa-solid fa-shield-halved"></i>
        </span>
        <h1 class="m-0 text-[1.35rem] font-extrabold text-[#122815]">Kiểm duyệt An ninh & An toàn Nội dung</h1>
      </div>
      <p class="m-0 mt-1 text-sm text-[#667768]">
        Hệ thống kiểm duyệt an ninh tự động: đọc hiểu ngữ cảnh AI, tự động phát hiện và ẩn nội dung xấu độc, thù địch, chống phá, lừa đảo theo quy định của Cục C11 - Bộ Công an.
      </p>
    </header>

    <!-- Error Alert -->
    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">
      <strong>Lỗi:</strong> {{ error }}
      <button type="button" class="font-bold underline text-[#4A6741] ml-2 cursor-pointer" @click="loadData">Thử lại</button>
    </div>

    <!-- Tab navigation -->
    <nav class="flex flex-wrap gap-2 bg-white p-2 rounded-xl border border-[#e2ece3]">
      <button
        v-for="t in ([
          { key: 'settings', label: '⚙️ Cài đặt Kiểm duyệt AI', icon: 'fa-solid fa-sliders', badge: 0, count: undefined as number | undefined },
          { key: 'queue', label: '📥 Sổ đối soát nội dung bị ẩn', icon: 'fa-solid fa-inbox', badge: pendingQueueCount, count: undefined as number | undefined },
          { key: 'rules', label: '📋 Quy tắc & Từ khóa an ninh', icon: 'fa-solid fa-list-check', badge: 0, count: rules.length },
          { key: 'worker', label: '⚡ Trạng thái Worker & Hệ thống', icon: 'fa-solid fa-server', badge: 0, count: undefined as number | undefined },
        ] as const)"
        :key="t.key"
        type="button"
        class="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border"
        :class="activeTab === t.key
          ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-xs'
          : 'bg-white text-[#667768] border-transparent hover:bg-[#f0f7f1] hover:text-[#1e4620]'"
        @click="activeTab = t.key as any"
      >
        <span>{{ t.label }}</span>
        <span v-if="t.badge > 0" class="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[0.65rem] font-black">
          {{ t.badge }}
        </span>
        <span v-else-if="t.count !== undefined" class="text-[0.7rem] opacity-70">
          ({{ t.count }})
        </span>
      </button>

      <button
        type="button"
        class="ml-auto px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#f0f7f1] transition-colors cursor-pointer flex items-center gap-1.5"
        :disabled="loading"
        @click="loadData"
      >
        <i class="fa-solid fa-rotate text-xs" :class="loading ? 'animate-spin' : ''"></i>
        <span>Làm mới</span>
      </button>
    </nav>

    <!-- Skeleton Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-4">
      <span class="sr-only">Đang tải dữ liệu kiểm duyệt an ninh</span>
      <div v-for="n in 3" :key="n" class="h-28 rounded-xl bg-white border border-[#e2ece3] animate-pulse motion-reduce:animate-none"></div>
    </div>

    <!-- Main Content Tabs -->
    <template v-else-if="!error">
      <!-- ─── TAB 1: CÀI ĐẶT KIỂM DUYỆT AI (SETTINGS) ─── -->
      <form v-if="activeTab === 'settings'" class="flex flex-col gap-5" @submit.prevent="saveSettings">
        <!-- Chế độ kiểm duyệt -->
        <section class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <div>
            <h2 class="m-0 text-base font-extrabold text-[#122815]">Chế độ kiểm duyệt an ninh</h2>
            <p class="m-0 mt-1 text-sm text-[#667768]">Lựa chọn phương thức bảo vệ an ninh và rà soát nội dung trên Cổng thông tin.</p>
          </div>

          <label class="flex items-center gap-3 text-sm font-semibold">
            <input v-model="form.enabled" type="checkbox" class="h-4 w-4 accent-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/30" />
            <span>Kích hoạt tính năng Kiểm duyệt an ninh tự động</span>
          </label>

          <div class="grid gap-3 sm:grid-cols-2">
            <label
              class="flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-all"
              :class="form.mode === 'keyword_only' ? 'border-[#2c6e33] bg-[#f0f7f1] shadow-xs' : 'border-[#c8d6c9] hover:bg-[#f8faf8]'"
            >
              <span class="flex items-center gap-2 text-sm font-bold text-[#122815]">
                <input v-model="form.mode" type="radio" value="keyword_only" class="h-4 w-4 accent-[#2c6e33]" />
                Chỉ dùng bộ lọc từ khóa (Không AI)
              </span>
              <span class="pl-6 text-xs text-[#667768] leading-relaxed">
                Quét nhanh các từ khóa cấm theo danh mục. Phản hồi tức thì, hoàn toàn không tốn chi phí gọi AI, nhưng có thể bị lách chữ hoặc khóa nhầm câu lành tính.
              </span>
            </label>

            <label
              class="flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-all"
              :class="form.mode === 'ai' ? 'border-[#2c6e33] bg-[#f0f7f1] shadow-xs' : 'border-[#c8d6c9] hover:bg-[#f8faf8]'"
            >
              <span class="flex items-center gap-2 text-sm font-bold text-[#122815]">
                <input v-model="form.mode" type="radio" value="ai" class="h-4 w-4 accent-[#2c6e33]" />
                Kết hợp AI đọc hiểu ngữ cảnh (Khuyên dùng)
              </span>
              <span class="pl-6 text-xs text-[#667768] leading-relaxed">
                AI phân tích ý đồ ngữ cảnh câu văn để phân biệt giữa tuyên truyền chống phá (vi phạm -> ẩn ngay) và người dân cảnh giác/phản bác (an toàn -> cho phép hiển thị).
              </span>
            </label>
          </div>
        </section>

        <!-- Cấu hình AI & Prompt cho Kiểm duyệt -->
        <section v-if="form.mode === 'ai'" class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-5">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2ece3] pb-3">
            <div>
              <h2 class="m-0 text-base font-extrabold text-[#122815]">Cấu hình AI & Prompt cho Trợ lý Kiểm duyệt</h2>
              <p class="m-0 mt-0.5 text-xs text-[#667768]">
                Đồng bộ với <nuxt-link to="/admin/ai" class="font-bold text-[#2c6e33] underline">AI Panel</nuxt-link>. Bạn sửa ở đây hoặc sửa trong AI Panel đều có hiệu lực ngay lập tức.
              </p>
            </div>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#122815] hover:bg-[#f0f7f1] transition-colors cursor-pointer"
              @click="restoreDefaultPrompt"
            >
              <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i> Khôi phục prompt kiểm duyệt mặc định C11
            </button>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm font-bold">
              Nhà cung cấp (Provider)
              <select v-model="form.provider" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20 bg-white">
                <option v-for="p in activeProviders" :key="p.provider" :value="p.provider">{{ p.label }} ({{ p.provider }})</option>
                <option v-if="!activeProviders.some(p => p.provider === form.provider)" :value="form.provider">{{ form.provider }}</option>
              </select>
            </label>

            <label class="flex flex-col gap-1.5 text-sm font-bold">
              Model sử dụng
              <select v-if="activeModelsForCurrentProvider.length > 0" v-model="form.model" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20 bg-white">
                <option v-for="m in activeModelsForCurrentProvider" :key="m.model" :value="m.model">
                  {{ m.model }} {{ m.label ? `(${m.label})` : '' }} — ${{ m.promptCostPerMillion }} in / ${{ m.completionCostPerMillion }} out
                </option>
              </select>
              <input
                v-else
                v-model="form.model"
                type="text"
                placeholder="delify-5.5, flash..."
                class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"
              />
            </label>
          </div>

          <!-- System Prompt Textarea -->
          <label class="flex flex-col gap-1.5 text-sm font-bold">
            <div class="flex items-center justify-between">
              <span>Chỉ dẫn hệ thống (System Prompt) cho AI Kiểm duyệt</span>
              <span class="text-xs font-normal text-[#667768]">{{ form.systemPrompt.length }} ký tự</span>
            </div>
            <textarea
              v-model="form.systemPrompt"
              rows="9"
              placeholder="Nhập prompt chỉ dẫn cho sĩ quan an ninh mạng kiểm duyệt..."
              class="rounded-lg border border-[#c8d6c9] px-3.5 py-2.5 font-normal font-sans text-xs leading-relaxed outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
            ></textarea>
          </label>
        </section>

        <!-- Save button -->
        <div class="flex items-center justify-end gap-3 bg-white p-4 rounded-xl border border-[#e2ece3]">
          <button
            type="submit"
            :disabled="saving"
            class="px-6 py-2.5 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-sm font-bold transition-all border-none cursor-pointer shadow-sm disabled:opacity-50"
          >
            {{ saving ? 'Đang lưu...' : 'Lưu cấu hình kiểm duyệt' }}
          </button>
        </div>
      </form>

      <!-- ─── TAB 2: SỔ ĐỐI SOÁT NỘI DUNG BỊ ẨN (REVIEW QUEUE) ─── -->
      <div v-else-if="activeTab === 'queue'" class="flex flex-col gap-4">
        <!-- Status Filter -->
        <div class="flex flex-wrap items-center gap-2 bg-white p-3 rounded-xl border border-[#e2ece3]">
          <span class="text-xs font-bold text-[#667768]">Lọc trạng thái:</span>
          <button
            v-for="s in [
              { key: 'pending', label: 'Chờ đối soát' },
              { key: 'approved', label: 'Đã duyệt an toàn' },
              { key: 'rejected', label: 'Đã xóa' },
              { key: 'banned', label: 'Đã cấm IP' },
              { key: 'all', label: 'Tất cả' }
            ]"
            :key="s.key"
            type="button"
            class="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border"
            :class="queueStatusFilter === s.key ? 'bg-[#2c6e33] text-white border-[#2c6e33]' : 'bg-white text-[#667768] border-[#d0ddd1] hover:bg-[#f0f7f1]'"
            @click="queueStatusFilter = s.key; queuePage = 1; loadQueue()"
          >
            {{ s.label }}
          </button>
        </div>

        <!-- Empty state -->
        <div v-if="queue.length === 0" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center text-sm text-[#667768]">
          <i class="fa-solid fa-shield-check text-4xl text-[#2c6e33] mb-3 block"></i>
          Không có mục nào trong danh sách đối soát. Hệ thống an ninh đang hoạt động tốt.
        </div>

        <!-- Queue table -->
        <div v-else class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
          <table class="w-full text-xs">
            <thead class="bg-[#f7faf7] text-left">
              <tr>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Thời gian</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Nguồn & Vị trí ẩn</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Người gửi / IP</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Nội dung vi phạm</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Lý do phân tích</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Mức độ</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Trạng thái</th>
                <th class="px-3.5 py-3 font-bold text-[#122815] text-right">Thao tác đối soát</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in queue" :key="item.id" class="border-t border-[#e2ece3] hover:bg-[#fcfdfc]">
                <td class="px-3.5 py-2.5 whitespace-nowrap text-[#667768]">{{ formatTime(item.createdAt) }}</td>
                <td class="px-3.5 py-2.5">
                  <span class="inline-block px-2 py-0.5 rounded font-bold uppercase text-[0.65rem]" :class="item.targetType === 'comment' ? 'bg-blue-100 text-blue-800' : item.targetType === 'chat' ? 'bg-purple-100 text-purple-800' : item.targetType === 'livestream_chat' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                    {{ item.targetType === 'comment' ? 'Bình luận' : item.targetType === 'chat' ? 'Chat AI' : item.targetType === 'livestream_chat' ? 'Livestream' : 'Bài viết' }}
                  </span>
                  <!-- Vị trí cụ thể: bài viết / video / phiên chat -->
                  <div v-if="item.contextTitle" class="mt-1 max-w-[220px]">
                    <a v-if="item.contextUrl" :href="item.contextUrl" target="_blank" class="block font-bold text-[#1e4620] hover:underline truncate text-xs" :title="item.contextTitle">
                      {{ item.contextTitle }}
                    </a>
                    <span v-else class="block font-bold text-[#1e4620] truncate text-xs" :title="item.contextTitle">
                      {{ item.contextTitle }}
                    </span>
                  </div>
                  <!-- Session ID nếu có -->
                  <div v-if="item.sessionId" class="mt-0.5">
                    <nuxt-link :to="`/admin/chatbot/sessions?search=${encodeURIComponent(item.sessionId)}`" class="text-[0.68rem] font-mono text-[#6b7280] hover:text-[#1e4620] underline">
                      Session: {{ item.sessionId.slice(0, 8) }}...
                    </nuxt-link>
                  </div>
                </td>
                <td class="px-3.5 py-2.5 whitespace-nowrap">
                  <strong class="text-[#122815]">{{ item.authorName || 'Khách' }}</strong>
                  <div v-if="item.authorIp" class="flex items-center gap-1.5 mt-0.5">
                    <span class="text-[0.68rem] text-[#667768] font-mono">{{ item.authorIp }}</span>
                    <span v-if="item.isIpBanned" class="px-1.5 py-0.2 rounded text-[0.62rem] font-bold bg-red-100 text-red-700 border border-red-200">
                      Đã cấm
                    </span>
                  </div>
                </td>
                <td class="px-3.5 py-2.5 max-w-xs break-words">
                  <p class="m-0 text-red-900 bg-red-50 p-2.5 rounded border border-red-200 text-xs leading-relaxed font-medium">
                    {{ item.contentSnippet }}
                  </p>
                </td>
                <td class="px-3.5 py-2.5 max-w-[240px] break-words text-xs text-[#b42318] leading-relaxed">
                  {{ item.flaggedReason }}
                </td>
                <td class="px-3.5 py-2.5 whitespace-nowrap">
                  <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem] uppercase" :class="item.severity === 'critical' ? 'bg-red-600 text-white' : item.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                    {{ item.severity === 'critical' ? 'Nguy hiểm' : item.severity === 'high' ? 'Cao' : 'Trung bình' }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5 whitespace-nowrap">
                  <span class="px-2 py-0.5 rounded-full font-bold text-[0.65rem]" :class="item.status === 'pending' ? 'bg-orange-100 text-orange-800 border border-orange-300' : item.status === 'approved' ? 'bg-green-100 text-green-800' : item.status === 'banned' ? 'bg-gray-800 text-white' : 'bg-red-100 text-red-800'">
                    {{ item.status === 'pending' ? 'Đã ẩn (Chờ duyệt)' : item.status === 'approved' ? 'Đã duyệt an toàn' : item.status === 'banned' ? 'Đã cấm IP' : 'Đã xóa' }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5 whitespace-nowrap text-right">
                  <div class="flex items-center justify-end gap-1.5 flex-wrap">
                    <button
                      v-if="item.status === 'pending'"
                      type="button"
                      class="px-2.5 py-1 rounded bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.7rem] font-bold cursor-pointer border-none shadow-2xs"
                      title="Duyệt nội dung an toàn và cho phép hiển thị lại"
                      @click="resolveItem(item, 'approve')"
                    >
                      <i class="fa-solid fa-check mr-1"></i> Bỏ ẩn
                    </button>
                    <button
                      v-if="item.status !== 'rejected'"
                      type="button"
                      class="px-2.5 py-1 rounded bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.7rem] font-bold cursor-pointer border-none shadow-2xs"
                      title="Xóa vĩnh viễn nội dung vi phạm"
                      @click="resolveItem(item, 'reject_delete')"
                    >
                      <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                    </button>
                    <button
                      v-if="item.authorIp"
                      type="button"
                      class="px-2.5 py-1 rounded text-[0.7rem] font-bold cursor-pointer border flex items-center gap-1 shadow-2xs transition-colors"
                      :class="item.isIpBanned
                        ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                        : 'bg-[#991b1b] hover:bg-[#7f1d1d] text-white border-transparent'"
                      :disabled="item.isIpBanned"
                      :title="item.isIpBanned ? 'Địa chỉ IP này đã bị cấm' : `Cấm địa chỉ IP ${item.authorIp}`"
                      @click="resolveItem(item, 'ban_ip')"
                    >
                      <i class="fa-solid fa-ban"></i>
                      <span>{{ item.isIpBanned ? 'Đã cấm IP' : 'Cấm IP' }}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Phân trang queue — server trả page/total/totalPages, không viết tay.
             Trang 1/1 không có gì để chuyển nên ẩn luôn. -->
        <div v-if="queueTotalPages > 1" class="flex items-center justify-between gap-3 px-1">
          <p class="text-xs text-[#667768]">
            Trang {{ queuePage }} / {{ queueTotalPages }} · {{ queueTotal }} mục
          </p>
          <div class="flex items-center gap-1">
            <button type="button" class="px-2.5 py-1 rounded-md text-xs font-semibold border border-[#d0ddd1] bg-white text-[#667768] hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed" :disabled="queuePage <= 1" @click="changeQueuePage(queuePage - 1)">
              <i class="fa-solid fa-angle-left mr-1"></i>Trang trước
            </button>
            <button type="button" class="px-2.5 py-1 rounded-md text-xs font-semibold border border-[#d0ddd1] bg-white text-[#667768] hover:bg-[#f0f7f1] disabled:opacity-40 disabled:cursor-not-allowed" :disabled="queuePage >= queueTotalPages" @click="changeQueuePage(queuePage + 1)">
              Trang sau<i class="fa-solid fa-angle-right ml-1"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- ─── TAB 3: QUY TẮC & TỪ KHÓA AN NINH (RULES ENGINE) ─── -->
      <div v-else-if="activeTab === 'rules'" class="flex flex-col gap-5">
        <!-- Add Rule Form -->
        <div class="rounded-xl border border-[#c8d6c9] bg-[#f0f7f1] p-4 flex flex-col gap-3 shadow-xs">
          <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
            <i class="fa-solid fa-plus-circle text-[#2c6e33]"></i>
            Thêm quy tắc / Từ khóa kiểm duyệt an ninh mới
          </h3>
          <form class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end" @submit.prevent="addRule">
            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815]">
              Nhóm vi phạm
              <select v-model="newRuleForm.category" class="rounded-lg border border-[#c8d6c9] px-2.5 py-2 text-xs bg-white">
                <option value="hostile_forces">Thế lực thù địch / Phản động</option>
                <option value="anti_state">Chống phá / Xuyên tạc chính sách</option>
                <option value="defamation">Bôi nhọ / Xúc phạm uy tín</option>
                <option value="spam_fraud">Spam / Cờ bạc / Lừa đảo</option>
                <option value="profanity">Từ ngữ thô tục</option>
                <option value="custom">Tùy biến</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815] lg:col-span-2">
              Từ khóa / Mẫu nhận diện (Pattern)
              <input
                v-model="newRuleForm.pattern"
                type="text"
                placeholder="Nhập từ khóa hoặc cụm từ vi phạm..."
                class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-xs bg-white outline-none focus:border-[#2c6e33]"
                required
              />
            </label>

            <label class="flex flex-col gap-1 text-xs font-bold text-[#122815]">
              Hành động xử lý
              <select v-model="newRuleForm.action" class="rounded-lg border border-[#c8d6c9] px-2.5 py-2 text-xs bg-white">
                <option value="auto_hide">Tự động ẩn ngay lập tức</option>
                <option value="flag_only">Chỉ gắn cờ cảnh báo</option>
              </select>
            </label>

            <button
              type="submit"
              class="px-4 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-xs font-bold cursor-pointer border-none shadow-xs"
            >
              + Thêm quy tắc
            </button>
          </form>
        </div>

        <!-- Rules List Table -->
        <div class="rounded-xl border border-[#e2ece3] bg-white overflow-x-auto shadow-xs">
          <table class="w-full text-xs">
            <thead class="bg-[#f7faf7] text-left">
              <tr>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Nhóm danh mục</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Từ khóa / Mẫu nhận diện</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Hành động</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Mức độ</th>
                <th class="px-3.5 py-3 font-bold text-[#122815]">Trạng thái</th>
                <th class="px-3.5 py-3 font-bold text-[#122815] text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rules" :key="r.id" class="border-t border-[#e2ece3] hover:bg-[#fcfdfc]">
                <td class="px-3.5 py-2.5 font-bold text-[#122815]">
                  {{ RULE_CATEGORY_LABELS[r.category] || r.category }}
                </td>
                <td class="px-3.5 py-2.5 font-mono text-[#b42318] font-bold">
                  "{{ r.pattern }}"
                </td>
                <td class="px-3.5 py-2.5">
                  <span class="px-2 py-0.5 rounded text-[0.68rem] font-bold" :class="r.action === 'auto_hide' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'">
                    {{ r.action === 'auto_hide' ? 'Tự động ẩn ngay' : 'Chỉ cảnh báo' }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5">
                  <span class="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase" :class="r.severity === 'critical' ? 'bg-red-600 text-white' : r.severity === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'">
                    {{ r.severity }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border"
                    :class="r.isEnabled ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'"
                    @click="toggleRule(r)"
                  >
                    {{ r.isEnabled ? 'Đang bật' : 'Đã tắt' }}
                  </button>
                </td>
                <td class="px-3.5 py-2.5 text-right">
                  <button
                    type="button"
                    class="text-xs text-[#b42318] hover:underline cursor-pointer border-none bg-transparent"
                    @click="deleteRule(r)"
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ─── TAB 4: TRẠNG THÁI WORKER & HỆ THỐNG (WORKER STATUS & RESTART) ─── -->
      <div v-else-if="activeTab === 'worker'" class="flex flex-col gap-5">
        <!-- Worker Status Banner -->
        <div
          class="rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
          :class="workerData?.status === 'active'
            ? 'border-[#8ed694] bg-[#f0f7f1]'
            : 'border-[#f1b8b5] bg-[#fff4f3]'"
        >
          <div class="flex items-center gap-3">
            <span
              class="w-10 h-10 rounded-full flex items-center justify-center text-white text-base shadow-xs"
              :class="workerData?.status === 'active' ? 'bg-[#2c6e33]' : 'bg-[#d12420]'"
            >
              <i :class="workerData?.status === 'active' ? 'fa-solid fa-shield-check' : 'fa-solid fa-triangle-exclamation'"></i>
            </span>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="m-0 text-base font-extrabold text-[#122815]">Moderation Worker: {{ workerData?.status === 'active' ? 'Đang hoạt động bình thường' : 'Có lỗi phát sinh' }}</h2>
                <span
                  class="px-2 py-0.5 rounded-full text-[0.68rem] font-bold uppercase tracking-wider"
                  :class="workerData?.status === 'active' ? 'bg-[#2c6e33] text-white' : 'bg-[#d12420] text-white'"
                >
                  {{ workerData?.status === 'active' ? 'HEALTHY' : 'DEGRADED' }}
                </span>
              </div>
              <p class="m-0 mt-0.5 text-xs text-[#667768]">
                Thời gian hoạt động liên tục: <strong class="text-[#122815]">{{ formatUptime(workerData?.uptimeSeconds || 0) }}</strong>
                • Khởi động lúc: {{ formatTime(workerData?.startedAt || null) }}
              </p>
            </div>
          </div>

          <button
            type="button"
            class="px-3 py-1.5 rounded-lg border border-[#c8d6c9] bg-white text-xs font-bold text-[#1e4620] hover:bg-[#f0f7f1] transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
            :disabled="workerLoading"
            @click="loadWorkerStatus"
          >
            <i class="fa-solid fa-rotate text-xs" :class="workerLoading ? 'animate-spin' : ''"></i>
            <span>Cập nhật số liệu</span>
          </button>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-1 shadow-xs">
            <span class="text-xs font-semibold text-[#667768]">Tổng lượt quét an ninh</span>
            <span class="text-2xl font-extrabold text-[#122815]">{{ workerData?.totalScanned ?? 0 }}</span>
            <span class="text-[0.7rem] text-[#2c6e33] font-medium">Bình luận, chat, livestream</span>
          </div>

          <div class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-1 shadow-xs">
            <span class="text-xs font-semibold text-[#667768]">Chặn tức thì (0ms)</span>
            <span class="text-2xl font-extrabold text-[#d12420]">{{ workerData?.blockedInstant ?? 0 }}</span>
            <span class="text-[0.7rem] text-[#667768]">Từ khóa thô tục, chống phá</span>
          </div>

          <div class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-1 shadow-xs">
            <span class="text-xs font-semibold text-[#667768]">Chặn bởi AI ngữ cảnh</span>
            <span class="text-2xl font-extrabold text-[#b78103]">{{ workerData?.blockedAi ?? 0 }}</span>
            <span class="text-[0.7rem] text-[#667768]">Độ trễ AI: ~{{ workerData?.lastAiLatencyMs ?? 0 }}ms</span>
          </div>

          <div class="rounded-xl border border-[#e2ece3] bg-white p-4 flex flex-col gap-1 shadow-xs">
            <span class="text-xs font-semibold text-[#667768]">Nội dung an toàn</span>
            <span class="text-2xl font-extrabold text-[#2c6e33]">{{ workerData?.allowedCount ?? 0 }}</span>
            <span class="text-[0.7rem] text-[#667768]">Cho phép hiển thị công khai</span>
          </div>
        </div>

        <!-- System Resources & Diagnostics -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3 shadow-xs">
            <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
              <i class="fa-solid fa-microchip text-[#2c6e33]"></i>
              Bộ nhớ & Hạ tầng Worker
            </h3>
            <div class="flex flex-col gap-2 text-xs">
              <div class="flex items-center justify-between py-1 border-b border-[#e2ece3]">
                <span class="text-[#667768]">Bộ nhớ RAM Heap (Đang dùng / Cấp phát):</span>
                <span class="font-bold text-[#122815]">{{ workerData?.memoryUsageMb?.heapUsed ?? 0 }} MB / {{ workerData?.memoryUsageMb?.heapTotal ?? 0 }} MB</span>
              </div>
              <div class="flex items-center justify-between py-1 border-b border-[#e2ece3]">
                <span class="text-[#667768]">Bộ nhớ RAM tiến trình (RSS):</span>
                <span class="font-bold text-[#122815]">{{ workerData?.memoryUsageMb?.rss ?? 0 }} MB</span>
              </div>
              <div class="flex items-center justify-between py-1 border-b border-[#e2ece3]">
                <span class="text-[#667768]">Mô hình AI kiểm duyệt:</span>
                <span class="font-bold text-[#2c6e33]">{{ workerData?.aiProvider }} / {{ workerData?.aiModel }} ({{ workerData?.aiServiceActive ? 'Đang hoạt động' : 'Tắt' }})</span>
              </div>
              <div class="flex items-center justify-between py-1">
                <span class="text-[#667768]">Quy tắc trong bộ nhớ đệm:</span>
                <span class="font-bold text-[#122815]">{{ workerData?.cachedRulesCount ?? 0 }} quy tắc</span>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3 shadow-xs">
            <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
              <i class="fa-solid fa-heart-pulse text-[#d12420]"></i>
              Nhật ký chẩn đoán & Sức khỏe
            </h3>
            <div class="flex flex-col gap-2 text-xs">
              <div class="flex items-center justify-between py-1 border-b border-[#e2ece3]">
                <span class="text-[#667768]">Số lỗi kiểm duyệt phát sinh:</span>
                <span class="font-bold" :class="workerData?.errorCount ? 'text-[#d12420]' : 'text-[#2c6e33]'">{{ workerData?.errorCount ?? 0 }} lần</span>
              </div>
              <div class="flex items-center justify-between py-1 border-b border-[#e2ece3]">
                <span class="text-[#667768]">Lần quét gần nhất:</span>
                <span class="font-bold text-[#122815]">{{ formatTime(workerData?.lastScannedAt || null) }}</span>
              </div>
              <div class="flex items-center justify-between py-1">
                <span class="text-[#667768]">Lỗi gần nhất:</span>
                <span class="font-medium text-[#667768] truncate max-w-[240px]">{{ workerData?.lastError || 'Không có lỗi' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Emergency Actions Card -->
        <div class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-4 shadow-xs">
          <div>
            <h3 class="m-0 text-sm font-extrabold text-[#122815] flex items-center gap-2">
              <i class="fa-solid fa-wrench text-[#2c6e33]"></i>
              Thao tác Khẩn cấp & Khởi động lại
            </h3>
            <p class="m-0 mt-1 text-xs text-[#667768]">Các công cụ quản trị giúp phục hồi hệ thống khi phát hiện lỗi hoặc dọn dẹp nội dung xấu độc còn sót.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <!-- Rescan All -->
            <div class="rounded-lg border border-[#c8d6c9] bg-[#f8faf8] p-4 flex flex-col justify-between gap-3">
              <div>
                <h4 class="m-0 text-xs font-bold text-[#1e4620] flex items-center gap-1.5">
                  <i class="fa-solid fa-broom"></i> Quét & Dọn sạch nội dung cũ
                </h4>
                <p class="m-0 mt-1 text-[0.72rem] text-[#667768]">
                  Rà soát lại toàn bộ bình luận bài viết, video và tin chat trực tiếp trong CSDL. Tự động ẩn hoặc xóa mọi nội dung vi phạm.
                </p>
              </div>
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 border-none"
                :disabled="rescanning"
                @click="triggerRescanAll"
              >
                <i class="fa-solid fa-play text-xs" :class="rescanning ? 'animate-spin' : ''"></i>
                <span>{{ rescanning ? 'Đang quét...' : 'Quét & Dọn ngay' }}</span>
              </button>
            </div>

            <!-- Restart Worker -->
            <div class="rounded-lg border border-[#e2ece3] bg-[#fcfdfc] p-4 flex flex-col justify-between gap-3">
              <div>
                <h4 class="m-0 text-xs font-bold text-[#122815] flex items-center gap-1.5">
                  <i class="fa-solid fa-arrows-rotate"></i> Khởi động lại Worker
                </h4>
                <p class="m-0 mt-1 text-[0.72rem] text-[#667768]">
                  Làm mới bộ đệm quy tắc trong RAM, đặt lại bộ đếm lỗi và kết nối lại AI Gateway mà không làm gián đoạn website.
                </p>
              </div>
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg border border-[#2c6e33] bg-white text-[#2c6e33] hover:bg-[#f0f7f1] text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                :disabled="restartingWorker"
                @click="triggerRestartWorker"
              >
                <i class="fa-solid fa-rotate text-xs" :class="restartingWorker ? 'animate-spin' : ''"></i>
                <span>{{ restartingWorker ? 'Đang khởi động...' : 'Khởi động lại Worker' }}</span>
              </button>
            </div>

            <!-- Restart Server Process -->
            <div class="rounded-lg border border-[#f1b8b5] bg-[#fff5f4] p-4 flex flex-col justify-between gap-3">
              <div>
                <h4 class="m-0 text-xs font-bold text-[#d12420] flex items-center gap-1.5">
                  <i class="fa-solid fa-power-off"></i> Khởi động lại Website
                </h4>
                <p class="m-0 mt-1 text-[0.72rem] text-[#8c231f]">
                  Khởi động lại toàn bộ tiến trình máy chủ website (process exit / supervisor restart). Website gián đoạn 3-5 giây.
                </p>
              </div>
              <button
                type="button"
                class="w-full px-3 py-2 rounded-lg bg-[#d12420] hover:bg-[#a81c19] text-white text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 border-none"
                :disabled="restartingServer"
                @click="triggerRestartServer"
              >
                <i class="fa-solid fa-power-off text-xs" :class="restartingServer ? 'animate-spin' : ''"></i>
                <span>{{ restartingServer ? 'Đang khởi động lại...' : 'Khởi động lại Website' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()

type TabKey = 'settings' | 'queue' | 'rules' | 'worker'
const activeTab = ref<TabKey>('settings')

const loading = ref(true)
const error = ref('')
const saving = ref(false)

const form = reactive({
  enabled: true,
  mode: 'ai' as 'ai' | 'keyword_only',
  provider: 'delify',
  model: 'delify-5.5',
  systemPrompt: '',
  defaultSystemPrompt: '',
})

interface ProviderOption {
  provider: string
  label: string
  isActive: boolean
}

interface ModelPricingOption {
  model: string
  provider: string
  label: string | null
  promptCostPerMillion: number
  completionCostPerMillion: number
}

const activeProviders = ref<ProviderOption[]>([])
const activeModels = ref<ModelPricingOption[]>([])

const activeModelsForCurrentProvider = computed(() => {
  return activeModels.value.filter(m => m.provider === form.provider)
})

interface ModerationRule {
  id: number
  category: string
  ruleType: string
  pattern: string
  action: string
  severity: string
  isEnabled: boolean
  createdAt: string
}

interface ModerationQueueItem {
  id: number
  targetType: string
  targetId: number | null
  authorName: string | null
  authorIp: string | null
  contentSnippet: string
  flaggedReason: string
  matchedRules: string[] | null
  severity: string
  status: string
  contextTitle?: string | null
  contextUrl?: string | null
  sessionId?: string | null
  isIpBanned?: boolean
  createdAt: string
}

const rules = ref<ModerationRule[]>([])
const queue = ref<ModerationQueueItem[]>([])
const queueStatusFilter = ref('pending')
// Phân trang queue — trang 1/perPage 20 mặc định. Server nay trả page/total/totalPages.
const queuePage = ref(1)
const queuePerPage = ref(20)
const queueTotalPages = ref(1)
const queueTotal = ref(0)

const pendingQueueCount = computed(() => queue.value.filter(q => q.status === 'pending').length)

const newRuleForm = reactive({
  category: 'hostile_forces',
  ruleType: 'keyword',
  pattern: '',
  action: 'auto_hide',
  severity: 'critical',
})

const RULE_CATEGORY_LABELS: Record<string, string> = {
  hostile_forces: 'Thế lực thù địch / Phản động',
  anti_state: 'Chống phá / Xuyên tạc chính sách',
  defamation: 'Bôi nhọ / Xúc phạm uy tín',
  spam_fraud: 'Spam / Cờ bạc / Lừa đảo',
  profanity: 'Từ ngữ thô tục',
  custom: 'Tùy biến',
}

function restoreDefaultPrompt() {
  form.systemPrompt = form.defaultSystemPrompt
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

async function loadSettings() {
  const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
    ok: boolean
    settings: typeof form
    activeProviders: ProviderOption[]
    activeModels: ModelPricingOption[]
  }>)('/api/admin/ai/moderation/settings')

  form.enabled = res.settings.enabled
  form.mode = res.settings.mode
  form.provider = res.settings.provider
  form.model = res.settings.model
  form.systemPrompt = res.settings.systemPrompt
  form.defaultSystemPrompt = res.settings.defaultSystemPrompt

  activeProviders.value = res.activeProviders
  activeModels.value = res.activeModels
}

async function loadQueue() {
  const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: ModerationQueueItem[]; page: number; perPage: number; total: number; totalPages: number }>)('/api/admin/ai/moderation/queue', {
    params: { status: queueStatusFilter.value, page: queuePage.value, perPage: queuePerPage.value },
  })
  queue.value = res.items
  queuePage.value = res.page
  queuePerPage.value = res.perPage
  queueTotal.value = res.total
  queueTotalPages.value = res.totalPages
}

async function changeQueuePage(p: number) {
  if (p < 1 || p > queueTotalPages.value || p === queuePage.value) return
  queuePage.value = p
  await loadQueue()
}

async function loadRules() {
  const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; rules: ModerationRule[] }>)(`/api/admin/ai/moderation/rules`)
  rules.value = res.rules
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadSettings(), loadQueue(), loadRules(), loadWorkerStatus()])
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không thể tải cấu hình kiểm duyệt an ninh.')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/ai/moderation/settings', {
      method: 'PUT',
      body: {
        enabled: form.enabled,
        mode: form.mode,
        provider: form.provider,
        model: form.model,
        systemPrompt: form.systemPrompt,
      },
    })
    toast.success('Đã lưu cấu hình kiểm duyệt an ninh!')
    await loadSettings()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu cấu hình.'))
  } finally {
    saving.value = false
  }
}

async function addRule() {
  if (!newRuleForm.pattern.trim()) {
    toast.warning('Vui lòng nhập từ khóa hoặc mẫu nhận diện.')
    return
  }
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/ai/moderation/rules', {
      method: 'POST',
      body: newRuleForm,
    })
    toast.success('Đã thêm quy tắc an ninh mới!')
    newRuleForm.pattern = ''
    await loadRules()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể thêm quy tắc.'))
  }
}

async function toggleRule(rule: ModerationRule) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/rules/${rule.id}`, {
      method: 'PUT',
      body: { isEnabled: !rule.isEnabled },
    })
    rule.isEnabled = !rule.isEnabled
    toast.success(`Đã ${rule.isEnabled ? 'bật' : 'tắt'} quy tắc.`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể cập nhật quy tắc.'))
  }
}

async function deleteRule(rule: ModerationRule) {
  const ok = await confirm({
    title: 'Xóa quy tắc kiểm duyệt',
    message: `Bạn có chắc muốn xóa quy tắc "${rule.pattern}"?`,
    confirmText: 'Xóa',
    tone: 'danger',
  })
  if (!ok) return

  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/rules/${rule.id}`, { method: 'DELETE' })
    toast.success('Đã xóa quy tắc.')
    await loadRules()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xóa quy tắc.'))
  }
}

async function resolveItem(item: ModerationQueueItem, action: 'approve' | 'reject_delete' | 'ban_ip') {
  let confirmMsg = 'Xác nhận xử lý?'
  if (action === 'approve') confirmMsg = 'Xác nhận nội dung này an toàn và hiển thị công khai lại?'
  else if (action === 'reject_delete') confirmMsg = 'Xác nhận nội dung vi phạm và xóa vĩnh viễn?'
  else if (action === 'ban_ip') confirmMsg = `Xác nhận xóa nội dung và CẤM vĩnh viễn địa chỉ IP ${item.authorIp}?`

  const ok = await confirm({
    title: 'Xử lý đối soát an ninh',
    message: confirmMsg,
    confirmText: action === 'approve' ? 'Duyệt an toàn' : action === 'ban_ip' ? 'Cấm IP' : 'Xóa vĩnh viễn',
    tone: action === 'approve' ? 'primary' : 'danger',
  })
  if (!ok) return

  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/ai/moderation/queue/${item.id}/resolve`, {
      method: 'POST',
      body: { action },
    })
    toast.success('Đã xử lý đối soát thành công!')
    await loadQueue()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xử lý đối soát.'))
  }
}

// ─── TAB 4: WORKER STATUS & EMERGENCY ACTIONS ───────────────────────────
interface WorkerStatusData {
  status: 'active' | 'degraded' | 'idle'
  startedAt: string
  uptimeSeconds: number
  totalScanned: number
  blockedInstant: number
  blockedAi: number
  allowedCount: number
  errorCount: number
  lastScannedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastAiLatencyMs: number
  pendingQueueCount: number
  cachedRulesCount: number
  aiServiceActive: boolean
  aiProvider: string
  aiModel: string
  memoryUsageMb: {
    heapUsed: number
    heapTotal: number
    rss: number
  }
}

const workerData = ref<WorkerStatusData | null>(null)
const workerLoading = ref(false)
const rescanning = ref(false)
const restartingWorker = ref(false)
const restartingServer = ref(false)

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 60) return `${seconds || 0} giây`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} phút ${seconds % 60} giây`
  const hours = Math.floor(mins / 60)
  return `${hours} giờ ${mins % 60} phút`
}

async function loadWorkerStatus() {
  workerLoading.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; worker: WorkerStatusData }>)(`/api/admin/ai/moderation/worker-status`)
    if (res.ok) {
      workerData.value = res.worker
    }
  } catch {
    // Non-blocking status lookup
  } finally {
    workerLoading.value = false
  }
}

async function triggerRestartWorker() {
  const ok = await confirm({
    title: 'Khởi động lại Moderation Worker',
    message: 'Khởi động lại worker sẽ làm mới bộ đệm quy tắc trong RAM và đặt lại bộ đếm lỗi. Tiếp tục?',
    confirmText: 'Khởi động lại Worker',
    tone: 'primary',
  })
  if (!ok) return

  restartingWorker.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>)(`/api/admin/ai/moderation/restart-worker`, { method: "POST" })
    toast.success(res.message || 'Đã khởi động lại Moderation Worker.')
    await loadWorkerStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể khởi động lại worker.'))
  } finally {
    restartingWorker.value = false
  }
}

async function triggerRescanAll() {
  const ok = await confirm({
    title: 'Quét & dọn sạch nội dung bẩn cũ',
    message: 'Hệ thống sẽ quét lại toàn bộ bình luận bài viết, video và tin chat trực tiếp hiện có trong CSDL bằng bộ lọc tức thì. Mọi nội dung vi phạm sẽ được tự động ẩn hoặc xóa ngay lập tức. Tiếp tục?',
    confirmText: 'Bắt đầu quét & dọn dẹp',
    tone: 'danger',
  })
  if (!ok) return

  rescanning.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>)(`/api/admin/ai/moderation/rescan-all`, { method: "POST" })
    toast.success(res.message)
    await Promise.all([loadWorkerStatus(), loadQueue()])
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể quét lại nội dung.'))
  } finally {
    rescanning.value = false
  }
}

async function triggerRestartServer() {
  const ok = await confirm({
    title: 'Khởi động lại máy chủ Website',
    message: 'CẢNH BÁO: Thao tác này sẽ gửi tín hiệu khởi động lại tiến trình máy chủ website (process restart). Website có thể gián đoạn trong 3-5 giây. Bạn có chắc chắn?',
    confirmText: 'Khởi động lại Website',
    tone: 'danger',
  })
  if (!ok) return

  restartingServer.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>)(`/api/admin/ai/moderation/restart-server`, { method: "POST" })
    toast.success(res.message)
    setTimeout(() => {
      window.location.replace('/admin/ai/moderation')
    }, 4000)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể gửi lệnh khởi động lại.'))
    restartingServer.value = false
  }
}

onMounted(loadData)
</script>
