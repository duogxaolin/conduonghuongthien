<template>
  <div class="app-layout">
    <!-- Thanh tiến trình chuyển trang. Điều hướng client-side phải chờ dữ liệu
         của trang đích, và trong khoảng đó trình duyệt không vẽ gì cả — bấm một
         liên kết trông y hệt như bấm hụt. Đây là phản hồi tức thì cho lần bấm. -->
    <!-- Loading bar — gradient xanh lá sáng chói nổi bật trên mọi nền (kể cả header
         xanh đậm), chiều cao 3px gọn gàng không chiếm không gian. throttle 0ms để
         hiện ngay lập tức. color nhận cả gradient CSS nên thanh có cảm giác "chạy". -->
    <NuxtLoadingIndicator
      color="repeating-linear-gradient(90deg,#7ED957 0%,#A6F28A 40%,#7ED957 100%)"
      :height="3"
      :duration="1500"
      :throttle="0"
    />
    <ToastContainer />
    <!-- Mobile Menu Overlay -->
    <div
      class="fixed inset-0 w-screen h-screen bg-[rgba(20,43,23,0.58)] backdrop-blur-[2px] z-[10000] opacity-0 pointer-events-none transition-opacity duration-300"
      :class="{ 'opacity-100 pointer-events-auto': isMobileMenuOpen }"
      @click="toggleMobileMenu"
    ></div>

    <!-- Top Bar -->
    <!-- Top Bar: z-index cao hơn Header (z-[10001]) khi menu mở để dropdown không bị Header che khuất -->
    <div
      class="bg-[#385130] text-white py-2 text-[0.82rem] border-b border-white/10 relative transition-[z-index]"
      :class="isLangMenuOpen ? 'z-[10005]' : 'z-[101]'"
    >
      <div class="container flex justify-between items-center">
        <div class="flex items-center gap-4">
          <span><i class="fa-solid fa-phone" aria-hidden="true"></i> {{ t('hotline_lbl') }}: {{ siteHotline }}</span>
        </div>
        <div class="flex items-center gap-4">
          <!-- Polished Language Switcher Dropdown (Scalable for many languages) -->
          <div class="relative" ref="langDropdownRef">
            <button
              type="button"
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[0.76rem] font-bold transition-all border border-white/15 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9CCC65]"
              :aria-expanded="isLangMenuOpen"
              aria-haspopup="true"
              :aria-label="t('language_switcher')"
              @click="isLangMenuOpen = !isLangMenuOpen"
            >
              <span class="text-sm leading-none">{{ currentLocaleFlag }}</span>
              <span>{{ currentLocale.name }}</span>
              <i class="fa-solid fa-chevron-down text-[0.55rem] transition-transform opacity-75" :class="isLangMenuOpen ? 'rotate-180' : ''"></i>
            </button>

            <!-- Dropdown Popover -->
            <div
              v-if="isLangMenuOpen"
              class="absolute right-0 top-full mt-1.5 w-44 rounded-xl bg-white text-[#1E251C] shadow-2xl border border-[#c8d6c9] py-1.5 z-[10006] flex flex-col gap-0.5 animate-fadeIn"
              role="menu"
            >
              <div class="px-3 py-1 text-[0.65rem] font-bold text-[#667768] uppercase tracking-wider border-b border-[#e2ece3] mb-1">
                {{ t('language_switcher') }}
              </div>
              <button
                v-for="locale in locales"
                :key="`dropdown-${locale.code}`"
                type="button"
                role="menuitem"
                class="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-[#f0f7f1] transition-colors border-none bg-transparent cursor-pointer flex items-center justify-between"
                :class="currentLang === locale.code ? 'text-[#2c6e33] font-bold bg-[#f0f7f1]' : 'text-[#333]'"
                @click="setLang(locale.code); isLangMenuOpen = false"
              >
                <span class="flex items-center gap-2">
                  <span class="text-sm leading-none">{{ getFlagEmoji(locale.code) }}</span>
                  <span>{{ locale.name }}</span>
                </span>
                <i v-if="currentLang === locale.code" class="fa-solid fa-check text-[0.7rem] text-[#2c6e33]"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Header: sticky giữ header trong flow, không gây reflow khi cuộn.
         isSticky nay chỉ bật/tắt shadow — không đổi position nữa. -->
    <header
      class="main-header notranslate bg-white w-full sticky top-0 z-[10001] border-b border-[#E2E8DF] transition-[box-shadow]"
      :class="isSticky ? 'shadow-md' : 'shadow-none'"
      translate="no"
    >
      <!-- Dòng 1: Logo & Các nút hành động nhanh -->
      <div class="border-b border-[#E2E8DF] bg-white">
        <div class="container flex justify-between items-center h-16 lg:h-20">
          <!-- Logo Area -->
          <nuxt-link to="/" class="flex items-center gap-3 lg:gap-3.5 no-underline">
            <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-2 lg:gap-2.5 shrink-0">
              <img
                v-if="siteMainLogo"
                class="w-auto object-contain shrink-0"
                :class="siteLogo ? 'h-10 lg:h-[56px]' : 'h-9 lg:h-[50px]'"
                :src="siteMainLogo"
                alt="Logo cơ quan chủ quản"
              />
              <span v-if="siteMainLogo && siteLogo" class="h-6 lg:h-8 w-px bg-[#D0DDD1] shrink-0" aria-hidden="true"></span>
              <img
                v-if="siteLogo"
                class="w-auto object-contain shrink-0 transition-all"
                :class="siteMainLogo ? 'h-7 lg:h-[38px]' : 'h-9 lg:h-[50px]'"
                :src="siteLogo"
                alt="Logo Con Đường Hướng Thiện"
              />
            </div>
            <div>
              <h1 class="text-[0.95rem] lg:text-[1.35rem] font-extrabold text-[#4A6741] tracking-[0.5px] leading-[1.2]">CON ĐƯỜNG HƯỚNG THIỆN</h1>
              <p class="hidden lg:block text-[0.72rem] font-semibold text-[#7A8675] uppercase mt-0.5">Cổng thông tin điện tử hỗ trợ tái hòa nhập cộng đồng — Bộ Công an</p>
            </div>
          </nuxt-link>

          <!-- Top Actions -->
          <div class="flex items-center gap-3">
            <button
              class="bg-[#F8FAF7] border border-[#E2E8DF] w-11 h-11 rounded-full flex items-center justify-center cursor-pointer text-[0.95rem] transition-all hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741]"
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
              <div v-if="readerLoaded" class="hidden lg:flex items-center gap-2">
                <!--
                  Chuông thông báo — xem `ReaderNotificationBell.client.vue`.

                  `.client` là bắt buộc: mọi tuyến công khai chạy `swr: 60`, nên một
                  khối dựng phía máy chủ mang số chưa đọc của một người sẽ được phát
                  lại cho người kế tiếp ghé vào trong cùng 60 giây.

                  Component tự sở hữu Escape và mousedown ra ngoài của nó, nên layout
                  không còn giữ ref hay nhánh nào cho menu này.
                -->
                <ReaderNotificationBell v-if="reader" ref="notifBellRef" />

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
                      to="/profile"
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
            <!-- Mobile Toggle — opens drawer; drawer's own X closes it -->
            <button
              class="lg:hidden flex flex-col justify-center items-center gap-1 w-11 h-11 rounded-xl bg-[#f0f6ef] border border-[#d9e7d7] text-[#1e4620] cursor-pointer transition-all hover:bg-[#e4f0e2]"
              @click="toggleMobileMenu"
              :aria-label="t('menu_open')"
              aria-expanded="false">
              <span class="block w-5 h-[2px] rounded-[4px] bg-current"></span>
              <span class="block w-5 h-[2px] rounded-[4px] bg-current"></span>
              <span class="block w-5 h-[2px] rounded-[4px] bg-current"></span>
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
          <div class="flex items-center gap-2.5 min-w-0">
            <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-2 shrink-0">
              <img
                v-if="siteMainLogo"
                :src="siteMainLogo"
                alt="Logo cơ quan chủ quản"
                class="w-auto object-contain drop-shadow-md"
                :class="siteLogo ? 'h-10' : 'h-9'"
              />
              <span v-if="siteMainLogo && siteLogo" class="h-6 w-px bg-white/25" aria-hidden="true"></span>
              <img
                v-if="siteLogo"
                :src="siteLogo"
                alt="Logo Con Đường Hướng Thiện"
                class="w-auto object-contain drop-shadow-md"
                :class="siteMainLogo ? 'h-7' : 'h-9'"
              />
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-[0.85rem] font-extrabold tracking-[0.4px] text-white leading-[1.2] truncate">CON ĐƯỜNG HƯỚNG THIỆN</span>
              <span class="text-[0.65rem] text-white/75 font-medium mt-0.5 truncate">Cổng thông tin điện tử C11 - Bộ Công an</span>
            </div>
          </div>
          <button
            class="w-[34px] h-[34px] rounded-full border border-white/20 bg-white/[0.12] text-white text-[0.95rem] flex items-center justify-center cursor-pointer transition-all active:bg-white/25 active:scale-[0.92]"
            @click.stop="toggleMobileMenu" :aria-label="t('menu_close')">✕</button>
        </div>

        <!-- Drawer Locale Switcher (Grid layout for many languages) -->
        <div class="px-4 py-2.5 bg-[#f0f6ef] border-b border-[#e1e8e0] flex-shrink-0">
          <div class="text-[0.68rem] font-bold text-[#667768] uppercase mb-1.5">{{ t('language_switcher') }}</div>
          <div class="grid grid-cols-2 gap-1.5" role="group" :aria-label="t('language_switcher')">
            <button
              v-for="locale in locales"
              :key="`drawer-${locale.code}`"
              :class="currentLang === locale.code ? 'text-white bg-[#2c6e33] shadow-xs' : 'text-[#1e4620] bg-white border border-[#c8d6c9] hover:bg-[#e4ece4]'"
              class="border-none font-bold cursor-pointer text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center justify-between"
              :aria-label="locale.name"
              :aria-pressed="currentLang === locale.code"
              @click="setLang(locale.code)">
              <span class="flex items-center gap-1.5 truncate">
                <span class="text-sm leading-none">{{ getFlagEmoji(locale.code) }}</span>
                <span class="truncate">{{ locale.name }}</span>
              </span>
              <i v-if="currentLang === locale.code" class="fa-solid fa-check text-[0.65rem] shrink-0"></i>
            </button>
          </div>
        </div>

        <!-- Drawer Search -->
        <div class="px-4 pt-3 pb-2 bg-[#fcfdfe] border-b border-[rgba(30,70,32,0.06)] flex-shrink-0">
          <form @submit.prevent="handleSearch" class="flex items-center bg-[rgba(30,70,32,0.05)] border border-[rgba(30,70,32,0.12)] rounded-[10px] px-3 py-2 gap-2">
            <span class="text-[0.85rem] text-[#4A6741]">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </span>
            <input
              type="text"
              :placeholder="t('search_placeholder')"
              v-model="searchQuery"
              class="border-none bg-transparent w-full text-[0.88rem] text-[#1E251C] outline-none"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="border-none bg-black/10 rounded-full w-[20px] h-[20px] text-[0.65rem] flex items-center justify-center cursor-pointer text-[#555] hover:bg-black/20 transition-colors"
              @click="clearSearch"
              aria-label="Xóa từ khóa"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </form>
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
                      to="/profile"
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

                  <!--
                    Thông báo ở ngăn kéo.

                    Bản mobile của chuông, và nó phải tồn tại riêng: khối desktop
                    mang `hidden lg:flex`, nên thiếu chỗ này là **trên điện thoại
                    tính năng không tồn tại** — đúng lỗi đã xảy ra một lần với nút
                    đăng nhập. Không dựng lại danh sách ở đây: ngăn kéo đã là một
                    lớp phủ, và một danh sách cuộn được lồng trong đó thì bấm hụt
                    liên tục. Nó dẫn thẳng sang trang cá nhân, nơi danh sách đầy đủ
                    đã có sẵn.
                  -->
                  <nuxt-link
                    to="/profile#notifications"
                    class="flex items-center justify-between gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3.5 py-2.5 text-[0.85rem] font-bold text-[#385130] no-underline transition-colors active:bg-[#EEF2EC]"
                    @click="isMobileMenuOpen = false"
                  >
                    <span class="flex items-center gap-2">
                      <i class="fa-solid fa-bell text-[#7CB342]" aria-hidden="true"></i> Thông báo
                    </span>
                    <span
                      v-if="unreadCount > 0"
                      class="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-[#B04A4A] text-white text-[0.7rem] font-bold leading-none"
                    >{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
                  </nuxt-link>
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
          <nav class="desktop-nav flex w-max min-w-full" @click="onNavClick" @keydown.escape="toggleMobileMenu">
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
                  <ul class="absolute top-[calc(100%+4px)] left-0 bg-white shadow-[0_14px_36px_rgba(15,35,18,0.18),0_2px_8px_rgba(0,0,0,0.04)] rounded-xl border border-[rgba(30,70,32,0.12)] p-2 min-w-[220px] list-none opacity-0 translate-y-2 scale-[0.97] pointer-events-none z-[102] transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:pointer-events-auto before:absolute before:top-[-4px] before:left-0 before:h-[4px] before:w-full before:content-['']">
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
        <div ref="searchBarRef" class="absolute top-full left-0 w-full bg-[#385130] py-4 shadow-xl z-[99] border-b border-[#2A3E24]" v-if="isSearchActive">
          <div class="container relative">
            <form @submit.prevent="handleSearch" class="flex flex-col sm:flex-row gap-3 items-center">
              <div class="relative flex-1 w-full">
                <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#7A8675] text-sm pointer-events-none">
                  <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                </span>
                <input
                  type="text"
                  placeholder="Nhập nội dung cần tìm kiếm trên website..."
                  v-model="searchQuery"
                  @input="onSearchInput"
                  ref="searchInputRef"
                  class="w-full py-3 pl-11 pr-10 rounded-lg border border-[#4A6741] bg-white font-[inherit] text-[0.95rem] text-[#172516] outline-none focus:ring-2 focus:ring-[#7CB342] shadow-inner"
                />
                <button
                  v-if="searchQuery"
                  type="button"
                  @click="clearSearch"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A9A88] hover:text-[#2D5A27] w-6 h-6 rounded-full flex items-center justify-center text-xs cursor-pointer border-none bg-transparent transition-colors"
                  aria-label="Xóa từ khóa"
                >
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
              </div>

              <div class="flex gap-2 w-full sm:w-auto shrink-0">
                <button
                  type="submit"
                  class="flex-1 sm:flex-none bg-[#7CB342] hover:bg-[#689F38] text-white border-none px-6 py-3 rounded-lg font-extrabold text-[0.9rem] cursor-pointer transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <i class="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
                  <span>Tìm kiếm</span>
                </button>
                <button
                  type="button"
                  class="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white border border-white/20 px-4 py-3 rounded-lg text-[0.9rem] font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  @click="toggleSearch"
                >
                  <i class="fa-solid fa-xmark text-sm" aria-hidden="true"></i>
                  <span>Đóng</span>
                </button>
              </div>
            </form>

            <!-- Instant Live Preview Dropdown -->
            <div
              v-if="showLivePreview && searchQuery.trim().length >= 2"
              class="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.25)] border border-[#DDE6DC] overflow-hidden z-[105] max-h-[440px] flex flex-col text-[#172516]"
            >
              <!-- Header -->
              <div class="px-4 py-2.5 bg-[#F7FAF6] border-b border-[#E8EFE6] flex items-center justify-between text-xs font-semibold text-[#556450]">
                <span v-if="isSearchingLive" class="flex items-center gap-2 text-[#4A6741]">
                  <i class="fa-solid fa-circle-notch animate-spin text-sm" aria-hidden="true"></i>
                  <span>Đang tìm kiếm...</span>
                </span>
                <span v-else>
                  Gợi ý kết quả cho: <strong class="text-[#2D5A27]">&laquo;{{ searchQuery }}&raquo;</strong>
                </span>
                <span v-if="!isSearchingLive && liveSearchResults.length" class="text-[0.72rem] text-[#7A8A76]">
                  {{ liveSearchResults.length }} kết quả nổi bật
                </span>
              </div>

              <!-- List -->
              <div v-if="liveSearchResults.length" class="overflow-y-auto divide-y divide-[#F0F5EE] p-1.5">
                <nuxt-link
                  v-for="item in liveSearchResults"
                  :key="item.id"
                  :to="item.url"
                  @click="closeSearchAndNavigate"
                  class="flex items-center gap-3.5 p-2.5 rounded-lg hover:bg-[#F2F7F0] transition-colors no-underline text-inherit group"
                >
                  <div v-if="item.thumbnailUrl" class="w-12 h-12 rounded-lg overflow-hidden bg-[#EBF1EA] shrink-0 border border-[#E2E8DF]">
                    <img :src="item.thumbnailUrl" :alt="item.title" class="w-full h-full object-cover" />
                  </div>
                  <div v-else class="w-10 h-10 rounded-lg bg-[#EBF1EA] text-[#4A6741] flex items-center justify-center shrink-0 text-sm">
                    <i :class="item.typeIcon" aria-hidden="true"></i>
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                      <span :class="['text-[0.65rem] font-extrabold px-1.5 py-0.2 rounded uppercase tracking-wider', item.typeBadgeClass]">
                        {{ item.typeLabel }}
                      </span>
                      <span v-if="item.categoryName" class="text-[0.7rem] text-[#7A8A76] truncate font-medium">
                        {{ item.categoryName }}
                      </span>
                    </div>
                    <p class="text-xs sm:text-[0.88rem] font-bold text-[#172516] group-hover:text-[#2D5A27] truncate m-0 leading-snug">
                      {{ item.title }}
                    </p>
                  </div>

                  <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#BAC8B6] group-hover:text-[#2D5A27] group-hover:translate-x-0.5 transition-all mr-1 shrink-0" aria-hidden="true"></i>
                </nuxt-link>
              </div>

              <!-- Empty State -->
              <div v-else-if="!isSearchingLive" class="p-6 text-center text-xs text-[#7A8A76]">
                <i class="fa-solid fa-magnifying-glass text-lg mb-2 text-[#BAC8B6] block" aria-hidden="true"></i>
                <span>Không tìm thấy kết quả phù hợp cho &laquo;{{ searchQuery }}&raquo;</span>
              </div>

              <!-- Footer -->
              <div class="p-2.5 bg-[#F7FAF6] border-t border-[#E8EFE6] text-center">
                <button
                  type="button"
                  @click="handleSearch"
                  class="w-full py-2 px-3 rounded-lg text-xs font-extrabold text-[#2D5A27] hover:bg-[#EBF3E8] transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Xem toàn bộ kết quả tìm kiếm</span>
                  <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </transition>
      <!-- Thanh thông báo phát trực tiếp — trong header sticky để dính theo khi cuộn.
           Client-only: `/media` phục vụ qua `swr: 60` nên không mang state này ra SSR. -->
      <ClientOnly>
        <LiveTickerBar />
      </ClientOnly>
    </header>

    <!-- Main Content Area — không bù padding-top: header đã sticky nên còn
         trong flow, nếu cộng pt ở đây thì isSticky flip (khi cuộn qua ngưỡng) sẽ
         bật/tắt 130px đột ngột → layout shift giật toàn trang. Hero của từng trang
         tự có padding nội bộ đủ lớn để text không bị header sticky che. -->
    <main :class="isAssistant ? 'overflow-hidden p-0' : 'min-h-[calc(100vh-165px)] pb-24 md:pb-0'">
      <slot />
    </main>

    <!-- Footer Area -->
    <footer v-if="!isAssistant" class="bg-[#385130] text-white/80 pt-16 lg:pt-20 border-t-4 border-[#7CB342] pb-[calc(110px+env(safe-area-inset-bottom,0px))] md:pb-12 lg:pb-10">
      <div class="container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr] gap-8 lg:gap-10 mb-12 lg:mb-16">
        <div>
          <div class="flex items-center gap-3.5 mb-5 flex-wrap">
            <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-3 shrink-0">
              <img
                v-if="siteMainLogo"
                :src="siteMainLogo"
                alt="Logo cơ quan chủ quản"
                class="w-auto object-contain"
                :class="siteLogo ? 'h-16 md:h-[72px]' : 'h-14 md:h-16'"
              />
              <span v-if="siteMainLogo && siteLogo" class="h-12 md:h-14 w-px bg-white/25" aria-hidden="true"></span>
              <img
                v-if="siteLogo"
                :src="siteLogo"
                alt="Logo Con Đường Hướng Thiện"
                class="w-auto object-contain"
                :class="siteMainLogo ? 'h-12 md:h-[52px]' : 'h-14 md:h-16'"
              />
            </div>
            <span class="text-white font-extrabold text-[1.2rem] md:text-[1.35rem] tracking-[0.5px]">CON ĐƯỜNG HƯỚNG THIỆN</span>
          </div>
          <p class="text-[0.9rem] leading-relaxed">
            Trang thông tin điện tử về tái hòa nhập cộng đồng của Bộ Công an, do Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) quản lý và vận hành.
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
            <li><nuxt-link to="/qa-documents" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">Tài liệu Hỏi – Đáp đã phê duyệt</nuxt-link></li>
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
        <div class="container flex flex-col items-center md:items-start gap-2 text-center md:text-left md:pr-24">
          <p class="m-0 text-white/80 leading-relaxed">&copy; 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.</p>
          <p class="m-0">
            <a
              href="https://delify.vn?ref=conduonghuongthien"
              target="_blank"
              rel="noopener noreferrer"
              class="text-white/70 no-underline font-semibold transition-all hover:text-[#7CB342] hover:underline"
            >Design by Delify.vn</a>
          </p>
        </div>
      </div>
    </footer>

    <!-- Chatbot: all state and markup live in the component. -->
    <ChatWidget ref="chatWidget" />

    <!-- Mobile Bottom Nav: nền đặc thay cho backdrop-blur để bớt phí repaint mỗi frame cuộn. -->
    <nav
      v-if="!isAssistant"
      class="fixed bottom-2.5 left-3 right-3 h-16 bg-white/95 border border-white/40 rounded-[24px] shadow-[0_8px_32px_rgba(30,70,32,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] z-[9900] flex justify-around items-center px-1.5 transition-all md:hidden"
      :class="{ 'opacity-0 pointer-events-none translate-y-4': isMobileMenuOpen || isChatOpen }"
      aria-label="Điều hướng nhanh"
      style="padding-bottom: env(safe-area-inset-bottom, 0px); box-shadow: 0 8px 32px rgba(30,70,32,0.12), inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.05)"
    >
      <template v-for="item in bottomNav" :key="item.id">
        <!-- Featured raised center button -->
        <button
          v-if="item.featured"
          class="flex-1 relative flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#385130] max-w-[52px] font-extrabold text-[0.65rem] -top-3.5 cursor-pointer transition-all font-[inherit]"
          :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
          @click="item.type === 'link' ? navigateTo(item.url) : onBottomNavClick(item)"
        >
          <div
            class="w-[50px] h-[50px] rounded-full bg-gradient-to-br from-[#2e6b32] to-[#173b18] text-white flex items-center justify-center shadow-[0_12px_28px_rgba(23,59,24,0.45),inset_0_2px_4px_rgba(255,255,255,0.4)] border-[3.5px] border-white/95 transition-all active:scale-90"
            :class="{ 'shadow-[0_16px_36px_rgba(23,59,24,0.55),inset_0_2px_6px_rgba(255,255,255,0.5)] scale-105': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
          >
            <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.3rem]" aria-hidden="true"></i>
          </div>
          <span class="mt-0.5">{{ navItemLabel(item) }}</span>
        </button>

        <!-- Normal link item với liquid glass active state -->
        <nuxt-link
          v-else-if="item.type === 'link'"
          :to="item.url || '/'"
          class="flex-1 flex flex-col items-center justify-center gap-0.5 no-underline text-[#6b7669] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all active:text-[#4A6741]"
        >
          <div
            class="flex items-center justify-center px-3 py-1.5 rounded-2xl transition-all"
            :class="$route.path === item.url ? 'bg-gradient-to-br from-[#e8f5e3] to-[#d4ead0] shadow-[inset_0_2px_8px_rgba(74,103,65,0.15),0_2px_8px_rgba(74,103,65,0.08)] scale-105' : 'bg-transparent hover:bg-white/40'"
          >
            <i
              :class="item.icon || 'fa-solid fa-circle'"
              class="text-[1.25rem] transition-all"
              :style="$route.path === item.url ? 'color: #4A6741; filter: drop-shadow(0 1px 2px rgba(74,103,65,0.3))' : ''"
              aria-hidden="true"
            ></i>
          </div>
          <span
            class="transition-all"
            :class="$route.path === item.url ? 'text-[#2e5a28] font-extrabold' : ''"
          >{{ navItemLabel(item) }}</span>
        </nuxt-link>

        <!-- Action item (chatbot / drawer) với glass effect khi active -->
        <button
          v-else
          class="flex-1 flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#6b7669] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all font-[inherit]"
          @click="onBottomNavClick(item)"
        >
          <div
            class="flex items-center justify-center px-3 py-1.5 rounded-2xl transition-all"
            :class="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'bg-gradient-to-br from-[#e8f5e3] to-[#d4ead0] shadow-[inset_0_2px_8px_rgba(74,103,65,0.15),0_2px_8px_rgba(74,103,65,0.08)] scale-105' : 'bg-transparent hover:bg-white/40'"
          >
            <i
              :class="item.icon || 'fa-solid fa-circle'"
              class="text-[1.25rem] transition-all"
              :style="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'color: #4A6741; filter: drop-shadow(0 1px 2px rgba(74,103,65,0.3))' : ''"
              aria-hidden="true"
            ></i>
          </div>
          <span
            class="transition-all"
            :class="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'text-[#2e5a28] font-extrabold' : ''"
          >{{ navItemLabel(item) }}</span>
        </button>
      </template>
    </nav>
  </div>
