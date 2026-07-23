<template>
  <div>
    <!-- Hero Banner Section -->
    <section class="relative min-h-[520px] overflow-hidden sm:min-h-[580px]" style="background: url('/assets/hero_banner.jpg') center 65% / cover no-repeat;">
      <!-- Gradient overlay: deep green left → lime-tinted right -->
      <div class="absolute inset-0" style="background: linear-gradient(120deg, rgba(28,54,28,0.95) 0%, rgba(45,74,45,0.82) 45%, rgba(90,140,60,0.45) 100%);"></div>

      <!-- Decorative diagonal stripe (subtle) -->
      <div class="absolute inset-0 opacity-[0.04]" style="background: repeating-linear-gradient(135deg, #fff 0px, #fff 1px, transparent 1px, transparent 40px);"></div>

      <div class="container relative z-10 flex items-center px-4 pb-24 pt-16 sm:px-0 sm:pb-32 sm:pt-[90px]">
        <div class="max-w-[780px]">

          <!-- Badge -->
          <div class="flex items-center gap-3 mb-7">
            <span class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[0.75rem] font-extrabold uppercase tracking-[1px] text-[#1a3a1a]" style="background: linear-gradient(135deg, #ffd700 0%, #f59e0b 100%); box-shadow: 0 3px 12px rgba(245,158,11,0.5);">
              <i class="fa-solid fa-shield-halved text-[0.7rem]"></i>
              {{ t('hero_badge') }}
            </span>
          </div>

          <!-- Headline -->
          <h1 class="text-[2.35rem] font-extrabold leading-[1.16] text-white mb-5 tracking-[-0.5px] sm:text-[3.6rem]" style="text-shadow: 0 2px 16px rgba(0,0,0,0.55);">
            <span class="block">Đồng hành cùng</span>
            <span class="block" style="color: #a8d878;">hành trình hướng thiện</span>
          </h1>

          <!-- Divider accent -->
          <div class="flex items-center gap-3 mb-6">
            <div class="h-[3px] w-12 rounded-full bg-[#7CB342]"></div>
            <div class="h-[3px] w-4 rounded-full bg-white/30"></div>
          </div>

          <!-- Subtitle -->
          <p class="text-[1rem] leading-[1.65] text-white/85 mb-8 max-w-[620px] sm:text-[1.15rem] sm:mb-9" style="text-shadow: 0 1px 6px rgba(0,0,0,0.4);">
            {{ t('hero_subtitle') }}
          </p>

          <!-- CTAs -->
          <div class="flex flex-wrap gap-3 items-center">
            <nuxt-link
              to="/about"
              class="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-white transition-all duration-200 hover:-translate-y-0.5"
              style="background: linear-gradient(135deg, #7CB342 0%, #5a9e2a 100%); box-shadow: 0 6px 20px rgba(124,179,66,0.45);"
            >
              <i class="fa-solid fa-circle-info text-[0.85rem]"></i>
              {{ t('hero_btn_about') }}
            </nuxt-link>

            <a
              href="#tro-giup"
              class="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-white border border-white/40 backdrop-blur-sm transition-all duration-200 hover:bg-white/15 hover:-translate-y-0.5"
              style="background: rgba(255,255,255,0.1);"
            >
              <i class="fa-solid fa-headset text-[0.85rem]"></i>
              {{ t('hero_btn_help') }}
            </a>
          </div>

          <!-- Trust signals -->
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-9 text-[0.8rem] font-semibold text-white/60">
            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Hỗ trợ 24/7 miễn phí</span>
            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Bảo mật thông tin</span>
            <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Kết nối trực tiếp cán bộ</span>
          </div>
        </div>
      </div>

      <!-- Bottom wave -->
      <div class="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 56" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="display:block; width:100%; height:56px;">
          <path d="M0,56 C360,0 1080,0 1440,56 L1440,56 L0,56 Z" fill="#ffffff"/>
        </svg>
      </div>
    </section>

    <!-- Statistics Section -->
    <section class="relative z-10 -mt-10 px-4 sm:-mt-7 sm:px-0" aria-label="Những con số nổi bật">
      <div class="container">
        <div class="relative overflow-hidden rounded-2xl border border-[#dce7d9] bg-white shadow-[0_18px_50px_rgba(35,67,31,0.12)]">
          <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#315c35] via-[#7CB342] to-[#315c35]"></div>
          <div class="grid grid-cols-1 divide-y divide-[#e5ede2] sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <div class="group flex items-center gap-4 px-5 py-6 transition-colors duration-200 hover:bg-[#f7faf5] sm:px-6 lg:flex-col lg:items-start lg:gap-5 lg:px-7 lg:py-8">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf5e8] text-[#416b3b] ring-1 ring-[#d7e7d0] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105" aria-hidden="true">
                <i class="fa-solid fa-map-location-dot text-xl"></i>
              </div>
              <div class="min-w-0">
                <span class="block text-[2rem] font-black leading-none tracking-tight text-[#244829] lg:text-[2.25rem]">34</span>
                <span class="mt-2 block text-[0.84rem] font-semibold leading-[1.45] text-[#5d6d59]">{{ t('stat_provinces_label') }}</span>
              </div>
            </div>

            <div class="group flex items-center gap-4 px-5 py-6 transition-colors duration-200 hover:bg-[#f7faf5] sm:px-6 lg:flex-col lg:items-start lg:gap-5 lg:px-7 lg:py-8">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf5e8] text-[#416b3b] ring-1 ring-[#d7e7d0] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105" aria-hidden="true">
                <i class="fa-solid fa-hands-holding-circle text-xl"></i>
              </div>
              <div class="min-w-0">
                <span class="block text-[2rem] font-black leading-none tracking-tight text-[#244829] lg:text-[2.25rem]">10.000<span class="text-[#6da33e]">+</span></span>
                <span class="mt-2 block text-[0.84rem] font-semibold leading-[1.45] text-[#5d6d59]">{{ t('stat_reintegrated_label') }}</span>
              </div>
            </div>

            <div class="group flex items-center gap-4 px-5 py-6 transition-colors duration-200 hover:bg-[#f7faf5] sm:px-6 lg:flex-col lg:items-start lg:gap-5 lg:px-7 lg:py-8">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf5e8] text-[#416b3b] ring-1 ring-[#d7e7d0] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105" aria-hidden="true">
                <i class="fa-solid fa-seedling text-xl"></i>
              </div>
              <div class="min-w-0">
                <span class="block text-[2rem] font-black leading-none tracking-tight text-[#244829] lg:text-[2.25rem]">500<span class="text-[#6da33e]">+</span></span>
                <span class="mt-2 block text-[0.84rem] font-semibold leading-[1.45] text-[#5d6d59]">{{ t('stat_models_label') }}</span>
              </div>
            </div>

            <div class="group flex items-center gap-4 px-5 py-6 transition-colors duration-200 hover:bg-[#f7faf5] sm:px-6 lg:flex-col lg:items-start lg:gap-5 lg:px-7 lg:py-8">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf5e8] text-[#416b3b] ring-1 ring-[#d7e7d0] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105" aria-hidden="true">
                <i class="fa-solid fa-headset text-xl"></i>
              </div>
              <div class="min-w-0">
                <span class="block text-[2rem] font-black leading-none tracking-tight text-[#244829] lg:text-[2.25rem]">24<span class="text-[#6da33e]">/</span>7</span>
                <span class="mt-2 block text-[0.84rem] font-semibold leading-[1.45] text-[#5d6d59]">{{ t('stat_support_label') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- BCA Style News Section -->
    <section class="section bg-white py-[60px]">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[2.1fr_0.9fr]">
        <!-- Left column -->
        <div>
          <SectionBar title="Tin nổi bật" icon="★" to="/news" viewall-text="Tất cả tin tức →" />

          <!-- Main featured -->
          <div class="mb-6">
            <nuxt-link to="/news/da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan" class="block no-underline group">
              <div class="relative h-[300px] rounded-lg overflow-hidden sm:h-[420px] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <img src="/assets/news_danang.jpg" alt="Đại hội Đà Nẵng" class="w-full h-full object-cover transition-transform duration-[0.6s] ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-[1.03]" />
                <div class="absolute bottom-0 left-0 right-0 h-[60%] z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.95) 0%, rgba(16,28,16,0.4) 60%, rgba(16,28,16,0) 100%);"></div>
                <div class="absolute bottom-0 left-0 right-0 p-6 text-white z-[2]">
                  <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm mb-2">TIN NỔI BẬT</span>
                  <span class="text-[0.75rem] opacity-85 ml-3">📅 17/07/2026</span>
                  <h3 class="text-[1.45rem] sm:text-[1.12rem] font-extrabold leading-[1.3] my-[6px_0_10px] text-white transition-colors group-hover:text-[#c5e1a5]">ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN</h3>
                  <p class="text-[0.88rem] sm:text-[0.82rem] leading-[1.5] opacity-[0.88] m-0 line-clamp-2">Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 nhằm nâng cao chất lượng giáo dục, cải tạo...</p>
                </div>
              </div>
            </nuxt-link>
          </div>

          <!-- 2 sub cards -->
          <div class="grid grid-cols-1 gap-[14px] sm:grid-cols-2 sm:gap-5">
            <div class="flex gap-4 py-3 border-t border-dashed border-[#E2E8DF] group">
              <nuxt-link to="/news/quang-ninh-van-don-ho-tro-viec-lam" class="w-[130px] h-[85px] rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                <img src="/assets/news_quangninh.jpg" alt="Vân đồn việc làm" class="w-full h-full object-cover transition group-hover:scale-[1.05]" />
              </nuxt-link>
              <div class="flex flex-col">
                <span class="text-[0.72rem] text-[#7A8675] font-bold mb-1">17/07/2026</span>
                <h4 class="text-[0.88rem] font-bold leading-[1.35] m-0">
                  <nuxt-link to="/news/quang-ninh-van-don-ho-tro-viec-lam" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">
                    QUẢNG NINH: Hỗ trợ việc làm tại Vân Đồn cho người chấp hành xong án phạt
                  </nuxt-link>
                </h4>
              </div>
            </div>

            <div class="flex gap-4 py-3 border-t border-dashed border-[#E2E8DF] group">
              <nuxt-link to="/news/lam-dong-tham-hoi-tang-qua-dac-xa" class="w-[130px] h-[85px] rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                <img src="/assets/news_lamdong.jpg" alt="Lâm đồng đặc xá" class="w-full h-full object-cover transition group-hover:scale-[1.05]" />
              </nuxt-link>
              <div class="flex flex-col">
                <span class="text-[0.72rem] text-[#7A8675] font-bold mb-1">17/07/2026</span>
                <h4 class="text-[0.88rem] font-bold leading-[1.35] m-0">
                  <nuxt-link to="/news/lam-dong-tham-hoi-tang-qua-dac-xa" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">
                    LÂM ĐỒNG: Thăm hỏi, tặng quà, động viên người được đặc xá khó khăn
                  </nuxt-link>
                </h4>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div>
          <SectionBar title="Chỉ đạo &amp; Hoạt động" icon="⚑" />

          <div class="flex flex-col">
            <div v-for="item in trendingNews" :key="item.id" class="flex gap-3 py-[14px] border-b border-[#E2E8DF] last:border-b-0">
              <div class="w-[6px] h-[6px] rounded-full bg-[#4A6741] mt-2 flex-shrink-0"></div>
              <div>
                <h4 class="text-[0.88rem] font-bold leading-[1.4] m-0 mb-[6px]">
                  <nuxt-link :to="item.link" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">{{ item.title }}</nuxt-link>
                </h4>
                <span class="text-[0.72rem] text-[#7A8675] font-semibold">📅 {{ item.date }}</span>
              </div>
            </div>
          </div>

          <!-- Side banner -->
          <div class="relative rounded-lg p-6 text-white mt-6 overflow-hidden shadow-sm" style="background: url('/assets/hero_banner.jpg') center/cover no-repeat;">
            <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)] z-[1]"></div>
            <div class="relative z-[2]">
              <h3 class="text-[1rem] font-extrabold mt-0 mb-2 uppercase">Hotline Cảnh Sát QLHC</h3>
              <p class="text-[0.78rem] leading-[1.4] m-0 mb-4 opacity-90">Hỗ trợ giải đáp thủ tục cấp CCCD &amp; Lý lịch tư pháp cho người hoàn lương</p>
              <span class="inline-block bg-[#7CB342] text-white px-[14px] py-[6px] text-[0.9rem] font-extrabold rounded">📞 1900.0368</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Sub News Columns -->
    <section class="section bg-[#F8FAF7] border-t border-[#E2E8DF] py-[50px]">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <!-- Warning col -->
        <div>
          <SectionBar title="Cảnh báo &amp; Tuyên truyền" icon="⚠" variant="light" />
          <div class="flex flex-col gap-4">
            <div v-for="item in legalWarningNews" :key="item.id" class="bg-white border-l-[3px] border-l-[#d9534f] border border-[#E2E8DF] p-[18px] rounded-lg transition hover:shadow-sm hover:border-l-[#4A6741]">
              <span class="block text-[0.72rem] text-[#7A8675] font-bold mb-[6px]">📅 {{ item.date }}</span>
              <h4 class="text-[0.92rem] font-extrabold m-0 mb-2 leading-[1.4]">
                <nuxt-link :to="item.link" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">{{ item.title }}</nuxt-link>
              </h4>
              <p class="text-[0.82rem] text-[#4A5545] leading-[1.5] m-0">{{ item.excerpt }}</p>
            </div>
          </div>
        </div>

        <!-- Local news col -->
        <div>
          <SectionBar title="Tin Công an địa phương" icon="📍" variant="light" />
          <div class="flex flex-col">
            <div v-for="item in localPoliceNews" :key="item.id" class="flex py-3 border-b border-dashed border-[#E2E8DF] last:border-b-0 text-[0.88rem] leading-[1.4]">
              <span class="text-[#4A6741] font-bold mr-2 flex-shrink-0">[{{ item.date.slice(0,5) }}]</span>
              <nuxt-link :to="item.link" class="text-[#1E251C] no-underline font-bold transition hover:text-[#4A6741]">{{ item.title }}</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Parallax Quote -->
    <section class="parallax-fixed relative py-[100px] md:py-[60px] sm:py-[40px] text-center text-white" style="background: url('/assets/hero_banner.jpg') center/cover no-repeat fixed;">
      <div class="absolute inset-0 bg-[rgba(45,74,45,0.85)]"></div>
      <div class="container relative z-[2] max-w-[800px] mx-auto">
        <blockquote class="text-[1.6rem] md:text-[1.1rem] sm:text-[0.95rem] font-semibold leading-[1.5] italic mb-6">
          "Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện."
        </blockquote>
        <cite class="text-[0.95rem] font-bold uppercase tracking-[1px]">— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an</cite>
      </div>
    </section>

    <!-- Role Models Section -->
    <section class="section bg-[#F8FAF7]">
      <div class="container">
        <div class="text-center max-w-[600px] mx-auto mb-[50px]">
          <span class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">Hành trình hướng thiện</span>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">Tấm Gương Sáng Điển Hình</h2>
          <p class="text-[0.95rem] text-[#4A5545] leading-[1.5]">Những câu chuyện nghị lực phi thường vượt qua lầm lỡ, xây dựng cuộc sống ấm no và giúp đỡ đồng đội</p>
        </div>

        <div
          class="relative w-full pb-9"
          @mouseenter="stopRoleAutoplay"
          @mouseleave="startRoleAutoplay"
        >
          <button class="absolute top-[42%] -translate-y-1/2 left-[-22px] md:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08] hover:shadow-[0_8px_24px_rgba(30,70,32,0.3)]" @click="prevRoleSlide" aria-label="Slide trước">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>

          <div
            class="grid grid-flow-col overflow-x-auto scroll-smooth [grid-auto-columns:calc(100%_-_12px)] [scroll-snap-type:x_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-[6px] py-3 gap-7 md:[grid-auto-columns:calc(50%_-_14px)]"
            ref="roleModelsSliderTrack"
          >
            <div
              v-for="(model, index) in roleModelsList"
              :key="model.id"
              class="role-card-before [scroll-snap-align:start] bg-white rounded-2xl p-6 shadow-[0_6px_24px_rgba(0,0,0,0.04)] flex gap-5 border border-[rgba(30,70,32,0.08)] transition-all duration-300 hover:-translate-y-[6px] hover:shadow-[0_16px_36px_rgba(30,70,32,0.12)] hover:border-[rgba(30,70,32,0.2)] md:flex-col md:items-center md:text-center md:p-6 relative overflow-hidden"
              :class="{ 'is-active-slide': activeRoleIndex === index }"
            >
              <div class="relative w-[90px] h-[90px] md:w-[54px] md:h-[54px] rounded-full overflow-hidden border-[3px] border-[rgba(30,70,32,0.1)] flex-shrink-0 md:mx-auto">
                <img :src="model.image" :alt="model.name" class="w-full h-full object-cover" />
                <span class="absolute bottom-[2px] right-[2px] w-5 h-5 md:w-4 md:h-4 rounded-full bg-[#7CB342] text-white text-[0.65rem] md:text-[0.55rem] font-black flex items-center justify-center border-2 border-white">✓</span>
              </div>
              <div>
                <span class="inline-block text-[0.74rem] md:text-[0.62rem] font-bold text-[#4A6741] bg-[rgba(30,70,32,0.06)] px-[10px] py-1 rounded-[20px] mb-2">{{ model.location }}</span>
                <h3 class="text-[1.1rem] md:text-[0.84rem] font-extrabold text-[#1E251C] mb-2 md:mb-1 md:leading-[1.25]">{{ model.name }}</h3>
                <p class="text-[0.86rem] md:text-[0.72rem] text-[#4A5545] leading-[1.5] md:leading-[1.35] mb-[14px] md:mb-1 md:line-clamp-3">{{ model.desc }}</p>
                <nuxt-link :to="`/role-models/${model.id}`" class="text-[0.84rem] md:text-[0.7rem] text-[#4A6741] font-bold no-underline inline-flex items-center gap-1 transition hover:gap-2 hover:text-[#7CB342]">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
              </div>
            </div>
          </div>

          <button class="absolute top-[42%] -translate-y-1/2 right-[-22px] md:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08] hover:shadow-[0_8px_24px_rgba(30,70,32,0.3)]" @click="nextRoleSlide" aria-label="Slide tiếp">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>

          <div class="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-2">
            <span
              v-for="(model, index) in roleModelsList"
              :key="'role-dot-' + index"
              class="rounded-full cursor-pointer transition-all duration-300 h-[9px]"
              :class="activeRoleIndex === index ? 'w-[26px] rounded-[12px] bg-[#4A6741] shadow-[0_2px_8px_rgba(30,70,32,0.3)]' : 'w-[9px] bg-[rgba(30,70,32,0.2)] hover:bg-[rgba(30,70,32,0.5)]'"
              @click="goToRoleSlide(index)"
            ></span>
          </div>
        </div>
      </div>
    </section>

    <!-- Reintegration Models Section -->
    <section class="section bg-white">
      <div class="container">
        <div class="text-center max-w-[600px] mx-auto mb-[50px]">
          <span class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">Mô hình hỗ trợ</span>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
          <p class="text-[0.95rem] text-[#4A5545] leading-[1.5]">Hệ thống giải pháp và cơ sở hỗ trợ sinh kế bền vững do Nhà nước và các địa phương tổ chức</p>
        </div>

        <div
          class="relative w-full pb-9"
          @mouseenter="stopModelAutoplay"
          @mouseleave="startModelAutoplay"
        >
          <button class="absolute top-[42%] -translate-y-1/2 left-[-22px] md:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08]" @click="prevModelSlide" aria-label="Slide trước">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>

          <div
            class="grid grid-flow-col overflow-x-auto scroll-smooth [grid-auto-columns:calc(100%_-_12px)] [scroll-snap-type:x_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-[6px] py-3 gap-[26px] md:[grid-auto-columns:calc(50%_-_13px)] lg:[grid-auto-columns:calc(33.333%_-_18px)]"
            ref="reintegrationModelsSliderTrack"
          >
            <div
              v-for="(item, index) in reintegrationModelsList"
              :key="item.id"
              class="[scroll-snap-align:start] bg-white rounded-2xl md:rounded-xl px-6 py-8 md:px-2 md:py-[14px] text-center shadow-[0_6px_24px_rgba(0,0,0,0.04)] border border-[rgba(30,70,32,0.08)] transition-all duration-300 hover:-translate-y-[6px] hover:shadow-[0_16px_36px_rgba(30,70,32,0.12)] hover:border-[rgba(30,70,32,0.2)] flex flex-col items-center"
              :class="{ 'is-active-slide': activeModelIndex === index }"
            >
              <div class="w-16 h-16 md:w-11 md:h-11 rounded-[20px] md:rounded-[14px] flex items-center justify-center text-[2.2rem] md:text-[1.3rem] mb-[18px] md:mb-2 shadow-[0_4px_12px_rgba(30,70,32,0.08)]" style="background: linear-gradient(135deg, rgba(30,70,32,0.08) 0%, rgba(124,179,66,0.15) 100%);">{{ item.icon }}</div>
              <h3 class="text-[1.12rem] md:text-[0.84rem] font-extrabold text-[#1E251C] mb-[10px] md:mb-1 md:leading-[1.25]">{{ item.title }}</h3>
              <p class="text-[0.86rem] md:text-[0.72rem] text-[#4A5545] leading-[1.5] md:leading-[1.35] mb-[18px] md:mb-[6px] md:line-clamp-3">{{ item.desc }}</p>
              <nuxt-link :to="`/reintegration-models/${item.id}`" class="text-[0.84rem] md:text-[0.7rem] text-[#4A6741] font-bold no-underline mt-auto">Tìm hiểu &rarr;</nuxt-link>
            </div>
          </div>

          <button class="absolute top-[42%] -translate-y-1/2 right-[-22px] md:hidden w-11 h-11 rounded-full bg-white border border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.09)] text-[#4A6741] flex items-center justify-center cursor-pointer z-10 transition hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] hover:scale-[1.08]" @click="nextModelSlide" aria-label="Slide tiếp">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>

          <div class="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-2">
            <span
              v-for="(item, index) in reintegrationModelsList"
              :key="'model-dot-' + index"
              class="rounded-full cursor-pointer transition-all duration-300 h-[9px]"
              :class="activeModelIndex === index ? 'w-[26px] rounded-[12px] bg-[#4A6741] shadow-[0_2px_8px_rgba(30,70,32,0.3)]' : 'w-[9px] bg-[rgba(30,70,32,0.2)] hover:bg-[rgba(30,70,32,0.5)]'"
              @click="goToModelSlide(index)"
            ></span>
          </div>
        </div>
      </div>
    </section>

    <!-- Official Documents Section -->
    <section class="section bg-[#F8FAF7]">
      <div class="container grid grid-cols-1 items-center gap-10 md:grid-cols-2">
        <div>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-4">Văn Bản Pháp Quy Mới</h2>
          <p class="text-[#4A5545] mb-6 leading-[1.6]">Cập nhật liên tục các quyết định chỉ đạo của Thủ tướng Chính phủ, các thông tư chỉ thị của Bộ Công an về công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng.</p>
          <nuxt-link to="/documents" class="btn btn-primary">Tra cứu thư viện văn bản</nuxt-link>
        </div>
        <div class="flex flex-col gap-4">
          <div v-for="doc in latestDocs" :key="doc.id" class="bg-white border border-[#E2E8DF] rounded-lg p-4 flex gap-4 items-start transition hover:border-[#4A6741] hover:shadow-sm">
            <span class="text-2xl">📄</span>
            <div>
              <span class="block text-[0.75rem] font-bold text-[#4A6741] mb-1">{{ doc.number }} • {{ doc.date }}</span>
              <h4 class="text-[0.88rem] font-bold leading-[1.4] m-0">{{ doc.title }}</h4>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Video Section -->
    <section class="section bg-white">
      <div class="container grid grid-cols-1 gap-10 md:grid-cols-[2fr_1fr]">
        <div>
          <SectionBar title="Thư viện Video" icon="▶" />
          <div class="bg-white border border-[#E2E8DF] rounded-lg p-4">
            <a :href="mainVideoUrl" target="_blank" rel="noopener" class="relative block h-[340px] md:h-[220px] sm:h-[180px] rounded overflow-hidden cursor-pointer no-underline group" aria-label="Mở video tài liệu về tái hòa nhập cộng đồng (YouTube)">
              <img src="/assets/hero_banner.jpg" alt="Ảnh minh họa phim tài liệu Đường về hướng thiện" class="w-full h-full object-cover" />
              <div class="absolute inset-0 bg-black/30 flex flex-col gap-[14px] items-center justify-center">
                <span class="text-5xl text-white bg-[#4A6741] w-[70px] h-[70px] rounded-full flex items-center justify-center pl-[5px] shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition group-hover:scale-110 group-hover:bg-[#7CB342]">▶</span>
                <span class="text-white text-[0.82rem] font-bold bg-black/50 px-[14px] py-[5px] rounded-[20px] tracking-[0.3px]">Xem trên YouTube</span>
              </div>
            </a>
            <h3 class="text-[1.1rem] font-bold mt-[14px]">Phim tài liệu: Đường về hướng thiện - Nâng bước cuộc sống mới</h3>
          </div>
        </div>

        <div class="flex flex-col">
          <SectionBar title="Playlist nổi bật" icon="♫" />
          <div class="flex flex-col gap-4">
            <a v-for="v in videos" :key="v.id" :href="v.url" target="_blank" rel="noopener" class="flex gap-4 items-center p-3 sm:p-[10px] bg-white border border-[#E2E8DF] rounded-lg cursor-pointer no-underline text-inherit transition hover:border-[#7CB342] hover:bg-[#F8FAF7]">
              <div class="w-20 sm:w-[60px] h-[50px] sm:h-10 bg-[#385130] rounded flex items-center justify-center flex-shrink-0">
                <span class="text-white text-[0.8rem]">▶</span>
              </div>
              <div>
                <h4 class="text-[0.85rem] font-bold leading-[1.3] mb-1">{{ v.title }}</h4>
                <span class="text-[0.75rem] text-[#7A8675]">{{ v.duration }}</span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Photo Gallery Section -->
    <section class="section bg-[#F8FAF7]" id="photo-library">
      <div class="container">
        <div class="text-center max-w-[600px] mx-auto mb-[50px]">
          <span class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">Hình ảnh thực tế</span>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">Thư Viện Ảnh Hoạt Động</h2>
          <p class="text-[0.95rem] text-[#4A5545] leading-[1.5]">Ghi nhận những khoảnh khắc hỗ trợ, kết nối doanh nghiệp và sinh hoạt cộng đồng tái hòa nhập</p>
        </div>

        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div class="relative rounded-lg overflow-hidden h-[200px] shadow-sm group">
            <img src="/assets/news_danang.jpg" alt="Đối thoại phạm nhân Đà Nẵng" class="w-full h-full object-cover transition-transform duration-[0.4s] group-hover:scale-[1.05]" />
            <div class="absolute inset-0 z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.9) 0%, rgba(16,28,16,0) 100%);"></div>
            <div class="absolute bottom-0 left-0 right-0 p-4 text-white z-[2]">
              <h4 class="text-[0.88rem] font-extrabold m-0 mb-1">Hội nghị đối thoại cùng phạm nhân</h4>
              <span class="text-[0.7rem] opacity-80 uppercase font-[750] tracking-[0.5px]">Trại tạm giam Đà Nẵng</span>
            </div>
          </div>
          <div class="relative rounded-lg overflow-hidden h-[200px] shadow-sm group">
            <img src="/assets/news_quangninh.jpg" alt="Hỗ trợ việc làm Vân Đồn" class="w-full h-full object-cover transition-transform duration-[0.4s] group-hover:scale-[1.05]" />
            <div class="absolute inset-0 z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.9) 0%, rgba(16,28,16,0) 100%);"></div>
            <div class="absolute bottom-0 left-0 right-0 p-4 text-white z-[2]">
              <h4 class="text-[0.88rem] font-extrabold m-0 mb-1">Tư vấn học nghề và việc làm</h4>
              <span class="text-[0.7rem] opacity-80 uppercase font-[750] tracking-[0.5px]">Sàn GDVL Vân Đồn, Quảng Ninh</span>
            </div>
          </div>
          <div class="relative rounded-lg overflow-hidden h-[200px] shadow-sm group">
            <img src="/assets/news_lamdong.jpg" alt="Động viên đặc xá Lâm Đồng" class="w-full h-full object-cover transition-transform duration-[0.4s] group-hover:scale-[1.05]" />
            <div class="absolute inset-0 z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.9) 0%, rgba(16,28,16,0) 100%);"></div>
            <div class="absolute bottom-0 left-0 right-0 p-4 text-white z-[2]">
              <h4 class="text-[0.88rem] font-extrabold m-0 mb-1">Tặng quà động viên người hoàn lương</h4>
              <span class="text-[0.7rem] opacity-80 uppercase font-[750] tracking-[0.5px]">Ban chỉ đạo đặc xá Lâm Đồng</span>
            </div>
          </div>
          <div class="relative rounded-lg overflow-hidden h-[200px] shadow-sm group">
            <img src="/assets/hero_banner.jpg" alt="Nẻo về hướng thiện" class="w-full h-full object-cover transition-transform duration-[0.4s] group-hover:scale-[1.05]" />
            <div class="absolute inset-0 z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.9) 0%, rgba(16,28,16,0) 100%);"></div>
            <div class="absolute bottom-0 left-0 right-0 p-4 text-white z-[2]">
              <h4 class="text-[0.88rem] font-extrabold m-0 mb-1">Không gian sinh hoạt cộng đồng</h4>
              <span class="text-[0.7rem] opacity-80 uppercase font-[750] tracking-[0.5px]">CLB Hòa Nhập Xanh, Bắc Ninh</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Legal FAQ Section -->
    <section class="section bg-white">
      <div class="container max-w-[800px] mx-auto">
        <div class="text-center max-w-[600px] mx-auto mb-[50px]">
          <span class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">Giải đáp nhanh</span>
          <h2 class="text-[2.2rem] md:text-[1.6rem] sm:text-[1.3rem] font-extrabold text-[#1E251C] mb-3">Hỏi Đáp Pháp Luật Thường Gặp</h2>
          <p class="text-[0.95rem] text-[#4A5545] leading-[1.5]">Các câu hỏi pháp lý cốt lõi về thủ tục xóa án tích, điều kiện hỗ trợ vay vốn đã được C11 kiểm duyệt</p>
        </div>

        <div class="flex flex-col gap-4">
          <div
            v-for="(faq, index) in localFaqList"
            :key="index"
            class="bg-white border border-[#E2E8DF] rounded-lg overflow-hidden transition"
            :class="activeFaqIndex === index ? 'border-[#4A6741] shadow-[0_4px_16px_rgba(74,103,65,0.06)]' : ''"
          >
            <button
              class="w-full bg-transparent border-none px-6 sm:px-[18px] py-[18px] sm:py-[14px] flex justify-between items-center text-left text-[0.95rem] sm:text-[0.85rem] font-bold text-[#1E251C] cursor-pointer font-[inherit] transition hover:text-[#4A6741] hover:bg-[#fcfdfe]"
              :class="activeFaqIndex === index ? 'text-[#4A6741] border-b border-[#E2E8DF]' : ''"
              @click="toggleFaqIndex(index)"
            >
              <span>{{ faq.question }}</span>
              <span class="text-[0.72rem] text-[#7A8675] ml-4 flex-shrink-0 transition" :class="activeFaqIndex === index ? 'text-[#4A6741]' : ''">{{ activeFaqIndex === index ? '▲' : '▼' }}</span>
            </button>
            <div v-if="activeFaqIndex === index" class="px-6 sm:px-[18px] py-[18px] sm:py-[14px] bg-[#fcfdfe]">
              <p class="text-[0.88rem] text-[#4A5545] leading-[1.6] m-0">{{ faq.answer }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Support Form Section -->
    <section class="section bg-[#F8FAF7]" id="tro-giup">
      <div class="container">
        <div class="grid grid-cols-1 items-center gap-[50px] md:grid-cols-2">
          <div>
            <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-4">{{ t('support_form_title') }}</h2>
            <p class="text-[#4A5545] leading-[1.6] mb-[30px]">{{ t('support_form_sub') }}</p>
            <div class="flex flex-col gap-3">
              <div class="text-[0.95rem] text-[#4A5545]">📞 <span>Hotline hỗ trợ: <strong>0903.480.985</strong></span></div>
              <div class="text-[0.95rem] text-[#4A5545]">✉ <span>Email: <strong>contact@conduonghuongthien.com.vn</strong></span></div>
            </div>
          </div>
          <div>
            <form @submit.prevent="submitForm" class="bg-white p-10 sm:p-6 rounded-lg shadow-md border border-[#E2E8DF]">
              <div class="mb-5">
                <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">{{ t('form_name') }}</label>
                <input type="text" v-model="form.name" required :placeholder="t('form_name_ph')" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
              </div>
              <div class="grid grid-cols-1 gap-5 mb-5 sm:grid-cols-2">
                <div>
                  <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">{{ t('form_phone') }}</label>
                  <input type="tel" v-model="form.phone" required :placeholder="t('form_phone_ph')" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
                </div>
                <div>
                  <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">{{ t('form_city') }}</label>
                  <input type="text" v-model="form.city" required :placeholder="t('form_city_ph')" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
                </div>
              </div>
              <div class="mb-5">
                <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">{{ t('form_msg') }}</label>
                <textarea rows="4" v-model="form.message" required :placeholder="t('form_msg_ph')" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]"></textarea>
              </div>
              <button type="submit" class="btn btn-primary w-full text-lg" :disabled="submitStatus === 'loading'">
                {{ submitStatus === 'loading' ? t('form_submitting') : t('form_submit') }}
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

    <!-- Useful Links Section -->
    <section class="section bg-[#f7f9f6] border-t border-[#E2E8DF] py-[50px]">
      <div class="container">
        <div class="text-center max-w-[600px] mx-auto mb-[50px]">
          <span class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ t('useful_links_sub') }}</span>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ t('useful_links_title') }}</h2>
        </div>

        <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          <a href="https://bocongan.gov.vn" target="_blank" class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group">
            <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">🏛</div>
            <span class="text-[0.82rem] font-bold leading-[1.3]">{{ t('gov_bca') }}</span>
          </a>
          <a href="https://dichvucong.gov.vn" target="_blank" class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group">
            <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">💻</div>
            <span class="text-[0.82rem] font-bold leading-[1.3]">{{ t('gov_dvc') }}</span>
          </a>
          <a href="https://vbsp.org.vn" target="_blank" class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group">
            <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">🏦</div>
            <span class="text-[0.82rem] font-bold leading-[1.3]">{{ t('gov_vbsp') }}</span>
          </a>
          <a href="https://molisa.gov.vn" target="_blank" class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group">
            <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">⚖</div>
            <span class="text-[0.82rem] font-bold leading-[1.3]">{{ t('gov_molisa') }}</span>
          </a>
          <a href="https://cand.com.vn" target="_blank" class="flex flex-col items-center justify-center bg-white border border-[#E2E8DF] rounded-lg p-5 text-center no-underline text-[#1E251C] shadow-sm transition hover:-translate-y-1 hover:border-[#4A6741] hover:shadow-md group">
            <div class="w-[46px] h-[46px] rounded-full bg-[rgba(74,103,65,0.05)] flex items-center justify-center text-[1.45rem] mb-3 transition group-hover:bg-[#4A6741] group-hover:text-white">📰</div>
            <span class="text-[0.82rem] font-bold leading-[1.3]">{{ t('gov_cand') }}</span>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'

