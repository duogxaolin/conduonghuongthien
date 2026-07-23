<template>
  <div class="bg-[#F8FAF7]">
    <!-- Banner Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">{{ t('about_hero_title') }}</h2>
        <p class="text-[1.1rem] opacity-90">{{ t('about_hero_sub') }}</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <div class="container">
        <SectionBar icon="fa-solid fa-building-columns" :title="t('about_editorial')" />
        <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-10 mt-6">
          <!-- Main Content -->
          <div class="bg-white p-10 rounded-lg shadow-sm border border-[#E2E8DF] max-md:p-6">
            <div class="mb-9">
              <h3 class="text-[1.5rem] font-bold text-[#4A6741] mb-[18px] border-l-4 border-[#7CB342] pl-3">{{ t('about_purpose_title') }}</h3>
              <p class="text-base text-[#4A5545] mb-4 text-justify">
                Trang thông tin điện tử <strong>Con Đường Hướng Thiện</strong> hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.
              </p>
              <p class="text-base text-[#4A5545] mb-4 text-justify">
                Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công; định hướng tư tưởng, pháp lý và kết nối hỗ trợ trực tuyến 24/7 giúp người lầm lỡ xóa bỏ tự ti, sớm ổn định cuộc sống.
              </p>
            </div>

            <div class="mb-9">
              <h3 class="text-[1.5rem] font-bold text-[#4A6741] mb-[18px] border-l-4 border-[#7CB342] pl-3">Nhiệm vụ trọng tâm</h3>
              <ul class="list-none flex flex-col gap-4">
                <li class="bg-[#F8FAF7] p-4 rounded border border-[#E2E8DF]">
                  <strong class="text-[#4A6741] block mb-1.5">Tuyên truyền & Giáo dục pháp luật:</strong> Phổ biến các quy định về xóa án tích, chính sách vay vốn ưu đãi, quyền và nghĩa vụ công dân giúp người hoàn lương nâng cao hiểu biết pháp lý.
                </li>
                <li class="bg-[#F8FAF7] p-4 rounded border border-[#E2E8DF]">
                  <strong class="text-[#4A6741] block mb-1.5">Đào tạo & Hướng nghiệp:</strong> Kết nối các cơ sở đào tạo nghề và các doanh nghiệp nhân văn nhằm tổ chức các lớp học nghề, tạo cơ hội việc làm công bằng cho người lầm lỡ.
                </li>
                <li class="bg-[#F8FAF7] p-4 rounded border border-[#E2E8DF]">
                  <strong class="text-[#4A6741] block mb-1.5">Tư vấn & Trợ giúp trực tuyến:</strong> Xây dựng hệ thống giải đáp tự động và đường dây nóng tiếp nhận thông tin đăng ký hỗ trợ trực tiếp 24/7 trên phạm vi cả nước.
                </li>
              </ul>
            </div>
          </div>

          <!-- Sidebar thông tin tổ chức -->
          <div class="flex flex-col">
            <div class="bg-[#4A6741] text-white p-[30px] rounded-lg shadow-md">
              <h4 class="text-[0.85rem] font-bold tracking-[1px] opacity-80 mb-2">ĐƠN VỊ CHỦ QUẢN</h4>
              <p class="text-[1.2rem] font-extrabold leading-snug mb-1">Cục Cảnh sát QLTHG, TG và THAHS tại cộng đồng (C11)</p>
              <p><strong>Bộ Công an</strong></p>
              <div class="h-px bg-white/[0.15] my-5"></div>
              <p class="mb-3"><strong>Ban Biên Tập:</strong> Đại diện Cảnh sát Thi hành án hình sự & Hỗ trợ tư pháp công an các địa phương.</p>
              <p><strong>Hotline liên hệ trực tiếp:</strong></p>
              <p class="text-[1.8rem] font-extrabold text-[#A5D66A] mt-2">0903.480.985</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
const { t } = useI18n()

useSeoMeta({
  title: 'Giới thiệu | Con Đường Hướng Thiện',
  description: 'Giới thiệu Ban Biên tập Cổng thông tin Con Đường Hướng Thiện - Cục C11 Bộ Công an.'
})
</script>
