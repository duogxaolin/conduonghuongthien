<template>
  <div class="homepage">
    <!-- Hero Banner -->
    <section class="hero-section">
      <div class="hero-overlay"></div>
      <div class="container hero-container">
        <div class="hero-content">
          <span class="hero-badge">Cổng thông tin C11 - Bộ Công an</span>
          <h2 class="hero-title">Đồng hành cùng hành trình hướng thiện</h2>
          <p class="hero-desc">
            Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.
          </p>
          <div class="hero-actions">
            <nuxt-link to="/gioi-thieu" class="btn btn-secondary">Về chúng tôi</nuxt-link>
            <a href="#tro-giup" class="btn btn-outline-white">Gửi yêu cầu trợ giúp</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Thống kê nhanh -->
    <section class="stats-section">
      <div class="container">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-number">63</div>
            <div class="stat-label">Tỉnh / Thành phố đồng hành</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">10.000+</div>
            <div class="stat-label">Người hoàn lương được hỗ trợ</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">500+</div>
            <div class="stat-label">Mô hình kinh tế tiêu biểu</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">24/7</div>
            <div class="stat-label">Tư vấn pháp lý & Tâm lý miễn phí</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Cụm tin tức & Chỉ đạo điều hành (Đồng bộ conduonghuongthien & bocongan) -->
    <section class="section news-section">
      <div class="container">
        <div class="section-header-row">
          <h2 class="section-title-left">Bản Tin & Chỉ Đạo Điều Hành</h2>
          <nuxt-link to="/ban-tin" class="view-all-link">Xem tất cả →</nuxt-link>
        </div>

        <div class="news-main-grid">
          <!-- Tin chính nổi bật (Đà Nẵng) -->
          <div class="news-featured">
            <div class="featured-card">
              <div class="featured-img-wrap">
                <img src="/assets/news_danang.jpg" alt="Đại hội đối thoại Đà Nẵng" />
                <span class="news-badge-cat">Tin hoạt động</span>
              </div>
              <div class="featured-info">
                <span class="news-date">17 Tháng 7, 2026</span>
                <h3>
                  <nuxt-link to="/ban-tin/da-nang-doi-thoai-giam-thi-pham-nhan">
                    ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN
                  </nuxt-link>
                </h3>
                <p>
                  Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng đã tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 nhằm lắng nghe tâm tư, nguyện vọng và giải quyết kịp thời các quyền lợi chính đáng.
                </p>
                <nuxt-link to="/ban-tin/da-nang-doi-thoai-giam-thi-pham-nhan" class="read-more">Chi tiết bài viết &rarr;</nuxt-link>
              </div>
            </div>
          </div>

          <!-- Danh sách tin phụ -->
          <div class="news-list">
            <div class="news-item-card">
              <div class="item-img-wrap">
                <img src="/assets/news_quangninh.jpg" alt="Quảng Ninh Vân Đồn hỗ trợ việc làm" />
              </div>
              <div class="item-info">
                <span class="news-date">17/07/2026</span>
                <h4>
                  <nuxt-link to="/ban-tin/quang-ninh-van-don-ho-tro-viec-lam">
                    QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm
                  </nuxt-link>
                </h4>
              </div>
            </div>

            <div class="news-item-card">
              <div class="item-img-wrap">
                <img src="/assets/news_lamdong.jpg" alt="Lâm Đồng tặng quà đặc xá" />
              </div>
              <div class="item-info">
                <span class="news-date">17/07/2026</span>
                <h4>
                  <nuxt-link to="/ban-tin/lam-dong-tham-hoi-tang-qua-dac-xa">
                    LÂM ĐỒNG: Công an tỉnh thăm hỏi, tặng quà, động viên người được đặc xá có hoàn cảnh khó khăn
                  </nuxt-link>
                </h4>
              </div>
            </div>

            <div class="news-item-card">
              <div class="item-img-wrap">
                <img src="/assets/news_quangninh.jpg" alt="Móng Cái cảm hóa giáo dục" />
              </div>
              <div class="item-info">
                <span class="news-date">17/07/2026</span>
                <h4>
                  <nuxt-link to="/ban-tin/mong-cai-tang-cuong-cam-hoa-giao-duc">
                    QUẢNG NINH: Công an phường Móng Cái 3 tăng cường điểm danh, kiểm diện, cảm hóa giáo dục
                  </nuxt-link>
                </h4>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Banner Quote Parallax xen kẽ -->
    <section class="quote-banner">
      <div class="quote-overlay"></div>
      <div class="container quote-container">
        <p class="quote-text">"Mỗi con đường hướng thiện đều bắt đầu bằng một bước chân quyết tâm trở về với cộng đồng."</p>
        <span class="quote-author">— Ban Chỉ đạo Đề án Tái hòa nhập cộng đồng</span>
      </div>
    </section>

    <!-- Tấm gương tiêu biểu (Gương sáng hoàn lương) -->
    <section class="section section-bg role-models-section">
      <div class="container">
        <h2 class="section-title">Tấm Gương Sáng Hoàn Lương</h2>
        <p class="section-subtitle-text">Những cá nhân vượt qua lầm lỡ, vững bước vươn lên xây dựng gia đình hạnh phúc và đóng góp cho kinh tế địa phương</p>
        
        <div class="role-grid">
          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_1.jpg" alt="Gương sáng Nguyễn Văn A" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 TP. Đà Nẵng</span>
              <h3>Anh Nguyễn Văn A</h3>
              <p class="role-desc">
                Từng chấp hành án phạt tù 5 năm, anh A trở về lập nghiệp từ hai bàn tay trắng. Được Công an phường và các doanh nghiệp hỗ trợ vay vốn, anh mở xưởng sản xuất đồ gỗ mỹ nghệ thủ công mỹ nghệ tiêu chuẩn cao, hiện tạo việc làm ổn định cho 15 thanh niên lầm lỡ khác tại địa bàn.
              </p>
              <nuxt-link to="/tam-guong-tieu-bieu/nguyen-van-a" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>

          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_2.jpg" alt="Gương sáng Trần Thị B" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 Tỉnh Quảng Ninh</span>
              <h3>Chị Trần Thị B</h3>
              <p class="role-desc">
                Vượt qua định kiến và mặc cảm ban đầu, chị B kiên trì tham gia các lớp đào tạo may mặc miễn phí do Hội Phụ nữ địa phương tổ chức. Hiện nay chị đã sở hữu một cơ sở may mặc xuất khẩu thời trang uy tín, tích cực tham gia các phong trào nhân đạo và hỗ trợ phụ nữ hoàn lương tái hòa nhập.
              </p>
              <nuxt-link to="/tam-guong-tieu-bieu/tran-thi-b" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Các Mô hình tái hòa nhập -->
    <section class="section models-section">
      <div class="container">
        <h2 class="section-title">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <div class="models-grid">
          <div class="model-box">
            <div class="model-icon">💼</div>
            <h3>Hỗ trợ nghề nghiệp</h3>
            <p>Phối hợp với các trường nghề tổ chức các khóa dạy nghề ngắn hạn, định hướng nghề nghiệp phù hợp và cấp chứng chỉ nghề chính quy cho người hoàn lương.</p>
          </div>
          <div class="model-box">
            <div class="model-icon">🌱</div>
            <h3>Tư vấn tâm lý</h3>
            <p>Đội ngũ chuyên gia tâm lý và các cán bộ đoàn thể hỗ trợ lắng nghe, tháo gỡ mặc cảm tự ti, định hướng tư duy tích cực vững vàng làm lại cuộc đời.</p>
          </div>
          <div class="model-box">
            <div class="model-icon">🤝</div>
            <h3>Kết nối doanh nghiệp</h3>
            <p>Xây dựng mạng lưới doanh nghiệp nhân văn sẵn sàng dang rộng cánh tay chào đón và bố trí công việc phù hợp, công bằng cho người có ý chí hoàn hoàn lương.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Văn bản Pháp luật (Điểm nhấn thầu nhà nước) -->
    <section class="section section-bg legal-section">
      <div class="container legal-container">
        <div class="legal-left">
          <h2 class="section-title-left">Văn Bản Quy Phạm Pháp Luật</h2>
          <p class="legal-intro-text">
            Tìm hiểu và tra cứu các chính sách, nghị định của Chính phủ và chỉ thị của Bộ Công an quy định chi tiết việc triển khai các biện pháp bảo đảm tái hòa nhập cộng đồng đối với người chấp hành xong án phạt tù.
          </p>
          <div class="legal-list">
            <div class="legal-item">
              <span class="legal-badge">Nghị định 49/2020/NĐ-CP</span>
              <p>Nghị định quy định chi tiết thi hành Luật Thi hành án hình sự về các biện pháp bảo đảm tái hòa nhập cộng đồng.</p>
            </div>
            <div class="legal-item">
              <span class="legal-badge">Quyết định 22/2023/QĐ-TTg</span>
              <p>Quyết định của Thủ tướng Chính phủ về chính sách tín dụng đối với người chấp hành xong án phạt tù vay vốn làm kinh tế.</p>
            </div>
          </div>
          <nuxt-link to="/van-ban" class="btn btn-primary">Xem thư viện văn bản</nuxt-link>
        </div>
        <div class="legal-right">
          <!-- Hình ảnh minh họa sách văn bản pháp luật, trang nghiêm -->
          <div class="book-mockup">
            <div class="book-cover">
              <h4>BỘ CÔNG AN</h4>
              <h3>PHÁP LUẬT VỀ TÁI HÒA NHẬP CỘNG ĐỒNG</h3>
              <p>Tài liệu tuyên truyền, phổ biến giáo dục pháp luật năm 2026</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Thư viện Đa phương tiện Video (Cơ chế đồng bộ Youtube) -->
    <section class="section multimedia-section">
      <div class="container">
        <h2 class="section-title">Thư Viện Ảnh - Video</h2>
        <div class="media-grid">
          <!-- Video chính Player -->
          <div class="video-player-wrap">
            <div class="video-placeholder">
              <img src="/assets/news_lamdong.jpg" alt="Video thumbnail" />
              <div class="video-overlay-play">
                <span class="play-triangle">▶</span>
              </div>
            </div>
            <div class="video-title-bar">
              <h4>Phóng sự: Hành trình hoàn lương - Lan tỏa những câu chuyện nhân văn</h4>
              <span>Thời lượng: 15:20 | Nguồn: Truyền hình CAND (ANTV)</span>
            </div>
          </div>

          <!-- Video liên quan -->
          <div class="video-sidebar">
            <div class="video-sidebar-item">
              <div class="thumb-wrap">
                <img src="/assets/news_quangninh.jpg" alt="Thumb 1" />
              </div>
              <div class="info-wrap">
                <h5>Quảng Ninh: Điểm sáng tín dụng giúp người hoàn lương làm chủ</h5>
                <span>10:45</span>
              </div>
            </div>

            <div class="video-sidebar-item">
              <div class="thumb-wrap">
                <img src="/assets/news_danang.jpg" alt="Thumb 2" />
              </div>
              <div class="info-wrap">
                <h5>Đà Nẵng: Tuyên dương 20 tấm gương tiêu biểu hoàn lương năm 2026</h5>
                <span>08:30</span>
              </div>
            </div>

            <div class="video-sidebar-item">
              <div class="thumb-wrap">
                <img src="/assets/news_lamdong.jpg" alt="Thumb 3" />
              </div>
              <div class="info-wrap">
                <h5>Phim tài liệu ngắn: Con đường hướng thiện và khát vọng sống mới</h5>
                <span>18:15</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Giải đáp pháp luật & Hỏi đáp FAQ -->
    <section class="section section-bg faq-section" id="faq">
      <div class="container">
        <h2 class="section-title">Giải Đáp & Hỏi Đáp Pháp Luật</h2>
        <div class="faq-accordion">
          <div v-for="(item, index) in faqs" :key="index" class="faq-item" :class="{ 'is-open': activeFaq === index }">
            <button class="faq-question" @click="toggleFaq(index)">
              <span>{{ item.question }}</span>
              <span class="faq-icon">{{ activeFaq === index ? '−' : '+' }}</span>
            </button>
            <div class="faq-answer" v-show="activeFaq === index">
              <p>{{ item.answer }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Biểu mẫu Trợ giúp & Phản hồi (Mục tiêu tương tác trực tuyến) -->
    <section class="section contact-form-section" id="tro-giup">
      <div class="container contact-container">
        <div class="contact-form-info">
          <h2 class="section-title-left">Đăng Ký Nhận Trợ Giúp</h2>
          <p>
            Nếu bạn hoặc người thân đang chấp hành xong án phạt tù và có nhu cầu được hỗ trợ về thủ tục pháp lý, học nghề, vay vốn làm ăn hoặc tư vấn tâm lý, xin vui lòng gửi thông tin cho chúng tôi.
          </p>
          <p>
            Các thông tin đăng ký sẽ được chúng tôi bảo mật và chuyển tiếp tới cơ quan Công an và đoàn thể tại địa bàn cư trú để kịp thời liên hệ hỗ trợ.
          </p>
          <div class="contact-hotline-card">
            <h4>Đường dây nóng hỗ trợ khẩn cấp:</h4>
            <h3>0903.480.985</h3>
            <p>Hỗ trợ 24/7 hoàn toàn miễn phí</p>
          </div>
        </div>
        
        <div class="contact-form-wrap">
          <form @submit.prevent="submitForm" class="assistance-form">
            <div class="form-group">
              <label>Họ và tên người cần hỗ trợ *</label>
              <input type="text" v-model="form.name" placeholder="Nhập đầy đủ họ và tên" required />
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Số điện thoại liên hệ *</label>
                <input type="tel" v-model="form.phone" placeholder="Nhập số điện thoại" required />
              </div>
              <div class="form-group">
                <label>Địa chỉ Email (nếu có)</label>
                <input type="email" v-model="form.email" placeholder="Nhập địa chỉ email" />
              </div>
            </div>

            <div class="form-group">
              <label>Tỉnh / Thành phố cư trú *</label>
              <input type="text" v-model="form.city" placeholder="Nhập tỉnh/thành phố" required />
            </div>

            <div class="form-group">
              <label>Nội dung cần hỗ trợ chi tiết *</label>
              <textarea v-model="form.message" rows="4" placeholder="Ví dụ: Cần tư vấn thủ tục xóa án tích, vay vốn ngân hàng chính sách, đăng ký học nghề..." required></textarea>
            </div>

            <button type="submit" class="btn btn-secondary btn-submit-form">Gửi yêu cầu trợ giúp</button>
          </form>
        </div>
      </div>
    </section>

    <!-- Chatbot Popup (Lõi Chatbot FAQ đã duyệt) -->
    <div class="chatbot-popup" :class="{ 'is-open': isChatbotOpen }">
      <div class="chatbot-header">
        <div class="chatbot-title">
          <span class="bot-avatar">🤖</span>
          <div>
            <h4>Trợ lý ảo Hướng Thiện</h4>
            <p>Hỗ trợ giải đáp pháp lý tự động</p>
          </div>
        </div>
        <button class="close-bot-btn" @click="toggleChatbot">×</button>
      </div>

      <div class="chatbot-messages" ref="chatContainer">
        <div v-for="(msg, index) in chatMessages" :key="index" class="chat-msg" :class="msg.sender">
          <div class="msg-bubble">{{ msg.text }}</div>
        </div>
      </div>

      <!-- Quick Questions -->
      <div class="chatbot-quick-questions">
        <button 
          v-for="(q, index) in chatbotFaqs" 
          :key="index" 
          @click="askBot(q.question, q.answer)"
          class="quick-q-btn"
        >
          {{ q.label }}
        </button>
      </div>

      <div class="chatbot-input-area">
        <input 
          type="text" 
          placeholder="Nhập câu hỏi pháp lý của bạn..." 
          v-model="botInput" 
          @keyup.enter="sendBotMessage"
        />
        <button class="send-bot-btn" @click="sendBotMessage">➤</button>
      </div>
    </div>

    <!-- Toggle Button for Chatbot -->
    <button class="chatbot-toggle-btn" @click="toggleChatbot">
      <span class="bot-icon">💬</span>
      <span class="bot-badge">Hỏi trợ lý</span>
    </button>
  </div>
</template>

<script setup>
import { ref, reactive, nextTick } from 'vue'

const activeFaq = ref(null)
const isChatbotOpen = ref(false)
const botInput = ref('')
const chatContainer = ref(null)

const faqs = [
  {
    question: "Quy trình xóa án tích theo quy định hiện nay như thế nào?",
    answer: "Người chấp hành xong án phạt tù có hai hình thức xóa án tích: Đương nhiên được xóa án tích (sau một khoảng thời gian nhất định nếu không phạm tội mới) hoặc Xóa án tích theo quyết định của Tòa án. Để tiến hành, đương sự nộp đơn xin cấp Phiếu lý lịch tư pháp số 2 tại Sở Tư pháp tỉnh/thành phố nơi cư trú để xác minh tình trạng án tích."
  },
  {
    question: "Người hoàn lương được vay vốn chính sách tối đa bao nhiêu tiền?",
    answer: "Theo Quyết định số 22/2023/QĐ-TTg của Thủ tướng Chính phủ, người chấp hành xong án phạt tù có thể vay vốn tối đa 100 triệu đồng đối với hộ sản xuất kinh doanh hoặc tối đa 4 triệu đồng/tháng đối với chi phí học nghề, thông qua Ngân hàng Chính sách Xã hội để đầu tư làm ăn, sản xuất nông lâm ngư nghiệp."
  },
  {
    question: "Các biện pháp hỗ trợ hòa nhập cộng đồng gồm những gì?",
    answer: "Theo Luật Thi hành án hình sự và Nghị định 49/2020/NĐ-CP, cơ quan chức năng cung cấp hỗ trợ thông tin, tuyên truyền pháp luật, đào tạo nghề nghiệp, giải quyết việc làm, hỗ trợ làm các thủ tục giấy tờ công dân (cấp CCCD, đăng ký cư trú) và hỗ trợ tâm lý, phòng chống tái phạm tội."
  },
  {
    question: "Ai có trách nhiệm chính trong việc quản lý và hỗ trợ người hoàn lương?",
    answer: "Ủy ban nhân dân cấp xã, phường là cơ quan chịu trách nhiệm chính trong việc tổ chức quản lý, giáo dục, hỗ trợ người chấp hành xong án phạt tù. Lực lượng Công an cấp xã trực tiếp tham mưu, lập hồ sơ quản lý và phối hợp với các ban ngành hỗ trợ về học nghề, tìm việc làm."
  }
]

const form = reactive({
  name: '',
  phone: '',
  email: '',
  city: '',
  message: ''
})

const chatMessages = ref([
  { sender: 'bot', text: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi có thể hỗ trợ bạn giải đáp nhanh các câu hỏi pháp lý đã được Cục C11 phê duyệt về công tác tái hòa nhập cộng đồng.' }
])

const chatbotFaqs = [
  { label: 'Hạn mức vay vốn?', question: 'Người hoàn lương được vay vốn tối đa bao nhiêu?', answer: 'Theo Quyết định 22/2023/QĐ-TTg, người chấp hành xong án phạt tù được vay vốn ưu đãi tối đa 100 triệu đồng để làm kinh tế, sản xuất kinh doanh tại Ngân hàng Chính sách Xã hội địa phương.' },
  { label: 'Làm sao xóa án tích?', question: 'Thủ tục xóa án tích như thế nào?', answer: 'Khi đủ thời gian thử thách và thời gian đương nhiên xóa án tích theo quy định Bộ luật Hình sự, bạn cần đến Sở Tư pháp địa phương để làm thủ tục xin cấp Phiếu lý lịch tư pháp số 2 làm cơ sở xác định việc xóa án tích.' },
  { label: 'Đăng ký học nghề?', question: 'Làm thế nào để đăng ký học nghề?', answer: 'Bạn hãy liên hệ với UBND hoặc Công an cấp xã/phường nơi cư trú để nhận phiếu giới thiệu học nghề miễn phí hoặc ưu đãi tại các trường dạy nghề liên kết của địa phương theo Nghị định 49/2020/NĐ-CP.' }
]

const toggleFaq = (index) => {
  activeFaq.value = activeFaq.value === index ? null : index
}

const toggleChatbot = () => {
  isChatbotOpen.value = !isChatbotOpen.value
  if (isChatbotOpen.value) {
    scrollChatBottom()
  }
}

const askBot = (question, answer) => {
  chatMessages.value.push({ sender: 'user', text: question })
  setTimeout(() => {
    chatMessages.value.push({ sender: 'bot', text: answer })
    scrollChatBottom()
  }, 400)
}

const sendBotMessage = () => {
  if (botInput.value.trim() === '') return
  const text = botInput.value
  chatMessages.value.push({ sender: 'user', text })
  botInput.value = ''
  scrollChatBottom()

  // Phân tích câu hỏi tự nhiên bằng so sánh từ khóa để lấy câu trả lời trong Ngân hàng CSDL
  setTimeout(() => {
    let reply = "Xin lỗi, câu hỏi này nằm ngoài ngân hàng câu hỏi pháp lý đã được biên soạn sẵn. Bạn vui lòng liên hệ hotline 0903.480.985 hoặc gửi biểu mẫu trợ giúp bên dưới để được cán bộ chuyên môn giải đáp chi tiết."
    const cleanText = text.toLowerCase()
    
    if (cleanText.includes('vay') || cleanText.includes('vốn') || cleanText.includes('tiền')) {
      reply = "Theo Quyết định 22/2023/QĐ-TTg, bạn được hỗ trợ vay vốn sản xuất tối đa 100 triệu đồng và vay học nghề tối đa 4 triệu đồng/tháng qua Ngân hàng Chính sách Xã hội."
    } else if (cleanText.includes('xóa') || cleanText.includes('án tích') || cleanText.includes('lý lịch')) {
      reply = "Thủ tục xóa án tích được quy định tại Bộ luật Hình sự. Khi đủ thời hạn quy định, bạn gửi hồ sơ đề nghị cấp Phiếu lý lịch tư pháp tại Sở Tư pháp tỉnh/thành phố nơi bạn có hộ khẩu thường trú."
    } else if (cleanText.includes('nghề') || cleanText.includes('học') || cleanText.includes('việc làm')) {
      reply = "Nghị định 49/2020/NĐ-CP quy định người chấp hành xong án phạt tù được hỗ trợ tư vấn học nghề và giới thiệu việc làm miễn phí thông qua trung tâm dịch vụ việc làm của Sở LĐ-TB&XH."
    } else if (cleanText.includes('hotline') || cleanText.includes('liên hệ') || cleanText.includes('điện thoại')) {
      reply = "Đường dây nóng của Ban chỉ đạo Đề án là 0903.480.985. Hỗ trợ 24/7."
    }

    chatMessages.value.push({ sender: 'bot', text: reply })
    scrollChatBottom()
  }, 600)
}

const scrollChatBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const submitForm = () => {
  alert(`Cảm ơn bạn ${form.name}. Yêu cầu trợ giúp của bạn đã được tiếp nhận thành công. Cơ quan Công an và cán bộ phụ trách sẽ liên hệ hỗ trợ bạn qua số điện thoại ${form.phone} trong vòng 24 giờ làm việc.`)
  form.name = ''
  form.phone = ''
  form.email = ''
  form.city = ''
  form.message = ''
}
</script>

<style scoped>
/* Hero Section */
.hero-section {
  position: relative;
  height: 70vh;
  min-height: 520px;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  display: flex;
  align-items: center;
}

.hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg, rgba(74, 103, 65, 0.9) 0%, rgba(56, 81, 48, 0.6) 100%);
  z-index: 1;
}