const { t } = useI18n()

useSeoMeta({
  title: 'Con Đường Hướng Thiện - Hỗ trợ tái hòa nhập cộng đồng',
  description: 'Cổng thông tin điện tử C11 Bộ Công an hỗ trợ người hoàn lương tái hòa nhập cộng đồng: vay vốn QĐ 22/2023, đào tạo nghề, xóa án tích, tư vấn tâm lý, kết nối doanh nghiệp.',
  ogTitle: 'Con Đường Hướng Thiện - Hỗ trợ tái hòa nhập cộng đồng',
  ogDescription: 'Hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tái hòa nhập cộng đồng.',
  ogType: 'website'
})

// Helper to format a date string for display
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('vi-VN')
}

// ====== DYNAMIC DATA FROM APIs ======

const { data: trendingNewsData } = await useAsyncData(
  'trending-news',
  () => $fetch('/api/public/articles', { params: { type: 'news', limit: 4 } }),
  { default: () => ({ articles: [] }) }
)
const trendingNews = computed(() =>
  (trendingNewsData.value?.articles || []).map(a => ({
    id: a.id,
    category: 'Tin nổi bật',
    title: a.title,
    link: `/news/${a.slug}`,
    date: formatDate(a.publishedAt || a.createdAt),
  }))
)

const { data: localPoliceNewsData } = await useAsyncData(
  'local-police-news',
  () => $fetch('/api/public/articles', { params: { type: 'local_news', limit: 5 } }),
  { default: () => ({ articles: [] }) }
)
const localPoliceNews = computed(() =>
  (localPoliceNewsData.value?.articles || []).map(a => ({
    id: a.id,
    date: formatDate(a.publishedAt || a.createdAt),
    title: a.title,
    link: `/news/${a.slug}`,
  }))
)

