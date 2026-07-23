<template>
  <div class="bg-[#F8FAF7]">
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover py-20 text-center text-white">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[2.2rem] font-extrabold mb-2">Tin Hoạt Động</h2>
        <p class="text-base opacity-90">Các hoạt động, chỉ đạo nghiệp vụ thi hành án hình sự và tái hòa nhập</p>
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
              <span class="block text-[0.8rem] text-[#7A8675] font-semibold mb-2">{{ item.date }} • Tin hoạt động</span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-2.5">
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
    slug: 'quang-ninh-van-don-ho-tro-viec-lam',
    title: 'QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Nhằm tạo điều kiện tốt nhất cho người chấp hành xong án phạt tù xóa bỏ tự ti và có thu nhập ổn định, Công an đặc khu Vân Đồn phối hợp cơ quan chức năng tổ chức sàn giao dịch hướng nghiệp kết nối trực tiếp doanh nghiệp.'
  },
  {
    id: 2,
    slug: 'lam-dong-tham-hoi-tang-qua-dac-xa',
    title: 'CÔNG AN TỈNH LÂM ĐỒNG THĂM HỎI, TẶNG QUÀ, ĐỘNG VIÊN NGƯỜI ĐƯỢC ĐẶC XÁ CÓ HOÀN CẢNH KHÓ KHĂN',
    date: '17/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Phòng Cảnh sát thi hành án hình sự và hỗ trợ tư pháp Công an tỉnh Lâm Đồng phối hợp với Công an các địa bàn tổ chức thăm hỏi, trao tặng các phần quà hỗ trợ thiết thực động viên tinh thần người chấp hành đặc xá vươn lên.'
  },
  {
    id: 3,
    slug: 'lam-dong-so-ket-quan-ly-giam-giu',
    title: 'LÂM ĐỒNG: Sơ kết công tác quản lý giam giữ, thi hành án hình sự và hỗ trợ tư pháp 6 tháng đầu năm 2026',
    date: '16/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Công an tỉnh Lâm Đồng sơ kết đánh giá kết quả triển khai công tác quản lý giam giữ và hỗ trợ tái hòa nhập cộng đồng 6 tháng đầu năm, đề ra phương hướng chỉ đạo sát sao cho 6 tháng cuối năm.'
  }
]
</script>
