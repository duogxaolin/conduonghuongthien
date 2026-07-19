<template>
  <div class="app-layout" :class="fontSizeClass">
    <!-- Mobile Menu Overlay -->
    <div class="mobile-menu-overlay" :class="{ 'is-show': isMobileMenuOpen }" @click="toggleMobileMenu"></div>
    
    <!-- Top Bar -->
    <div class="top-bar">
      <div class="container top-bar-content">
        <div class="top-left">
          <span>📞 Hotline: 0903.480.985</span>
        </div>
        <div class="top-right">
          <!-- Language Switcher -->
          <div class="lang-switcher">
            <button :class="{ active: currentLang === 'VN' }" @click="setLang('VN')">VN</button>
            <button :class="{ active: currentLang === 'EN' }" @click="setLang('EN')">EN</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Header -->
    <header class="main-header" :class="{ 'is-sticky': isSticky }">
      <!-- Dòng 1: Logo & Các nút hành động nhanh -->
      <div class="header-top-row">
        <div class="container header-top-container">
          <!-- Logo Area -->
          <nuxt-link to="/" class="logo-area">
            <div class="logo-icon-wrap">
              <img class="logo-img-ref" src="/Logo.png" alt="Logo Con Đường Hướng Thiện" />
            </div>
            <div class="logo-text">
              <h1 class="logo-title">CON ĐƯỜNG HƯỚNG THIỆN</h1>
              <p class="logo-subtitle">Cổng thông tin điện tử hỗ trợ tái hòa nhập cộng đồng — Bộ Công an</p>
            </div>
          </nuxt-link>

          <!-- Top Actions -->
          <div class="header-top-actions">
            <button class="search-btn-toggle" @click="toggleSearch" :class="{ 'is-active': isSearchActive }" :aria-label="isSearchActive ? 'Đóng ô tìm kiếm' : 'Mở ô tìm kiếm'" :aria-expanded="isSearchActive">
              {{ isSearchActive ? '×' : '🔍' }}
            </button>
            <nuxt-link to="/lien-he" class="btn btn-primary btn-support-247">
              <span class="pulse-icon"></span> {{ t('support_247') }}
            </nuxt-link>
            <!-- Mobile Toggle -->
            <button class="menu-toggle" :class="{ 'is-hidden': isMobileMenuOpen }" @click="toggleMobileMenu" aria-label="Mở menu">
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Dòng 2: Thanh Menu Điều hướng -->
      <div class="header-nav-row" :class="{ 'nav-sticky': isSticky }">
        <div class="container nav-container">
          <nav class="main-nav" :class="{ 'is-open': isMobileMenuOpen }" @click="onNavClick" @keydown.escape="toggleMobileMenu">
            <!-- Modern Drawer Header -->
            <div class="mobile-drawer-head">
              <div class="drawer-brand-box">
                <img class="drawer-logo-img" src="/Logo.png" alt="Logo Con Đường Hướng Thiện" />
                <div class="drawer-brand-info">
                  <span class="drawer-brand-name">CON ĐƯỜNG HƯỚNG THIỆN</span>
                  <span class="drawer-brand-sub">Cổng thông tin điện tử C11 - Bộ Công an</span>
                </div>
              </div>
              <button class="drawer-close" @click.stop="toggleMobileMenu" aria-label="Đóng menu">
                ✕
              </button>
            </div>

            <!-- Drawer Controls Row (Đổi ngôn ngữ & Cỡ chữ trên Mobile) -->
            <div class="drawer-controls-row">
              <div class="drawer-ctrl-item">
                <span class="drawer-ctrl-label">{{ t('font_size') }}</span>
                <div class="accessibility-ctrl">
                  <button @click="changeFontSize('small')" :class="{ active: fontSize === 'small' }">A-</button>
                  <button @click="changeFontSize('normal')" :class="{ active: fontSize === 'normal' }">A</button>
                  <button @click="changeFontSize('large')" :class="{ active: fontSize === 'large' }">A+</button>
                </div>
              </div>
              <div class="drawer-ctrl-item">
                <div class="lang-switcher">
                  <button :class="{ active: currentLang === 'VN' }" @click="setLang('VN')">VN</button>
                  <button :class="{ active: currentLang === 'EN' }" @click="setLang('EN')">EN</button>
                </div>
              </div>
            </div>

            <!-- Drawer Search Bar -->
            <div class="drawer-search-wrap">
              <div class="drawer-search-box">
                <span class="search-icon">🔍</span>
                <input
                  type="text"
                  :placeholder="t('search_placeholder')"
                  v-model="searchQuery"
                  @keyup.enter="handleSearch"
                />
                <button v-if="searchQuery" class="clear-search-btn" @click="searchQuery = ''">✕</button>
              </div>
            </div>

            <!-- Drawer Links -->
            <div class="drawer-body">
              <ul class="nav-links">
                <li><nuxt-link to="/" class="nav-item" active-class="active-item">{{ t('home') }}</nuxt-link></li>
                <li><nuxt-link to="/gioi-thieu" class="nav-item" active-class="active-item">{{ t('about') }}</nuxt-link></li>
                
                <!-- Dropdown Menu Bản tin -->
                <li class="has-dropdown" :class="{ 'is-mobile-expanded': showDropdown }" @mouseenter="showDropdown = true" @mouseleave="showDropdown = false">
                  <div class="nav-item nav-item-dropdown" @click.stop="toggleMobileSubmenu('news')">
                    <nuxt-link to="/ban-tin" active-class="active-item" @click.stop>{{ t('news') }}</nuxt-link>
                    <span class="arrow" :class="{ 'is-rotated': showDropdown }">▼</span>
                  </div>
                  <ul class="dropdown-menu" :class="{ 'is-show': showDropdown }">
                    <li><nuxt-link to="/ban-tin/tin-noi-bat">{{ t('news_featured') }}</nuxt-link></li>
                    <li><nuxt-link to="/ban-tin/tin-hoat-dong">{{ t('news_activities') }}</nuxt-link></li>
                    <li><nuxt-link to="/ban-tin/tin-dia-phuong">{{ t('news_local') }}</nuxt-link></li>
                  </ul>
                </li>

                <li><nuxt-link to="/tamguongtieubieu" class="nav-item" active-class="active-item">{{ t('role_models') }}</nuxt-link></li>
                <li><nuxt-link to="/mohinhtaihoanhap" class="nav-item" active-class="active-item">{{ t('reintegration') }}</nuxt-link></li>
                <li><nuxt-link to="/van-ban" class="nav-item" active-class="active-item">{{ t('documents') }}</nuxt-link></li>
                
                <!-- Dropdown Menu Thư viện -->
                <li class="has-dropdown" :class="{ 'is-mobile-expanded': showLibraryDropdown }" @mouseenter="showLibraryDropdown = true" @mouseleave="showLibraryDropdown = false">
                  <div class="nav-item nav-item-dropdown" @click.stop="toggleMobileSubmenu('library')">
                    <span class="cursor-pointer">{{ t('library') }}</span>
                    <span class="arrow" :class="{ 'is-rotated': showLibraryDropdown }">▼</span>
                  </div>
                  <ul class="dropdown-menu" :class="{ 'is-show': showLibraryDropdown }">
                    <li><a href="#video-library">{{ t('video_lib') }}</a></li>
                    <li><a href="#photo-library">{{ t('photo_lib') }}</a></li>
                  </ul>
                </li>

                <li><nuxt-link to="/giai-dap-phap-luat" class="nav-item" active-class="active-item">{{ t('faq') }}</nuxt-link></li>
                
                <!-- Dropdown Bộ với công dân -->
                <li class="has-dropdown" :class="{ 'is-mobile-expanded': showGovDropdown }" @mouseenter="showGovDropdown = true" @mouseleave="showGovDropdown = false">
                  <div class="nav-item nav-item-dropdown" @click.stop="toggleMobileSubmenu('gov')">
                    <span class="cursor-pointer">{{ t('gov_citizen') }}</span>
                    <span class="arrow" :class="{ 'is-rotated': showGovDropdown }">▼</span>
                  </div>
                  <ul class="dropdown-menu" :class="{ 'is-show': showGovDropdown }">
                    <li><a href="#tro-giup">{{ t('register_help') }}</a></li>
                    <li><nuxt-link to="/van-ban">{{ t('procedures') }}</nuxt-link></li>
                  </ul>
                </li>

                <li><nuxt-link to="/lien-he" class="nav-item" active-class="active-item">{{ t('contact') }}</nuxt-link></li>
              </ul>

              <!-- Drawer Footer Quick Actions -->
              <div class="mobile-drawer-footer">
                <a href="tel:0903480985" class="drawer-hotline-card">
                  <span class="hotline-icon-wrap">📞</span>
                  <div class="hotline-text">
                    <span class="hotline-lbl">Hotline Tư Vấn 24/7</span>
                    <span class="hotline-num">0903.480.985</span>
                  </div>
                </a>
                <nuxt-link to="/lien-he" class="btn btn-primary drawer-support-btn" @click="isMobileMenuOpen = false">
                  <span class="pulse-icon"></span> Đăng ký tư vấn ngay
                </nuxt-link>
              </div>
            </div>
          </nav>
        </div>
      </div>

      <!-- Search Dropdown Bar -->
      <transition name="slide-down">
        <div class="search-dropdown-bar" v-if="isSearchActive">
          <div class="container search-dropdown-container">
            <div class="search-input-wrap">
              <span class="search-input-icon">🔍</span>
              <input
                type="text"
                placeholder="Nhập nội dung cần tìm kiếm trên website..."
                v-model="searchQuery"
                @keyup.enter="handleSearch"
                ref="searchInputRef"
              />
            </div>
            <div class="search-bar-buttons">
              <button class="search-dropdown-submit" @click="handleSearch">Tìm kiếm</button>
              <button class="search-dropdown-close" @click="toggleSearch">Đóng ×</button>
            </div>
          </div>
        </div>
      </transition>
    </header>

    <!-- Main Content Area -->
    <main class="main-content" :class="[fontSizeClass, { 'has-sticky-padding': isSticky }]">
      <slot />
    </main>

    <!-- Footer Area -->
    <footer class="main-footer">
      <div class="container footer-grid">
        <div class="footer-col-about">
          <div class="footer-logo">
            <img class="footer-logo-img" src="/Logo.png" alt="Logo Con Đường Hướng Thiện" />
            <span class="footer-logo-title">CON ĐƯỜNG HƯỚNG THIỆN</span>
          </div>
          <p class="footer-desc">
            Trang thông tin điện tử dưới sự chỉ đạo sát sao của Bộ Công an, Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11).
          </p>
        </div>

        <div class="footer-col-links">
          <h3 class="footer-col-title">Liên kết chính</h3>
          <ul>
            <li><nuxt-link to="/">Trang chủ</nuxt-link></li>
            <li><nuxt-link to="/gioi-thieu">Giới thiệu ban biên tập</nuxt-link></li>
            <li><nuxt-link to="/ban-tin">Bản tin hoạt động</nuxt-link></li>
            <li><nuxt-link to="/van-ban">Văn bản pháp luật mới</nuxt-link></li>
          </ul>
        </div>

        <div class="footer-col-links">
          <h3 class="footer-col-title">Tái hòa nhập</h3>
          <ul>
            <li><nuxt-link to="/tamguongtieubieu">Tấm gương tiêu biểu hoàn lương</nuxt-link></li>
            <li><nuxt-link to="/mohinhtaihoanhap">Các mô hình kinh tế hỗ trợ</nuxt-link></li>
            <li><nuxt-link to="/giai-dap-phap-luat">Giải đáp pháp luật trực tuyến</nuxt-link></li>
            <li><nuxt-link to="/lien-he">Thông tin đường dây nóng</nuxt-link></li>
          </ul>
        </div>

        <div class="footer-col-contact">
          <h3 class="footer-col-title">Thông tin liên hệ</h3>
          <p><strong>Cơ quan chủ quản:</strong> C11 - Bộ Công an</p>
          <p><strong>Địa chỉ:</strong> Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội</p>
          <p><strong>Điện thoại:</strong> 0903.480.985</p>
          <p><strong>Email:</strong> contact@conduonghuongthien.com.vn</p>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="container footer-bottom-content">
          <p>&copy; 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.</p>
          <p><a href="https://www.facebook.com/hi.duogxaolin" target="_blank" rel="noopener noreferrer" class="designer-link">Design by Delify.vn</a></p>
        </div>
      </div>
    </footer>

    <!-- Chatbot Popup (Trợ Lý Pháp Lý C11 Minimalist) -->
    <div class="chatbot-popup" :class="{ 'is-open': isChatbotOpen }">
      <div class="chatbot-header">
        <div class="chatbot-title">
          <div class="minimal-bot-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e4620" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="bot-header-meta">
            <h4>Trợ lý Pháp lý C11</h4>
            <p><span class="status-dot-green"></span> Sẵn sàng giải đáp 24/7</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="clear-history-btn" @click="clearChatHistory" title="Xóa lịch sử trò chuyện" aria-label="Xóa lịch sử">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <button class="close-bot-btn" @click="toggleChatbot" aria-label="Đóng cửa sổ">✕</button>
        </div>
      </div>

      <div class="chatbot-messages" ref="chatContainer">
        <div v-for="(msg, index) in chatMessages" :key="index" class="chat-msg" :class="msg.sender">
          <div v-if="msg.sender === 'bot'" class="msg-bot-avatar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e4620" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="msg-bubble">
            <div class="markdown-content" v-html="renderMarkdown(msg.text)"></div>
            <span v-if="msg.isStreaming" class="streaming-cursor">▌</span>
          </div>
        </div>
      </div>

      <!-- Quick Questions -->
      <div class="chatbot-quick-questions">
        <button 
          v-for="(q, index) in chatbotFaqs" 
          :key="index" 
          @click="askBot(q.question, q.answer)"
          class="quick-q-btn"
        >
          {{ q.label }}
        </button>
      </div>

      <div class="chatbot-input-area">
        <input 
          type="text" 
          placeholder="Hỏi trợ lý về QĐ 22, thủ tục..." 
          v-model="botInput" 
          @keyup.enter="sendBotMessage"
        />
        <button class="send-bot-btn" @click="sendBotMessage" aria-label="Gửi tin nhắn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>

    <!-- Chatbot Floating Teaser Bubble (Hiện 4.5s -> Tắt -> Nghỉ 3.5s -> Hiện câu mới) -->
    <transition name="teaser-pop">
      <div 
        v-if="!isChatbotOpen && isTeaserVisible" 
        class="chatbot-teaser-bubble"
        @click="toggleChatbot"
      >
        <div class="teaser-content">
          <span class="teaser-badge">Gợi ý câu hỏi</span>
          <p class="teaser-text">{{ currentTeaserText }}</p>
        </div>
        <button class="teaser-close-btn" @click="dismissTeaser" aria-label="Tắt gợi ý">✕</button>
        <div class="teaser-arrow"></div>
      </div>
    </transition>

    <!-- Minimal Floating Toggle Button for Chatbot -->
    <button class="chatbot-toggle-btn" @click="toggleChatbot">
      <div class="toggle-bot-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <span class="bot-badge">Hỏi trợ lý</span>
    </button>

    <!-- Mobile App Bottom Navigation Bar (Liquid Glass Style) -->
    <nav class="mobile-bottom-nav">
      <nuxt-link to="/" class="bottom-nav-item" active-class="active">
        <div class="bottom-nav-icon-wrap">
          <svg class="bottom-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </div>
        <span class="bottom-nav-label">{{ t('home') }}</span>
      </nuxt-link>

      <nuxt-link to="/ban-tin" class="bottom-nav-item" active-class="active">
        <div class="bottom-nav-icon-wrap">
          <svg class="bottom-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1m2 13a2 2 0 0 1-2-2V7m2 13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"></path>
          </svg>
        </div>
        <span class="bottom-nav-label">{{ t('news') }}</span>
      </nuxt-link>

      <!-- Center Floating Liquid Orb: Hỏi Trợ Lý -->
      <button class="bottom-nav-item center-action" @click="toggleChatbot" :class="{ 'active': isChatbotOpen }">
        <div class="center-action-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <span class="bottom-nav-label">{{ t('ask_ai') }}</span>
      </button>

      <nuxt-link to="/van-ban" class="bottom-nav-item" active-class="active">
        <div class="bottom-nav-icon-wrap">
          <svg class="bottom-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
        </div>
        <span class="bottom-nav-label">{{ t('documents') }}</span>
      </nuxt-link>

      <button class="bottom-nav-item" @click="toggleMobileMenu" :class="{ 'active': isMobileMenuOpen }">
        <div class="bottom-nav-icon-wrap">
          <svg class="bottom-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </div>
        <span class="bottom-nav-label">{{ t('categories') }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, nextTick } from 'vue'