const { data: legalWarningNewsData } = await useAsyncData(
  'legal-warning-news',
  () => $fetch('/api/public/articles', { params: { type: 'featured_news', limit: 3 } }),
  { default: () => ({ articles: [] }) }
)
const legalWarningNews = computed(() =>
  (legalWarningNewsData.value?.articles || []).map(a => ({
    id: a.id,
    date: formatDate(a.publishedAt || a.createdAt),
    title: a.title,
    link: `/news/${a.slug}`,
    excerpt: a.excerpt || '',
  }))
)

const { data: latestDocsData } = await useAsyncData(
  'latest-docs',
  () => $fetch('/api/public/articles', { params: { type: 'document', limit: 3 } }),
  { default: () => ({ articles: [] }) }
)
const latestDocs = computed(() =>
  (latestDocsData.value?.articles || []).map(a => ({
    id: a.id,
    number: a.title,
    date: formatDate(a.publishedAt || a.createdAt),
    title: a.excerpt || a.title,
  }))
)

const { data: roleModelsData } = await useAsyncData(
  'role-models',
  () => $fetch('/api/public/articles', { params: { type: 'role_model', limit: 4 } }),
  { default: () => ({ articles: [] }) }
)
const roleModelsList = computed(() =>
  (roleModelsData.value?.articles || []).map(a => ({
    id: a.slug,
    name: a.title,
    location: '',
    image: a.thumbnailUrl || '/assets/guong_sang_1.jpg',
    desc: a.excerpt || '',
  }))
)

