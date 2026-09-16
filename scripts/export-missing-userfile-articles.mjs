import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const articlesPath = resolve('.migrate/import-articles.json')
const articles = JSON.parse(readFileSync(articlesPath, 'utf8'))

// 1. Build comprehensive disk index of all available images
const availableImages = new Set()

function addFilesFromDir(dirPath) {
  if (!existsSync(dirPath)) return
  try {
    for (const f of readdirSync(dirPath, { withFileTypes: true })) {
      if (f.isFile()) {
        availableImages.add(f.name.toLowerCase())
      } else if (f.isDirectory()) {
        addFilesFromDir(resolve(dirPath, f.name))
      }
    }
  } catch (e) {
    // ignore
  }
}

addFilesFromDir(resolve('public/uploads/migrated'))
addFilesFromDir(resolve('old-data/UserFile/editor/images'))
addFilesFromDir(resolve('old-data/UserFile/News/Main'))

console.log(`Total available image files indexed: ${availableImages.size}`)

// Regex to capture image references
const refRe = /\/UserFile\/[^\s"'<>]+\/([^"'?\s\\<>]+)/g

const missingArticles = []
const missingImagesMap = new Map()

for (const a of articles) {
  const content = a.body || ''
  let m
  const articleMissing = []
  
  // Also check defaultPic if any
  if (a.defaultPic && typeof a.defaultPic === 'string') {
    const base = a.defaultPic.split('/').pop()?.toLowerCase()
    if (base && !availableImages.has(base)) {
      articleMissing.push(`[Ảnh đại diện] ${a.defaultPic}`)
      missingImagesMap.set(base, (missingImagesMap.get(base) || 0) + 1)
    }
  }

  while ((m = refRe.exec(content))) {
    const orig = decodeURIComponent(m[1])
    const base = orig.split('/').pop() || orig
    const low = base.toLowerCase().trim()
    if (low && !availableImages.has(low)) {
      if (!articleMissing.includes(orig)) {
        articleMissing.push(orig)
      }
      missingImagesMap.set(low, (missingImagesMap.get(low) || 0) + 1)
    }
  }

  if (articleMissing.length > 0) {
    missingArticles.push({
      id: a.id,
      title: a.title,
      catName: a.catName || '',
      status: a.status || 'published',
      oldUrl: a.oldUrl || '',
      missingCount: articleMissing.length,
      missingImages: articleMissing
    })
  }
}

console.log(`Articles with missing image files: ${missingArticles.length}`)
console.log(`Distinct missing image filenames: ${missingImagesMap.size}`)
console.log(`Total missing occurrences: ${missingArticles.reduce((s, a) => s + a.missingCount, 0)}`)

// Write CSV report
const csvRows = ['"ID Bài viết","Tiêu đề","Chuyên mục","Trạng thái","Số ảnh thiếu","Chi tiết tên ảnh thiếu","Đường dẫn cũ"']
for (const a of missingArticles) {
  const t = (a.title || '').replace(/"/g, '""')
  const c = (a.catName || '').replace(/"/g, '""')
  const imgs = a.missingImages.join('; ').replace(/"/g, '""')
  const u = (a.oldUrl || '').replace(/"/g, '""')
  csvRows.push(`"${a.id}","${t}","${c}","${a.status}","${a.missingCount}","${imgs}","${u}"`)
}

writeFileSync('docs/migration-unresolved-images-report.csv', '\uFEFF' + csvRows.join('\r\n'), 'utf8')

// Write Markdown summary report
const md = `# Báo cáo Tổng hợp Bài viết Thiếu Ảnh Nguồn (Sau Di Trú Cổng Cũ)

- **Thời gian xuất báo cáo**: ${new Date().toISOString().split('T')[0]}
- **Tổng số bài viết rà soát**: ${articles.length} bài
- **Số bài viết có ảnh không tìm thấy file nguồn**: **${missingArticles.length}** bài
- **Số tệp ảnh riêng biệt bị thiếu**: **${missingImagesMap.size}** tệp
- **File chi tiết**: [\`docs/migration-unresolved-images-report.csv\`](file:///D:/code/conduonghuongthien/docs/migration-unresolved-images-report.csv)

## Hướng dẫn xử lý cho Ban biên tập:
1. Mở file CSV bằng Excel (đã kèm BOM UTF-8 không lỗi font tiếng Việt).
2. Tra cứu theo **ID Bài viết** hoặc **Tiêu đề** trong trang Quản trị Admin (\`/admin/content/articles\`).
3. Mở bài viết, kiểm tra vị trí các ảnh bị thiếu (hiện khung ảnh trống hoặc liên kết cũ) và tải ảnh mới từ máy lên thay thế.

## Top 20 ảnh thiếu xuất hiện nhiều nhất:
| Tên tệp ảnh | Số bài viết bị ảnh hưởng |
| :--- | :--- |
${[...missingImagesMap.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([name, count]) => `| \`${name}\` | ${count} bài |`)
  .join('\n')}
`

writeFileSync('docs/migration-unresolved-images-report.md', md, 'utf8')
console.log('Saved report to docs/migration-unresolved-images-report.md & csv')
