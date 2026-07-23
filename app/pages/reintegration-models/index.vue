<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <p class="text-[1.1rem] opacity-90">Các mô hình kinh tế tập thể, quỹ hỗ trợ nhân văn giúp người hoàn lương ổn định cuộc sống</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="py-12">
      <div class="container">
        <SectionBar icon="fa-solid fa-trophy" title="Các mô hình tiêu biểu" />
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[30px]">
          <div
            v-for="item in models"
            :key="item.id"
            class="bg-white rounded-lg px-[30px] py-[40px] shadow-sm border border-[#E2E8DF] flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="flex flex-col flex-grow">
              <span class="text-[0.75rem] font-bold text-[#4A6741] uppercase tracking-wide mb-[10px] block">💡 Mô hình tiêu biểu</span>
              <h3 class="text-[1.25rem] font-bold text-[#1E251C] mb-4 leading-[1.4]">{{ item.title }}</h3>
              <p class="text-[0.92rem] text-[#4A5545] leading-[1.6] mb-6 flex-grow">{{ item.excerpt }}</p>
            </div>
            <nuxt-link
              :to="`/reintegration-models/${item.slug}`"
              class="text-[#7CB342] font-bold no-underline text-[0.9rem] transition-all duration-300 hover:text-[#4A6741]"
            >Xem chi tiết mô hình &rarr;</nuxt-link>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
useSeoMeta({
  title: 'Mô hình tái hòa nhập | Con Đường Hướng Thiện',
  description: 'Các mô hình tiêu biểu hỗ trợ người hoàn lương tái hòa nhập cộng đồng: quỹ tín dụng, câu lạc bộ, liên kết đào tạo nghề.'
})

const models = [
  {
    id: 1,
    slug: 'quy-tin-dung-hoan-luong',
    title: 'Quỹ Tín dụng hỗ trợ hoàn lương theo Quyết định 22/2023/QĐ-TTg',
    excerpt: 'Triển khai chính sách tín dụng ưu đãi đột phá từ Chính phủ, hỗ trợ người chấp hành xong án phạt tù tiếp cận nguồn vốn vay 100 triệu đồng giải quyết việc làm, mua sắm công cụ sản xuất.'
  },
  {
    id: 2,
    slug: 'cau-lac-bo-hoa-nhap-xanh',
    title: 'Mô hình Câu lạc bộ "Hòa nhập xanh" nâng bước hoàn lương',
    excerpt: 'Nơi sinh hoạt cộng đồng gắn kết tình cảm, chia sẻ kinh nghiệm phát triển kinh tế gia đình và phổ biến kiến thức pháp luật bổ ích dưới sự hỗ trợ điều hành của lực lượng Công an cơ sở.'
  },
  {
    id: 3,
    slug: 'lien-ket-dao-tao-nghe-nhan-van',
    title: 'Mô hình liên kết Đào tạo nghề và giới thiệu việc làm nhân văn',
    excerpt: 'Chương trình liên kết chặt chẽ giữa các doanh nghiệp địa phương và trung tâm giáo dục nghề nghiệp nhằm tổ chức đào tạo các lớp nghề mộc, may mặc, cơ khí và bao tiêu đầu ra việc làm ngay sau khi tốt nghiệp.'
  }
]
</script>
