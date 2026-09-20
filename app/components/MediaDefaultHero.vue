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
  <section class="relative overflow-hidden border-b border-[#E2E8DF] bg-gradient-to-br from-[#F2F7F0] via-white to-[#EEF4EC]">
    <!-- Vòng trang trí. `aria-hidden` vì nó không mang thông tin nào — trình đọc
         màn hình không nên dừng ở một hình tròn. -->
    <div class="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-[#7CB342]/8" aria-hidden="true"></div>
    <div class="absolute -right-4 top-24 w-32 h-32 rounded-full bg-[#4A6741]/6" aria-hidden="true"></div>

    <div class="container relative pt-8 sm:pt-10 pb-8">
      <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-4">
        <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
          <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
          <span>Trang chủ</span>
        </nuxt-link>
        <span class="text-[#BAC8B6]">&rsaquo;</span>
        <span class="text-[#2D5A27] font-bold">Thư viện Video</span>
      </nav>

      <div class="flex items-start gap-4 sm:gap-5">
        <div class="hidden sm:flex w-14 h-14 rounded-2xl bg-[#4A6741] text-white items-center justify-center text-xl shrink-0 shadow-sm">
          <i class="fa-solid fa-clapperboard" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">
            Kênh truyền thông
          </p>
          <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">
            Thư Viện Video
          </h1>
          <p class="text-[0.95rem] text-[#5A6655] mt-2 mb-0 leading-relaxed max-w-3xl">
            {{ description }}
          </p>
        </div>
      </div>
    </div>
  </section>
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