const { data: reintegrationModelsData } = await useAsyncData(
  'reintegration-models',
  () => $fetch('/api/public/articles', { params: { type: 'reintegration_model', limit: 4 } }),
  { default: () => ({ articles: [] }) }
)
const reintegrationModelsList = computed(() =>
  (reintegrationModelsData.value?.articles || []).map(a => ({
    id: a.slug,
    icon: '🌱',
    title: a.title,
    desc: a.excerpt || '',
  }))
)

// ====== ROLE MODELS SWIPER SLIDER ======
const roleModelsSliderTrack = ref(null)
const activeRoleIndex = ref(0)
let roleAutoplayTimer = null

const scrollRoleToSlide = (idx) => {
  activeRoleIndex.value = idx
  if (roleModelsSliderTrack.value) {
    const card = roleModelsSliderTrack.value.children[idx]
    if (card) {
      const scrollPos = card.offsetLeft - roleModelsSliderTrack.value.offsetLeft
      roleModelsSliderTrack.value.scrollTo({ left: scrollPos, behavior: 'smooth' })
    }
  }
}

const goToRoleSlide = (idx) => {
  scrollRoleToSlide(idx)
}

const nextRoleSlide = () => {
  const nextIdx = (activeRoleIndex.value + 1) % roleModelsList.value.length
  scrollRoleToSlide(nextIdx)
}

