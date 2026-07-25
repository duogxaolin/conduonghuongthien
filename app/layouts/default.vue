<template>
  <div class="app-layout">
    <ToastContainer />
    <!-- Mobile Menu Overlay -->
    <div
      class="fixed inset-0 w-screen h-screen bg-[rgba(20,43,23,0.58)] backdrop-blur-[2px] z-[10000] opacity-0 pointer-events-none transition-opacity duration-300"
      :class="{ 'opacity-100 pointer-events-auto': isMobileMenuOpen }"
      @click="toggleMobileMenu"
    ></div>

    <!-- Top Bar -->
    <div class="bg-[#385130] text-white py-2 text-[0.82rem] border-b border-white/10 relative z-[101]">
      <div class="container flex justify-between items-center">
        <div class="flex items-center gap-4">
          <span><i class="fa-solid fa-phone" aria-hidden="true"></i> {{ t('hotline_lbl') }}: 0903.480.985</span>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex items-center">
            <button
              v-for="locale in locales"
              :key="`top-${locale.code}`"
              :class="currentLang === locale.code ? 'text-white bg-[#4A6741] rounded' : 'text-white/70'"
              class="bg-transparent border-none font-semibold cursor-pointer text-[0.78rem] px-1.5 py-0.5 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9CCC65]"
              :aria-label="locale.name"
              :aria-pressed="currentLang === locale.code"
              @click="setLang(locale.code)">{{ locale.label }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Header -->
    <header
      class="main-header bg-white w-full z-[10001] border-b border-[#E2E8DF] transition-all"
      :class="isSticky ? 'fixed top-0 shadow-md' : 'relative'"
    >
      <!-- Dòng 1: Logo & Các nút hành động nhanh -->
      <div class="border-b border-[#E2E8DF] bg-white">
        <div class="container flex justify-between items-center h-16 lg:h-20">
          <!-- Logo Area -->
          <nuxt-link to="/" class="flex items-center gap-[14px] no-underline">
            <div>
              <img class="h-9 lg:h-[50px] w-auto object-contain" src="/Logo.png" alt="Logo Con Đường Hướng Thiện" />
            </div>
            <div>
              <h1 class="text-[0.95rem] lg:text-[1.35rem] font-extrabold text-[#4A6741] tracking-[0.5px] leading-[1.2]">CON ĐƯỜNG HƯỚNG THIỆN</h1>
              <p class="hidden lg:block text-[0.72rem] font-semibold text-[#7A8675] uppercase mt-0.5">Cổng thông tin điện tử hỗ trợ tái hòa nhập cộng đồng — Bộ Công an</p>
            </div>
          </nuxt-link>

          <!-- Top Actions -->
          <div class="flex items-center gap-3">
            <button
              class="bg-[#F8FAF7] border border-[#E2E8DF] w-[38px] h-[38px] rounded-full flex items-center justify-center cursor-pointer text-[0.95rem] transition-all hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]"
              :class="{ 'bg-[#4A6741] text-white border-[#4A6741]': isSearchActive }"
              @click="toggleSearch"
              :aria-label="isSearchActive ? t('search_close') : t('search_open')"
              :aria-expanded="isSearchActive">
              <i :class="isSearchActive ? 'fa-solid fa-xmark' : 'fa-solid fa-magnifying-glass'"></i>
            </button>
            <nuxt-link to="/contact" class="hidden lg:inline-flex items-center gap-2 btn btn-primary px-5 py-2.5 text-[0.85rem] rounded-sm">
              <i class="fa-solid fa-headset"></i> {{ t('support_247') }}
            </nuxt-link>
            <!-- Mobile Toggle -->
            <button
              class="md:hidden flex flex-col justify-center items-center gap-1 w-11 h-11 rounded-xl bg-[#f0f6ef] border border-[#d9e7d7] text-[#1e4620] cursor-pointer transition-all z-[10003] hover:bg-[#e4f0e2]"
              @click="toggleMobileMenu"
              :aria-label="isMobileMenuOpen ? t('menu_close') : t('menu_open')"
              :aria-expanded="isMobileMenuOpen">
              <span class="block w-5 h-[2px] rounded-[4px] bg-current transition-transform" :class="{ 'translate-y-[3px] rotate-45': isMobileMenuOpen }"></span>
              <span class="block w-5 h-[2px] rounded-[4px] bg-current transition-opacity" :class="{ 'opacity-0': isMobileMenuOpen }"></span>
              <span class="block w-5 h-[2px] rounded-[4px] bg-current transition-transform" :class="{ '-translate-y-[3px] -rotate-45': isMobileMenuOpen }"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Mobile Drawer Nav -->
      <nav
        class="fixed top-0 w-[min(88vw,380px)] max-w-full h-[100dvh] flex flex-col bg-white shadow-[-12px_0_40px_rgba(15,35,18,0.24)] z-[10002] transition-[right] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden md:hidden"
        :class="isMobileMenuOpen ? 'right-0' : '-right-full'"
        @click="onNavClick" @keydown.escape="toggleMobileMenu"
      >
        <!-- Drawer Header -->
        <div class="flex items-center justify-between px-5 py-[18px] bg-gradient-to-br from-[#1e4620] to-[#133215] text-white border-b border-white/10 z-[2] flex-shrink-0">
          <div class="flex items-center gap-3">
            <img src="/Logo.png" alt="Logo Con Đường Hướng Thiện" class="h-9 w-auto object-contain drop-shadow-md" />
            <div class="flex flex-col">
              <span class="text-[0.85rem] font-extrabold tracking-[0.4px] text-white leading-[1.2]">CON ĐƯỜNG HƯỚNG THIỆN</span>
              <span class="text-[0.65rem] text-white/75 font-medium mt-0.5">Cổng thông tin điện tử C11 - Bộ Công an</span>
            </div>
          </div>
          <button
            class="w-[34px] h-[34px] rounded-full border border-white/20 bg-white/[0.12] text-white text-[0.95rem] flex items-center justify-center cursor-pointer transition-all active:bg-white/25 active:scale-[0.92]"
            @click.stop="toggleMobileMenu" :aria-label="t('menu_close')">✕</button>
        </div>

        <!-- Drawer Locale Switcher -->
        <div class="flex justify-end items-center px-[18px] py-2.5 bg-[#f0f6ef] border-b border-[#e1e8e0] flex-shrink-0">
          <div class="flex items-center" role="group" :aria-label="t('language_switcher')">
            <button
              v-for="locale in locales"
              :key="`drawer-${locale.code}`"
              :class="currentLang === locale.code ? 'text-white bg-[#4A6741] rounded' : 'text-[#1e4620]/70'"
              class="bg-transparent border-none font-semibold cursor-pointer text-[0.78rem] px-1.5 py-0.5 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4A6741]"
              :aria-label="locale.name"
              :aria-pressed="currentLang === locale.code"
              @click="setLang(locale.code)">{{ locale.label }}</button>
          </div>
        </div>

        <!-- Drawer Search -->
        <div class="px-4 pt-3 pb-1 bg-[#fcfdfe] border-b border-[rgba(30,70,32,0.06)] flex-shrink-0">
          <div class="flex items-center bg-[rgba(30,70,32,0.05)] border border-[rgba(30,70,32,0.12)] rounded-[10px] px-3 py-2 gap-2">
            <span class="text-[0.85rem] opacity-60">🔍</span>
            <input type="text" :placeholder="t('search_placeholder')" v-model="searchQuery" @keyup.enter="handleSearch" class="border-none bg-transparent w-full text-[0.88rem] text-[#1E251C] outline-none" />
            <button v-if="searchQuery" class="border-none bg-black/10 rounded-full w-[18px] h-[18px] text-[0.65rem] flex items-center justify-center cursor-pointer text-[#555]" @click="searchQuery = ''">✕</button>
          </div>
        </div>

        <!-- Drawer Body -->
        <div class="flex-1 flex flex-col justify-between overflow-y-auto [-webkit-overflow-scrolling:touch]">
          <ul class="list-none flex flex-col px-3.5 pt-3.5 pb-5 gap-1">
            <li v-for="item in navMenu" :key="item.id">
              <!-- Has children: accordion -->
              <template v-if="item.children && item.children.length">
                <div
                  class="no-underline text-[#1E251C] font-semibold text-[0.95rem] px-4 py-3 rounded-[10px] flex justify-between items-center cursor-pointer transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-[#4A6741]"
                  @click.stop="toggleMobileSubmenu(item.id)"
                >
                  <component
                    :is="item.url && item.url !== '#' ? NuxtLink : 'span'"
                    v-bind="item.url && item.url !== '#' ? { to: item.url, class: 'text-inherit no-underline' } : {}"
                    @click.stop
                  >{{ navItemLabel(item) }}</component>
                  <i class="fa-solid fa-chevron-down text-[0.65rem] opacity-70 transition-transform duration-200" :class="{ 'rotate-180': mobileOpenSubmenu === item.id }" aria-hidden="true"></i>
                </div>
                <ul v-if="mobileOpenSubmenu === item.id" class="list-none static opacity-100 pointer-events-auto transform-none shadow-none p-1.5 pl-3.5 bg-[rgba(30,70,32,0.04)] border-l-[3px] border-[#4A6741] rounded-[0_10px_10px_0] my-1 ml-3">
                  <li v-for="child in item.children" :key="child.id">
                    <component
                      :is="child.url && child.url.startsWith('http') ? 'a' : NuxtLink"
                      v-bind="child.url && child.url.startsWith('http') ? { href: child.url, target: child.openNewTab ? '_blank' : undefined, rel: child.openNewTab ? 'noopener noreferrer' : undefined } : { to: child.url }"
                      class="block px-3.5 py-2.5 text-[0.88rem] font-medium text-[#4A5545] rounded-lg no-underline transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-[#4A6741]"
                    >{{ navItemLabel(child) }}</component>
                  </li>
                </ul>
              </template>
              <!-- No children: simple link -->
              <template v-else>
                <component
                  :is="item.url && item.url.startsWith('http') ? 'a' : NuxtLink"
                  v-bind="item.url && item.url.startsWith('http') ? { href: item.url, target: item.openNewTab ? '_blank' : undefined, rel: item.openNewTab ? 'noopener noreferrer' : undefined } : { to: item.url, 'active-class': 'bg-[rgba(30,70,32,0.08)] text-[#4A6741] font-extrabold' }"
                  class="no-underline text-[#1E251C] font-semibold text-[0.95rem] px-4 py-3 rounded-[10px] flex justify-between items-center transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-[#4A6741]"
                >{{ navItemLabel(item) }}</component>
              </template>
            </li>
          </ul>

          <!-- Drawer Footer -->
          <div class="px-4 py-4 bg-[#f8faf7] border-t border-black/[0.06] flex flex-col gap-2.5 flex-shrink-0">
            <a href="tel:0903480985" class="flex items-center gap-3 bg-white px-3.5 py-3 rounded-[14px] border border-[rgba(30,70,32,0.12)] no-underline shadow-sm">
              <span class="text-xl">📞</span>
              <div class="flex flex-col">
                <span class="text-[0.72rem] text-[#7A8675] font-semibold">{{ t('hotline_lbl') }}</span>
                <span class="text-[0.95rem] font-extrabold text-[#4A6741]">0903.480.985</span>
              </div>
            </a>
            <nuxt-link to="/contact" class="btn btn-primary w-full flex items-center justify-center gap-2 px-4 py-3 text-[0.88rem] font-bold rounded-xl" @click="isMobileMenuOpen = false">
              <span class="w-1.5 h-1.5 bg-[#7CB342] rounded-full inline-block animate-pulse"></span> Đăng ký tư vấn ngay
            </nuxt-link>
          </div>
        </div>
      </nav>
      <div class="hidden md:flex bg-white border-t border-[#edf2ec] border-b border-[#e1e8e0] h-[50px] items-center shadow-[0_4px_12px_rgba(15,35,18,0.04)] transition-all">
        <div class="container w-full overflow-x-auto scrollbar-hide">
          <nav class="flex w-max min-w-full" @click="onNavClick" @keydown.escape="toggleMobileMenu">
            <ul class="flex list-none w-full justify-between items-center gap-1">
              <li v-for="item in navMenu" :key="item.id" :class="item.children && item.children.length ? 'relative group' : ''">
                <!-- With children: dropdown -->
                <template v-if="item.children && item.children.length">
                  <div class="nav-item no-underline text-[#1e4620] font-bold text-[0.8rem] px-2 lg:text-[0.88rem] lg:px-3 py-2 rounded-lg flex items-center gap-1 whitespace-nowrap cursor-pointer transition-all hover:bg-[#f0f6ef] hover:text-[#143516]">
                    <component
                      :is="item.url && item.url !== '#' ? NuxtLink : 'span'"
                      v-bind="item.url && item.url !== '#' ? { to: item.url, 'active-class': 'active-item', class: 'text-inherit no-underline' } : {}"
                    >{{ navItemLabel(item) }}</component>
                    <i class="fa-solid fa-chevron-down text-[0.55rem] ml-0.5 text-[#557757] transition-transform duration-200 group-hover:rotate-180" aria-hidden="true"></i>
                  </div>
                  <ul class="absolute top-[calc(100%+4px)] left-0 bg-white shadow-[0_14px_36px_rgba(15,35,18,0.18),0_2px_8px_rgba(0,0,0,0.04)] rounded-xl border border-[rgba(30,70,32,0.12)] p-2 min-w-[220px] list-none opacity-0 translate-y-2 scale-[0.97] pointer-events-none z-[102] transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-hover:pointer-events-auto">
                    <li v-for="child in item.children" :key="child.id">
                      <component
                        :is="child.url && child.url.startsWith('http') ? 'a' : NuxtLink"
                        v-bind="child.url && child.url.startsWith('http') ? { href: child.url, target: child.openNewTab ? '_blank' : undefined, rel: child.openNewTab ? 'noopener noreferrer' : undefined } : { to: child.url }"
                        class="block px-3.5 py-2.5 no-underline text-[#2d4a2d] text-[0.86rem] font-semibold rounded-lg transition-all hover:bg-[rgba(30,70,32,0.07)] hover:text-[#1e4620] hover:pl-[18px]"
                      >{{ navItemLabel(child) }}</component>
                    </li>
                  </ul>
                </template>
                <!-- No children: simple link -->
                <template v-else>
                  <component
                    :is="item.url && item.url.startsWith('http') ? 'a' : NuxtLink"
                    v-bind="item.url && item.url.startsWith('http') ? { href: item.url, target: item.openNewTab ? '_blank' : undefined, rel: item.openNewTab ? 'noopener noreferrer' : undefined } : { to: item.url, 'active-class': 'active-item bg-[#e4f0e2] font-extrabold' }"
                    class="nav-item no-underline text-[#1e4620] font-bold text-[0.8rem] px-2 lg:text-[0.88rem] lg:px-3 py-2 rounded-lg flex items-center gap-1 whitespace-nowrap relative transition-all hover:bg-[#f0f6ef] hover:text-[#143516]"
                  >{{ navItemLabel(item) }}</component>
                </template>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      <!-- Search Dropdown Bar -->
      <transition name="slide-down">
        <div class="absolute top-full left-0 w-full bg-[#4A6741] py-4 shadow-md z-[99]" v-if="isSearchActive">
          <div class="container flex flex-col sm:flex-row gap-4 items-center">
            <div class="relative flex-1 w-full">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7A8675]">🔍</span>
              <input
                type="text"
                placeholder="Nhập nội dung cần tìm kiếm trên website..."
                v-model="searchQuery"
                @keyup.enter="handleSearch"
                ref="searchInputRef"
                class="w-full py-3 pl-[42px] pr-3.5 rounded-sm border-none font-[inherit] text-[0.95rem] outline-none"
              />
            </div>
            <div class="flex gap-2 w-full sm:w-auto">
              <button class="flex-1 sm:flex-none bg-[#7CB342] text-white border-none px-6 py-3 rounded-sm font-bold text-[0.9rem] cursor-pointer transition-all hover:opacity-90" @click="handleSearch">Tìm kiếm</button>
              <button class="flex-1 sm:flex-none bg-transparent text-white border border-white/30 px-4 py-3 rounded-sm text-[0.9rem] cursor-pointer transition-all hover:bg-white/10" @click="toggleSearch">Đóng ×</button>
            </div>
          </div>
        </div>
      </transition>
    </header>

    <!-- Main Content Area -->
    <main
      class="min-h-[calc(100vh-165px)] transition-all pb-24 md:pb-0"
      :class="{ 'pt-[100px] md:pt-[130px]': isSticky }"
    >
      <slot />
    </main>

    <!-- Footer Area -->
    <footer class="bg-[#385130] text-white/80 pt-20 border-t-4 border-[#7CB342] md:pb-0 pb-20">
      <div class="container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr] gap-8 lg:gap-10 mb-12 lg:mb-16">
        <div>
          <div class="flex items-center gap-3 mb-5">
            <img src="/Logo.png" alt="Logo Con Đường Hướng Thiện" class="h-9 w-auto object-contain" />
            <span class="text-white font-extrabold text-[1.2rem] tracking-[0.5px]">CON ĐƯỜNG HƯỚNG THIỆN</span>
          </div>
          <p class="text-[0.9rem] leading-relaxed">
            Trang thông tin điện tử dưới sự chỉ đạo sát sao của Bộ Công an, Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11).
          </p>
        </div>

        <div>
          <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">Liên kết chính</h3>
          <ul class="list-none space-y-3">
            <li><nuxt-link to="/" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Trang chủ</nuxt-link></li>
            <li><nuxt-link to="/about" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Giới thiệu ban biên tập</nuxt-link></li>
            <li><nuxt-link to="/news" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Bản tin hoạt động</nuxt-link></li>
            <li><nuxt-link to="/documents" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Văn bản pháp luật mới</nuxt-link></li>
          </ul>
        </div>

        <div>
          <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">Tái hòa nhập</h3>
          <ul class="list-none space-y-3">
            <li><nuxt-link to="/role-models" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Tấm gương tiêu biểu hoàn lương</nuxt-link></li>
            <li><nuxt-link to="/reintegration-models" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Các mô hình kinh tế hỗ trợ</nuxt-link></li>
            <li><nuxt-link to="/legal-qa" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Giải đáp pháp luật trực tuyến</nuxt-link></li>
            <li><nuxt-link to="/contact" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Thông tin đường dây nóng</nuxt-link></li>
          </ul>
        </div>

        <div>
          <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">Thông tin liên hệ</h3>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Cơ quan chủ quản:</strong> C11 - Bộ Công an</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Địa chỉ:</strong> Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Điện thoại:</strong> 0903.480.985</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Email:</strong> contact@conduonghuongthien.com.vn</p>
        </div>
      </div>

      <div class="border-t border-white/[0.08] py-6 text-[0.85rem]">
        <div class="container flex flex-col sm:flex-row justify-between items-center gap-3 text-center sm:text-left">
          <p>&copy; 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.</p>
          <p><a href="https://www.facebook.com/hi.duogxaolin" target="_blank" rel="noopener noreferrer" class="text-white/70 no-underline font-semibold transition-all hover:text-[#7CB342] hover:underline">Design by Delify.vn</a></p>
        </div>
      </div>
    </footer>

    <!-- Chatbot Popup (client-only: uses localStorage history, skip SSR to avoid hydration mismatch) -->
    <div
      v-if="clientMounted"
      id="public-chatbot-dialog"
      ref="chatbotDialog"
      class="fixed inset-0 w-screen h-[100dvh] bg-[#f0f4ef] flex flex-col z-[99999] overflow-hidden opacity-0 pointer-events-none translate-y-[20px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none md:inset-auto md:fixed md:right-5 md:bottom-5 md:w-[400px] md:h-[min(600px,calc(100dvh-100px))] md:rounded-2xl md:shadow-[0_25px_60px_rgba(0,0,0,0.2)] md:border md:border-black/10 md:translate-y-3 md:scale-[0.96]"
      :class="{ '!opacity-100 !pointer-events-auto !translate-y-0 md:!scale-100': isChatbotOpen }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-chatbot-title"
      :aria-hidden="!isChatbotOpen"
      :inert="!isChatbotOpen"
      @keydown="handleChatbotDialogKeydown"
    >
        <!-- Header -->
        <div class="flex-shrink-0 bg-[#1e4620] px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3 md:pt-3 md:rounded-t-2xl">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <button class="md:hidden w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/90 text-[0.9rem] border-none cursor-pointer transition-all active:scale-90" @click="closeChatbot" aria-label="Quay lại">
                <i class="fa-solid fa-arrow-left"></i>
              </button>
              <div class="w-10 h-10 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
                <i class="fa-solid fa-robot text-white text-[1.1rem]"></i>
              </div>
              <div>
                <h4 id="public-chatbot-title" class="text-[0.95rem] font-bold text-white m-0 leading-tight">Trợ lý Hướng Thiện</h4>
                <p class="text-[0.7rem] text-white/60 mt-0.5 mb-0 flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-[#7CB342] inline-block animate-pulse" aria-hidden="true"></span>
                  Đang hoạt động
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <button class="w-8 h-8 rounded-full bg-white/10 border-none text-white/80 flex items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90" @click="clearChatHistory" title="Xóa lịch sử" aria-label="Xóa lịch sử">
                <i class="fa-solid fa-broom text-[0.8rem]"></i>
              </button>
              <button ref="chatCloseButton" class="hidden md:flex w-8 h-8 rounded-full bg-white/10 border-none text-white/80 items-center justify-center cursor-pointer transition-all hover:bg-white/20 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" @click="closeChatbot" aria-label="Đóng">
                <i class="fa-solid fa-xmark text-[0.9rem]"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div ref="chatContainer" class="flex-1 px-4 py-5 overflow-y-auto overscroll-contain flex flex-col gap-4" aria-live="polite" aria-relevant="additions text">
          <!-- Welcome card -->
          <div v-if="chatMessages.length <= 1" class="mx-auto mt-4 mb-2 max-w-[280px] text-center">
            <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-[#1e4620]/10 flex items-center justify-center">
              <i class="fa-solid fa-shield-halved text-[#1e4620] text-[1.4rem]"></i>
            </div>
            <p class="text-[0.82rem] text-[#4A5545] leading-relaxed m-0">Xin chào! Tôi hỗ trợ tra cứu thông tin từ kho dữ liệu đã được <strong class="text-[#1e4620]">Cục C11</strong> phê duyệt.</p>
          </div>

          <template v-for="(msg, index) in chatMessages" :key="msg.id || index">
            <div v-if="msg.id !== 'welcome'" class="flex gap-2.5" :class="msg.sender === 'user' ? 'justify-end' : 'justify-start'">
              <!-- Bot avatar -->
              <div v-if="msg.sender === 'bot'" class="w-7 h-7 rounded-full bg-[#1e4620] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm" aria-hidden="true">
                <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
              </div>
              <!-- Message bubble -->
              <div
                class="max-w-[80%] break-words px-4 py-3 text-[0.875rem] leading-[1.55]"
                :class="msg.sender === 'bot'
                  ? 'bg-white text-[#1f2937] rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                  : 'bg-[#1e4620] text-white rounded-[18px_4px_18px_18px] shadow-[0_2px_8px_rgba(30,70,32,0.2)]'"
              >
                <p class="m-0 whitespace-pre-wrap">{{ msg.text }}</p>
                <p v-if="msg.kind && msg.sender === 'bot'" class="mt-2 mb-0 text-[0.7rem] font-semibold flex items-center gap-1" :class="messageKindClass(msg.kind)" role="status">
                  <i class="fa-solid" :class="msg.kind === 'curated' || msg.kind === 'provider' ? 'fa-circle-check text-[#1e4620]' : 'fa-circle-exclamation text-[#9a3412]'" aria-hidden="true"></i>
                  {{ messageKindLabel(msg.kind) }}
                </p>
                <ul v-if="msg.sources?.length" class="mt-2 mb-0 space-y-1 border-t border-[#e1e8e0] pt-2 list-none pl-0" aria-label="Nguồn tham khảo">
                  <li v-for="source in msg.sources" :key="source.id" class="text-[0.7rem] leading-snug text-[#4A5545]">
                    <i class="fa-solid fa-link text-[0.55rem] text-[#7CB342] mr-1" aria-hidden="true"></i>
                    <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1e4620] underline underline-offset-2">{{ source.label }}</a>
                    <span v-else class="font-semibold">{{ source.label }}</span>
                    <span v-if="source.reference" class="text-[#6b7280]"> — {{ source.reference }}</span>
                  </li>
                </ul>
                <span v-if="msg.isStreaming" class="inline-block ml-0.5 text-[#7CB342] font-bold animate-[blinkCursor_0.6s_infinite] motion-reduce:animate-none" aria-hidden="true">▌</span>
              </div>
            </div>
          </template>

          <!-- Typing indicator -->
          <div v-if="isSubmitting" class="flex gap-2.5 justify-start">
            <div class="w-7 h-7 rounded-full bg-[#1e4620] flex items-center justify-center flex-shrink-0 shadow-sm">
              <i class="fa-solid fa-robot text-white text-[0.65rem]"></i>
            </div>
            <div class="bg-white px-4 py-3 rounded-[4px_18px_18px_18px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div class="flex gap-1 items-center">
                <span class="w-2 h-2 bg-[#1e4620]/40 rounded-full animate-bounce [animation-delay:0ms]"></span>
                <span class="w-2 h-2 bg-[#1e4620]/40 rounded-full animate-bounce [animation-delay:150ms]"></span>
                <span class="w-2 h-2 bg-[#1e4620]/40 rounded-full animate-bounce [animation-delay:300ms]"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Questions (collapsible) -->
        <div v-if="quickQuestionState === 'success' && quickQuestions.length" class="flex-shrink-0 border-t border-[#e1e8e0]">
          <button type="button" class="w-full px-4 py-2 bg-white text-[0.75rem] font-semibold text-[#4A5545] flex items-center justify-between border-none cursor-pointer transition-all hover:bg-[#f8faf8]" @click="isQuickQuestionsExpanded = !isQuickQuestionsExpanded">
            <span class="flex items-center gap-1.5"><i class="fa-solid fa-lightbulb text-[#7CB342] text-[0.7rem]" aria-hidden="true"></i> Câu hỏi gợi ý</span>
            <i class="fa-solid fa-chevron-up text-[0.6rem] transition-transform duration-200" :class="{ 'rotate-180': !isQuickQuestionsExpanded }" aria-hidden="true"></i>
          </button>
          <div v-show="isQuickQuestionsExpanded" class="px-3.5 pb-2.5 bg-white">
            <div class="flex flex-wrap gap-1.5 max-h-[68px] overflow-y-auto overscroll-contain">
              <button
                v-for="question in quickQuestions"
                :key="question.id"
                type="button"
                :disabled="isSubmitting"
                @click="askBot(question.question)"
                class="bg-[#f0f6ef] border border-[#d4e4d2] text-[#2d4a2d] px-2.5 py-1 rounded-full text-[0.72rem] font-medium whitespace-nowrap cursor-pointer transition-all hover:bg-[#1e4620] hover:text-white hover:border-[#1e4620] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >{{ question.question }}</button>
            </div>
          </div>
        </div>

        <!-- Input Form -->
        <div class="flex-shrink-0 bg-white border-t border-[#e1e8e0] px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] md:pb-3 md:rounded-b-2xl">
          <form class="flex items-end gap-2" @submit.prevent="sendBotMessage">
            <div class="flex-1 min-w-0">
              <label for="public-chatbot-input" class="sr-only">Nhập câu hỏi cho trợ lý</label>
              <input
                id="public-chatbot-input"
                ref="botInputRef"
                type="text"
                placeholder="Hỏi tôi bất cứ điều gì..."
                v-model="botInput"
                :maxlength="CHATBOT_CLIENT_LIMITS.maxMessageChars"
                :aria-describedby="botInputError ? 'public-chatbot-error public-chatbot-counter' : 'public-chatbot-counter'"
                :aria-invalid="Boolean(botInputError)"
                :disabled="isSubmitting"
                class="w-full px-4 py-3 rounded-full border border-[#d4e4d2] text-[0.88rem] outline-none bg-[#f8faf8] transition-all focus:border-[#1e4620] focus:bg-white focus:shadow-[0_0_0_3px_rgba(30,70,32,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div v-if="botInputError" class="mt-1 px-4">
                <p id="public-chatbot-error" class="m-0 text-[0.7rem] text-[#b42318]" role="alert">{{ botInputError }}</p>
              </div>
            </div>
            <button type="submit" :disabled="isSubmitting || !botInput.trim()" class="w-11 h-11 rounded-full bg-[#1e4620] text-white border-none flex flex-shrink-0 items-center justify-center cursor-pointer transition-all hover:bg-[#153317] hover:shadow-[0_4px_12px_rgba(30,70,32,0.3)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[#a0b89e]" aria-label="Gửi tin nhắn">
              <i class="fa-solid fa-paper-plane text-[0.85rem]"></i>
            </button>
          </form>
          <p id="public-chatbot-counter" class="m-0 mt-1 text-[0.65rem] text-[#9ca3af] text-right px-2" :class="{ '!text-[#b42318]': botInput.length > CHATBOT_CLIENT_LIMITS.maxMessageChars * 0.9 }">{{ botInput.length }}/{{ CHATBOT_CLIENT_LIMITS.maxMessageChars }}</p>
        </div>
    </div>


    <!-- Chatbot Toggle Button + Teaser Bubble (client-only) -->
    <div v-if="clientMounted" class="fixed right-4 bottom-[88px] md:right-6 md:bottom-6 z-[10050] flex flex-col items-end gap-2 transition-all" :class="{ 'opacity-0 pointer-events-none scale-90': isChatbotOpen }">
      <!-- Teaser bubble -->
      <div
        v-if="chatTeaserVisible && !isChatbotOpen"
        class="relative max-w-[220px] bg-white text-[#1f2937] text-[0.8rem] leading-snug px-3.5 py-2.5 rounded-[16px_16px_4px_16px] shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-black/5 animate-[fadeSlideUp_0.3s_ease-out] cursor-pointer"
        @click="toggleChatbot"
      >
        <p class="m-0">{{ chatTeaserText }}</p>
        <button type="button" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#e5e7eb] text-[#6b7280] text-[0.6rem] flex items-center justify-center border-none cursor-pointer hover:bg-[#d1d5db]" @click.stop="dismissTeaser" aria-label="Đóng">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <!-- Toggle button -->
      <button
        ref="chatToggleButton"
        class="chatbot-toggle-btn flex bg-[#1e4620] text-white border border-white/20 px-4 py-2.5 pl-3.5 rounded-[50px] shadow-[0_8px_24px_rgba(30,70,32,0.25)] cursor-pointer items-center gap-2 font-bold text-[0.88rem] transition-all hover:-translate-y-0.5 hover:bg-[#153317] hover:shadow-[0_12px_30px_rgba(30,70,32,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] focus-visible:ring-offset-2 motion-reduce:transition-none"
        aria-controls="public-chatbot-dialog"
        :aria-expanded="isChatbotOpen"
        @click="toggleChatbot">
        <div class="flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <span class="bot-label">Hỏi trợ lý</span>
      </button>
    </div>

    <!-- Mobile Bottom Nav -->
    <nav
      class="fixed bottom-2.5 left-3 right-3 h-16 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(244,249,243,0.92)_100%)] backdrop-blur-md border border-white/90 rounded-[24px] shadow-[0_12px_32px_rgba(15,35,18,0.16)] z-[9900] flex justify-around items-center px-1.5 transition-all md:hidden"
      :class="{ 'opacity-0 pointer-events-none translate-y-4': isMobileMenuOpen || isChatbotOpen }"
      aria-label="Điều hướng nhanh"
      style="padding-bottom: env(safe-area-inset-bottom, 0px)"
    >
      <template v-for="item in bottomNav" :key="item.id">
        <!-- Featured raised center button -->
        <button
          v-if="item.featured"
          class="flex-1 relative flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#385130] max-w-[52px] font-extrabold text-[0.65rem] -top-3.5 cursor-pointer transition-all font-[inherit]"
          :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatbotOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
          @click="item.type === 'link' ? navigateTo(item.url) : onBottomNavClick(item)"
        >
          <div class="w-[50px] h-[50px] rounded-full bg-gradient-to-br from-[#2e6b32] to-[#173b18] text-white flex items-center justify-center shadow-[0_10px_24px_rgba(23,59,24,0.4),inset_0_2px_4px_rgba(255,255,255,0.4)] border-[3.5px] border-white/95 transition-all active:scale-90">
            <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.3rem]" aria-hidden="true"></i>
          </div>
          <span class="mt-0.5">{{ navItemLabel(item) }}</span>
        </button>

        <!-- Normal link item -->
        <nuxt-link
          v-else-if="item.type === 'link'"
          :to="item.url || '/'"
          class="flex-1 flex flex-col items-center justify-center gap-0.5 no-underline text-[#556655] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all active:text-[#4A6741]"
          active-class="text-[#4A6741]"
        >
          <div class="flex items-center justify-center px-3 py-0.5 rounded-2xl transition-all">
            <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.25rem]" aria-hidden="true"></i>
          </div>
          <span>{{ navItemLabel(item) }}</span>
        </nuxt-link>

        <!-- Action item (chatbot / drawer) -->
        <button
          v-else
          class="flex-1 flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#556655] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all font-[inherit]"
          :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatbotOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
          @click="onBottomNavClick(item)"
        >
          <div class="flex items-center justify-center px-3 py-0.5 rounded-2xl transition-all">
            <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.25rem]" aria-hidden="true"></i>
          </div>
          <span>{{ navItemLabel(item) }}</span>
        </button>
      </template>
    </nav>
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch, resolveComponent } from 'vue'