</template>
<script setup lang="ts">
import {
  DEFAULT_BOTTOM_NAV,
  DEFAULT_NAV,
  parseBottomNavConfig,
  parseNavConfig,
} from '~/utils/nav-config'
import type { BottomNavItem, NavItem } from '~/utils/nav-config'
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
const isLangMenuOpen = ref(false)
const langDropdownRef = ref<HTMLElement | null>(null)

const FLAG_MAP: Record<string, string> = {
  vi: '🇻🇳',
  en: '🇬🇧',
  zh: '🇨🇳',
  fr: '🇫🇷',
  ru: '🇷🇺',
  lo: '🇱🇦',
  ja: '🇯🇵',
  ko: '🇰🇷',
}

const getFlagEmoji = (code: string) => FLAG_MAP[code] || '🌐'
const currentLocale = computed(() => locales.find(l => l.code === currentLang.value) || locales[0]!)
const currentLocaleFlag = computed(() => getFlagEmoji(currentLang.value))
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchBarRef = ref<HTMLElement | null>(null)

interface LiveSearchItem {
  id: string | number
  kind: string
  type: string
  typeLabel: string
  typeIcon: string
  typeBadgeClass: string
  title: string
  excerpt: string
  url: string
  thumbnailUrl: string | null
  categoryName: string | null
}