const prevRoleSlide = () => {
  const prevIdx = (activeRoleIndex.value - 1 + roleModelsList.value.length) % roleModelsList.value.length
  scrollRoleToSlide(prevIdx)
}

const startRoleAutoplay = () => {
  stopRoleAutoplay()
  roleAutoplayTimer = setInterval(() => {
    nextRoleSlide()
  }, 3500)
}

const stopRoleAutoplay = () => {
  if (roleAutoplayTimer) {
    clearInterval(roleAutoplayTimer)
    roleAutoplayTimer = null
  }
}

// ====== REINTEGRATION MODELS SWIPER SLIDER ======
const reintegrationModelsSliderTrack = ref(null)
const activeModelIndex = ref(0)
let modelAutoplayTimer = null

const scrollModelToSlide = (idx) => {
  activeModelIndex.value = idx
  if (reintegrationModelsSliderTrack.value) {
    const card = reintegrationModelsSliderTrack.value.children[idx]
    if (card) {
      const scrollPos = card.offsetLeft - reintegrationModelsSliderTrack.value.offsetLeft
      reintegrationModelsSliderTrack.value.scrollTo({ left: scrollPos, behavior: 'smooth' })
    }
  }
}

const goToModelSlide = (idx) => {
  scrollModelToSlide(idx)
}

