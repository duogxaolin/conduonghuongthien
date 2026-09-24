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
        v-for="t in [
          { key: 'settings', label: '⚙️ Cài đặt Kiểm duyệt AI', icon: 'fa-solid fa-sliders' },
          { key: 'queue', label: '📥 Sổ đối soát nội dung bị ẩn', icon: 'fa-solid fa-inbox', badge: pendingQueueCount },
          { key: 'rules', label: '📋 Quy tắc & Từ khóa an ninh', icon: 'fa-solid fa-list-check', count: rules.length },
        ]"
        :key="t.key"
        type="button"
        class="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border"
        :class="activeTab === t.key
          ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-xs'
          : 'bg-white text-[#667768] border-transparent hover:bg-[#f0f7f1] hover:text-[#1e4620]'"
        @click="activeTab = t.key as any"
      >
        <span>{{ t.label }}</span>
        <span v-if="t.badge" class="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[0.65rem] font-black">
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
            @click="queueStatusFilter = s.key; loadQueue()"
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
                <th class="px-3.5 py-3 font-bold text-[#122815]">Nguồn</th>
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
                <td class="px-3.5 py-2.5 whitespace-nowrap">
                  <span class="px-2 py-0.5 rounded font-bold uppercase text-[0.65rem]" :class="item.targetType === 'comment' ? 'bg-blue-100 text-blue-800' : item.targetType === 'chat' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'">
                    {{ item.targetType === 'comment' ? 'Bình luận' : item.targetType === 'chat' ? 'Chat AI' : 'Bài viết' }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5 whitespace-nowrap">
                  <strong class="text-[#122815]">{{ item.authorName || 'Khách' }}</strong>
                  <span v-if="item.authorIp" class="block text-[0.68rem] text-[#667768] font-mono">{{ item.authorIp }}</span>
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
                  <div v-if="item.status === 'pending'" class="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      class="px-2 py-1 rounded bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.7rem] font-bold cursor-pointer border-none"
                      title="Duyệt an toàn và cho phép hiển thị lại"
                      @click="resolveItem(item, 'approve')"
                    >
                      <i class="fa-solid fa-check mr-1"></i> Bỏ ẩn
                    </button>
                    <button
                      type="button"
                      class="px-2 py-1 rounded bg-[#fee2e2] hover:bg-[#fca5a5] text-[#b42318] text-[0.7rem] font-bold cursor-pointer border-none"
                      title="Xóa vĩnh viễn nội dung vi phạm"
                      @click="resolveItem(item, 'reject_delete')"
                    >
                      <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                    </button>
                    <button
                      v-if="item.authorIp"
                      type="button"
                      class="px-2 py-1 rounded bg-black hover:bg-gray-800 text-white text-[0.7rem] font-bold cursor-pointer border-none"
                      title="Cấm địa chỉ IP này vĩnh viễn"
                      @click="resolveItem(item, 'ban_ip')"
                    >
                      <i class="fa-solid fa-ban mr-1"></i> Cấm IP
                    </button>
                  </div>
                  <span v-else class="text-[#9ca3af] text-xs">Đã xử lý</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ─── TAB 3: QUY TẮC & TỪ KHÓA AN NINH (RULES ENGINE) ─── -->
      <div v-else class="flex flex-col gap-5">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()

type TabKey = 'settings' | 'queue' | 'rules'
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
  createdAt: string
}

const rules = ref<ModerationRule[]>([])
const queue = ref<ModerationQueueItem[]>([])
const queueStatusFilter = ref('pending')

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
  const res = await $fetch<{
    ok: boolean
    settings: typeof form
    activeProviders: ProviderOption[]
    activeModels: ModelPricingOption[]
  }>('/api/admin/ai/moderation/settings')

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
  const res = await $fetch<{ ok: boolean; items: ModerationQueueItem[] }>('/api/admin/ai/moderation/queue', {
    params: { status: queueStatusFilter.value },
  })
  queue.value = res.items
}

async function loadRules() {
  const res = await $fetch<{ ok: boolean; rules: ModerationRule[] }>('/api/admin/ai/moderation/rules')
  rules.value = res.rules
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([loadSettings(), loadQueue(), loadRules()])
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không thể tải cấu hình kiểm duyệt an ninh.')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    await $fetch('/api/admin/ai/moderation/settings', {
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
    await $fetch('/api/admin/ai/moderation/rules', {
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
    await $fetch(`/api/admin/ai/moderation/rules/${rule.id}`, {
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
    await $fetch(`/api/admin/ai/moderation/rules/${rule.id}`, { method: 'DELETE' })
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
    await $fetch(`/api/admin/ai/moderation/queue/${item.id}/resolve`, {
      method: 'POST',
      body: { action },
    })
    toast.success('Đã xử lý đối soát thành công!')
    await loadQueue()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xử lý đối soát.'))
  }
}

onMounted(loadData)
</script>
