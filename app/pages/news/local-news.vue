<template>
  <div class="bg-[#F8FAF7]">
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover py-20 text-center text-white">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[2.2rem] font-extrabold mb-2">Tin Địa Phương</h2>
        <p class="text-base opacity-90">Hoạt động thi hành án hình sự và công tác cộng đồng tại địa bàn xã, phường</p>
      </div>
    </section>

    <section class="section">
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
              <span class="block text-[0.8rem] text-[#7A8675] font-semibold mb-2">{{ item.date }} • Tin địa phương</span>
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
    slug: 'mong-cai-tang-cuong-cam-hoa-giao-duc',
    title: 'QUẢNG NINH: Công an phường Móng Cái 3 tăng cường công tác cảm hóa, giáo dục thi hành án hình sự tại cộng đồng',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Tăng cường điểm danh, kiểm diện và lập hồ sơ theo dõi sát sao, kết hợp rà soát hoàn cảnh gia đình để có phương hướng cảm hóa giáo dục phù hợp, phòng ngừa tái phạm tội trên địa bàn phường Móng Cái 3.'
  }
]
</script>
