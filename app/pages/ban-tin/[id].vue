<template>
  <div class="article-detail-page section-bg">
    <div class="container article-container">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <nuxt-link to="/">Trang chủ</nuxt-link> &raquo; 
        <nuxt-link to="/ban-tin">Bản tin</nuxt-link> &raquo; 
        <span>Chi tiết tin tức</span>
      </div>

      <!-- Main Content -->
      <article class="article-content" v-if="article">
        <span class="meta-tag">📰 {{ article.category }} • Ngày đăng: {{ article.date }}</span>
        <h1 class="article-title">{{ article.title }}</h1>
        
        <div class="article-lead">
          <p>{{ article.lead }}</p>
        </div>

        <div class="article-body">
          <div class="article-img-wrap" v-if="article.image">
            <img :src="article.image" :alt="article.title" />
            <span class="img-caption" v-if="article.caption">{{ article.caption }}</span>
          </div>

          <div v-html="article.content"></div>
        </div>

        <!-- Back Link -->
        <div class="back-wrap">
          <nuxt-link to="/ban-tin" class="btn btn-primary">&larr; Quay lại danh sách Bản tin</nuxt-link>
        </div>
      </article>

      <div class="not-found" v-else>
        <p>Không tìm thấy tin tức yêu cầu hoặc bài viết đang được cập nhật.</p>
        <nuxt-link to="/ban-tin" class="btn btn-primary">Quay lại danh sách Bản tin</nuxt-link>
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
  'da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan': {
    category: 'Tin nổi bật',
    date: '17/07/2026',
    title: 'ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN',
    image: '/assets/news_danang.jpg',
    caption: 'Toàn cảnh Hội nghị đối thoại giữa Ban giám thị Trại tạm giam số 1 Công an Đà Nẵng với các phạm nhân.',
    lead: 'Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 để kịp thời lắng nghe, giải quyết khó khăn vướng mắc và động viên tinh thần cải tạo tốt.',
    content: `
      <p>Hội nghị do đồng chí Thượng tá Lê Thị Thu Huyền, Phó Giám thị Trại chủ trì đối thoại, cùng các đồng chí đại diện chỉ huy các đội nghiệp vụ. Trong không khí dân chủ, cởi mở và thẳng thắn, các phạm nhân đều bày tỏ sự tin tưởng vào chủ trương, đường lối của Đảng, chính sách, pháp luật của Nhà nước; cảm ơn sự quan tâm của lãnh đạo, cán bộ Trại đã thực hiện nghiêm các chế độ, chính sách đối với phạm nhân theo quy định.</p>
      
      <p>Nhiều phạm nhân đánh giá cao việc xây dựng "Tủ sách Hướng thiện" với số lượng đầu sách phong phú, đa dạng, đáp ứng nhu cầu học tập, nghiên cứu, nâng cao hiểu biết pháp luật của phạm nhân; đồng thời ghi nhận tinh thần trách nhiệm, thái độ ứng xử chuẩn mực, tận tình, nhân văn của cán bộ làm công tác quản lý, giáo dục phạm nhân.</p>

      <blockquote>
        "Mục tiêu lớn nhất của cuộc đối thoại là tạo ra môi trường công khai, minh bạch, giúp phạm nhân an tâm tư tưởng cải tạo, sớm trở về tái hòa nhập cộng đồng."
        <span>— Thượng tá Lê Thị Thu Huyền phát biểu tại Hội nghị</span>
      </blockquote>

      <p>Tại hội nghị, có 09 phạm nhân tham gia phát biểu ý kiến, tập trung đề xuất tăng cường các hoạt động văn hóa, văn nghệ, thể dục, thể thao nhằm nâng cao đời sống tinh thần; đồng thời kiến nghị sửa chữa một số hạng mục nhỏ tại buồng giam để bảo đảm điều kiện sinh hoạt. Các ý kiến của phạm nhân đã được đồng chí Thượng tá Lê Thị Thu Huyền cùng các đồng chí đại diện chỉ huy các đội nghiệp vụ trực tiếp lắng nghe, giải đáp đầy đủ, thấu đáo; đồng thời ghi nhận các nội dung phù hợp để báo cáo Giám thị chỉ đạo xem xét, giải quyết trong thời gian tới.</p>
      
      <p>Hoạt động đối thoại được tổ chức định kỳ nhằm thực hiện tốt Quy chế dân chủ ở cơ sở, phát huy quyền dân chủ của phạm nhân theo quy định của pháp luật; tạo điều kiện để phạm nhân bày tỏ tâm tư nguyện vọng chính đáng, góp phần xây dựng môi trường giam giữ kỷ cương, an toàn và nhân văn.</p>
    `
  },
  'quang-ninh-van-don-ho-tro-viec-lam': {
    category: 'Tin hoạt động',
    date: '17/07/2026',
    title: 'QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm, tái hòa nhập cộng đồng',
    image: '/assets/news_quangninh.jpg',
    caption: 'Sàn giao dịch việc làm Vân Đồn hỗ trợ kết nối trực tiếp doanh nghiệp cho các lao động hoàn lương.',
    lead: 'Vừa qua, UBND đặc khu Vân Đồn phối hợp với Trung tâm Dịch vụ việc làm tỉnh Quảng Ninh tổ chức Ngày hội việc làm năm 2026, thu hút sự tham gia của nhiều doanh nghiệp và đông đảo người lao động trên địa bàn. Lực lượng Công an cơ sở đã chủ động rà soát, kết nối các đối tượng chấp hành xong án phạt tù tham gia hướng nghiệp sản xuất.',
    content: `
      <p>Nhằm tạo điều kiện tốt nhất cho người chấp hành xong án phạt tù xóa bỏ mặc cảm tự ti, nhanh chóng hòa nhập với đời sống xã hội và có thu nhập ổn định, Công an đặc khu Vân Đồn đã phối hợp sát sao với cơ quan lao động thương binh xã hội tổ chức sàn giao dịch việc làm kết nối trực tiếp với các doanh nghiệp gỗ, cơ khí, may mặc.</p>
      
      <p>Các đối tượng khi tham gia ngày hội việc làm được tư vấn tận tình về các chính sách vay vốn ưu đãi kinh tế từ Ngân hàng Chính sách Xã hội theo Quyết định 22 của Thủ tướng Chính phủ, các chế độ hỗ trợ học nghề ngắn hạn miễn phí và được phỏng vấn trực tiếp tại các gian hàng tuyển dụng lao động.</p>
      
      <p>Đây là giải pháp mang tính chiến lược và nhân văn sâu sắc, giúp giải quyết triệt để khó khăn về việc làm - rào cản lớn nhất đối với người hoàn lương, từ đó hạn chế tối đa nguy cơ tái phạm tội và giữ vững trật tự an toàn xã hội trên địa bàn đặc khu Vân Đồn.</p>
    `
  },
  'mong-cai-tang-cuong-cam-hoa-giao-duc': {
    category: 'Tin địa phương',
    date: '17/07/2026',
    title: 'QUẢNG NINH: Công an phường Móng Cái 3 tăng cường công tác cảm hóa, giáo dục đối với người thi hành án hình sự tại cộng đồng',
    image: '/assets/news_quangninh.jpg',
    caption: 'Cán bộ Công an phường trực tiếp xuống địa bàn rà soát, gặp gỡ tuyên truyền giáo dục người chấp hành án.',
    lead: 'Thời gian qua, Công an phường Móng Cái 3, thành phố Móng Cái đã chủ động triển khai đồng bộ các biện pháp nghiệp vụ nhằm tăng cường công tác điểm danh, kiểm diện, quản lý, giám sát và cảm hóa giáo dục người chấp hành án hình sự tại cộng đồng; đảm bảo quản lý chặt chẽ, nhân văn, đúng pháp luật.',
    content: `
      <p>Xác định công tác quản lý, thi hành án hình sự tại cộng đồng là nhiệm vụ trọng tâm góp phần đảm bảo an ninh trật tự địa bàn, Công an phường Móng Cái 3 đã chủ động tham mưu Đảng ủy, UBND phường huy động sự vào cuộc của cả hệ thống chính trị, ban ngành đoàn thể cùng phối hợp giúp đỡ người chấp hành án.</p>
      
      <p>Định kỳ hàng tháng, Công an phường tổ chức điểm danh, kiểm diện, yêu cầu viết bản tự kiểm điểm tình hình chấp hành pháp luật. Đối với các trường hợp có hoàn cảnh khó khăn, các cán bộ phụ trách đã tích cực xuống tận nhà chia sẻ, tháo gỡ mặc cảm tự ti, đồng thời kiến nghị tạo điều kiện vay vốn chính sách phát triển chăn nuôi gia súc, kinh doanh tạp hóa nhỏ.</p>
      
      <p>Nhờ thực hiện tốt công tác cảm hóa giáo dục nhân văn kết hợp giám sát chặt chẽ, trong nhiều năm qua trên địa bàn phường Móng Cái 3 không xảy ra tình trạng người chấp hành án hình sự tại cộng đồng tái phạm tội, góp phần bảo vệ bình yên cho các khu phố vùng biên giới.</p>
    `
  },
  'lam-dong-tham-hoi-tang-qua-dac-xa': {
    category: 'Tin hoạt động',
    date: '17/07/2026',
    title: 'LÂM ĐỒNG: Công an tỉnh Lâm Đồng thăm hỏi, tặng quà, động viên người được đặc xá có hoàn cảnh khó khăn',
    image: '/assets/news_lamdong.jpg',
    caption: 'Lãnh đạo Phòng PC10 Công an Lâm Đồng trao quà động viên gia đình anh/chị đặc xá vượt khó lập nghiệp.',
    lead: 'Phòng Cảnh sát thi hành án hình sự và hỗ trợ tư pháp (PC10) Công an tỉnh Lâm Đồng phối hợp với Công an các địa phương tổ chức gặp gỡ, thăm hỏi, trao tặng các phần quà thiết thực động viên tinh thần người chấp hành đặc xá có hoàn cảnh khó khăn vươn lên ổn định cuộc sống.',
    content: `
      <p>Đặc xá tha tù trước thời hạn là chủ trương lớn, thể hiện chính sách khoan hồng, nhân đạo sâu sắc của Đảng và Nhà nước ta đối với người phạm tội biết ăn ăn hối cải, tích cực cải tạo tốt. Để chính sách này thực sự đi vào đời sống và phát huy hiệu quả, Công an Lâm Đồng đã triển khai nhiều giải pháp thiết thực hỗ trợ người đặc xá trở về.</p>
      
      <p>Bên cạnh việc thực hiện nhanh chóng các thủ tục đăng ký cư trú, cấp thẻ Căn cước công dân và xóa án tích đúng quy định, Ban lãnh đạo Công an tỉnh đặc biệt quan tâm đến đời sống kinh tế của các hộ đặc xá. Những phần quà được trao tặng tuy giá trị vật chất không lớn nhưng là nguồn động viên tinh thần to lớn, thể hiện sự đồng hành, không bỏ rơi của lực lượng Công an đối với những người mong muốn làm lại cuộc đời.</p>
    `
  },
  'can-tho-diem-tua-tin-dung-cho-nguoi-hoan-luong': {
    category: 'Tin nổi bật',
    date: '16/07/2026',
    title: 'CẦN THƠ: Điểm tựa tín dụng chính sách cho người hoàn lương tái hòa nhập',
    image: '/assets/news_lamdong.jpg',
    caption: 'Cán bộ ngân hàng chính sách giải ngân vốn vay cho người hoàn lương tại phường Thốt Nốt, Cần Thơ.',
    lead: 'Nguồn vốn vay ưu đãi theo Quyết định số 22/2023/QĐ-TTg của Thủ tướng Chính phủ về tín dụng đối với người chấp hành xong án phạt tù (Quyết định 22) thực sự trở thành chiếc phao cứu sinh, tiếp thêm động lực cho nhiều hoàn cảnh tại thành phố Cần Thơ vươn lên xây dựng cuộc sống mới.',
    content: `
      <p>Theo báo cáo của Ngân hàng Chính sách Xã hội chi nhánh TP Cần Thơ, sau hơn 2 năm triển khai Quyết định 22, đơn vị đã tổ chức giải ngân cho hàng trăm hộ gia đình có người chấp hành xong án phạt tù vay vốn với tổng dư nợ hàng chục tỷ đồng. Mức vay tối đa 100 triệu đồng/hộ với lãi suất ưu đãi đã giúp giải quyết kịp thời bài toán thiếu vốn mua sắm thiết bị sản xuất nông nghiệp, lập xưởng sửa xe, ao nuôi cá...</p>
      
      <p>Công tác bình xét vay vốn được thực hiện công khai, dân chủ thông qua các tổ tiết kiệm và vay vốn tại khóm ấp, đảm bảo vốn vay đến đúng đối tượng, sử dụng đúng mục đích phát triển kinh tế gia đình lành mạnh.</p>
    `
  }
}