const nextModelSlide = () => {
  const nextIdx = (activeModelIndex.value + 1) % reintegrationModelsList.value.length
  scrollModelToSlide(nextIdx)
}

const prevModelSlide = () => {
  const prevIdx = (activeModelIndex.value - 1 + reintegrationModelsList.value.length) % reintegrationModelsList.value.length
  scrollModelToSlide(prevIdx)
}

const startModelAutoplay = () => {
  stopModelAutoplay()
  modelAutoplayTimer = setInterval(() => {
    nextModelSlide()
  }, 4000)
}

const stopModelAutoplay = () => {
  if (modelAutoplayTimer) {
    clearInterval(modelAutoplayTimer)
    modelAutoplayTimer = null
  }
}

onMounted(() => {
  startRoleAutoplay()
  startModelAutoplay()
})

onUnmounted(() => {
  stopRoleAutoplay()
  stopModelAutoplay()
})

const videos = [
  { id: 1, title: 'Hành trình hoàn lương - Kết nối yêu thương tại Đà Nẵng', duration: '08:24', url: 'https://www.youtube.com/results?search_query=hoàn+lương+tái+hòa+nhập+cộng+đồng+đà+nẵng' },
  { id: 2, title: 'Ngày hội việc làm nhân đạo kết nối doanh nghiệp', duration: '12:45', url: 'https://www.youtube.com/results?search_query=ngày+hội+việc+làm+người+hoàn+lương' },
  { id: 3, title: 'Phóng sự: Nguồn lực vay vốn thắp sáng nẻo thiện', duration: '06:18', url: 'https://www.youtube.com/results?search_query=quyết+định+22+2023+vay+vốn+hoàn+lương' }
]

