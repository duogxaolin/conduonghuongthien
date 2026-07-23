<template>
  <div class="bg-[#F8FAF7]">
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover py-20 text-center text-white">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[2.2rem] font-extrabold mb-2">Tin Nổi Bật</h2>
        <p class="text-base opacity-90">Các sự kiện và tin tức nổi bật về công tác tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <section class="py-12">
      <div class="container">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-[30px] max-w-[1000px] mx-auto">
          <div
            v-for="item in newsItems"
            :key="item.id"
            class="bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="h-[220px] overflow-hidden">
              <img :src="item.image" :alt="item.title" class="w-full h-full object-cover" />
            </div>
            <div class="p-6">
              <span class="text-[0.8rem] text-[#7A8675] font-semibold block mb-2">{{ item.date }} • Tin nổi bật</span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-[10px]">
                <nuxt-link
                  :to="'/news/' + item.slug"
                  class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                >{{ item.title }}</nuxt-link>
              </h3>
              <p class="text-[0.9rem] text-[#4A5545] leading-[1.5] mb-4">{{ item.excerpt }}</p>
              <nuxt-link :to="'/news/' + item.slug" class="text-[#7CB342] font-bold no-underline text-[0.88rem]">Chi tiết &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
const newsItems = [
  {
    id: 1,
    slug: 'da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan',
    title: 'ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN',
    date: '17/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 để kịp thời tháo gỡ vướng mắc, động viên cải tạo.'
  },
  {
    id: 2,
    slug: 'can-tho-diem-tua-tin-dung-cho-nguoi-hoan-luong-tai-hoa-nhap',
    title: 'CẦN THƠ: Điểm tựa tín dụng cho người hoàn lương tái hòa nhập',
    date: '16/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Triển khai chính sách tín dụng ưu đãi từ Ngân hàng Chính sách Xã hội theo Quyết định 22/2023/QĐ-TTg, giúp hàng chục hộ gia đình người hoàn lương tại Cần Thơ tiếp cận nguồn vốn ưu đãi 100 triệu đồng để mở rộng làm ăn.'
  }
]
</script>