.hero-container {
  position: relative;
  z-index: 2;
}

.hero-content {
  max-width: 720px;
  color: var(--white);
}

.hero-badge {
  background-color: var(--secondary);
  color: var(--white);
  padding: 6px 14px;
  font-size: 0.8rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 1px;
  display: inline-block;
  margin-bottom: 24px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.1);
}

.hero-title {
  font-size: 3.2rem;
  font-weight: 800;
  line-height: 1.25;
  margin-bottom: 20px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.hero-desc {
  font-size: 1.15rem;
  line-height: 1.6;
  opacity: 0.95;
  margin-bottom: 36px;
}

.hero-actions {
  display: flex;
  gap: 16px;
}

.btn-outline-white {
  background: transparent;
  border: 2px solid white;
  color: white;
}

.btn-outline-white:hover {
  background: white;
  color: var(--primary);
  transform: translateY(-2px);
}

/* Stats Section */
.stats-section {
  margin-top: -40px;
  position: relative;
  z-index: 10;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.stat-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 30px 20px;
  text-align: center;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.stat-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--shadow-lg);
  border-color: var(--secondary);
}

.stat-number {
  font-size: 2.2rem;
  font-weight: 800;
  color: var(--primary);
  margin-bottom: 8px;
}

.stat-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-medium);
}