const liveSearchResults = ref<LiveSearchItem[]>([])
const isSearchingLive = ref(false)
const showLivePreview = ref(false)
let liveSearchTimer: ReturnType<typeof setTimeout> | null = null

const onSearchInput = () => {
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    liveSearchResults.value = []
    showLivePreview.value = false
    return
  }
  showLivePreview.value = true
  isSearchingLive.value = true
  if (liveSearchTimer) clearTimeout(liveSearchTimer)
  liveSearchTimer = setTimeout(async () => {
    try {
      const res = await $fetch<{ ok: boolean; items: LiveSearchItem[] }>('/api/public/search', {
        params: { q, limit: 6 },
      })
      if (res?.ok && Array.isArray(res.items)) {
        liveSearchResults.value = res.items
      } else {
        liveSearchResults.value = []
      }
    } catch {
      liveSearchResults.value = []
    } finally {
      isSearchingLive.value = false
    }
  }, 250)
}

const clearSearch = () => {
  searchQuery.value = ''
  liveSearchResults.value = []
  showLivePreview.value = false
  if (searchInputRef.value) searchInputRef.value.focus()
}

const closeSearchAndNavigate = () => {
  showLivePreview.value = false
  isSearchActive.value = false
  isMobileMenuOpen.value = false
}
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
// `HTMLElement`: `handleDocumentPointerDown` gọi `.contains(...)` trên giá trị này.
const readerMenuRef = ref<HTMLElement | null>(null)

