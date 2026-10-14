/**
 * Hợp đồng giao diện cho lượt đọc công khai HỎNG (PR-7).
 *
 * GIỚI HẠN — đọc trước khi tin một lượt xanh: các khẳng định dưới đây đọc văn bản
 * SFC, không mount component. Chúng chứng minh nhánh lỗi + nút thử lại + lượt tải
 * lại khi mount + chốt "hỏng ≠ 404" còn NẰM trong tệp, và đỏ nếu ai xoá chúng khi
 * tái cấu trúc; chúng không chứng minh nhánh đó hiện ra đúng trong trình duyệt.
 * Phía máy chủ (503 + log thay cho 200 rỗng) có test hành vi thật:
 * tests/public-read-failure-behavior.test.ts.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8')

const ARTICLE_BLOCKS = [
  'components/blocks/NewsBlock.vue',
  'components/blocks/RoleModelsBlock.vue',
  'components/blocks/ReintegrationBlock.vue',
  'components/blocks/DocumentsBlock.vue',
]

test('nhánh lỗi dùng chung mang role="alert" và một nút thử lại thật', () => {
  const source = read('components/blocks/BlockLoadError.vue')
  assert.match(source, /role="alert"/)
  assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?@click="emit\('retry'\)"/)
  // Biểu tượng quay chỉ quay khi người dùng không yêu cầu giảm chuyển động.
  assert.match(source, /animate-spin motion-reduce:animate-none/)
})

for (const file of ARTICLE_BLOCKS) {
  test(`${file}: lượt tải hỏng hiện nhánh lỗi có thử lại, không phải "chưa có bài"`, () => {
    const source = read(file)
    assert.match(source, /import BlockLoadError from '\.\/BlockLoadError\.vue'/)
    assert.match(source, /<BlockLoadError[\s\S]*?v-else-if="loadError"[\s\S]*?@retry="\(\) => refresh\(\)"/, 'nhánh lỗi gọi lại đúng `refresh` của lượt đã hỏng')
    assert.match(source, /const loadError = computed\(\(\) => !!error\.value\)/)
    // HTML mang nhánh lỗi có thể ra từ bộ đệm SWR — tải lại một lần lúc mount.
    assert.match(source, /onMounted\(\(\) => \{[\s\S]*?\|\| error\.value\) \{\s*void refresh\(\)/)
    // Nhánh lỗi đứng TRƯỚC nhánh rỗng: thứ tự v-else-if quyết định cái nào thắng.
    const errorAt = source.indexOf('v-else-if="loadError"')
    const emptyAt = Math.max(source.indexOf('_empty'), source.indexOf('block_docs_empty'))
    assert.ok(errorAt > 0 && errorAt < emptyAt, 'nhánh lỗi phải đứng trước nhánh "chưa có"')
  })
}

test('[slug].vue: lượt đọc hỏng không bao giờ thành 404, và có nhánh lỗi + thử lại', () => {
  const source = read('pages/[slug].vue')
  const isMissing = source.slice(source.indexOf('const isMissing = () => {'))
  const body = isMissing.slice(0, isMissing.indexOf('\n}\n'))
  assert.match(body, /if \(lookupFailed\.value\) return false/, 'isMissing phải từ chối kết luận 404 khi lượt đọc hỏng')
  assert.match(source, /const lookupFailed = computed\(\(\) => pageFetchFailed\.value \|\| \(pageMissConfirmed\.value && typesStatus\.value === 'error'\)\)/)
  assert.match(source, /if \(lookupFailed\.value\) return true/, 'isPageBranch nhường cho PageRenderer hiện nhánh lỗi')
  assert.match(source, /:on-retry="retryLookup"/)
  assert.match(source, /onMounted\(\(\) => \{\s*if \(lookupFailed\.value\) void retryLookup\(\)/)
})

for (const file of ['pages/index.vue', 'pages/about.vue', 'pages/contact.vue']) {
  test(`${file}: lượt SSR hỏng được tải lại một lần lúc mount`, () => {
    assert.match(read(file), /onMounted\(\(\) => \{\s*if \(currentLang\.value !== 'vi' \|\| error\.value\) \{\s*void refresh\(\)/)
  })
}