/* News Section */
.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 36px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 12px;
}

.section-title-left {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--primary);
  position: relative;
}

.section-title-left::after {
  content: '';
  position: absolute;
  bottom: -14px;
  left: 0;
  width: 50px;
  height: 4px;
  background-color: var(--secondary);
  border-radius: 2px;
}

.view-all-link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  transition: var(--transition);
}

.view-all-link:hover {
  color: var(--secondary);
}

.news-main-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 30px;
}

.featured-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.featured-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border-color);
}

.featured-img-wrap {
  position: relative;
  height: 380px;
  overflow: hidden;
}

.featured-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: var(--transition);
}

.featured-card:hover .featured-img-wrap img {
  transform: scale(1.03);
}

.news-badge-cat {
  position: absolute;
  top: 16px; left: 16px;
  background-color: var(--primary);
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 4px;
}

.featured-info {
  padding: 24px;
}

.news-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 500;
  display: block;
  margin-bottom: 8px;
}

.featured-info h3 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 12px;
  line-height: 1.4;
}

.featured-info h3 a {
  text-decoration: none;
  color: var(--text-dark);
  transition: var(--transition);
}

.featured-info h3 a:hover {
  color: var(--primary);
}

.featured-info p {
  color: var(--text-medium);
  font-size: 0.95rem;
  margin-bottom: 16px;
}