// ─── Thông báo ──────────────────────────────────────────────────────────────
// Chuông desktop sống trong `ReaderNotificationBell.client.vue` và tự sở hữu
// state mở/đóng của nó. Layout vẫn chạm vào composable vì hai thứ còn lại nằm ở
// đây: huy hiệu số chưa đọc trong ngăn kéo mobile, và lượt nạp đầu tiên (xem
// `watch(reader)` bên dưới — huy hiệu mobile là một liên kết phẳng, không có cú
// mở nào để bám vào).
//
// State ở cấp module trong composable, nên chuông và danh sách trên /profile
// đọc cùng một con số thay vì hai lượt fetch đếm lệch nhau.
const {
  unreadCount,
  loaded: notifLoaded,
  load: loadNotifications,
  reset: resetNotifications,
} = useReaderNotifications()

// Chỉ để đóng menu trước khi `v-if` tháo component lúc đăng xuất.
// Chuông tự sở hữu cách đóng của nó và phơi ra qua `defineExpose({ close })`.
const notifBellRef = ref<{ close?: () => void } | null>(null)

/**
 * Nạp thông báo ngay khi biết được người đọc là ai.
 *
 * Phải là `watch` chứ không nằm trong `onMounted`: `loadReader()` cố ý không được
 * `await` (header không chặn lượt vẽ đầu để chờ nó), nên tại thời điểm mount thì
 * `reader` vẫn còn null và một lượt gọi thẳng sẽ nhận 401.
 *
 * Nạp sẵn thay vì đợi mở chuông, vì **huy hiệu ở ngăn kéo mobile không có cú mở
 * nào để bám vào** — nó là một liên kết phẳng, không phải một menu. Không nạp ở
 * đây thì trên điện thoại con số vĩnh viễn bằng 0 và tính năng trông như không
 * chạy. Đúng một request cho mỗi lượt tải trang của người đã đăng nhập.
 */