// Resolve NuxtLink once so runtime `:is` bindings render a real <a> (a string
// `:is="'nuxt-link'"` renders an inert custom element that never navigates).
const NuxtLink = resolveComponent('NuxtLink')

const clientMounted = ref(false) // true after onMounted — gates client-only UI (chatbot)
const isSticky = ref(false)
const isMobileMenuOpen = ref(false)
const isSearchActive = ref(false)
const searchQuery = ref('')
const showDropdown = ref(false)
const showLibraryDropdown = ref(false)
const showGovDropdown = ref(false)
const { currentLang, locales, t, setLang } = useI18n()
const searchInputRef = ref(null)
const liveDateTime = ref('')

// Dynamic nav menu from admin settings (falls back to DEFAULT_NAV)
const DEFAULT_NAV = [
  { id: 'home', label: null, labelKey: 'home', url: '/', children: [] },
  { id: 'about', label: null, labelKey: 'about', url: '/about', children: [] },
  {
    id: 'news', label: null, labelKey: 'news', url: '/news',
    children: [
      { id: 'news-featured', label: null, labelKey: 'news_featured', url: '/news/featured-news' },
      { id: 'news-activity', label: null, labelKey: 'news_activities', url: '/news/activity-news' },
      { id: 'news-local', label: null, labelKey: 'news_local', url: '/news/local-news' },
    ]
  },
  { id: 'role-models', label: null, labelKey: 'role_models', url: '/role-models', children: [] },
  { id: 'reintegration', label: null, labelKey: 'reintegration', url: '/reintegration-models', children: [] },
  { id: 'documents', label: null, labelKey: 'documents', url: '/documents', children: [] },
  { id: 'legal-qa', label: null, labelKey: 'faq', url: '/legal-qa', children: [] },
  { id: 'contact', label: null, labelKey: 'contact', url: '/contact', children: [] },
]

