<!--
  Hero mặc định của Thư viện Video: hiện khi **không** có buổi phát trực tiếp nào.

  Thuần trình bày — không fetch, không state. Việc hỏi trạng thái buổi phát thuộc
  về `LiveHero.vue`, và nó quyết định component nào được dựng. Tách đôi như vậy để
  mỗi bên kiểm được một mình: khối này là hình dạng của một tiêu đề trang, còn
  bên kia là một lượt gọi mạng có ba nhánh.

  Không có `animate-pulse` nào ở đây: đây là nội dung thật, không phải khung chờ.
  Một khối trang trí nhấp nháy trong khi không tải gì là dạy người đọc rằng chuyển
  động trên trang này không mang thông tin gì.
-->
<template>
  <PageHero>
    <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#6B7967] mb-4">
      <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
        <i class="fa-solid fa-house text-[0.7rem] text-[#4A6741]" aria-hidden="true"></i>
        <span>Trang chủ</span>
      </nuxt-link>
      <span class="text-[#A2B09F]" aria-hidden="true">&rsaquo;</span>
      <span class="text-[#2A3B27] font-bold">Thư viện Video</span>
    </nav>

    <div class="max-w-2xl">
      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
        <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        <span>Cổng Thông Tin Điện Tử C11 &bull; Bộ Công An</span>
      </div>
      <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">
        Thư Viện Video
      </h1>
      <p class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed">
        {{ description }}
      </p>
    </div>
  </PageHero>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  /**
   * Câu mô tả dưới tiêu đề.
   *
   * Có mặc định nhưng vẫn là một prop: trang gọi nó có thể nói điều gì đó cụ thể
   * hơn khi đang lọc theo chuyên mục, và một chuỗi viết cứng trong tệp này sẽ
   * buộc nơi gọi phải sao chép cả khối để đổi một câu.
   */
  description?: string
}>(), {
  description: 'Xem các phóng sự, phim tài liệu ngắn và buổi phát trực tiếp về công tác hỗ trợ tái hòa nhập cộng đồng.',
})
</script>