watch(reader, (value) => {
  if (!value) { resetNotifications(); return }
  if (!notifLoaded.value) {
    loadNotifications().catch(() => {
      // 401 ở đây nghĩa là vé đã hết hiệu lực. `useReaderAuth` sở hữu quyết định
      // đó và lượt tải trang sau sẽ tự chỉnh; một thông báo lỗi ở header cho một
      // danh sách chưa ai mở là tiếng ồn.
    })
  }
})

/**
 * Đăng xuất từ cả hai bề mặt (menu desktop và ngăn kéo mobile).
 *
 * Đóng cả hai lớp phủ trước khi gọi: `signOut` xoá danh tính, nên khối chứa nút
 * vừa bấm bị `v-if` tháo ra. Để menu mở lại thì lần đăng nhập sau nó vẫn còn mở
 * đúng ở chỗ đó, treo dưới một cái tên đã không còn.
 */
async function onReaderSignOut() {
  isReaderMenuOpen.value = false
  notifBellRef.value?.close?.()
  isMobileMenuOpen.value = false
  await readerSignOut()
  // Xoá luôn danh sách và bộ đếm: state ở cấp module nên nó sống qua lượt đăng
  // xuất, và trên máy dùng chung người kế tiếp sẽ thấy huy hiệu của người trước.
  resetNotifications()
}