.read-more {
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.92rem;
}

.news-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.news-item-card {
  display: flex;
  gap: 16px;
  background-color: var(--white);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.news-item-card:hover {
  box-shadow: var(--shadow-sm);
  border-color: var(--secondary);
}

.item-img-wrap {
  width: 100px;
  height: 80px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.item-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-info h4 {
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.4;
  margin-top: 4px;
}

.item-info h4 a {
  text-decoration: none;
  color: var(--text-dark);
  transition: var(--transition);
}

.item-info h4 a:hover {
  color: var(--primary);
}

/* Quote Banner */
.quote-banner {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat fixed;
  padding: 80px 0;
  text-align: center;
}

.quote-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.85);
}

.quote-container {
  position: relative;
  z-index: 2;
  color: white;
  max-width: 800px;
}

.quote-text {
  font-size: 1.8rem;
  font-style: italic;
  font-weight: 300;
  line-height: 1.5;
  margin-bottom: 16px;
}

.quote-author {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  opacity: 0.8;
}

/* Role Models */
.section-subtitle-text {
  text-align: center;
  color: var(--text-medium);
  margin-top: -36px;
  margin-bottom: 48px;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.role-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}

.role-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 30px;
  display: flex;
  gap: 24px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.role-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.role-avatar-wrap {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  border: 4px solid var(--bg-light);
  flex-shrink: 0;
}