const dynamicArticle = ref(null)

const fetchDynamicArticle = async () => {
  try {
    const res = await $fetch(`/api/public/articles/${slug}`)
    if (res.ok && res.article) {
      dynamicArticle.value = {
        category: res.article.type === 'news' ? 'Bản tin' : (res.article.type === 'role_model' ? 'Tấm gương' : 'Thông tin'),
        date: new Date(res.article.publishedAt || res.article.createdAt).toLocaleDateString('vi-VN'),
        title: res.article.title,
        image: res.article.thumbnailUrl || null,
        caption: res.article.title,
        lead: res.article.excerpt || '',
        content: res.article.content || '',
      }
    }
  } catch {
    // Ignore error, fallback to mockup
  }
}

onMounted(() => {
  fetchDynamicArticle()
})

const article = computed(() => {
  return dynamicArticle.value || articlesData[slug] || null
})
</script>

<style scoped>
.article-detail-page {
  padding: 40px 0;
}

.article-container {
  max-width: 800px;
  margin: 0 auto;
}

.breadcrumb {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.breadcrumb a {
  color: var(--primary);
  text-decoration: none;
}

.breadcrumb a:hover {
  text-underline: underline;
}

.meta-tag {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--primary);
  background-color: var(--bg-light);
  padding: 6px 12px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 16px;
}

