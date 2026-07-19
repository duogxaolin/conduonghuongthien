<template>
  <div class="legal-docs-page section-bg">
    <!-- Hero Header -->
    <section class="docs-hero">
      <div class="docs-hero-overlay"></div>
      <div class="container">
        <h2 class="docs-hero-title">Văn Bản Quy Phạm Pháp Luật</h2>
        <p class="docs-hero-subtitle">Tra cứu các nghị định, chính sách, chỉ thị về công tác quản lý thi hành án hình sự và tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <div class="container docs-container">
        <div class="docs-main-list">
          <SectionBar icon="📜" title="Văn bản pháp luật mới" />
          <div class="search-bar-wrap">
            <input type="text" placeholder="Nhập từ khóa tìm kiếm văn bản (Ví dụ: 49/2020, vay vốn, xóa án tích...)" v-model="searchQuery" />
            <button class="btn btn-primary">Tìm kiếm</button>
          </div>

          <div class="docs-table-wrap">
            <table class="docs-table">
              <thead>
                <tr>
                  <th width="15%">Số ký hiệu / Ngày</th>
                  <th width="55%">Trích yếu nội dung</th>
                  <th width="20%">Cơ quan ban hành</th>
                  <th width="10%">Tải về</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="doc in filteredDocs" :key="doc.id">
                  <td class="doc-meta">
                    <strong>{{ doc.code }}</strong>
                    <span>{{ doc.date }}</span>
                  </td>
                  <td class="doc-title">
                    <a href="#">{{ doc.title }}</a>
                  </td>
                  <td class="doc-org">{{ doc.org }}</td>
                  <td class="doc-download">
                    <a href="#" class="download-link">📄 PDF</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

useSeoMeta({
  title: 'Văn bản pháp luật | Con Đường Hướng Thiện',
  description: 'Tra cứu văn bản quy phạm pháp luật về thi hành án hình sự, chính sách tín dụng và tái hòa nhập cộng đồng.'
})

const searchQuery = ref('')

const docs = [
  {
    id: 1,
    code: 'Nghị định 49/2020/NĐ-CP',
    date: '17/04/2020',
    title: 'Nghị định quy định chi tiết thi hành Luật Thi hành án hình sự về các biện pháp bảo đảm tái hòa nhập cộng đồng đối với người chấp hành xong án phạt tù.',
    org: 'Chính phủ',
  },
  {
    id: 2,
    code: 'Quyết định 22/2023/QĐ-TTg',
    date: '17/08/2023',
    title: 'Quyết định của Thủ tướng Chính phủ về chính sách tín dụng đối với người chấp hành xong án phạt tù vay vốn ưu đãi tại Ngân hàng Chính sách Xã hội.',
    org: 'Thủ tướng Chính phủ',
  },
  {
    id: 3,
    code: 'Thông tư 12/2022/TT-BTTTT',
    date: '12/08/2022',
    title: 'Thông tư quy định chi tiết và hướng dẫn về các yêu cầu, tiêu chuẩn kỹ thuật trong xây dựng hồ sơ thiết kế an toàn thông tin cấp độ mạng.',
    org: 'Bộ Thông tin & Truyền thông',
  },
  {
    id: 4,
    code: 'Luật số 41/2019/QH14',
    date: '14/06/2019',
    title: 'Luật Thi hành án hình sự năm 2019 của Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.',
    org: 'Quốc hội',
  }
]

const filteredDocs = computed(() => {
  if (searchQuery.value.trim() === '') {
    return docs
  }
  const cleanQ = searchQuery.value.toLowerCase()
  return docs.filter(doc => 
    doc.code.toLowerCase().includes(cleanQ) || 
    doc.title.toLowerCase().includes(cleanQ) || 
    doc.org.toLowerCase().includes(cleanQ)
  )
})
</script>

<style scoped>
.docs-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.docs-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.docs-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.docs-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.search-bar-wrap {
  display: flex;
  gap: 12px;
  margin-bottom: 30px;
  background-color: var(--white);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}

.search-bar-wrap input {
  flex: 1;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  font-family: inherit;
  font-size: 0.95rem;
}

.search-bar-wrap input:focus {
  border-color: var(--secondary);
}

.docs-table-wrap {
  background-color: var(--white);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  overflow-x: auto;
}

.docs-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.docs-table th, .docs-table td {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.9rem;
}

.docs-table th {
  background-color: var(--bg-light);
  color: var(--primary);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.8rem;
  letter-spacing: 0.5px;
}

.doc-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.doc-meta strong {
  color: var(--primary);
  font-size: 0.88rem;
}

.doc-meta span {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.doc-title a {
  text-decoration: none;
  color: var(--text-dark);
  font-weight: 600;
  line-height: 1.4;
  transition: var(--transition);
}

.doc-title a:hover {
  color: var(--primary);
}

.doc-org {
  color: var(--text-medium);
  font-weight: 500;
}

.download-link {
  color: #D32F2F;
  text-decoration: none;
  font-weight: 700;
}

.download-link:hover {
  text-decoration: underline;
}
</style>