.role-avatar-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.role-location {
  font-size: 0.78rem;
  background-color: var(--bg-light);
  color: var(--primary);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 8px;
}

.role-info h3 {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 10px;
}

.role-desc {
  font-size: 0.9rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 12px;
}

.role-link {
  color: var(--primary);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.88rem;
}

/* Models Box */
.models-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px;
}

.model-box {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 40px 30px;
  text-align: center;
  transition: var(--transition);
}

.model-box:hover {
  transform: translateY(-5px);
  border-color: var(--secondary);
  box-shadow: var(--shadow-md);
}

.model-icon {
  font-size: 2.5rem;
  margin-bottom: 20px;
}

.model-box h3 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 16px;
}

.model-box p {
  font-size: 0.92rem;
  color: var(--text-medium);
  line-height: 1.6;
}

/* Legal Section */
.legal-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 60px;
  align-items: center;
}

.legal-intro-text {
  color: var(--text-medium);
  margin-bottom: 28px;
  font-size: 1.05rem;
}

.legal-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 32px;
}

.legal-item {
  background-color: var(--white);
  padding: 20px;
  border-radius: var(--radius-sm);
  border-left: 4px solid var(--primary);
  box-shadow: var(--shadow-sm);
}

.legal-badge {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary);
  background-color: var(--bg-light);
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 8px;
}