const navMenuRaw = ref(null) // null = use DEFAULT_NAV

const navMenu = computed(() => {
  if (Array.isArray(navMenuRaw.value) && navMenuRaw.value.length) return navMenuRaw.value
  return DEFAULT_NAV
})

// Mobile bottom navigation bar (floating tab bar). Different shape from navMenu:
// each item has an icon + a type ('link' | 'chatbot' | 'drawer') + featured flag.
const DEFAULT_BOTTOM_NAV = [
  { id: 'home', label: null, labelKey: 'home', icon: 'fa-solid fa-house', type: 'link', url: '/', featured: false },
  { id: 'news', label: null, labelKey: 'news', icon: 'fa-solid fa-newspaper', type: 'link', url: '/news', featured: false },
  { id: 'chatbot', label: null, labelKey: 'ask_ai', icon: 'fa-solid fa-comment-dots', type: 'chatbot', url: '', featured: true },
  { id: 'documents', label: null, labelKey: 'documents', icon: 'fa-solid fa-file-lines', type: 'link', url: '/documents', featured: false },
  { id: 'drawer', label: null, labelKey: 'categories', icon: 'fa-solid fa-bars', type: 'drawer', url: '', featured: false },
]

const bottomNavRaw = ref(null) // null = use DEFAULT_BOTTOM_NAV
const bottomNav = computed(() => {
  if (Array.isArray(bottomNavRaw.value) && bottomNavRaw.value.length) return bottomNavRaw.value
  return DEFAULT_BOTTOM_NAV
})