const mainVideoUrl = 'https://www.youtube.com/results?search_query=tái+hòa+nhập+cộng+đồng+người+chấp+hành+xong+án'

const form = reactive({
  name: '',
  phone: '',
  city: '',
  message: ''
})

const submitStatus = ref(null) // null | 'loading' | 'success' | 'error'
const submitMessage = ref('')

const submitForm = async () => {
  submitStatus.value = 'loading'
  submitMessage.value = ''
  try {
    await $fetch('/api/submissions', {
      method: 'POST',
      body: {
        type: 'support',
        name: form.name,
        phone: form.phone,
        city: form.city,
        message: form.message
      }
    })
    submitStatus.value = 'success'
    submitMessage.value = `Cám ơn ${form.name}. Thông tin đăng ký của bạn đã được ghi nhận. Cán bộ chuyên môn sẽ liên hệ tư vấn trong vòng 24 giờ qua số ${form.phone}.`
    form.name = ''
    form.phone = ''
    form.city = ''
    form.message = ''
  } catch (err) {
    submitStatus.value = 'error'
    submitMessage.value = err?.data?.statusMessage || 'Có lỗi xảy ra, vui lòng thử lại hoặc gọi hotline 0903.480.985.'
  }
}

const localFaqList = [
  {
    question: "Điều kiện và thủ tục để người hoàn lương được xóa án tích đương nhiên?",
    answer: "Người chấp hành xong hình phạt chính (án tù) hoặc thời gian thử thách án treo, đã chấp hành xong các quyết định hình phạt bổ sung (án phí, bồi thường dân sự) và không thực hiện hành vi phạm tội mới trong thời hạn quy định của Bộ luật Hình sự (thông thường từ 1 đến 5 năm tùy mức độ tội danh). Khi đủ thời gian, đương sự làm hồ sơ xin cấp Phiếu lý lịch tư pháp số 2 tại Sở Tư pháp tỉnh/thành phố để xác nhận trạng thái xóa án tích."
  },
  {
    question: "Làm thế nào để tiếp cận nguồn vốn vay ưu đãi 100 triệu theo Quyết định 22/2023/QĐ-TTg?",
    answer: "Người chấp hành xong án phạt tù (trở về cư trú hợp pháp tại địa phương trong vòng 5 năm) cần làm đơn đề nghị có xác nhận của UBND cấp xã về việc chấp hành tốt pháp luật. Sau đó, hồ sơ được gửi qua tổ tiết kiệm và vay vốn (Hội Phụ nữ, Hội Nông dân, Đoàn Thanh niên...) để chuyển đến Ngân hàng Chính sách Xã hội quận/huyện thẩm định giải ngân tối đa 100 triệu đồng."
  },
  {
    question: "Các trường hợp người hoàn lương được miễn phí đào tạo nghề?",
    answer: "Theo Nghị định 49/2020/NĐ-CP, người chấp hành xong án phạt tù khi tham gia các lớp đào tạo nghề ngắn hạn (dưới 3 tháng) tại địa phương sẽ được hỗ trợ 100% chi phí học nghề và hỗ trợ tiền ăn, tiền đi lại theo chính sách hiện hành của từng địa phương."
  },
  {
    question: "Ai có trách nhiệm trực tiếp giúp đỡ người hoàn lương tại cơ sở?",
    answer: "Lực lượng Công an cấp xã/phường có trách nhiệm trực tiếp tham mưu cho UBND cấp xã lập hồ sơ quản lý, phối hợp cùng các tổ chức đoàn thể (Hội Cựu chiến binh, Hội phụ nữ, Đoàn thanh niên) phân công người trực tiếp cảm hóa, giáo dục và hướng dẫn làm các thủ tục giấy tờ công dân."
  }
]

const activeFaqIndex = ref(null)
const toggleFaqIndex = (index) => {
  activeFaqIndex.value = activeFaqIndex.value === index ? null : index
}
</script>

<style scoped>
/* Retained for pseudo-element (::before) and custom keyframe animation — not expressible with Tailwind utility classes */
.pulse-effect {
  animation: buttonPulse 2s infinite;
}

@keyframes buttonPulse {
  0% { box-shadow: 0 0 0 0 rgba(124, 179, 66, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(124, 179, 66, 0); }
  100% { box-shadow: 0 0 0 0 rgba(124, 179, 66, 0); }
}

/* Role card top accent ::before pseudo-element */
.role-card-before {
  position: relative;
  overflow: hidden;
}
.role-card-before::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #4A6741 0%, #7CB342 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.role-card-before:hover::before {
  opacity: 1;
}

/* Parallax fixed bg fallback on mobile */
@media (max-width: 480px) {
  .parallax-fixed {
    background-attachment: scroll;
  }
}
</style>