.legal-item p {
  font-size: 0.9rem;
  color: var(--text-medium);
  line-height: 1.5;
}

.book-mockup {
  display: flex;
  justify-content: center;
}

.book-cover {
  width: 300px;
  height: 420px;
  background-color: var(--primary);
  border-radius: 4px 16px 16px 4px;
  color: white;
  padding: 40px 30px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 15px 15px 30px rgba(0,0,0,0.15), -2px 0 5px rgba(255,255,255,0.1) inset;
  position: relative;
}

.book-cover::before {
  content: '';
  position: absolute;
  top: 0; left: 10px; bottom: 0;
  width: 1px;
  background-color: rgba(255,255,255,0.15);
  box-shadow: 1px 0 0 rgba(0,0,0,0.1);
}

.book-cover h4 {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 1px;
  border-bottom: 1.5px solid rgba(255,255,255,0.3);
  padding-bottom: 12px;
}

.book-cover h3 {
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1.3;
}

.book-cover p {
  font-size: 0.8rem;
  opacity: 0.8;
  line-height: 1.4;
}

/* Video Section */
.media-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 30px;
}

.video-player-wrap {
  background-color: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.video-placeholder {
  position: relative;
  height: 400px;
  background-color: #000;
  cursor: pointer;
  overflow: hidden;
}

.video-placeholder img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.7;
  transition: var(--transition);
}

