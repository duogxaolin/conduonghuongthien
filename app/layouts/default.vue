<template>
  <div class="app-layout">
    <!-- Thanh tiến trình chuyển trang. Điều hướng client-side phải chờ dữ liệu
         của trang đích, và trong khoảng đó trình duyệt không vẽ gì cả — bấm một
         liên kết trông y hệt như bấm hụt. Đây là phản hồi tức thì cho lần bấm. -->
    <NuxtLoadingIndicator color="#2c6e33" :height="3" />
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
          <span><i class="fa-solid fa-phone" aria-hidden="true"></i> {{ t('hotline_lbl') }}: {{ siteHotline }}</span>
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

            <!-- Trạng thái đăng nhập của người đọc.

                 `<client-only>` là điều kiện tiên quyết, không phải tinh chỉnh:
                 mọi trang công khai phục vụ qua `swr: 60`, nên một cái tên hiện
                 trong HTML dựng phía máy chủ sẽ được phát lại cho người kế tiếp
                 trong cùng cửa sổ 60 giây. Không có `fallback`: chỗ này để trống
                 tới khi biết được người đọc là ai — một nút "Đăng nhập" nhấp nháy
                 rồi đổi thành tên còn tệ hơn là xuất hiện muộn nửa giây. -->
            <client-only>
              <div v-if="readerLoaded" class="hidden lg:flex items-center">
                <!-- Đã đăng nhập: một nút mở menu nhỏ.

                     `relative` nằm ở đây, và tổ tiên của nó **không được** có
                     `overflow-x` khác `visible` — `overflow-x: auto` biến
                     `overflow-y: visible` thành `auto`, tức là cắt mất đúng cái
                     menu này. Cùng cái bẫy đã ghi ở thanh điều hướng phía dưới. -->
                <div v-if="reader" ref="readerMenuRef" class="relative">
                  <button
                    type="button"
                    class="flex items-center gap-2 bg-[#F8FAF7] border border-[#E2E8DF] pl-1.5 pr-2.5 py-1.5 rounded-full transition-all hover:bg-[#EEF2EC] hover:border-[#CFDDC8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                    :aria-expanded="isReaderMenuOpen"
                    aria-haspopup="menu"
                    @click="isReaderMenuOpen = !isReaderMenuOpen"
                  >
                    <ReaderAvatar :initials="reader.initials" size="sm" />
                    <span class="max-w-[132px] truncate text-[0.82rem] font-bold text-[#385130]">{{ reader.displayName }}</span>
                    <i class="fa-solid fa-chevron-down text-[0.6rem] text-[#7A8675] transition-transform duration-200" :class="{ 'rotate-180': isReaderMenuOpen }" aria-hidden="true"></i>
                  </button>

                  <div
                    v-if="isReaderMenuOpen"
                    role="menu"
                    class="absolute right-0 top-[calc(100%+8px)] z-[10004] w-[236px] rounded-xl border border-[#E2E8DF] bg-white p-1.5 shadow-[0_12px_32px_rgba(15,35,18,0.14)]"
                  >
                    <!-- Địa chỉ email chỉ hiện trong menu đã mở, không hiện trên
                         thanh header: nó là dữ liệu cá nhân của người đọc, và một
                         màn hình đang chia sẻ thì cả phòng đọc được. -->
                    <p v-if="reader.email" class="m-0 px-3 pt-1.5 pb-2 text-[0.72rem] text-[#7A8675] truncate border-b border-[#EEF2EC]">{{ reader.email }}</p>
                    <nuxt-link
                      to="/nguoi-doc"
                      role="menuitem"
                      class="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[0.85rem] font-semibold text-[#1E251C] no-underline transition-colors hover:bg-[#F3F7F1] hover:text-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                      @click="isReaderMenuOpen = false"
                    >
                      <i class="fa-solid fa-user w-4 text-center text-[#7CB342]" aria-hidden="true"></i> Trang cá nhân
                    </nuxt-link>
                    <button
                      type="button"
                      role="menuitem"
                      class="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[0.85rem] font-semibold text-[#1E251C] transition-colors hover:bg-[#F3F7F1] hover:text-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                      @click="onReaderSignOut"
                    >
                      <i class="fa-solid fa-right-from-bracket w-4 text-center text-[#7A8675]" aria-hidden="true"></i> Đăng xuất
                    </button>
                  </div>
                </div>

                <button
                  v-else
                  type="button"
                  class="inline-flex items-center gap-2 bg-[#F8FAF7] border border-[#E2E8DF] px-3.5 py-2 rounded-sm text-[0.82rem] font-semibold text-[#385130] transition-all hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
                  @click="readerSignIn()"
                >
                  <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Đăng nhập
                </button>
              </div>
            </client-only>
            <!-- Mobile Toggle -->
            <button
              class="lg:hidden flex flex-col justify-center items-center gap-1 w-11 h-11 rounded-xl bg-[#f0f6ef] border border-[#d9e7d7] text-[#1e4620] cursor-pointer transition-all z-[10003] hover:bg-[#e4f0e2]"
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
        class="fixed top-0 w-[min(88vw,380px)] max-w-full h-[100dvh] flex flex-col bg-white shadow-[-12px_0_40px_rgba(15,35,18,0.24)] z-[10002] transition-[right] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden lg:hidden"
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
            <!-- Khối danh tính người đọc trên điện thoại.

                 Đây là phần VÁ LỖI, không phải trang trí: khối ở header mang
                 `hidden lg:flex`, và ngăn kéo này trước đây không có khối nào
                 tương đương — nên trên điện thoại, tính năng đăng nhập của người
                 đọc **không tồn tại**, trong khi phần lớn công dân đọc cổng này
                 bằng điện thoại.

                 `<client-only>` cùng lý do như ở header: mọi trang công khai phục
                 vụ qua `swr: 60`, nên một cái tên lọt vào HTML dựng phía máy chủ
                 sẽ được phát lại cho người kế tiếp. Không có `fallback`.

                 Không dùng dropdown ở đây: ngăn kéo đã là một lớp phủ, và hai
                 liên kết phẳng thì bấm được bằng ngón tay ngay, không cần mở thêm
                 một lớp nữa. -->
            <client-only>
              <div v-if="readerLoaded">
                <div v-if="reader" class="flex flex-col gap-2">
                  <div class="flex items-center gap-3 bg-white px-3.5 py-3 rounded-[14px] border border-[rgba(30,70,32,0.12)] shadow-sm">
                    <ReaderAvatar :initials="reader.initials" />
                    <div class="flex flex-col min-w-0">
                      <span class="text-[0.9rem] font-extrabold text-[#1E251C] truncate">{{ reader.displayName }}</span>
                      <span v-if="reader.email" class="text-[0.72rem] text-[#7A8675] truncate">{{ reader.email }}</span>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <nuxt-link
                      to="/nguoi-doc"
                      class="flex-1 flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3 py-2.5 text-[0.85rem] font-bold text-[#385130] no-underline transition-colors active:bg-[#EEF2EC]"
                      @click="isMobileMenuOpen = false"
                    >
                      <i class="fa-solid fa-user text-[#7CB342]" aria-hidden="true"></i> Trang cá nhân
                    </nuxt-link>
                    <button
                      type="button"
                      class="flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3.5 py-2.5 text-[0.85rem] font-bold text-[#7A8675] transition-colors active:bg-[#EEF2EC]"
                      @click="onReaderSignOut"
                    >
                      <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Đăng xuất
                    </button>
                  </div>
                </div>

                <button
                  v-else
                  type="button"
                  class="w-full flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-4 py-3 text-[0.88rem] font-bold text-[#385130] shadow-sm transition-colors active:bg-[#EEF2EC]"
                  @click="readerSignIn()"
                >
                  <i class="fa-solid fa-right-to-bracket text-[#7CB342]" aria-hidden="true"></i> Đăng nhập để bình luận
                </button>
              </div>
            </client-only>

            <a :href="siteHotlineTel" class="flex items-center gap-3 bg-white px-3.5 py-3 rounded-[14px] border border-[rgba(30,70,32,0.12)] no-underline shadow-sm">
              <span class="text-xl">📞</span>
              <div class="flex flex-col">
                <span class="text-[0.72rem] text-[#7A8675] font-semibold">{{ t('hotline_lbl') }}</span>
                <span class="text-[0.95rem] font-extrabold text-[#4A6741]">{{ siteHotline }}</span>
              </div>
            </a>
            <nuxt-link to="/contact" class="btn btn-primary w-full flex items-center justify-center gap-2 px-4 py-3 text-[0.88rem] font-bold rounded-xl" @click="isMobileMenuOpen = false">
              <span class="w-1.5 h-1.5 bg-[#7CB342] rounded-full inline-block animate-pulse"></span> Đăng ký tư vấn ngay
            </nuxt-link>
          </div>
        </div>
      </nav>
      <!--
        Thanh điều hướng ngang chỉ hiện từ `lg` (1024px), không từ `md` (768px).

        `nav` mang `w-max`, nên nó rộng theo NỘI DUNG chứ không theo container:
        tám mục mặc định cần ~852px. Ở `md` thanh này bật lên trong một khung chỉ
        rộng 768px, nên `min-w-full` không cứu được gì — phần thừa đẩy ra ngoài và
        **cả trang cuộn ngang được**, ở mọi trang chứ không riêng trang nào. Đây
        là lý do các mục cuối ("Liên hệ") bị cắt trên tablet.

        Không chọn `overflow-x-auto` cho container: dropdown là `absolute` mở
        xuống dưới, và một khung cuộn ngang cũng cắt luôn chiều dọc (`overflow-x`
        khác `visible` biến `overflow-y: visible` thành `auto`) — nó sẽ cắt mất
        đúng menu con. Cũng không cho `ul` xuống dòng: thanh này cao cố định 50px.

        Khoảng 768–1023px giao cho hamburger, và không mất gì: drawer dựng từ
        cùng `navMenu`, có accordion cho mục con.

        ⚠️ Menu do admin cấu hình được (`/admin/content/navigation/navbar`), nên
        thêm thật nhiều mục vẫn có thể vượt cả 1024px. Đó là tính chất có sẵn của
        một thanh ngang cao cố định, không phải thứ breakpoint này hứa sẽ chặn.
      -->
      <div class="hidden lg:flex bg-white border-t border-[#edf2ec] border-b border-[#e1e8e0] h-[50px] items-center shadow-[0_4px_12px_rgba(15,35,18,0.04)] transition-all">
        <div class="container w-full overflow-visible">
          <nav class="flex w-max min-w-full" @click="onNavClick" @keydown.escape="toggleMobileMenu">
            <ul class="flex list-none w-full justify-between items-center gap-1">
              <li v-for="item in navMenu" :key="item.id" :class="item.children && item.children.length ? 'relative group focus-within:z-[103]' : ''">
                <!-- With children: dropdown -->
                <template v-if="item.children && item.children.length">
                  <div class="nav-item no-underline text-[#1e4620] font-bold text-[0.8rem] px-2 lg:text-[0.88rem] lg:px-3 py-2 rounded-lg flex items-center gap-1 whitespace-nowrap cursor-pointer transition-all hover:bg-[#f0f6ef] hover:text-[#143516]" aria-haspopup="true">
                    <component
                      :is="item.url && item.url !== '#' ? NuxtLink : 'span'"
                      v-bind="item.url && item.url !== '#' ? { to: item.url, 'active-class': 'active-item', class: 'text-inherit no-underline' } : {}"
                    >{{ navItemLabel(item) }}</component>
                    <i class="fa-solid fa-chevron-down text-[0.55rem] ml-0.5 text-[#557757] transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" aria-hidden="true"></i>
                  </div>
                  <ul class="absolute top-[calc(100%+4px)] left-0 bg-white shadow-[0_14px_36px_rgba(15,35,18,0.18),0_2px_8px_rgba(0,0,0,0.04)] rounded-xl border border-[rgba(30,70,32,0.12)] p-2 min-w-[220px] list-none opacity-0 translate-y-2 scale-[0.97] pointer-events-none z-[102] transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:pointer-events-auto">
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
            <li><nuxt-link to="/tai-lieu-hoi-dap" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Tài liệu Hỏi – Đáp đã phê duyệt</nuxt-link></li>
            <li><nuxt-link to="/contact" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Thông tin đường dây nóng</nuxt-link></li>
          </ul>
        </div>

        <div>
          <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">Thông tin liên hệ</h3>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Cơ quan chủ quản:</strong> C11 - Bộ Công an</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Địa chỉ:</strong> {{ siteAddress }}</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Điện thoại:</strong> {{ siteHotline }}</p>
          <p class="mb-3 text-[0.9rem]"><strong class="text-white">Email:</strong> {{ siteEmail }}</p>
        </div>
      </div>

      <div class="border-t border-white/[0.08] py-6 text-[0.85rem]">
        <div class="container flex flex-col sm:flex-row justify-between items-center gap-3 text-center sm:text-left">
          <p>&copy; 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.</p>
          <p><a href="https://www.facebook.com/hi.duogxaolin" target="_blank" rel="noopener noreferrer" class="text-white/70 no-underline font-semibold transition-all hover:text-[#7CB342] hover:underline">Design by Delify.vn</a></p>
        </div>
      </div>
    </footer>

    <!-- Chatbot: all state and markup live in the component. -->
    <ChatWidget ref="chatWidget" />

    <!-- Mobile Bottom Nav -->
    <nav
      class="fixed bottom-2.5 left-3 right-3 h-16 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(244,249,243,0.92)_100%)] backdrop-blur-md border border-white/90 rounded-[24px] shadow-[0_12px_32px_rgba(15,35,18,0.16)] z-[9900] flex justify-around items-center px-1.5 transition-all md:hidden"
      :class="{ 'opacity-0 pointer-events-none translate-y-4': isMobileMenuOpen || isChatOpen }"
      aria-label="Điều hướng nhanh"
      style="padding-bottom: env(safe-area-inset-bottom, 0px)"
    >
      <template v-for="item in bottomNav" :key="item.id">
        <!-- Featured raised center button -->
        <button
          v-if="item.featured"
          class="flex-1 relative flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#385130] max-w-[52px] font-extrabold text-[0.65rem] -top-3.5 cursor-pointer transition-all font-[inherit]"
          :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
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
          :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
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
const { currentLang, locales, t, setLang } = useI18n()
const searchInputRef = ref(null)

