<!--
  Hero text đơn giản dùng chung cho các trang công khai (news, role-models,
  reintegration-models, documents, legal-qa, media, about, contact).

  Chỉ là breadcrumb + badge + tiêu đề + mô tả trên **nền gradient xanh nhạt** —
  không ảnh nền, không overlay, không wave. Các ô tìm kiếm / bộ lọc **không thuộc
  hero**; trang gọi đặt chúng trong section nội dung bên dưới.

  Thuần trình bày — không fetch, không state. Nội dung qua `<slot />`, mỗi trang
  tự đặt breadcrumb, badge, tiêu đề, mô tả theo cấu trúc riêng nhưng cùng style.
-->
<template>
  <section class="border-b border-[#DDE6DC] bg-gradient-to-b from-[#EEF5EB] via-[#F5FAF3] to-[#F7FAF6]">
    <div class="container pt-6 sm:pt-8 pb-6 sm:pb-7">
      <slot />
    </div>
  </section>
</template>
