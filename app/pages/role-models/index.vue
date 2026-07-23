<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Tấm Gương Tiêu Biểu</h2>
        <p class="text-[1.1rem] opacity-90">Hành trình vươn lên từ lầm lỡ, khẳng định giá trị bản thân và đóng góp tích cực cho cộng đồng</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="py-12">
      <div class="container">
        <SectionBar icon="fa-solid fa-star" title="Những tấm gương hoàn lương" />
        <div class="flex flex-col gap-[30px] max-w-[900px] mx-auto">
          <div
            v-for="item in roleModels"
            :key="item.id"
            class="bg-white rounded-lg p-5 sm:p-[30px] flex flex-col items-center text-center gap-5 sm:gap-[30px] shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:shadow-md hover:border-[#7CB342] md:flex-row md:items-start md:text-left"
          >
            <div class="w-24 h-24 sm:w-[140px] sm:h-[140px] rounded-full overflow-hidden border-4 border-[#F8FAF7] shrink-0">
              <img :src="item.image" :alt="item.name" class="w-full h-full object-cover" />
            </div>
            <div>
              <span class="text-[0.8rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-[10px] py-[4px] rounded inline-block mb-[10px]">📍 {{ item.location }}</span>
              <h3 class="text-[1.3rem] font-bold mb-3 text-[#1E251C]">{{ item.title }}</h3>
              <p class="text-[0.95rem] text-[#4A5545] leading-[1.6] mb-5">{{ item.excerpt }}</p>
              <nuxt-link :to="`/role-models/${item.slug}`" class="btn btn-outline">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
useSeoMeta({
  title: 'Tấm gương tiêu biểu | Con Đường Hướng Thiện',
  description: 'Những tấm gương hoàn lương lập nghiệp thành công sau khi chấp hành xong án phạt tù.'
})

const roleModels = [
  {
    id: 1,
    name: 'Nguyễn Văn A',
    slug: 'nguyen-van-a',
    location: 'TP. Đà Nẵng',
    title: 'Anh Nguyễn Văn A — Nghị lực làm giàu và gieo mầm hy vọng từ xưởng mộc',
    image: '/assets/guong_sang_1.jpg',
    excerpt: 'Trở về sau án phạt tù 5 năm, anh Nguyễn Văn A vượt qua mặc cảm tự ti ban đầu để lập nghiệp. Nhờ sự hỗ trợ vay vốn của Công an địa phương và Ngân hàng CSXH, anh đã xây dựng thành công xưởng sản xuất đồ gỗ mỹ nghệ lớn...'
  },
  {
    id: 2,
    name: 'Trần Thị B',
    slug: 'tran-thi-b',
    location: 'Tỉnh Quảng Ninh',
    title: 'Chị Trần Thị B — Tự tin vươn lên làm chủ cơ sở may gia công xuất khẩu',
    image: '/assets/guong_sang_2.jpg',
    excerpt: 'Từng lầm lỡ sa ngã, chị B trở về địa phương được sự động viên sát sao của Hội Phụ nữ và Công an phường. Chị kiên trì học nghề may và hiện nay sở hữu cơ sở may mặc uy tín tạo sinh kế cho nhiều phụ nữ hoàn cảnh khó khăn...'
  }
]
</script>
