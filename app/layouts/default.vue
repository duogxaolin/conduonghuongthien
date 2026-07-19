<template>
  <div class="app-layout">
    <!-- Top Bar -->
    <div class="top-bar">
      <div class="container top-bar-content">
        <div class="top-left">
          <span>📞 Hotline: 0903.480.985</span>
          <span class="divider">|</span>
          <span>✉ Email: contact@conduonghuongthien.com.vn</span>
        </div>
        <div class="top-right">
          <!-- Text Accessibility Controls -->
          <div class="accessibility-ctrl">
            <span class="ctrl-label">Cỡ chữ:</span>
            <button @click="changeFontSize('small')" :class="{ active: fontSize === 'small' }">A-</button>
            <button @click="changeFontSize('normal')" :class="{ active: fontSize === 'normal' }">A</button>
            <button @click="changeFontSize('large')" :class="{ active: fontSize === 'large' }">A+</button>
          </div>
          <span class="divider">|</span>
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
            <button class="search-btn-toggle" @click="toggleSearch" :class="{ 'is-active': isSearchActive }">
              {{ isSearchActive ? '×' : '🔍' }}
            </button>
            <nuxt-link to="/lien-he" class="btn btn-primary btn-support-247">
              <span class="pulse-icon"></span> Hỗ trợ 24/7
            </nuxt-link>
            <!-- Mobile Toggle -->
            <button class="menu-toggle" @click="toggleMobileMenu">
              <span class="bar" :class="{ 'bar-open-1': isMobileMenuOpen }"></span>
              <span class="bar" :class="{ 'bar-open-2': isMobileMenuOpen }"></span>
              <span class="bar" :class="{ 'bar-open-3': isMobileMenuOpen }"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Dòng 2: Thanh Menu Điều hướng -->
      <div class="header-nav-row" :class="{ 'nav-sticky': isSticky }">
        <div class="container nav-container">
          <nav class="main-nav" :class="{ 'is-open': isMobileMenuOpen }">
            <ul class="nav-links">
              <li><nuxt-link to="/" class="nav-item" active-class="active-item">Trang chủ</nuxt-link></li>
              <li><nuxt-link to="/gioi-thieu" class="nav-item" active-class="active-item">Giới thiệu</nuxt-link></li>
              
              <!-- Dropdown Menu Bản tin -->
              <li class="has-dropdown" @mouseenter="showDropdown = true" @mouseleave="showDropdown = false">
                <nuxt-link to="/ban-tin" class="nav-item" active-class="active-item">
                  Bản tin <span class="arrow">▼</span>
                </nuxt-link>
                <ul class="dropdown-menu" :class="{ 'is-show': showDropdown }">
                  <li><nuxt-link to="/ban-tin/tin-noi-bat">Tin nổi bật</nuxt-link></li>
                  <li><nuxt-link to="/ban-tin/tin-hoat-dong">Tin hoạt động</nuxt-link></li>
                  <li><nuxt-link to="/ban-tin/tin-dia-phuong">Tin địa phương</nuxt-link></li>
                </ul>
              </li>

              <li><nuxt-link to="/tamguongtieubieu" class="nav-item" active-class="active-item">Tấm gương tiêu biểu</nuxt-link></li>
              <li><nuxt-link to="/mohinhtaihoanhap" class="nav-item" active-class="active-item">Mô hình tái hòa nhập</nuxt-link></li>
              <li><nuxt-link to="/van-ban" class="nav-item" active-class="active-item">Văn bản</nuxt-link></li>
              
              <!-- Dropdown Menu Thư viện -->
              <li class="has-dropdown" @mouseenter="showLibraryDropdown = true" @mouseleave="showLibraryDropdown = false">
                <span class="nav-item cursor-pointer">
                  Thư viện <span class="arrow">▼</span>
                </span>
                <ul class="dropdown-menu" :class="{ 'is-show': showLibraryDropdown }">
                  <li><a href="#video-library">Thư viện Video</a></li>
                  <li><a href="#photo-library">Thư viện Ảnh</a></li>
                </ul>
              </li>

              <li><nuxt-link to="/giai-dap-phap-luat" class="nav-item" active-class="active-item">Giải đáp pháp luật</nuxt-link></li>
              
              <!-- Dropdown Bộ với công dân -->
              <li class="has-dropdown" @mouseenter="showGovDropdown = true" @mouseleave="showGovDropdown = false">
                <span class="nav-item cursor-pointer">
                  Bộ với Công dân <span class="arrow">▼</span>
                </span>
                <ul class="dropdown-menu" :class="{ 'is-show': showGovDropdown }">
                  <li><a href="#tro-giup">Đăng ký trợ giúp</a></li>
                  <li><nuxt-link to="/van-ban">Thủ tục hành chính</nuxt-link></li>
                </ul>
              </li>

              <li><nuxt-link to="/lien-he" class="nav-item" active-class="active-item">Liên hệ</nuxt-link></li>
            </ul>
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
          <p><strong>Địa chỉ:</strong> Số 47 Phạm Văn Đồng, Cầu Giấy, Hà Nội</p>
          <p><strong>Điện thoại:</strong> 0903.480.985</p>
          <p><strong>Email:</strong> contact@conduonghuongthien.com.vn</p>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="container footer-bottom-content">
          <p>&copy; 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.</p>
          <p>Thiết kế hiện đại và bảo mật bởi GlobalTech</p>
        </div>
      </div>
    </footer>

    <!-- Chatbot Popup (Hiển thị ở mọi trang) -->
    <div class="chatbot-popup" :class="{ 'is-open': isChatbotOpen }">
      <div class="chatbot-header">
        <div class="chatbot-title">
          <span class="bot-avatar">🤖</span>
          <div>
            <h4>Trợ lý ảo Hướng Thiện</h4>
            <p>Hỗ trợ giải đáp pháp lý tự động</p>
          </div>
        </div>
        <button class="close-bot-btn" @click="toggleChatbot">×</button>
      </div>

      <div class="chatbot-messages" ref="chatContainer">
        <div v-for="(msg, index) in chatMessages" :key="index" class="chat-msg" :class="msg.sender">
          <div class="msg-bubble">{{ msg.text }}</div>
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
          placeholder="Nhập câu hỏi pháp lý của bạn..." 
          v-model="botInput" 
          @keyup.enter="sendBotMessage"
        />
        <button class="send-bot-btn" @click="sendBotMessage">➤</button>
      </div>
    </div>

    <!-- Toggle Button for Chatbot -->
    <button class="chatbot-toggle-btn" @click="toggleChatbot">
      <span class="bot-icon">💬</span>
      <span class="bot-badge">Hỏi trợ lý</span>
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'