const route = useRoute()
const isAssistant = computed(() => route.path === '/assistant' || route.path.startsWith('/assistant/'))
const router = useRouter()
const { error: toastError } = useToast()

// Đóng dropdown nav desktop khi chuyển trang.
//
// Dropdown nav mở bằng `:focus-within`/`:hover` thuần CSS (không có state JS),
// nên sau khi bấm một mục con, focus vẫn nằm trong `<li>` đó và menu cứ mở
// regardless route đã đổi. `activeElement.blur()` gỡ focus → `:focus-within`
// tắt → menu đóng theo chính CSS đã có, không phải thêm(state mới. Chỉ blur khi
// focus đang nằm trong thanh nav (`.desktop-nav`), không giày vò focus của
// widget/ô input nào khác trên trang.
watch(() => route.path, () => {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('.desktop-nav')) active.blur()
})

// Dynamic nav menu from admin settings (falls back to DEFAULT_NAV)

// `NavItem[] | null` tường minh: `null` nghĩa là "chưa có cấu hình, dùng bảng mặc
// định". Đây cũng là chỗ `openNewTab` được đọc, nên khai đúng kiểu ở đây là điều
// biến cổng typecheck thành thứ **bắt được** một trường nav bị bộ khử độc bỏ rơi —
// đúng lỗi vừa phải sửa bằng tay vì không có gì canh.
const navMenuRaw = ref<NavItem[] | null>(null)