// Trạng thái đăng nhập của người đọc. State ở cấp module trong composable, nên
// header và khối bình luận trong bài đọc cùng một danh tính — hai lượt fetch
// riêng sẽ có lúc nói hai điều khác nhau trên cùng một trang.
const {
  reader,
  loaded: readerLoaded,
  load: loadReader,
  signIn: readerSignIn,
  signOut: readerSignOut,
  signInMessage: readerSignInMessage,
} = useReaderAuth()

// Menu nhỏ dưới nút danh tính ở header desktop.
const isReaderMenuOpen = ref(false)
const readerMenuRef = ref(null)

/**
 * Đăng xuất từ cả hai bề mặt (menu desktop và ngăn kéo mobile).
 *
 * Đóng cả hai lớp phủ trước khi gọi: `signOut` xoá danh tính, nên khối chứa nút
 * vừa bấm bị `v-if` tháo ra. Để menu mở lại thì lần đăng nhập sau nó vẫn còn mở
 * đúng ở chỗ đó, treo dưới một cái tên đã không còn.
 */
async function onReaderSignOut() {
  isReaderMenuOpen.value = false
  isMobileMenuOpen.value = false
  await readerSignOut()
}

const route = useRoute()
const router = useRouter()
const { error: toastError } = useToast()

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
  // Hỏi – Đáp mở ra hai nguồn khác nhau, nên nó là dropdown chứ không phải một
  // liên kết: `/legal-qa` là bài biên tập (`articles` type=faq), còn
  // `/tai-lieu-hoi-dap` là kho câu trả lời đã duyệt mà chính trợ lý ảo dẫn lại.
  // Thêm mục thứ 9 ngang hàng sẽ làm tràn thanh nav ở md.
  {
    id: 'legal-qa', label: null, labelKey: 'faq', url: '/legal-qa',
    children: [
      { id: 'legal-qa-articles', label: null, labelKey: 'faq_articles', url: '/legal-qa' },
      { id: 'qa-approved-docs', label: null, labelKey: 'faq_approved_docs', url: '/tai-lieu-hoi-dap' },
    ]
  },
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
  if (item.type === 'chatbot') chatWidget.value?.toggleChatbot()
  else if (item.type === 'drawer') toggleMobileMenu()
}