const isSticky = ref(false)
const isMobileMenuOpen = ref(false)
const isSearchActive = ref(false)
const searchQuery = ref('')
const showDropdown = ref(false)
const showLibraryDropdown = ref(false)
const showGovDropdown = ref(false)
const currentLang = ref('VN')
const fontSize = ref('normal') // small, normal, large
const searchInputRef = ref(null)

// Chatbot states
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
  if (searchQuery.value.trim() !== '') {
    alert(`Tìm kiếm từ khóa: ${searchQuery.value}`)
    searchQuery.value = ''
    isSearchActive.value = false
  }
}

const setLang = (lang) => {
  currentLang.value = lang
}

const changeFontSize = (size) => {
  fontSize.value = size
}

const toggleChatbot = () => {
  isChatbotOpen.value = !isChatbotOpen.value
  if (isChatbotOpen.value) {
    scrollChatBottom()
  }
}

const askBot = (question, answer) => {
  chatMessages.value.push({ sender: 'user', text: question })
  setTimeout(() => {
    chatMessages.value.push({ sender: 'bot', text: answer })
    scrollChatBottom()
  }, 400)
}

const sendBotMessage = () => {
  if (botInput.value.trim() === '') return
  const text = botInput.value
  chatMessages.value.push({ sender: 'user', text })
  botInput.value = ''
  scrollChatBottom()

  setTimeout(() => {
    let reply = "Xin lỗi, câu hỏi này nằm ngoài ngân hàng câu hỏi pháp lý đã được biên soạn sẵn. Bạn vui lòng liên hệ hotline 0903.480.985 để được các cán bộ chuyên môn giải đáp chi tiết."
    const cleanText = text.toLowerCase()
    
    if (cleanText.includes('vay') || cleanText.includes('vốn') || cleanText.includes('tiền')) {
      reply = "Theo Quyết định 22/2023/QĐ-TTg, bạn được hỗ trợ vay vốn sản xuất tối đa 100 triệu đồng và vay học nghề tối đa 4 triệu đồng/tháng qua Ngân hàng Chính sách Xã hội."
    } else if (cleanText.includes('xóa') || cleanText.includes('án tích') || cleanText.includes('lý lịch')) {
      reply = "Thủ tục xóa án tích được quy định tại Bộ luật Hình sự. Khi đủ thời hạn quy định, bạn gửi hồ sơ đề nghị cấp Phiếu lý lịch tư pháp tại Sở Tư pháp tỉnh/thành phố nơi bạn có hộ khẩu thường trú."
    } else if (cleanText.includes('nghề') || cleanText.includes('học') || cleanText.includes('việc làm')) {
      reply = "Nghị định 49/2020/NĐ-CP quy định người chấp hành xong án phạt tù được hỗ trợ tư vấn học nghề và giới thiệu việc làm miễn phí thông qua trung tâm dịch vụ việc làm của Sở LĐ-TB&XH."
    } else if (cleanText.includes('hotline') || cleanText.includes('liên hệ') || cleanText.includes('điện thoại')) {
      reply = "Đường dây nóng của Ban chỉ đạo Đề án là 0903.480.985. Hỗ trợ 24/7."
    }

    chatMessages.value.push({ sender: 'bot', text: reply })
    scrollChatBottom()
  }, 600)
}

const scrollChatBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
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
  position: absolute;
  top: 35px;
  left: 0;
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

/* Header Nav Row */
.header-nav-row {
  background-color: var(--white);
  height: 50px;
  display: flex;
  align-items: center;
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
}