.video-placeholder:hover img {
  transform: scale(1.02);
  opacity: 0.8;
}

.video-overlay-play {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 70px;
  height: 70px;
  background-color: var(--secondary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 15px rgba(124, 179, 66, 0.4);
  transition: var(--transition);
}

.video-placeholder:hover .video-overlay-play {
  background-color: var(--primary);
  transform: translate(-50%, -50%) scale(1.08);
}

.play-triangle {
  color: white;
  font-size: 1.6rem;
  margin-left: 4px;
}

.video-title-bar {
  padding: 20px;
}

.video-title-bar h4 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.video-title-bar span {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.video-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.video-sidebar-item {
  display: flex;
  gap: 12px;
  background-color: var(--white);
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: var(--transition);
}

.video-sidebar-item:hover {
  border-color: var(--secondary);
  box-shadow: var(--shadow-sm);
}

.thumb-wrap {
  width: 90px;
  height: 60px;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.thumb-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info-wrap h5 {
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.info-wrap span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* FAQ accordion */
.faq-accordion {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.faq-item {
  background-color: var(--white);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  overflow: hidden;
  transition: var(--transition);
}

.faq-item.is-open {
  border-color: var(--primary);
  box-shadow: var(--shadow-sm);
}

.faq-question {
  width: 100%;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-dark);
  text-align: left;
  cursor: pointer;
}

.faq-item:hover .faq-question {
  color: var(--primary);
}

.faq-icon {
  font-size: 1.4rem;
  color: var(--text-muted);
}

.faq-item.is-open .faq-icon {
  color: var(--primary);
}

.faq-answer {
  padding: 0 24px 20px 24px;
  font-size: 0.95rem;
  color: var(--text-medium);
  line-height: 1.6;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-light);
}

/* Assistance Form */
.contact-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 60px;
  align-items: center;
}

.contact-hotline-card {
  background-color: var(--bg-light);
  border: 1.5px dashed var(--primary);
  border-radius: var(--radius-md);
  padding: 24px;
  margin-top: 30px;
}

.contact-hotline-card h4 {
  font-size: 0.95rem;
  color: var(--text-medium);
  margin-bottom: 6px;
}

.contact-hotline-card h3 {
  font-size: 2rem;
  font-weight: 800;
  color: var(--primary);
}

.contact-hotline-card p {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.contact-form-wrap {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 40px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
}

.assistance-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-medium);
}

.form-group input, .form-group textarea {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  background-color: var(--bg-light);
  transition: var(--transition);
}

.form-group input:focus, .form-group textarea:focus {
  border-color: var(--secondary);
  background-color: var(--white);
  box-shadow: var(--shadow-sm);
}

.btn-submit-form {
  margin-top: 10px;
}

/* Chatbot Style */
.chatbot-toggle-btn {
  position: fixed;
  bottom: 30px;
  right: 30px;
  background-color: var(--primary);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 30px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(74, 103, 65, 0.4);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 999;
  transition: var(--transition);
}

.chatbot-toggle-btn:hover {
  background-color: var(--primary-dark);
  transform: scale(1.05);
}

.bot-icon {
  font-size: 1.2rem;
}

.chatbot-popup {
  position: fixed;
  bottom: 90px;
  right: 30px;
  width: 380px;
  height: 520px;
  background-color: var(--white);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  opacity: 0;
  transform: translateY(20px) scale(0.95);
  pointer-events: none;
  transition: var(--transition);
}

.chatbot-popup.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.chatbot-header {
  background-color: var(--primary);
  color: white;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top-left-radius: var(--radius-md);
  border-top-right-radius: var(--radius-md);
}

.chatbot-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bot-avatar {
  font-size: 1.6rem;
}

.chatbot-title h4 {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.2;
}

.chatbot-title p {
  font-size: 0.72rem;
  opacity: 0.8;
}

.close-bot-btn {
  background: none;
  border: none;
  color: white;
  font-size: 1.8rem;
  cursor: pointer;
  line-height: 1;
}

.chatbot-messages {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #F8FBF8;
}

.chat-msg {
  display: flex;
  max-width: 80%;
}

.chat-msg.bot {
  align-self: flex-start;
}

.chat-msg.user {
  align-self: flex-end;
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  line-height: 1.4;
  word-break: break-word;
}

.bot .msg-bubble {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  color: var(--text-dark);
  border-top-left-radius: 2px;
}

.user .msg-bubble {
  background-color: var(--secondary);
  color: white;
  border-top-right-radius: 2px;
}

.chatbot-quick-questions {
  padding: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  background-color: var(--white);
  border-top: 1px solid var(--border-color);
}

.quick-q-btn {
  background-color: var(--bg-light);
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--primary);
  border-radius: 20px;
  cursor: pointer;
  transition: var(--transition);
}

