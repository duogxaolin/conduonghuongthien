<template>
  <section class="section bg-white">
    <div class="container">
      <div class="text-center max-w-[600px] mx-auto mb-[40px]">
        <span v-if="d.subtitle" class="block text-[0.8rem] font-extrabold text-[#7CB342] uppercase tracking-[1.5px] mb-2">{{ d.subtitle }}</span>
        <h2 class="text-[2.2rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] mb-3">{{ d.title || 'Mô Hình Tái Hòa Nhập Cộng Đồng' }}</h2>
        <p v-if="d.description" class="text-[0.95rem] text-[#4A5545] leading-[1.5]">{{ d.description }}</p>
      </div>

      <!-- Lưới 3 cột thẻ ảnh — khác biệt trực quan với carousel "Tấm Gương":
           ảnh tỉ lệ 16:9 phía trên, sau đó tên địa phương (category) xanh, tiêu
           đề, excerpt. Dùng cùng hình dạng thẻ của `NewsBlock.vue` để cổng nói
           cùng một ngôn ngữ hình ảnh, nhưng KHÔNG phải carousel ngang — giúp khách
           đọc lướt nhanh tất cả mô hình cùng lúc thay vì chờ autoplay. -->
      <div v-if="list.length" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in list"
          :key="item.id"
          class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
        >
          <nuxt-link :to="`/reintegration-models/${item.id}`" class="block overflow-hidden no-underline">
            <img
              :src="item.image"
              :alt="item.name"
              class="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              loading="lazy"
              decoding="async"
            />
          </nuxt-link>
          <div class="p-4 flex flex-col gap-2 flex-1">
            <span v-if="item.location" class="inline-block self-start bg-[#EDF3EA] text-[#4A6741] text-[0.68rem] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-sm">{{ item.location }}</span>
            <h3 class="text-[0.95rem] font-extrabold leading-[1.4] m-0">
              <nuxt-link
                :to="`/reintegration-models/${item.id}`"
                class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
              >{{ item.name }}</nuxt-link>
            </h3>
            <p v-if="item.desc" class="text-[0.85rem] text-[#4A5545] leading-[1.55] m-0 line-clamp-2">{{ item.desc }}</p>
          </div>
        </article>
      </div>

      <p v-else class="text-center text-[0.9rem] text-[#7A8675] italic">Chưa có mô hình nào được đăng.</p>

      <!-- Nút xem tất cả — chỉ hiện khi có dữ liệu và trang danh mục tồn tại.
           Carousel "Tấm Gương" không có nút này, nên đây thêm một điểm khác biệt
           hữu ích: mô hình tái hòa nhập là một chủ đề khách có thể muốn xem hết. -->
      <div v-if="list.length" class="text-center mt-[36px]">
        <nuxt-link
          to="/reintegration-models"
          class="inline-flex items-center gap-2 bg-[#4A6741] text-white px-6 py-3 rounded-lg text-[0.9rem] font-bold no-underline transition-colors duration-300 hover:bg-[#385130]"
        >Xem tất cả mô hình <i class="fa-solid fa-arrow-right text-[0.78rem]" aria-hidden="true"></i></nuxt-link>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

// maxItems mặc định 6 (lưới 3 cột × 2 hàng) thay vì 4 như carousel cũ — lưới
// nhìn cân đối hơn với số chẵn. maxItems vẫn cấu hình được ở Page Builder.
const maxItems = computed(() => Number(d.value.maxItems) || 6)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data } = await useAsyncData(
  `block-reintegration-${props.block.id}-${categorySlug.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'reintegration',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  // `lazy: true`: server vẫn chờ dữ liệu cho HTML đầu + SEO, client không chặn
  // chuyển trang — khung xương (nhánh empty / default) vẽ ngay, dữ liệu về sau
  // thì tự cập nhật.
  { lazy: true, default: () => ({ articles: [] }) }
)

const list = computed(() =>
  (data.value?.articles || []).map(a => ({
    id: a.slug,
    name: a.title,
    location: a.categoryName || '',
    desc: a.excerpt || '',
    image: a.thumbnailUrl || '/assets/hero_banner.jpg',
  }))
)
</script>