.nav-item {
  text-decoration: none;
  color: var(--text-medium);
  font-weight: 700;
  font-size: 0.9rem;
  padding: 12px 2px;
  display: block;
  white-space: nowrap;
  position: relative;
  transition: var(--transition);
}

.cursor-pointer {
  cursor: pointer;
}

.nav-item:hover, .active-item {
  color: var(--primary);
}

.nav-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 3px;
  background-color: var(--secondary);
  transition: var(--transition);
}

.nav-item:hover::after, .active-item::after {
  width: 100%;
}

/* Dropdown Menu */
.has-dropdown {
  position: relative;
}

.arrow {
  font-size: 0.55rem;
  margin-left: 2px;
  display: inline-block;
  transition: var(--transition);
}

.has-dropdown:hover .arrow {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background-color: var(--white);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-sm);
  padding: 8px 0;
  min-width: 210px;
  list-style: none;
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
  z-index: 102;
  transition: var(--transition);
}

.has-dropdown:hover .dropdown-menu, .dropdown-menu.is-show {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.dropdown-menu a {
  display: block;
  padding: 10px 20px;
  text-decoration: none;
  color: var(--text-medium);
  font-size: 0.85rem;
  font-weight: 600;
  transition: var(--transition);
}

.dropdown-menu a:hover {
  background-color: var(--bg-light);
  color: var(--primary);
  padding-left: 24px;
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
  padding-top: 165px;
  min-height: calc(100vh - 165px);
  transition: var(--transition);
}

.main-content.has-sticky-padding {
  padding-top: 165px;
}

/* Mobile Toggle */
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

/* Chatbot Styles */
.chatbot-toggle-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background-color: var(--primary);
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 50px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 999;
  font-weight: bold;
  transition: var(--transition);
}

.chatbot-toggle-btn:hover {
  background-color: var(--primary-dark);
  transform: translateY(-2px);
}

.chatbot-popup {
  position: fixed;
  bottom: 90px;
  right: 24px;
  width: 360px;
  height: 480px;
  background-color: white;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  z-index: 999;
  overflow: hidden;
  opacity: 0;
  transform: translateY(20px) scale(0.95);
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.1);
}

.chatbot-popup.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.chatbot-header {
  background-color: var(--primary);
  color: white;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chatbot-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bot-avatar {
  font-size: 1.5rem;
}

.chatbot-title h4 {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
}

.chatbot-title p {
  font-size: 0.72rem;
  opacity: 0.8;
  margin: 0;
}

.close-bot-btn {
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
}

.chatbot-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #f7f9f6;
}

.chat-msg {
  display: flex;
}

.chat-msg.user {
  justify-content: flex-end;
}

.msg-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.88rem;
  line-height: 1.4;
}

.chat-msg.bot .msg-bubble {
  background-color: var(--white);
  color: var(--text-dark);
  border-bottom-left-radius: 2px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.chat-msg.user .msg-bubble {
  background-color: var(--secondary);
  color: white;
  border-bottom-right-radius: 2px;
}

.chatbot-quick-questions {
  padding: 8px 16px;
  background-color: #f7f9f6;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-top: 1px solid rgba(0,0,0,0.05);
}

.quick-q-btn {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: var(--transition);
}

.quick-q-btn:hover {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

.chatbot-input-area {
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--border-color);
}

.chatbot-input-area input {
  flex: 1;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  font-size: 0.88rem;
  outline: none;
}

.chatbot-input-area input:focus {
  border-color: var(--primary);
}

.send-bot-btn {
  background-color: var(--primary);
  color: white;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition);
}

.send-bot-btn:hover {
  background-color: var(--primary-dark);
}

/* Tablet & Mobile responsive */
@media (max-width: 1200px) {
  .logo-title { font-size: 1.1rem; }
  .logo-subtitle { font-size: 0.6rem; }
  .nav-item { font-size: 0.8rem; }
}

@media (max-width: 1024px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 900px) {
  .menu-toggle {
    display: flex;
  }
  
  .header-nav-row {
    display: none;
  }

  .main-nav {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background-color: white;
    border-bottom: 1px solid var(--border-color);
    box-shadow: var(--shadow-md);
    opacity: 0;
    pointer-events: none;
    transform: translateY(-10px);
    transition: var(--transition);
    display: block;
  }
  
  .main-nav.is-open {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
  
  .nav-links {
    flex-direction: column;
    padding: 20px;
    gap: 16px;
  }
  
  .dropdown-menu {
    position: static;
    opacity: 1;
    pointer-events: auto;
    transform: none;
    box-shadow: none;
    padding-left: 20px;
    background-color: var(--bg-light);
    margin-top: 8px;
  }
  
  .btn-support-247 {
    display: none;
  }

  .footer-grid {
    grid-template-columns: 1fr;
  }

  .footer-bottom-content {
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  
  .bar-open-1 { transform: rotate(45deg) translate(5px, 5px); }
  .bar-open-2 { opacity: 0; }
  .bar-open-3 { transform: rotate(-45deg) translate(6px, -6px); }

  .chatbot-popup {
    width: 90vw;
    right: 5vw;
    left: 5vw;
  }
}
</style>