.quick-q-btn:hover {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

.chatbot-input-area {
  padding: 12px;
  display: flex;
  gap: 8px;
  background-color: var(--white);
  border-top: 1px solid var(--border-color);
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}

.chatbot-input-area input {
  flex: 1;
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  border-radius: 20px;
  outline: none;
  font-family: inherit;
  font-size: 0.85rem;
}

.chatbot-input-area input:focus {
  border-color: var(--secondary);
}

.send-bot-btn {
  background-color: var(--primary);
  color: white;
  border: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--transition);
}

.send-bot-btn:hover {
  background-color: var(--primary-dark);
}

/* Response and Layout adjustments */
@media (max-width: 1024px) {
  .hero-title { font-size: 2.6rem; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .news-main-grid { grid-template-columns: 1fr; }
  .role-grid { grid-template-columns: 1fr; }
  .models-grid { grid-template-columns: 1fr; }
  .legal-container { grid-template-columns: 1fr; }
  .media-grid { grid-template-columns: 1fr; }
  .contact-container { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .hero-title { font-size: 2rem; }
  .featured-img-wrap { height: 260px; }
  .role-card { flex-direction: column; align-items: center; text-align: center; }
  .book-cover { width: 100%; max-width: 300px; height: 380px; }
  .video-placeholder { height: 240px; }
  .contact-form-wrap { padding: 24px; }
  .form-row { grid-template-columns: 1fr; }
  .chatbot-popup { width: 90vw; right: 5vw; left: 5vw; }
}
</style>