const isSticky = ref(false)
const isMobileMenuOpen = ref(false)
const isSearchActive = ref(false)
const searchQuery = ref('')
const showDropdown = ref(false)
const showLibraryDropdown = ref(false)
const showGovDropdown = ref(false)
const { currentLang, fontSize, t, setLang, setFontSize, initSettings } = useI18n()
const searchInputRef = ref(null)
const liveDateTime = ref('')

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
const pad = (n) => String(n).padStart(2, '0')

const updateLiveDate = () => {
  const now = new Date()
  liveDateTime.value = `${WEEKDAYS[now.getDay()]}, ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} - ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

let dateTimer = null

// Chatbot Floating Teaser Prompts (Hiện -> Tắt -> Nghỉ -> Hiện câu mới)
const botTeasers = [
  'Bạn muốn hỏi về quy trình?',
  'Bạn muốn vay vốn theo QĐ 22?',
  'Bạn hãy đặt câu hỏi cho mình nhé!',
  'Hồ sơ thủ tục xóa án tích gồm những gì?',
  'Tư vấn đào tạo nghề & việc làm miễn phí'
]
const activeTeaserIndex = ref(0)
const isTeaserVisible = ref(true)
const isTeaserDismissed = ref(false)
let teaserTimeout = null

const currentTeaserText = computed(() => {
  return botTeasers[activeTeaserIndex.value]
})

const runTeaserCycle = () => {
  stopTeaserCycle()
  if (isTeaserDismissed.value || isChatbotOpen.value) return

  // Phase 1: Hiển thị bong bóng gợi ý
  isTeaserVisible.value = true

  // Phase 2: Giữ bong bóng hiện 4.5 giây cho người dùng đọc
  teaserTimeout = setTimeout(() => {
    isTeaserVisible.value = false // Tắt hoàn toàn bong bóng

    // Phase 3: Tắt xong nghỉ 3.5 giây rồi mới chuyển sang câu tiếp theo và hiện lại
    teaserTimeout = setTimeout(() => {
      activeTeaserIndex.value = (activeTeaserIndex.value + 1) % botTeasers.length
      runTeaserCycle()
    }, 3500)
  }, 4500)
}

const stopTeaserCycle = () => {
  if (teaserTimeout) {
    clearTimeout(teaserTimeout)
    teaserTimeout = null
  }
  isTeaserVisible.value = false
}

const dismissTeaser = (e) => {
  e.stopPropagation()
  isTeaserDismissed.value = true
  stopTeaserCycle()
}
const isChatbotOpen = ref(false)
const botInput = ref('')
const chatContainer = ref(null)
const chatMessages = ref([
  { sender: 'bot', text: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi có thể hỗ trợ bạn giải đáp nhanh các câu hỏi pháp lý đã được Cục C11 phê duyệt về công tác tái hòa nhập cộng đồng.' }
])

const chatbotFaqs = [
  { label: 'Hạn mức vay vốn?', question: 'Người hoàn lương được vay vốn tối đa bao nhiêu?', answer: 'Theo Quyết định 22/2023/QĐ-TTg, người chấp hành xong án phạt tù được vay vốn ưu đãi tối đa 100 triệu đồng để làm kinh tế, sản xuất kinh doanh tại Ngân hàng Chính sách Xã hội địa phương.' },
  { label: 'Làm sao xóa án tích?', question: 'Thủ tục xóa án tích như thế nào?', answer: 'Khi đủ thời gian thử thách và thời gian đương nhiên xóa án tích theo quy định Bộ luật Hình sự, bạn cần đến Sở Tư pháp địa phương để làm thủ tục xin cấp Phiếu lý lịch tư pháp số 2 làm cơ sở xác định việc xóa án tích.' },
  { label: 'Đăng ký học nghề?', question: 'Làm thế nào để đăng ký học nghề?', answer: 'Bạn hãy liên hệ với UBND hoặc Công an cấp xã/phường nơi cư trú để nhận phiếu giới thiệu học nghề miễn phí hoặc ưu đãi tại các trường dạy nghề liên kết của địa phương theo Nghị định 49/2020/NĐ-CP.' }
]

const fontSizeClass = computed(() => {
  return `font-size-${fontSize.value}`
})

const handleScroll = () => {
  if (window.scrollY > 80) {
    isSticky.value = true
  } else {
    isSticky.value = false
  }
}

const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

const toggleMobileSubmenu = (menuKey) => {
  if (menuKey === 'news') {
    showDropdown.value = !showDropdown.value
  } else if (menuKey === 'library') {
    showLibraryDropdown.value = !showLibraryDropdown.value
  } else if (menuKey === 'gov') {
    showGovDropdown.value = !showGovDropdown.value
  }
}

const onNavClick = (e) => {
  if (e.target.closest('a')) {
    isMobileMenuOpen.value = false
  }
}

const toggleSearch = async () => {
  isSearchActive.value = !isSearchActive.value
  if (isSearchActive.value) {
    await nextTick()
    if (searchInputRef.value) {
      searchInputRef.value.focus()
    }
  }
}

const handleSearch = () => {
  const q = searchQuery.value.trim()
  if (q) {
    navigateTo({ path: '/ban-tin', query: { q } })
    searchQuery.value = ''
    isSearchActive.value = false
  }
}

const changeFontSize = (size) => {
  setFontSize(size)
}

const toggleChatbot = () => {
  isChatbotOpen.value = !isChatbotOpen.value
  if (isChatbotOpen.value) {
    stopTeaserCycle()
    scrollChatBottom()
  } else {
    setTimeout(() => {
      runTeaserCycle()
    }, 2500)
  }
}

const renderMarkdown = (text) => {
  if (!text) return ''
  let html = text

  // 1. Escape HTML special characters for security
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 2. Bold: **text** or __text__
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>')

  // 3. Italic: *text* or _text_
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.*?)_/g, '<em>$1</em>')

  // 4. Inline Code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 5. Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // 6. Line & List Processing
  const lines = html.split('\n')
  let inList = false
  let isNumbered = false
  let resultLines = []

  for (let line of lines) {
    const trimmed = line.trim()

    // Bullet points (- or *)
    if (/^[-*]\s+(.*)/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, '')
      if (!inList) {
        inList = true
        isNumbered = false
        resultLines.push('<ul class="md-list">')
      }
      resultLines.push(`<li>${content}</li>`)
    } 
    // Numbered lists (1. or 2.)
    else if (/^\d+\.\s+(.*)/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s+/, '')
      if (!inList) {
        inList = true
        isNumbered = true
        resultLines.push('<ol class="md-list">')
      }
      resultLines.push(`<li>${content}</li>`)
    } 
    else {
      if (inList) {
        inList = false
        resultLines.push(isNumbered ? '</ol>' : '</ul>')
      }
      if (trimmed === '') {
        resultLines.push('<div class="md-spacer"></div>')
      } else {
        resultLines.push(`<p>${line}</p>`)
      }
    }
  }

  if (inList) {
    resultLines.push(isNumbered ? '</ol>' : '</ul>')
  }

  return resultLines.join('')
}

const STORAGE_KEY = 'cdkt_chat_history_v1'

const loadChatHistory = () => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          chatMessages.value = parsed
        }
      }
    } catch (e) {
      console.error('Lỗi load lịch sử chat:', e)
    }
  }
}

const saveChatHistory = () => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMessages.value))
    } catch (e) {
      console.error('Lỗi lưu lịch sử chat:', e)
    }
  }
}

const clearChatHistory = () => {
  chatMessages.value = [
    { sender: 'bot', text: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi có thể hỗ trợ bạn giải đáp nhanh các câu hỏi pháp lý đã được Cục C11 phê duyệt về công tác tái hòa nhập cộng đồng.' }
  ]
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

const fetchStreamBotReply = async () => {
  const msgObj = reactive({ sender: 'bot', text: '', isStreaming: true })
  chatMessages.value.push(msgObj)
  scrollChatBottom()

  let targetFullText = ''
  let currentRenderedLength = 0
  let isStreamFetching = true

  // Bộ tiêu thụ từng ký tự client (Typewriter Stream Queue - 15ms/ký tự)
  const typewriterTimer = setInterval(() => {
    if (currentRenderedLength < targetFullText.length) {
      // Mỗi nhịp render 1 - 2 ký tự tạo cảm giác gõ AI siêu mượt
      const step = Math.min(2, targetFullText.length - currentRenderedLength)
      currentRenderedLength += step
      msgObj.text = targetFullText.substring(0, currentRenderedLength)
      scrollChatBottom()
    } else if (!isStreamFetching) {
      // Đã đọc xong từ mạng & đã render đủ toàn bộ ký tự!
      clearInterval(typewriterTimer)
      msgObj.isStreaming = false
      saveChatHistory()
      scrollChatBottom()
    }
  }, 15)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatMessages.value.slice(0, -1) })
    })

    if (!response.ok || !response.body) {
      throw new Error('Kết nối tới server AI thất bại')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue

        if (trimmed === 'data: [DONE]') {
          break
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.substring(6)
          try {
            const data = JSON.parse(jsonStr)
            const content = data.choices?.[0]?.delta?.content || ''
            if (content) {
              targetFullText += content
            }
          } catch (e) {
            targetFullText += jsonStr
          }
        }
      }
    }
  } catch (err) {
    console.error('Streaming error:', err)
    if (!targetFullText) {
      targetFullText = 'Xin lỗi, kết nối tới máy chủ AI gặp sự cố. Bạn vui lòng thử lại hoặc gọi hotline 0903.480.985 để được hỗ trợ trực tiếp.'
    }
  } finally {
    isStreamFetching = false
  }
}

const askBot = (question, answer) => {
  chatMessages.value.push({ sender: 'user', text: question })
  saveChatHistory()
  scrollChatBottom()
  setTimeout(() => {
    fetchStreamBotReply()
  }, 200)
}

const sendBotMessage = () => {
  if (botInput.value.trim() === '') return
  const text = botInput.value
  chatMessages.value.push({ sender: 'user', text })
  saveChatHistory()
  botInput.value = ''
  scrollChatBottom()

  setTimeout(() => {
    fetchStreamBotReply()
  }, 200)
}

const scrollChatBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

onMounted(() => {
  initSettings()

  window.addEventListener('scroll', handleScroll)
  updateLiveDate()
  dateTimer = setInterval(updateLiveDate, 1000)
  loadChatHistory()
  runTeaserCycle()
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  if (dateTimer) clearInterval(dateTimer)
  stopTeaserCycle()
})
</script>

<style scoped>
/* Root Font Size Controls (A-, A, A+) */
.app-layout.font-size-small p,
.app-layout.font-size-small span,
.app-layout.font-size-small a,
.app-layout.font-size-small li,
.app-layout.font-size-small h1,
.app-layout.font-size-small h2,
.app-layout.font-size-small h3,
.app-layout.font-size-small h4,
.app-layout.font-size-small input,
.app-layout.font-size-small button {
  font-size: 92% !important;
}

.app-layout.font-size-large p,
.app-layout.font-size-large span,
.app-layout.font-size-large a,
.app-layout.font-size-large li,
.app-layout.font-size-large h1,
.app-layout.font-size-large h2,
.app-layout.font-size-large h3,
.app-layout.font-size-large h4,
.app-layout.font-size-large input,
.app-layout.font-size-large button {
  font-size: 112% !important;
}

/* Top Bar */
.top-bar {
  background-color: var(--primary-dark);
  color: var(--white);
  padding: 8px 0;
  font-size: 0.82rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  position: relative;
  z-index: 101;
}

.top-bar-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.top-left, .top-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.divider {
  opacity: 0.3;
}

.accessibility-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-label {
  font-weight: 500;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.7);
}

.accessibility-ctrl button {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition);
}

.accessibility-ctrl button:hover, .accessibility-ctrl button.active {
  background-color: var(--secondary);
}

.lang-switcher button {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
  cursor: pointer;
  font-size: 0.78rem;
  padding: 2px 6px;
  transition: var(--transition);
}

.lang-switcher button:hover, .lang-switcher button.active {
  color: white;
  background-color: var(--primary);
  border-radius: 4px;
}

/* Main Header */
.main-header {
  background-color: var(--white);
  position: relative;
  width: 100%;
  z-index: 100;
  border-bottom: 1px solid var(--border-color);
  transition: var(--transition);
}

.main-header.is-sticky {
  position: fixed;
  top: 0;
  box-shadow: var(--shadow-md);
}

/* Header Top Row */
.header-top-row {
  border-bottom: 1px solid var(--border-color);
  background-color: var(--white);
}

.header-top-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 80px;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
}

.logo-img-ref {
  width: auto;
  height: 50px;
  object-fit: contain;
}

.logo-title {
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.5px;
  line-height: 1.2;
}

.logo-subtitle {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-top: 2px;
}

.menu-toggle {
  display: none;
}

.mobile-drawer-head,
.drawer-search-wrap,
.mobile-drawer-footer {
  display: none;
}

.header-top-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-btn-toggle {
  background: var(--bg-light);
  border: 1px solid var(--border-color);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.95rem;
  transition: var(--transition);
}

.search-btn-toggle:hover, .search-btn-toggle.is-active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

.btn-support-247 {
  padding: 10px 20px;
  font-size: 0.85rem;
  border-radius: var(--radius-sm);
}

.pulse-icon {
  width: 6px;
  height: 6px;
  background-color: var(--secondary);
  border-radius: 50%;
  display: inline-block;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 1; box-shadow: 0 0 0 0 rgba(124, 179, 66, 0.7); }
  70% { transform: scale(1.1); opacity: 0.5; box-shadow: 0 0 0 6px rgba(124, 179, 66, 0); }
  100% { transform: scale(0.9); opacity: 0; box-shadow: 0 0 0 0 rgba(124, 179, 66, 0); }
}

/* Header Nav Row - Crisp White Background & Deep Green Text (Thanh Lịch, Sạch Sẽ) */
.header-nav-row {
  background-color: #ffffff;
  border-top: 1px solid #edf2ec;
  border-bottom: 1px solid #e1e8e0;
  height: 50px;
  display: flex;
  align-items: center;
  box-shadow: 0 4px 12px rgba(15, 35, 18, 0.04);
  transition: var(--transition);
}

.nav-container {
  width: 100%;
}

.main-nav {
  display: flex;
  width: 100%;
}

.nav-links {
  display: flex;
  list-style: none;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: 2px;
}

.nav-item {
  text-decoration: none;
  color: #1e4620;
  font-weight: 700;
  font-size: 0.88rem;
  padding: 8px 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  position: relative;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-item a {
  color: inherit;
  text-decoration: none;
}

.cursor-pointer {
  cursor: pointer;
}

.nav-item:hover,
.nav-item:hover a {
  color: #143516;
  background-color: #f0f6ef;
}

.nav-item.active-item,
.nav-item:has(a.active-item) {
  color: #1e4620;
  background-color: #e4f0e2;
  font-weight: 800;
}

.nav-item:has(a.active-item) a {
  color: #1e4620;
}

.nav-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 12px;
  right: 12px;
  height: 3px;
  background-color: #1e4620;
  border-radius: 4px;
  opacity: 0;
  transform: scaleX(0);
  transition: all 0.25s ease;
}

.nav-item:hover::after, 
.active-item::after,
.nav-item:has(a.active-item)::after {
  opacity: 1;
  transform: scaleX(1);
}

/* Dropdown Menu */
.has-dropdown {
  position: relative;
}

.nav-item-dropdown {
  cursor: pointer;
}

.arrow {
  font-size: 0.55rem;
  margin-left: 2px;
  display: inline-block;
  color: #557757;
  transition: transform 0.25s ease;
}

.has-dropdown:hover .arrow,
.arrow.is-rotated {
  transform: rotate(180deg);
  color: #1e4620;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(15, 35, 18, 0.18), 0 2px 8px rgba(0, 0, 0, 0.04);
  border-radius: 12px;
  border: 1px solid rgba(30, 70, 32, 0.12);
  padding: 8px;
  min-width: 220px;
  list-style: none;
  opacity: 0;
  transform: translateY(8px) scale(0.97);
  pointer-events: none;
  z-index: 102;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.has-dropdown:hover .dropdown-menu, .dropdown-menu.is-show {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.dropdown-menu a {
  display: block;
  padding: 9px 14px;
  text-decoration: none;
  color: #2d4a2d;
  font-size: 0.86rem;
  font-weight: 600;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.dropdown-menu a:hover {
  background-color: rgba(30, 70, 32, 0.07);
  color: #1e4620;
  padding-left: 18px;
}

/* Search Dropdown Bar */
.search-dropdown-bar {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  background-color: var(--primary);
  padding: 16px 0;
  box-shadow: var(--shadow-md);
  z-index: 99;
}

.search-dropdown-container {
  display: flex;
  gap: 16px;
  align-items: center;
}

.search-input-wrap {
  position: relative;
  flex: 1;
}

.search-input-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-dropdown-bar input {
  width: 100%;
  padding: 12px 14px 12px 42px;
  border-radius: var(--radius-sm);
  border: none;
  font-family: inherit;
  font-size: 0.95rem;
  outline: none;
}

.search-bar-buttons {
  display: flex;
  gap: 8px;
}

.search-dropdown-submit {
  background-color: var(--secondary);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  transition: var(--transition);
}

.search-dropdown-submit:hover {
  background-color: var(--secondary-light);
}

.search-dropdown-close {
  background: transparent;
  color: white;
  border: 1px solid rgba(255,255,255,0.3);
  padding: 12px 18px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
  transition: var(--transition);
}

.search-dropdown-close:hover {
  background-color: rgba(255,255,255,0.1);
}

/* Slide Down Transition */
.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

/* Main Content Padding */
.main-content {
  padding-top: 0;
  min-height: calc(100vh - 165px);
  transition: var(--transition);
}

.main-content.has-sticky-padding {
  padding-top: 130px;
}

/* Mobile Toggle */
.mobile-drawer-head {
  display: none;
}

.menu-toggle {
  display: none;
  flex-direction: column;
  justify-content: space-between;
  width: 24px;
  height: 18px;
  background: none;
  border: none;
  cursor: pointer;
}

.menu-toggle .bar {
  width: 100%;
  height: 3px;
  background-color: var(--primary);
  border-radius: 2px;
  transition: var(--transition);
}

/* Accessibility classes */
.font-size-small { font-size: 0.9rem; }
.font-size-normal { font-size: 1rem; }
.font-size-large { font-size: 1.15rem; }

/* Footer */
.main-footer {
  background-color: var(--primary-dark);
  color: rgba(255, 255, 255, 0.8);
  padding: 80px 0 0 0;
  border-top: 4px solid var(--secondary);
}

.footer-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 2fr;
  gap: 40px;
  margin-bottom: 60px;
}

.footer-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.footer-logo-img {
  width: auto;
  height: 36px;
  object-fit: contain;
}

.footer-logo-title {
  color: white;
  font-weight: 800;
  font-size: 1.2rem;
  letter-spacing: 0.5px;
}

.footer-desc {
  font-size: 0.9rem;
  line-height: 1.6;
}

.footer-col-title {
  color: white;
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 24px;
  position: relative;
}

.footer-col-title::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 0;
  width: 30px;
  height: 3px;
  background-color: var(--secondary);
}

.footer-col-links ul {
  list-style: none;
}

.footer-col-links li {
  margin-bottom: 12px;
}

.footer-col-links a {
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  font-size: 0.9rem;
  transition: var(--transition);
}

.footer-col-links a:hover {
  color: var(--secondary-light);
  padding-left: 6px;
}

.footer-col-contact p {
  margin-bottom: 12px;
  font-size: 0.9rem;
}

.footer-col-contact strong {
  color: white;
}

.footer-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 24px 0;
  font-size: 0.85rem;
}

.footer-bottom-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.designer-link {
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  font-weight: 600;
  transition: all 0.2s ease;
}

.designer-link:hover {
  color: var(--secondary-light);
  text-decoration: underline;
}

/* ====== MINIMALIST ELEGANT CHATBOT AI STYLING ====== */
.chatbot-teaser-bubble {
  position: fixed;
  bottom: 84px;
  right: 24px;
  background: #ffffff;
  border-radius: 16px;
  padding: 10px 32px 10px 14px;
  box-shadow: 0 12px 36px rgba(15, 35, 18, 0.2), 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1.5px solid rgba(30, 70, 32, 0.18);
  z-index: 9999;
  cursor: pointer;
  max-width: 280px;
}

/* Vue Teaser Pop Transition */
.teaser-pop-enter-active,
.teaser-pop-leave-active {
  transition: all 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.teaser-pop-enter-from,
.teaser-pop-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.92);
}

.chatbot-teaser-bubble:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 36px rgba(15, 35, 18, 0.22);
}

.teaser-badge {
  font-size: 0.65rem;
  font-weight: 800;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 2px;
}

.teaser-text {
  font-size: 0.84rem;
  font-weight: 700;
  color: #1a2e1b;
  line-height: 1.35;
  margin: 0;
  animation: textFadeIn 0.4s ease-out;
}

.teaser-close-btn {
  position: absolute;
  top: 6px;
  right: 8px;
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px;
  transition: color 0.2s ease;
}

.teaser-close-btn:hover {
  color: #374151;
}

.teaser-arrow {
  position: absolute;
  bottom: -6px;
  right: 28px;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-right: 1px solid rgba(30, 70, 32, 0.14);
  border-bottom: 1px solid rgba(30, 70, 32, 0.14);
  transform: rotate(45deg);
}

@keyframes teaserBounceIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes textFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.chatbot-toggle-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #1e4620;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 10px 20px 10px 14px;
  border-radius: 50px;
  box-shadow: 0 8px 24px rgba(30, 70, 32, 0.25);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 999;
  font-weight: 700;
  font-size: 0.88rem;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.chatbot-toggle-btn:hover {
  transform: translateY(-2px);
  background: #153317;
  box-shadow: 0 12px 30px rgba(30, 70, 32, 0.35);
}

.toggle-bot-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chatbot-popup {
  position: fixed;
  bottom: 90px;
  right: 24px;
  width: 420px;
  height: 580px;
  max-height: calc(100vh - 110px);
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.16), 0 4px 16px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  z-index: 9999;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  opacity: 0;
  transform: translateY(20px) scale(0.96);
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.chatbot-popup.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.chatbot-header {
  background: #ffffff;
  color: #1f2937;
  padding: 14px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #edf2ec;
}

.chatbot-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.minimal-bot-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #edf5ec;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bot-header-meta h4 {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1a2e1b;
  margin: 0;
}

.bot-header-meta p {
  font-size: 0.72rem;
  color: #6b7280;
  margin: 2px 0 0 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-dot-green {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  display: inline-block;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-history-btn {
  background: #f3f4f6;
  border: none;
  color: #6b7280;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-history-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}

.close-bot-btn {
  background: #f3f4f6;
  border: none;
  color: #6b7280;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-bot-btn:hover {
  background: #e5e7eb;
  color: #111827;
}

.chatbot-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #f9fbf9;
}

.chat-msg {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-msg.user {
  justify-content: flex-end;
}

.msg-bot-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #edf5ec;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: 2px;
}

.msg-bubble {
  max-width: 86%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 0.88rem;
  line-height: 1.48;
}

.chat-msg.bot .msg-bubble {
  background: #ffffff;
  color: #1f2937;
  border: 1px solid #e8ede7;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

/* Markdown formatted content */
.markdown-content p {
  margin: 0 0 6px 0;
  line-height: 1.5;
}

.markdown-content p:last-child {
  margin-bottom: 0;
}

.markdown-content strong {
  font-weight: 700;
  color: #112812;
}

.markdown-content ul.md-list,
.markdown-content ol.md-list {
  margin: 6px 0 8px 0;
  padding-left: 18px;
}

.markdown-content ul.md-list li,
.markdown-content ol.md-list li {
  margin-bottom: 4px;
  line-height: 1.45;
}

.markdown-content a {
  color: #1e4620;
  text-decoration: underline;
  font-weight: 600;
}

.markdown-content code {
  background: #f0f6ef;
  color: #1e4620;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-family: monospace;
}

.md-spacer {
  height: 6px;
}

.streaming-cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--primary);
  font-weight: 700;
  animation: blinkCursor 0.6s infinite;
}

@keyframes blinkCursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.chat-msg.user .msg-bubble {
  background: #1e4620;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.chatbot-quick-questions {
  padding: 10px 14px;
  background-color: #ffffff;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  max-height: 110px;
  overflow-y: auto;
  border-top: 1px solid #edf2ec;
}

.quick-q-btn {
  background-color: #f3f6f3;
  border: 1px solid #e1e8e0;
  color: #2d4a2d;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 0.76rem;
  font-weight: 600;
  white-space: normal;
  text-align: left;
  line-height: 1.3;
  cursor: pointer;
  transition: all 0.2s ease;
}

.quick-q-btn:hover {
  background-color: #1e4620;
  color: #ffffff;
  border-color: #1e4620;
}

.chatbot-input-area {
  padding: 12px 14px;
  display: flex;
  gap: 8px;
  background: #ffffff;
  border-top: 1px solid #edf2ec;
}

.chatbot-input-area input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 20px;
  border: 1px solid #e1e8e0;
  font-size: 0.86rem;
  outline: none;
  background: #f8faf8;
  transition: all 0.2s ease;
}

.chatbot-input-area input:focus {
  border-color: #1e4620;
  background: #ffffff;
}

.send-bot-btn {
  background: #1e4620;
  color: #ffffff;
  border: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.send-bot-btn:hover {
  background: #153317;
}

/* Tablet & Mobile responsive */
@media (max-width: 1280px) {
  .logo-title { font-size: 1.15rem; }
  .logo-subtitle { font-size: 0.62rem; }
  .nav-item { font-size: 0.82rem; padding: 12px 2px; }
}

@media (max-width: 1024px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 1100px) {
  .mobile-drawer-head {
    display: flex;
  }

  .drawer-search-wrap {
    display: block;
  }

  .mobile-drawer-footer {
    display: flex;
  }

  .top-bar {
    display: block;
    padding: 4px 0;
  }

  .top-bar-content {
    justify-content: space-between;
  }

  .top-hide-mobile {
    display: none !important;
  }

  .drawer-controls-row {
    display: flex;
    padding: 10px 18px;
    background: #f0f6ef;
    border-bottom: 1px solid #e1e8e0;
    justify-content: space-between;
    align-items: center;
  }

  .drawer-ctrl-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .drawer-ctrl-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: #1e4620;
  }

  .menu-toggle {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 4px;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: rgba(30, 70, 32, 0.06);
    border: 1px solid rgba(30, 70, 32, 0.12);
    box-shadow: none;
    z-index: 10000;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .menu-toggle:hover, .menu-toggle:active {
    background: rgba(30, 70, 32, 0.12);
    transform: scale(1.04);
  }

  .menu-toggle .bar {
    width: 20px;
    height: 2px;
    background-color: var(--primary-dark);
    border-radius: 4px;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  }

  .header-nav-row {
    display: block;
    height: 0;
    padding: 0;
    margin: 0;
    border: none;
    overflow: visible;
  }

  .main-header {
    z-index: auto;
  }

  .menu-toggle.is-hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  /* ====== SLEEK MODERN MOBILE MENU ====== */
  .main-nav {
    position: fixed;
    top: 0;
    right: -100%;
    width: 86vw;
    max-width: 360px;
    height: 100vh;
    height: 100dvh;
    background: #ffffff;
    box-shadow: -12px 0 40px rgba(15, 35, 18, 0.18);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    transition: right 0.38s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    padding: 0;
  }

  .main-nav.is-open {
    right: 0;
  }

  .mobile-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    background: linear-gradient(135deg, #1e4620 0%, #133215 100%);
    color: #ffffff;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 2;
    flex-shrink: 0;
  }

  .drawer-brand-box {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .drawer-logo-img {
    height: 36px;
    width: auto;
    object-fit: contain;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
  }

  .drawer-brand-info {
    display: flex;
    flex-direction: column;
  }

  .drawer-brand-name {
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.4px;
    color: #ffffff;
    line-height: 1.2;
  }

  .drawer-brand-sub {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.75);
    font-weight: 500;
    margin-top: 2px;
  }

  .drawer-close {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font-size: 0.95rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .drawer-close:active {
    background: rgba(255, 255, 255, 0.25);
    transform: scale(0.92);
  }

  /* Drawer Search Bar */
  .drawer-search-wrap {
    padding: 12px 16px 4px 16px;
    background: #fcfdfe;
    border-bottom: 1px solid rgba(30, 70, 32, 0.06);
    flex-shrink: 0;
  }

  .drawer-search-box {
    display: flex;
    align-items: center;
    background: rgba(30, 70, 32, 0.05);
    border: 1px solid rgba(30, 70, 32, 0.12);
    border-radius: 10px;
    padding: 8px 12px;
    gap: 8px;
  }

  .drawer-search-box .search-icon {
    font-size: 0.85rem;
    opacity: 0.6;
  }

  .drawer-search-box input {
    border: none;
    background: transparent;
    width: 100%;
    font-size: 0.88rem;
    color: var(--text-dark);
    outline: none;
  }

  .clear-search-btn {
    border: none;
    background: rgba(0,0,0,0.1);
    border-radius: 50%;
    width: 18px;
    height: 18px;
    font-size: 0.65rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #555;
  }

  .drawer-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .nav-links {
    flex-direction: column;
    padding: 14px 14px 20px 14px;
    gap: 4px;
  }

  .nav-links li {
    border-bottom: none;
    width: 100%;
  }

  .nav-item {
    padding: 12px 16px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-dark);
    border-radius: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s ease;
  }

  .nav-item-dropdown {
    cursor: pointer;
  }

  .nav-item:hover, .nav-item:active, .nav-item.active-item {
    background: rgba(30, 70, 32, 0.08);
    color: var(--primary);
  }

  .nav-item.active-item {
    font-weight: 800;
  }

  .arrow {
    font-size: 0.65rem;
    transition: transform 0.25s ease;
    opacity: 0.7;
  }

  .arrow.is-rotated {
    transform: rotate(180deg);
  }

  .dropdown-menu {
    position: static;
    display: none;
    opacity: 1;
    pointer-events: auto;
    transform: none;
    box-shadow: none;
    padding: 6px 8px 6px 14px;
    background: rgba(30, 70, 32, 0.04);
    border-left: 3px solid var(--primary);
    border-radius: 0 10px 10px 0;
    margin: 4px 0 8px 12px;
  }

  .dropdown-menu.is-show {
    display: block;
  }

  .dropdown-menu a {
    padding: 10px 14px;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--text-medium);
    border-radius: 8px;
    display: block;
  }

  .dropdown-menu a:hover {
    background: rgba(30, 70, 32, 0.08);
    color: var(--primary);
  }

  .mobile-drawer-footer {
    padding: 16px;
    background: #f8faf7;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }

  .drawer-hotline-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #ffffff;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(30, 70, 32, 0.12);
    text-decoration: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
  }

  .hotline-icon-wrap {
    font-size: 1.2rem;
  }

  .hotline-text {
    display: flex;
    flex-direction: column;
  }

  .hotline-lbl {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .hotline-num {
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--primary);
  }

  .drawer-support-btn {
    width: 100%;
    justify-content: center;
    padding: 12px 16px;
    font-size: 0.88rem;
    border-radius: 12px;
    font-weight: 700;
  }

  .btn-support-247 {
    display: none;
  }

  /* Top bar mobile */
  .top-bar-content {
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
  }

  .top-left, .top-right {
    gap: 8px;
    font-size: 0.72rem;
  }

  .top-left {
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 2px;
  }

  .top-hide-mobile {
    display: none;
  }

  /* Header mobile */
  .header-top-container {
    height: 60px;
  }

  .logo-img-ref {
    height: 36px;
  }

  .logo-title {
    font-size: 0.95rem;
  }

  .logo-subtitle {
    display: none;
  }

  /* Footer mobile */
  .footer-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .main-footer {
    padding: 50px 0 0 0;
  }

  .footer-bottom-content {
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  
  /* Hamburger bars transition */
  .bar-open-1 { transform: translateY(7.5px) rotate(45deg); }
  .bar-open-2 { opacity: 0; }
  .bar-open-3 { transform: translateY(-7.5px) rotate(-45deg); }

  /* Chatbot mobile */
  .chatbot-popup {
    width: 92vw;
    right: 4vw;
    left: 4vw;
    bottom: 80px;
    height: 60vh;
  }

  .chatbot-toggle-btn {
    bottom: 16px;
    right: 16px;
    padding: 10px 16px;
    font-size: 0.82rem;
  }

  .bot-badge {
    display: none;
  }

  .chatbot-toggle-btn .bot-icon {
    font-size: 1.2rem;
  }

  /* Search mobile */
  .search-dropdown-container {
    flex-direction: column;
    gap: 12px;
  }

  .search-bar-buttons {
    width: 100%;
    justify-content: stretch;
  }

  .search-dropdown-submit,
  .search-dropdown-close {
    flex: 1;
  }

  /* Mobile menu overlay style */
  .mobile-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(45, 74, 45, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 99;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  
  .mobile-menu-overlay.is-show {
    opacity: 1;
    pointer-events: auto;
  }
}

/* Small phone */
@media (max-width: 480px) {
  .header-top-container {
    height: 52px;
  }

  .logo-area {
    gap: 8px;
  }

  .logo-img-ref {
    height: 30px;
  }

  .logo-title {
    font-size: 0.82rem;
  }

  .accessibility-ctrl {
    display: none;
  }

  .divider {
    display: none;
  }
}

/* ====== LIQUID GLASS MOBILE BOTTOM NAV ====== */
.mobile-bottom-nav {
  display: none;
}

@media (max-width: 1100px) {
  .mobile-bottom-nav {
    display: flex;
    justify-content: space-around;
    align-items: center;
    position: fixed;
    bottom: 10px;
    left: 12px;
    right: 12px;
    height: 64px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.82) 0%, rgba(244, 249, 243, 0.76) 100%);
    backdrop-filter: blur(28px) saturate(200%);
    -webkit-backdrop-filter: blur(28px) saturate(200%);
    border: 1px solid rgba(255, 255, 255, 0.85);
    border-radius: 28px;
    box-shadow: 0 12px 36px rgba(15, 35, 18, 0.16), 0 2px 8px rgba(0, 0, 0, 0.04), inset 0 1.5px 0 rgba(255, 255, 255, 0.9);
    z-index: 9990;
    padding: 0 6px;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-decoration: none;
    color: #556655;
    background: none;
    border: none;
    padding: 6px 0;
    font-family: inherit;
    font-size: 0.65rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 52px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .bottom-nav-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px 12px;
    border-radius: 16px;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .bottom-nav-item:hover,
  .bottom-nav-item.active {
    color: var(--primary);
  }

  .bottom-nav-item.active .bottom-nav-icon-wrap {
    background: linear-gradient(135deg, rgba(30, 70, 32, 0.12) 0%, rgba(124, 179, 66, 0.18) 100%);
    box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.8);
  }

  .bottom-nav-item.active .bottom-nav-icon {
    stroke: var(--primary);
    transform: scale(1.06);
  }

  .bottom-nav-item.active .bottom-nav-label {
    color: var(--primary-dark);
    font-weight: 800;
  }

  /* Center Highlight Action Button (Hỏi trợ lý AI - Floating Liquid Orb) */
  .bottom-nav-item.center-action {
    position: relative;
    top: -14px;
  }

  .center-action-icon {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: linear-gradient(135deg, #2e6b32 0%, #173b18 100%);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 24px rgba(23, 59, 24, 0.4), 0 2px 6px rgba(0, 0, 0, 0.15), inset 0 2px 4px rgba(255, 255, 255, 0.4);
    border: 3.5px solid rgba(255, 255, 255, 0.95);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    animation: liquidOrbGlow 3s infinite ease-in-out;
  }

  @keyframes liquidOrbGlow {
    0%, 100% { box-shadow: 0 10px 24px rgba(23, 59, 24, 0.4), 0 0 0 0 rgba(46, 107, 50, 0.3); }
    50% { box-shadow: 0 12px 28px rgba(23, 59, 24, 0.5), 0 0 0 8px rgba(46, 107, 50, 0); }
  }

  .center-action-icon svg {
    stroke: #ffffff;
  }

  .bottom-nav-item.center-action:active .center-action-icon {
    transform: scale(0.9);
  }

  .bottom-nav-item.center-action .bottom-nav-label {
    margin-top: 3px;
    color: var(--primary-dark);
    font-weight: 800;
  }

  /* Offset layout for floating liquid bottom bar */
  .main-content {
    padding-bottom: 80px;
  }

  .main-footer {
    padding-bottom: 80px;
  }

  .chatbot-toggle-btn {
    bottom: 88px;
    right: 18px;
  }

  .chatbot-teaser-bubble {
    bottom: 144px;
    right: 16px;
    max-width: 240px;
  }

  .chatbot-popup {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
    z-index: 99999;
  }

  .chatbot-header {
    padding: 14px 16px;
    padding-top: calc(env(safe-area-inset-top, 0px) + 10px);
  }

  .chatbot-input-area {
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  }
}
</style>