.article-title {
  font-size: 2.2rem;
  font-weight: 800;
  line-height: 1.3;
  color: var(--text-dark);
  margin-bottom: 20px;
}

.article-lead {
  font-size: 1.12rem;
  font-weight: 600;
  color: var(--text-medium);
  line-height: 1.6;
  border-left: 4px solid var(--secondary);
  padding-left: 20px;
  margin-bottom: 30px;
}

.article-img-wrap {
  margin: 30px 0;
  text-align: center;
}

.article-img-wrap img {
  width: 100%;
  max-height: 450px;
  object-fit: cover;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.img-caption {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 8px;
  display: block;
}

.article-body :deep(p) {
  font-size: 1.05rem;
  line-height: 1.7;
  color: var(--text-medium);
  margin-bottom: 20px;
}

.article-body :deep(blockquote) {
  background-color: var(--bg-light);
  border-left: 4px solid var(--primary);
  padding: 20px 24px;
  margin: 30px 0;
  font-style: italic;
  font-size: 1.1rem;
  color: var(--primary-dark);
}

.article-body :deep(blockquote span) {
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 8px;
  font-weight: 700;
  font-style: normal;
}

.back-wrap {
  margin-top: 40px;
  border-top: 1px solid var(--border-color);
  padding-top: 30px;
}
</style>
