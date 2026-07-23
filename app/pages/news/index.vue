<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Bản Tin Hoạt Động</h2>
        <p class="text-[1.1rem] opacity-90">Cập nhật tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương trên toàn quốc</p>
      </div>
    </section>

    <!-- Main Content Grid -->
    <section class="section">
      <div class="container grid grid-cols-1 lg:grid-cols-[1fr_3fr] gap-[30px]">
        <!-- Filter Sidebar -->
        <aside>
          <div class="bg-white p-6 rounded-lg border border-[#E2E8DF] shadow-sm sticky top-[100px]">
            <h4 class="text-[0.9rem] font-bold text-[#4A6741] mb-4 border-b-2 border-[#E2E8DF] pb-2">DANH MỤC TIN TỨC</h4>
            <ul class="list-none flex flex-col gap-2 p-0 m-0">
              <li>
                <button
                  :class="activeCategory === 'all' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory('all')"
                >Tất cả bản tin</button>
              </li>
              <li>
                <button
                  :class="activeCategory === 'tin-noi-bat' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory('tin-noi-bat')"
                >Tin nổi bật</button>
              </li>
              <li>
                <button
                  :class="activeCategory === 'tin-hoat-dong' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory('tin-hoat-dong')"
                >Tin hoạt động</button>
              </li>
              <li>
                <button
                  :class="activeCategory === 'tin-dia-phuong' ? 'bg-[#F8FAF7] text-[#4A6741] !pl-[18px]' : 'text-[#4A5545]'"
                  class="w-full text-left bg-transparent border-0 px-[14px] py-[10px] text-[0.9rem] font-semibold rounded cursor-pointer transition-all duration-300 hover:bg-[#F8FAF7] hover:text-[#4A6741] hover:pl-[18px]"
                  @click="setCategory('tin-dia-phuong')"
                >Tin địa phương</button>
              </li>
            </ul>
          </div>
        </aside>

        <!-- News List -->
        <div class="flex flex-col gap-6">
          <SectionBar icon="fa-solid fa-newspaper" title="Bản tin hoạt động" />
          <div
            v-if="searchQuery"
            class="bg-[#F8FAF7] border border-[#E2E8DF] border-l-4 border-l-[#7CB342] px-[18px] py-[14px] rounded text-[0.92rem] text-[#4A5545] flex items-center justify-between gap-3 flex-wrap"
          >
            Kết quả tìm kiếm cho từ khóa: <strong>&laquo;{{ searchQuery }}&raquo;</strong>
            <button
              class="bg-transparent border border-[#E2E8DF] rounded-[20px] px-3 py-[5px] text-[0.8rem] font-bold text-[#4A5545] cursor-pointer transition-all duration-300 hover:bg-[#4A6741] hover:border-[#4A6741] hover:text-white"
              @click="clearSearch"
            >✕ Bỏ tìm kiếm</button>
          </div>
          <div
            v-if="filteredNews.length === 0"
            class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]"
          >
            Không tìm thấy bản tin phù hợp. Vui lòng thử từ khóa khác hoặc xem <nuxt-link to="/news" class="text-[#4A6741] font-bold">tất cả bản tin</nuxt-link>.
          </div>
          <div
            v-for="item in filteredNews"
            :key="item.id"
            class="flex flex-col sm:flex-row bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="w-full sm:w-[260px] h-[200px] sm:h-[180px] flex-shrink-0">
              <img :src="item.image" :alt="item.title" class="w-full h-full object-cover" />
            </div>
            <div class="p-6 flex flex-col justify-between">
              <span class="text-[0.8rem] text-[#7A8675] font-semibold mb-1.5 block">{{ item.date }} • {{ item.categoryName }}</span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-2">
                <nuxt-link
                  :to="`/news/${item.slug}`"
                  class="no-underline text-[#1E251C] transition-all duration-300 hover:text-[#4A6741]"
                >{{ item.title }}</nuxt-link>
              </h3>
              <p class="text-[0.88rem] text-[#4A5545] leading-[1.5] mb-3">{{ item.excerpt }}</p>
              <nuxt-link
                :to="`/news/${item.slug}`"
                class="text-[#7CB342] font-bold no-underline text-[0.88rem] self-start"
              >Xem chi tiết &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