// Use useFetch so the payload is serialized from SSR and reused on client
// hydration without a second network request — eliminates nav data mismatch.
const { data: settingsData } = await useFetch('/api/public/settings', {
  key: 'public-settings-nav',
  default: () => null,
  lazy: false,
})

// Site-wide contact details come from Cài đặt chung so an editor's change takes
// effect on the live site. The literals are only a fallback for the very first
// render before settings exist.
const sitePublicSettings = computed(() => settingsData.value?.settings || {})
const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.vn')
const siteAddress = computed(() => sitePublicSettings.value.address?.trim() || 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội')
const siteHotlineTel = computed(() => 'tel:' + siteHotline.value.replace(/[^0-9+]/g, ''))

// Derive nav from the fetched settings (reactive — updates if data refetches)
const _parseNav = (raw) => { try { return JSON.parse(raw) } catch { return null } }
watch(settingsData, (res) => {
  if (!res?.settings) return
  const navbarRaw = res.settings.nav_menu_navbar || res.settings.nav_menu
  if (navbarRaw) navMenuRaw.value = _parseNav(navbarRaw)
  const mobileRaw = res.settings.nav_menu_mobile
  if (mobileRaw) bottomNavRaw.value = _parseNav(mobileRaw)
}, { immediate: true })

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

// The bottom nav dims itself while the chat is open and highlights its chatbot
// item; both need to read the widget's state, which the widget owns.
const chatWidget = ref(null)
const isChatOpen = computed(() => chatWidget.value?.isChatbotOpen ?? false)

// The widget locks scroll for itself while its dialog is open; the layout only
// answers for the mobile menu.
watch(isMobileMenuOpen, (isMenuOpen) => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = isMenuOpen ? 'hidden' : ''
  }
})