const navItemLabel = (item) => item.label || (item.labelKey ? t(item.labelKey) : item.url)

const onBottomNavClick = (item) => {
  if (item.type === 'chatbot') toggleChatbot()
  else if (item.type === 'drawer') toggleMobileMenu()
}

// Use useFetch so the payload is serialized from SSR and reused on client
// hydration without a second network request — eliminates nav data mismatch.
const { data: settingsData } = await useFetch('/api/public/settings', {
  key: 'public-settings-nav',
  default: () => null,
  lazy: false,
})

// Derive nav from the fetched settings (reactive — updates if data refetches)
const _parseNav = (raw) => { try { return JSON.parse(raw) } catch { return null } }
watch(settingsData, (res) => {
  if (!res?.settings) return
  const navbarRaw = res.settings.nav_menu_navbar || res.settings.nav_menu
  if (navbarRaw) navMenuRaw.value = _parseNav(navbarRaw)
  const mobileRaw = res.settings.nav_menu_mobile
  if (mobileRaw) bottomNavRaw.value = _parseNav(mobileRaw)
}, { immediate: true })

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
const pad = (n) => String(n).padStart(2, '0')

const updateLiveDate = () => {
  const now = new Date()
  liveDateTime.value = `${WEEKDAYS[now.getDay()]}, ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} - ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

let dateTimer = null

const CHATBOT_CLIENT_LIMITS = Object.freeze({
  maxMessageChars: 2000,
  maxOutputChars: 8000,
  maxHistoryMessages: 8,
  maxTotalUserChars: 30000,
  maxQuickQuestions: 8,
  maxSources: 3,
  maxSourceLabelChars: 160,
  maxSourceReferenceChars: 160,
})
const CHATBOT_RESPONSE_KINDS = new Set(['curated', 'provider', 'not_found', 'unavailable', 'rate_limited'])
const CHATBOT_STORAGE_KEY = 'cdkt_chat_history_v2'
const CHATBOT_WELCOME_MESSAGE = Object.freeze({
  id: 'welcome',
  sender: 'bot',
  text: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi chỉ hỗ trợ theo thông tin công khai trong kho dữ liệu đã được Cục C11 phê duyệt.',
})

const isChatbotOpen = ref(false)
const isSubmitting = ref(false)
const botInput = ref('')
const botInputError = ref('')
const chatContainer = ref(null)
const chatbotDialog = ref(null)
const botInputRef = ref(null)
const chatCloseButton = ref(null)
const chatToggleButton = ref(null)
const chatMessages = ref([{ ...CHATBOT_WELCOME_MESSAGE }])
const quickQuestions = ref([])
const quickQuestionState = ref('loading')
const isQuickQuestionsExpanded = ref(true)
let quickQuestionsController = null
let chatRequestController = null
let botRequestSequence = 0
let messageSequence = 0

// Chat teaser bubble logic
const CHAT_TEASER_MESSAGES = [
  'Bạn cần tìm hiểu về quyền lợi sau khi chấp hành xong án phạt tù?',
  'Tôi có thể giúp bạn tra cứu thủ tục xóa án tích miễn phí.',
  'Cần hỗ trợ tìm việc làm sau khi tái hòa nhập cộng đồng?',
  'Hỏi tôi về chính sách hỗ trợ vay vốn cho người hoàn lương nhé!',
  'Bạn muốn biết về các mô hình tái hòa nhập thành công?',
  'Tôi giúp bạn tìm hiểu quy trình đăng ký tạm trú sau mãn hạn tù.',
  'Cần tư vấn về quyền học nghề, học văn hóa miễn phí?',
]
const chatTeaserVisible = ref(false)
const chatTeaserText = ref('')
let teaserInterval = null
let teaserInitTimeout = null
let teaserDismissed = false

const showRandomTeaser = () => {
  if (isChatbotOpen.value || teaserDismissed) return
  const msg = CHAT_TEASER_MESSAGES[Math.floor(Math.random() * CHAT_TEASER_MESSAGES.length)]
  chatTeaserText.value = msg
  chatTeaserVisible.value = true
  // Auto-hide after 6s
  setTimeout(() => { chatTeaserVisible.value = false }, 6000)
}

const dismissTeaser = () => {
  chatTeaserVisible.value = false
  teaserDismissed = true
  if (teaserInterval) { clearInterval(teaserInterval); teaserInterval = null }
  if (teaserInitTimeout) { clearTimeout(teaserInitTimeout); teaserInitTimeout = null }
}

const startTeaserCycle = () => {
  if (teaserInterval || teaserInitTimeout) return
  // First teaser after 2s, then every 8s
  teaserInitTimeout = setTimeout(() => {
    teaserInitTimeout = null
    showRandomTeaser()
    teaserInterval = setInterval(showRandomTeaser, 8000)
  }, 2000)
}

const quickQuestionStatusText = computed(() => {
  if (quickQuestionState.value === 'loading') return 'Đang tải câu hỏi đã được phê duyệt…'
  if (quickQuestionState.value === 'error') return 'Hiện không thể tải câu hỏi gợi ý. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  if (quickQuestionState.value === 'empty') return 'Hiện chưa có câu hỏi gợi ý đã được phê duyệt. Bạn vẫn có thể nhập câu hỏi bên dưới.'
  return 'Câu hỏi gợi ý từ kho dữ liệu đã phê duyệt'
})

const messageKindLabel = (kind) => ({
  curated: 'Trả lời từ nội dung đã phê duyệt',
  provider: 'Giải thích có tham chiếu nội dung đã phê duyệt',
  not_found: 'Chưa tìm thấy thông tin phù hợp',
  unavailable: 'Dịch vụ tạm thời chưa sẵn sàng',
  rate_limited: 'Tạm giới hạn yêu cầu',
}[kind] || '')

const messageKindClass = (kind) => kind === 'not_found' || kind === 'unavailable' || kind === 'rate_limited'
  ? 'text-[#9a3412]'
  : 'text-[#385130]'

const normalizeQuickQuestion = (item) => {
  if (!item || typeof item !== 'object') return null
  const id = typeof item.id === 'number' || typeof item.id === 'string' ? String(item.id) : ''
  const question = typeof item.question === 'string' ? item.question.normalize('NFKC').trim() : ''
  if (!id || !question || question.length > CHATBOT_CLIENT_LIMITS.maxMessageChars) return null
  return { id, question }
}

const safeHttpsUrl = (value) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const normalizeSource = (item, index) => {
  if (!item || typeof item !== 'object') return null
  const rawSource = item.source && typeof item.source === 'object' ? item.source : item
  const label = typeof rawSource.label === 'string' ? rawSource.label.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxSourceLabelChars) : ''
  const reference = typeof rawSource.reference === 'string' ? rawSource.reference.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxSourceReferenceChars) : ''
  const url = safeHttpsUrl(rawSource.url)
  if (!label && !reference) return null
  return {
    id: `${typeof item.id === 'number' || typeof item.id === 'string' ? item.id : index}-${label}-${reference}`,
    label: label || 'Tài liệu công khai',
    reference,
    url,
  }
}

const loadQuickQuestions = async () => {
  if (quickQuestionsController) quickQuestionsController.abort()
  quickQuestionsController = new AbortController()
  quickQuestionState.value = 'loading'
  quickQuestions.value = []
  try {
    const response = await fetch('/api/public/chatbot/quick-questions', {
      headers: { Accept: 'application/json' },
      signal: quickQuestionsController.signal,
    })
    if (!response.ok) throw new Error('QUICK_QUESTIONS_UNAVAILABLE')
    const data = await response.json()
    const items = Array.isArray(data?.items)
      ? data.items.slice(0, CHATBOT_CLIENT_LIMITS.maxQuickQuestions).map(normalizeQuickQuestion).filter(Boolean)
      : []
    quickQuestions.value = items
    quickQuestionState.value = data?.ok === true && data?.available === true && items.length > 0 ? 'success' : 'empty'
  } catch (error) {
    if (error?.name !== 'AbortError') quickQuestionState.value = 'error'
  } finally {
    quickQuestionsController = null
  }
}


// rAF-throttled scroll handler: coalesces bursts of scroll events into one write
// per frame and only mutates `isSticky` when the boolean actually flips. Hysteresis
// (sticky >80, unsticky <60) prevents flicker right at the threshold. The listener
// is registered passive (see onMounted) so it never blocks the compositor.
let scrollTicking = false
const applyStickyState = () => {
  scrollTicking = false
  const y = window.scrollY
  const next = isSticky.value ? y > 60 : y > 80
  if (next !== isSticky.value) isSticky.value = next
}
const handleScroll = () => {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(applyStickyState)
}

const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

watch([isMobileMenuOpen, isChatbotOpen], ([isMenuOpen, isChatOpen]) => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = isMenuOpen || isChatOpen ? 'hidden' : ''
  }
})

const handleKeydown = (event) => {
  if (event.key === 'Escape' && isChatbotOpen.value) {
    closeChatbot()
    return
  }
  if (event.key === 'Escape' && isMobileMenuOpen.value) {
    isMobileMenuOpen.value = false
  }
}

const mobileOpenSubmenu = ref(null)

const toggleMobileSubmenu = (menuKey) => {
  mobileOpenSubmenu.value = mobileOpenSubmenu.value === menuKey ? null : menuKey
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
    navigateTo({ path: '/news', query: { q } })
    searchQuery.value = ''
    isSearchActive.value = false
  }
}


const handleChatbotDialogKeydown = (event) => {
  if (event.key === 'Escape') {
    closeChatbot()
    return
  }
  if (event.key !== 'Tab' || !chatbotDialog.value) return
  const focusable = [...chatbotDialog.value.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const openChatbot = async () => {
  isChatbotOpen.value = true
  chatTeaserVisible.value = false
  teaserDismissed = true
  if (teaserInterval) { clearInterval(teaserInterval); teaserInterval = null }
  if (teaserInitTimeout) { clearTimeout(teaserInitTimeout); teaserInitTimeout = null }
  if (quickQuestionState.value === 'error' || quickQuestionState.value === 'empty') loadQuickQuestions()
  await nextTick()
  chatCloseButton.value?.focus()
  scrollChatBottom()
}

const closeChatbot = async () => {
  isChatbotOpen.value = false
  await nextTick()
  chatToggleButton.value?.focus()
}

const toggleChatbot = () => {
  if (isChatbotOpen.value) closeChatbot()
  else openChatbot()
}

const normalizeStoredMessage = (item, index) => {
  if (!item || typeof item !== 'object' || (item.sender !== 'user' && item.sender !== 'bot')) return null
  const maxChars = item.sender === 'user' ? CHATBOT_CLIENT_LIMITS.maxMessageChars : CHATBOT_CLIENT_LIMITS.maxOutputChars
  const text = typeof item.text === 'string' ? item.text.normalize('NFKC').trim().slice(0, maxChars) : ''
  if (!text) return null
  if (item.sender === 'user') return { id: `stored-${index}`, sender: 'user', text }
  const kind = CHATBOT_RESPONSE_KINDS.has(item.kind) ? item.kind : undefined
  const sources = Array.isArray(item.sources)
    ? item.sources.slice(0, CHATBOT_CLIENT_LIMITS.maxSources).map(normalizeSource).filter(Boolean)
    : []
  return { id: `stored-${index}`, sender: 'bot', text, kind, sources }
}

const loadChatHistory = () => {
  if (typeof window === 'undefined') return
  try {
    const saved = localStorage.getItem(CHATBOT_STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : null
    if (!Array.isArray(parsed)) return
    const bounded = parsed.slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2)).map(normalizeStoredMessage).filter(Boolean)
    if (bounded.length > 0) chatMessages.value = [{ ...CHATBOT_WELCOME_MESSAGE }, ...bounded.filter(item => item.id !== 'welcome')]
  } catch {
    localStorage.removeItem(CHATBOT_STORAGE_KEY)
  }
}

const saveChatHistory = () => {
  if (typeof window === 'undefined') return
  const bounded = chatMessages.value
    .filter(item => item.id !== 'welcome' && !item.isStreaming && typeof item.text === 'string' && item.text.trim())
    .slice(-(CHATBOT_CLIENT_LIMITS.maxHistoryMessages * 2))
    .map(({ sender, text, kind, sources }) => ({ sender, text, kind, sources }))
  try {
    localStorage.setItem(CHATBOT_STORAGE_KEY, JSON.stringify(bounded))
  } catch {
    // Storage can be unavailable in private browsing; chat remains usable in memory.
  }
}

const clearChatHistory = () => {
  botRequestSequence += 1
  if (chatRequestController) chatRequestController.abort()
  isSubmitting.value = false
  botInputError.value = ''
  chatMessages.value = [{ ...CHATBOT_WELCOME_MESSAGE }]
  if (typeof window !== 'undefined') localStorage.removeItem(CHATBOT_STORAGE_KEY)
  nextTick(() => botInputRef.value?.focus())
}

const boundedUserHistory = () => {
  const messages = chatMessages.value
    .filter(item => item.sender === 'user' && typeof item.text === 'string')
    .map(item => ({ sender: 'user', text: item.text.normalize('NFKC').trim().slice(0, CHATBOT_CLIENT_LIMITS.maxMessageChars) }))
    .filter(item => item.text)
    .slice(-CHATBOT_CLIENT_LIMITS.maxHistoryMessages)
  let total = 0
  return messages.reverse().filter((item) => {
    if (total + item.text.length > CHATBOT_CLIENT_LIMITS.maxTotalUserChars) return false
    total += item.text.length
    return true
  }).reverse()
}

const parseSseLine = (line, targetMessage) => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') return
  let data
  try {
    data = JSON.parse(trimmed.slice(6))
  } catch {
    return
  }
  const content = typeof data?.choices?.[0]?.delta?.content === 'string' ? data.choices[0].delta.content : ''
  if (content) targetMessage.text = `${targetMessage.text}${content}`.slice(0, CHATBOT_CLIENT_LIMITS.maxOutputChars)
  const chatbot = data?.chatbot
  if (chatbot && typeof chatbot === 'object') {
    targetMessage.kind = CHATBOT_RESPONSE_KINDS.has(chatbot.kind) ? chatbot.kind : 'unavailable'
    targetMessage.sources = Array.isArray(chatbot.sources)
      ? chatbot.sources.slice(0, CHATBOT_CLIENT_LIMITS.maxSources).map(normalizeSource).filter(Boolean)
      : []
  }
}

const fetchStreamBotReply = async () => {
  if (isSubmitting.value) return false
  const requestSequence = ++botRequestSequence
  isSubmitting.value = true
  botInputError.value = ''
  chatRequestController = new AbortController()
  const requestController = chatRequestController
  const botMessage = {
    id: `bot-${++messageSequence}`,
    sender: 'bot',
    text: '',
    kind: undefined,
    sources: [],
    isStreaming: true,
  }
  chatMessages.value.push(botMessage)
  scrollChatBottom()

  try {
    const response = await fetch('/api/public/chatbot', {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: boundedUserHistory() }),
      signal: requestController.signal,
    })
    if (!response.ok || !response.body) throw new Error('CHATBOT_UNAVAILABLE')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let doneEvent = false
    while (!doneEvent) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop() || ''
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') {
          doneEvent = true
          break
        }
        parseSseLine(line, botMessage)
      }
      if (done) break
      scrollChatBottom()
    }
    if (buffer) parseSseLine(buffer, botMessage)
    if (!botMessage.text.trim()) throw new Error('EMPTY_CHATBOT_RESPONSE')
    if (!botMessage.kind) botMessage.kind = 'unavailable'
    botMessage.isStreaming = false
    saveChatHistory()
    return true
  } catch (error) {
    const index = chatMessages.value.findIndex(item => item.id === botMessage.id)
    if (index !== -1) chatMessages.value.splice(index, 1)
    if (error?.name !== 'AbortError' && requestSequence === botRequestSequence) {
      botInputError.value = 'Không thể nhận phản hồi lúc này. Nội dung câu hỏi đã được giữ lại để bạn thử lại.'
    }
    return false
  } finally {
    if (requestSequence === botRequestSequence) {
      isSubmitting.value = false
      chatRequestController = null
    }
    scrollChatBottom()
  }
}

const submitBotQuestion = async (rawText) => {
  if (isSubmitting.value) return
  const text = typeof rawText === 'string' ? rawText.normalize('NFKC').trim() : ''
  if (!text) {
    botInputError.value = 'Vui lòng nhập câu hỏi.'
    return
  }
  if (text.length > CHATBOT_CLIENT_LIMITS.maxMessageChars) {
    botInputError.value = `Câu hỏi không được vượt quá ${CHATBOT_CLIENT_LIMITS.maxMessageChars} ký tự.`
    return
  }
  const userMessage = { id: `user-${++messageSequence}`, sender: 'user', text }
  chatMessages.value.push(userMessage)
  scrollChatBottom()
  const requestSequence = botRequestSequence + 1
  const succeeded = await fetchStreamBotReply()
  if (requestSequence !== botRequestSequence) return
  if (succeeded) {
    botInput.value = ''
    saveChatHistory()
  } else {
    const index = chatMessages.value.findIndex(item => item.id === userMessage.id)
    if (index !== -1) chatMessages.value.splice(index, 1)
    botInput.value = text
  }
  nextTick(() => botInputRef.value?.focus())
}

const askBot = (question) => {
  if (isSubmitting.value) return
  botInput.value = question
  submitBotQuestion(question)
}

const sendBotMessage = () => submitBotQuestion(botInput.value)

const scrollChatBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

onMounted(() => {
  clientMounted.value = true
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  updateLiveDate()
  dateTimer = setInterval(updateLiveDate, 1000)
  loadChatHistory()
  loadQuickQuestions()
  startTeaserCycle()
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('keydown', handleKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
  if (dateTimer) clearInterval(dateTimer)
  if (teaserInterval) clearInterval(teaserInterval)
  if (teaserInitTimeout) clearTimeout(teaserInitTimeout)
  quickQuestionsController?.abort()
  chatRequestController?.abort()
})
</script>

<style scoped>
/* Hide scrollbar but keep scroll functionality */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Slide-down transition for search bar */
.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

/* Teaser pop transition */
.teaser-pop-enter-active,
.teaser-pop-leave-active {
  transition: all 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.teaser-pop-enter-from,
.teaser-pop-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.92);
}

/* Streaming cursor blink */
@keyframes blinkCursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Teaser bubble slide up */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Liquid orb glow animation */
@keyframes liquidOrbGlow {
  0%, 100% { box-shadow: 0 10px 24px rgba(23, 59, 24, 0.4), 0 0 0 0 rgba(46, 107, 50, 0.3); }
  50% { box-shadow: 0 12px 28px rgba(23, 59, 24, 0.5), 0 0 0 8px rgba(46, 107, 50, 0); }
}

/* Markdown content inside chatbot */
.markdown-content p { margin: 0 0 6px 0; line-height: 1.5; }
.markdown-content p:last-child { margin-bottom: 0; }
.markdown-content strong { font-weight: 700; color: #112812; }
.markdown-content ul.md-list,
.markdown-content ol.md-list { margin: 6px 0 8px 0; padding-left: 18px; }
.markdown-content ul.md-list li,
.markdown-content ol.md-list li { margin-bottom: 4px; line-height: 1.45; }
.markdown-content a { color: #1e4620; text-decoration: underline; font-weight: 600; }
.markdown-content code { background: #f0f6ef; color: #1e4620; padding: 2px 6px; border-radius: 4px; font-size: 0.82rem; font-family: monospace; }
.md-spacer { height: 6px; }

/* Nav item pseudo-element underline (desktop nav) */
.nav-item {
  position: relative;
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
.nav-item:has(a.active-item) {
  color: #1e4620;
  background-color: #e4f0e2;
  font-weight: 800;
}
.nav-item:has(a.active-item) a {
  color: #1e4620;
}

/* Teaser text animation */
.teaser-text {
  animation: textFadeIn 0.4s ease-out;
}
</style>