useSeoMeta({
  title: 'Bản tin hoạt động | Con Đường Hướng Thiện',
  description: 'Tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương, tái hòa nhập cộng đồng trên toàn quốc.'
})

const route = useRoute()
const activeCategory = ref('all')
const searchQuery = ref('')

const newsItems = [
  {
    id: 1,
    title: 'ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN',
    slug: 'da-nang-doi-thoai-giam-thi-pham-nhan',
    category: 'tin-noi-bat',
    categoryName: 'Tin nổi bật',
    date: '17/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 để kịp thời tháo gỡ vướng mắc, động viên cải tạo.'
  },
  {
    id: 2,
    title: 'QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm',
    slug: 'quang-ninh-van-don-ho-tro-viec-lam',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Nhằm tạo điều kiện tốt nhất cho người chấp hành xong án phạt tù xóa bỏ tự ti và có thu nhập ổn định, Công an đặc khu Vân Đồn phối hợp cơ quan chức năng tổ chức sàn giao dịch hướng nghiệp kết nối trực tiếp doanh nghiệp.'
  },
  {
    id: 3,
    title: 'CÔNG AN TỈNH LÂM ĐỒNG THĂM HỎI, TẶNG QUÀ, ĐỘNG VIÊN NGƯỜI ĐƯỢC ĐẶC XÁ CÓ HOÀN CẢNH KHÓ KHĂN',
    slug: 'lam-dong-tham-hoi-tang-qua-dac-xa',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '17/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Phòng Cảnh sát thi hành án hình sự và hỗ trợ tư pháp Công an tỉnh Lâm Đồng phối hợp với Công an các địa bàn tổ chức thăm hỏi, trao tặng các phần quà hỗ trợ thiết thực động viên tinh thần người chấp hành đặc xá vươn lên.'
  },
  {
    id: 4,
    title: 'QUẢNG NINH: Công an phường Móng Cái 3 tăng cường công tác cảm hóa, giáo dục thi hành án hình sự tại cộng đồng',
    slug: 'mong-cai-tang-cuong-cam-hoa-giao-duc',
    category: 'tin-dia-phuong',
    categoryName: 'Tin địa phương',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Tăng cường điểm danh, kiểm diện và lập hồ sơ theo dõi sát sao, kết hợp rà soát hoàn cảnh gia đình để có phương hướng cảm hóa giáo dục phù hợp, phòng ngừa tái phạm tội trên địa bàn phường Móng Cái 3.'
  },
  {
    id: 5,
    title: 'CẦN THƠ: Điểm tựa tín dụng cho người hoàn lương tái hòa nhập',
    slug: 'can-tho-diem-tua-tin-dung',
    category: 'tin-noi-bat',
    categoryName: 'Tin nổi bật',
    date: '16/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Triển khai chính sách tín dụng ưu đãi từ Ngân hàng Chính sách Xã hội theo Quyết định 22/2023/QĐ-TTg, giúp hàng chục hộ gia đình người hoàn lương tại Cần Thơ tiếp cận nguồn vốn ưu đãi 100 triệu đồng để mở rộng làm ăn.'
  },
  {
    id: 6,
    title: 'LÂM ĐỒNG: Sơ kết công tác quản lý giam giữ, thi hành án hình sự và hỗ trợ tư pháp 6 tháng đầu năm 2026',
    slug: 'lam-dong-so-ket-cong-tac',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '16/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Công an tỉnh Lâm Đồng sơ kết đánh giá kết quả triển khai công tác quản lý giam giữ và hỗ trợ tái hòa nhập cộng đồng 6 tháng đầu năm, đề ra phương hướng chỉ đạo sát sao cho 6 tháng cuối năm.'
  }
]

const filteredNews = computed(() => {
  let list = activeCategory.value === 'all'
    ? newsItems
    : newsItems.filter(item => item.category === activeCategory.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.excerpt.toLowerCase().includes(q) ||
      item.categoryName.toLowerCase().includes(q)
    )
  }
  return list
})

const setCategory = (cat) => {
  activeCategory.value = cat
}

const clearSearch = () => {
  searchQuery.value = ''
  navigateTo({ path: '/news', query: {} })
}

onMounted(() => {
  if (route.query.cat) {
    activeCategory.value = route.query.cat
  }
  if (route.query.q) {
    searchQuery.value = String(route.query.q)
  }
})
</script>