const handleKeydown = (event) => {
  // The chatbot dialog handles its own Escape via a keydown on the dialog; this
  // only needs to catch the mobile menu.
  if (event.key !== 'Escape') return
  if (isMobileMenuOpen.value) isMobileMenuOpen.value = false
  // Đóng cả menu danh tính: một menu chỉ đóng được bằng cách bấm lại đúng nút đã
  // mở nó là một cái bẫy bàn phím — Escape là cách người dùng bàn phím thoát khỏi
  // mọi lớp phủ khác trên trang này.
  if (isReaderMenuOpen.value) isReaderMenuOpen.value = false
}

/**
 * Bấm ra ngoài thì đóng menu danh tính.
 *
 * Bắt ở pha `mousedown` chứ không `click`: một cú bấm vào liên kết bên trong menu
 * là `mousedown` rồi `click`, và nếu đóng ở `click` thì handler này chạy **sau**
 * khi Vue đã tháo phần tử — nhưng bắt ở `mousedown` với kiểm tra `contains` thì
 * liên kết vẫn còn trong cây, nên nó vẫn điều hướng bình thường.
 */
const handleDocumentPointerDown = (event) => {
  if (!isReaderMenuOpen.value) return
  const root = readerMenuRef.value
  if (root && !root.contains(event.target)) isReaderMenuOpen.value = false
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

onMounted(() => {
  clientMounted.value = true
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('mousedown', handleDocumentPointerDown)
  // Sau khi mount, không phải trong lúc dựng: mọi trang công khai phục vụ qua
  // `swr: 60`, nên danh tính người đọc mà lọt vào HTML sẽ được phát lại cho
  // người kế tiếp. Không `await`: header không được chặn lượt vẽ đầu để chờ một
  // lượt fetch chỉ quyết định hiện tên hay hiện nút đăng nhập.
  loadReader()

  // Cổng OAuth chuyển người đọc về kèm `?dangnhap=<lý do>` khi lượt đăng nhập bị
  // từ chối. Không có chỗ hiện lý do thì một cú bấm "Đăng nhập" không dẫn tới
  // đâu cả, và người đọc chỉ biết là nó không chạy.
  const reason = readerSignInMessage(route.query.dangnhap)
  if (reason) {
    toastError(reason)
    // Gỡ tham số khỏi URL để F5 không hiện lại thông báo của một lượt đã xong.
    router.replace({ query: { ...route.query, dangnhap: undefined } })
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousedown', handleDocumentPointerDown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<style scoped>

/* Slide-down transition for search bar */
.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-20px);
  opacity: 0;
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

</style>