const navMenu = computed<NavItem[]>(() => {
  if (Array.isArray(navMenuRaw.value) && navMenuRaw.value.length) return navMenuRaw.value
  return DEFAULT_NAV
})


const bottomNavRaw = ref<BottomNavItem[] | null>(null)
const bottomNav = computed<BottomNavItem[]>(() => {
  if (Array.isArray(bottomNavRaw.value) && bottomNavRaw.value.length) return bottomNavRaw.value
  return DEFAULT_BOTTOM_NAV
})

const navItemLabel = (item: NavItem) => item.label || (item.labelKey ? t(item.labelKey) : item.url)

const onBottomNavClick = (item: BottomNavItem) => {
  if (item.type === 'chatbot') chatWidget.value?.toggleChatbot?.()
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
const siteLogo = computed(() => {
  const val = sitePublicSettings.value.logo_url
  if (val === '') return ''
  return val?.trim() || '/Logo.png'
})
const siteMainLogo = computed(() => sitePublicSettings.value.main_logo_url?.trim() || '')
const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.vn')
const siteAddress = computed(() => sitePublicSettings.value.address?.trim() || 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội')
const siteHotlineTel = computed(() => 'tel:' + siteHotline.value.replace(/[^0-9+]/g, ''))

// Derive nav from the fetched settings (reactive — updates if data refetches)
//
// `parseNavConfig` / `parseBottomNavConfig` (app/utils/nav-config.ts) kiểm cả
// HÌNH DẠNG, không chỉ cú pháp JSON. Bản cũ ở đây chỉ có `try/catch`, nên một
// JSON hợp lệ mà sai hình dạng (`{}`, `[{}]`) đi qua trót lọt rồi làm
// `<NuxtLink :to="undefined">` — thanh điều hướng biến mất hoặc dựng liên kết
// chết trên TOÀN cổng, do một ô cấu hình lưu thành công mà không có gì báo.
// `null` nghĩa là lùi về bảng mặc định: một cấu hình sai nên làm cổng trông như
// chưa cấu hình, không nên làm cổng trông như bị hỏng.
watch(settingsData, (res) => {
  if (!res?.settings) return
  const navbarRaw = res.settings.nav_menu_navbar || res.settings.nav_menu
  if (navbarRaw) navMenuRaw.value = parseNavConfig(navbarRaw)
  const mobileRaw = res.settings.nav_menu_mobile
  if (mobileRaw) bottomNavRaw.value = parseBottomNavConfig(mobileRaw)
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
  if (isLangMenuOpen.value) isLangMenuOpen.value = false
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(applyStickyState)
}

const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

// The bottom nav dims itself while the chat is open and highlights its chatbot
// item; both need to read the widget's state, which the widget owns.
// Widget phơi `isChatbotOpen` + `toggleChatbot` cho thanh nav dưới đọc trạng thái.
const chatWidget = ref<{ isChatbotOpen?: boolean; toggleChatbot?: () => void } | null>(null)
const isChatOpen = computed(() => chatWidget.value?.isChatbotOpen ?? false)

// The widget locks scroll for itself while its dialog is open; the layout only
// answers for the mobile menu.
watch(isMobileMenuOpen, (isMenuOpen) => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = isMenuOpen ? 'hidden' : ''
  }
})

const handleKeydown = (event: KeyboardEvent) => {
  // The chatbot dialog handles its own Escape via a keydown on the dialog; this
  // only needs to catch the mobile menu.
  if (event.key !== 'Escape') return
  if (isMobileMenuOpen.value) isMobileMenuOpen.value = false
  // Đóng cả menu danh tính: một menu chỉ đóng được bằng cách bấm lại đúng nút đã
  // mở nó là một cái bẫy bàn phím — Escape là cách người dùng bàn phím thoát khỏi
  // mọi lớp phủ khác trên trang này.
  if (isReaderMenuOpen.value) isReaderMenuOpen.value = false
  if (isLangMenuOpen.value) isLangMenuOpen.value = false
  if (isSearchActive.value) {
    isSearchActive.value = false
    showLivePreview.value = false
  }
}

/**
 * Bấm ra ngoài thì đóng menu danh tính hoặc khung xem trước tìm kiếm.
 *
 * Bắt ở pha `mousedown` chứ không `click`: một cú bấm vào liên kết bên trong menu
 * là `mousedown` rồi `click`, và nếu đóng ở `click` thì handler này chạy **sau**
 * khi Vue đã tháo phần tử — nhưng bắt ở `mousedown` với kiểm tra `contains` thì
 * liên kết vẫn còn trong cây, nên nó vẫn điều hướng bình thường.
 */
const handleDocumentPointerDown = (event: MouseEvent) => {
  const target = event.target instanceof Node ? event.target : null
  if (isReaderMenuOpen.value) {
    const root = readerMenuRef.value
    if (root && (!target || !root.contains(target))) isReaderMenuOpen.value = false
  }
  if (isLangMenuOpen.value) {
    const langRoot = langDropdownRef.value
    if (langRoot && (!target || !langRoot.contains(target))) isLangMenuOpen.value = false
  }
  if (showLivePreview.value) {
    const searchRoot = searchBarRef.value
    if (searchRoot && (!target || !searchRoot.contains(target))) {
      showLivePreview.value = false
    }
  }
}

const mobileOpenSubmenu = ref<string | null>(null)

const toggleMobileSubmenu = (menuKey: string) => {
  mobileOpenSubmenu.value = mobileOpenSubmenu.value === menuKey ? null : menuKey
}

const onNavClick = (e: MouseEvent) => {
  // `closest` là của `Element`; một target không phải Element không có liên kết nào
  // để bấm vào, nên nó chỉ đơn giản không đóng menu.
  if (e.target instanceof Element && e.target.closest('a')) {
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
  } else {
    showLivePreview.value = false
  }
}

const handleSearch = () => {
  const q = searchQuery.value.trim()
  if (q) {
    navigateTo({ path: '/search', query: { q } })
    searchQuery.value = ''
    showLivePreview.value = false
    isSearchActive.value = false
    isMobileMenuOpen.value = false
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
