<template>
  <div class="py-10 bg-[#F8FAF7]">
    <div class="max-w-[800px] mx-auto px-4">
      <!-- Breadcrumb -->
      <div class="text-[0.85rem] text-[#7A8675] mb-6">
        <nuxt-link to="/" class="text-[#4A6741] no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
        <nuxt-link to="/role-models" class="text-[#4A6741] no-underline hover:underline">Tấm gương tiêu biểu</nuxt-link> &raquo;
        <span>Chi tiết câu chuyện</span>
      </div>

      <!-- Main Content -->
      <article v-if="article">
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-block mb-4">
          📍 {{ article.location }} • Ngày đăng: {{ article.date }}
        </span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div class="text-[1.15rem] font-semibold text-[#4A5545] leading-[1.6] border-l-4 border-[#7CB342] pl-5 mb-8">
          <p>{{ article.lead }}</p>
        </div>

        <div class="article-body">
          <div class="my-8 text-center">
            <img :src="article.image" :alt="article.name" class="w-full max-h-[450px] object-cover rounded-md shadow-sm" />
            <span class="text-[0.85rem] text-[#7A8675] italic mt-2 block">
              Hình ảnh anh/chị {{ article.name }} năng nổ, tích cực làm việc trong ngày hội sản xuất.
            </span>
          </div>

          <div v-html="article.content"></div>
        </div>

        <!-- Back Link -->
        <div class="mt-10 border-t border-[#E2E8DF] pt-8">
          <nuxt-link to="/role-models" class="btn btn-primary">&larr; Quay lại danh sách tấm gương</nuxt-link>
        </div>
      </article>

      <div v-else class="py-10 text-center">
        <p class="text-[#4A5545] mb-4">Không tìm thấy bài viết yêu cầu hoặc bài viết đang được cập nhật.</p>
        <nuxt-link to="/role-models" class="btn btn-primary">Quay lại danh sách</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const slug = route.params.id

const articlesData = {
  'nguyen-van-a': {
    name: 'Nguyễn Văn A',
    location: 'TP. Đà Nẵng',
    date: '17/07/2026',
    title: 'Anh Nguyễn Văn A — Nghị lực làm giàu và gieo mầm hy vọng từ xưởng mộc nhân văn',
    image: '/assets/guong_sang_1.jpg',
    lead: 'Trở về sau án phạt tù 5 năm, anh Nguyễn Văn A từng trải qua những chuỗi ngày dài mặc cảm và bế tắc. Tuy nhiên, bằng nghị lực phi thường cùng sự đồng hành, hỗ trợ kịp thời của chính quyền địa phương, anh đã vươn lên thành công, tạo dựng cơ nghiệp xưởng mộc vững chắc và giúp đỡ hàng chục người hoàn lương khác tái hòa nhập cộng đồng.',
    content: `
      <p>Sau khi chấp hành xong án phạt tù trở về địa phương vào năm 2021, anh Nguyễn Văn A đối mặt với muôn vàn khó khăn. Sự e dè của xã hội cùng nỗi mặc cảm tội lỗi đè nặng khiến anh nhiều lúc muốn bỏ cuộc. "Lúc mới về, tôi đi xin việc nhiều nơi nhưng đều nhận được những cái lắc đầu ái ngại vì lý lịch. Nhiều lúc buồn chán, tôi chỉ muốn đóng cửa không tiếp xúc với ai", anh A chia sẻ.</p>

      <blockquote>
        "Mỗi người đều xứng đáng có cơ hội thứ hai nếu họ thực sự quyết tâm hướng thiện. Sự động viên kịp thời của các cán bộ Công an phường chính là bước ngoặt thay đổi cuộc đời tôi."
        <span>— Anh Nguyễn Văn A chia sẻ</span>
      </blockquote>

      <p>Nhận thấy hoàn cảnh của anh A, lực lượng Cảnh sát khu vực và Công an phường đã thường xuyên xuống nhà thăm hỏi, động viên tinh thần. Thấy anh có tay nghề mộc thô sơ từ trước, các cán bộ đã chủ động hướng dẫn anh làm thủ tục vay vốn ưu đãi hỗ trợ tái hòa nhập cộng đồng từ Ngân hàng Chính sách Xã hội với số tiền 100 triệu đồng.</p>

      <p>Với số vốn ban đầu, anh A mạnh dạn đầu tư mua sắm máy xẻ gỗ, máy chà nhám công nghiệp và thuê lại một mặt bằng nhỏ để mở xưởng mộc. Bằng sự tỉ mỉ, uy tín trong từng sản phẩm gỗ gia dụng, xưởng mộc của anh ngày càng đông khách. Đến nay, xưởng mộc đã mở rộng quy mô lên hơn 300m², tạo việc làm thường xuyên cho 15 nhân công đều là những thanh niên lầm lỡ tại địa phương với mức thu nhập ổn định từ 8 - 12 triệu đồng/tháng.</p>
    `
  },
  'tran-thi-b': {
    name: 'Trần Thị B',
    location: 'Tỉnh Quảng Ninh',
    date: '17/07/2026',
    title: 'Chị Trần Thị B — Tự tin vươn lên làm chủ cơ sở may gia công xuất khẩu uy tín',
    image: '/assets/guong_sang_2.jpg',
    lead: 'Vượt qua những cú vấp ngã đầu đời đầy đắng cay, chị Trần Thị B ở Quảng Ninh đã làm lại cuộc đời thành công bằng nghề may mặc. Chị không chỉ sở hữu một xưởng may gia công lớn mà còn trực tiếp đào tạo nghề miễn phí cho phụ nữ lầm lỡ tại địa phương.',
    content: `
      <p>Trở về gia đình sau thời gian chấp hành án, chị Trần Thị B mang theo tâm lý tự ti của người phụ nữ từng phạm sai lầm. Hội Phụ nữ phường cùng các chiến sĩ Công an cơ sở đã chủ động đến nhà hỗ trợ, tạo điều kiện cho chị tham gia các khóa đào tạo nghề may ngắn hạn miễn phí do địa phương tổ chức liên kết.</p>

      <p>Nhờ sự khéo léo và chăm chỉ, chị B nhanh chóng thạo nghề và mạnh dạn xin liên kết may gia công đồ bảo hộ lao động cho các doanh nghiệp đóng trên địa bàn. Cơ sở may nhỏ ban đầu chỉ có 2-3 chiếc máy khâu đến nay đã phát triển thành xưởng may khang trang tạo công ăn việc làm ổn định cho nhiều lao động nữ tại địa phương.</p>
    `
  }
}

const article = computed(() => {
  return articlesData[slug] || null
})
</script>

<style scoped>
/* Retained for v-html deep content — not expressible with Tailwind utility classes */
.article-body :deep(p) {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #4A5545;
  margin-bottom: 20px;
}

.article-body :deep(blockquote) {
  background-color: #F8FAF7;
  border-left: 4px solid #4A6741;
  padding: 20px 24px;
  margin: 30px 0;
  font-style: italic;
  font-size: 1.1rem;
  color: #385130;
}

.article-body :deep(blockquote span) {
  display: block;
  font-size: 0.85rem;
  color: #7A8675;
  margin-top: 8px;
  font-weight: 700;
  font-style: normal;
}
</style>
