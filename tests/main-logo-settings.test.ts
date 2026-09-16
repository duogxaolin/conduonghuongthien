/**
 * Kiểm tra tính năng Main Logo (Logo Tổng Cục / Đơn vị chủ quản)
 * và quan hệ hiển thị với Logo Website con (tỷ lệ 80%).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

test('main_logo_url được phép ghi qua endpoint cài đặt admin', () => {
  const code = read('server/api/admin/settings/index.put.ts')
  assert.match(code, /'main_logo_url'/, 'thiếu main_logo_url trong ALLOWED_SETTING_KEYS')
})

test('main_logo_url không bị khóa bởi SUPERADMIN_ONLY_KEYS', () => {
  const code = read('server/api/admin/settings/index.put.ts')
  const gated = /const SUPERADMIN_ONLY_KEYS = new Set\(\[([^\]]*)\]\)/.exec(code)?.[1] ?? ''
  assert.doesNotMatch(gated, /main_logo_url/, 'main_logo_url không chứa script nên không phải superadmin only')
})

test('main_logo_url được phát ra cho trang công khai trong settings.get.ts', () => {
  const code = read('server/api/public/settings.get.ts')
  assert.match(code, /'main_logo_url'/, 'thiếu main_logo_url trong allowedKeys của endpoint public settings')
})

test('main_logo_url có mặt trong danh sách seed mặc định', () => {
  const code = read('server/db/seed.ts')
  assert.match(code, /key:\s*'main_logo_url'/, 'thiếu key main_logo_url trong defaultSettings của seed.ts')
})

test('admin general settings quản lý ô nhập main_logo_url và xem trước phối hợp', () => {
  const code = read('app/pages/admin/settings/general.vue')
  assert.match(code, /main_logo_url:\s*''/, 'thiếu main_logo_url trong reactive settings')
  assert.match(code, /type ImageField = [^;]*'main_logo_url'/, 'ImageField cần hỗ trợ main_logo_url để chọn ảnh / tải ảnh')
  assert.match(code, /v-model="settings\.main_logo_url"/, 'thiếu input v-model cho main_logo_url')
  assert.match(code, /pickImage\('main_logo_url'\)/, 'thiếu nút chọn thư viện cho main_logo_url')
  assert.match(code, /uploadImage\(e,\s*'main_logo_url'\)/, 'thiếu nút upload cho main_logo_url')
  assert.match(code, /Xem trước phối hợp Logo/, 'thiếu khối xem trước trực quan trong admin general')
})

test('layout default hiển thị main logo bên trái và logo con tỉ lệ nhỏ hơn khi có main logo', () => {
  const code = read('app/layouts/default.vue')
  // Script có computed
  assert.match(code, /siteMainLogo = computed\(/, 'thiếu computed siteMainLogo trong default.vue')
  assert.match(code, /siteLogo = computed\(/, 'thiếu computed siteLogo trong default.vue')

  // Header: Main logo to hơn (56px) và logo con nhỏ hơn (38px ~ 70-80%)
  assert.match(code, /:src="siteMainLogo"/, 'header thiếu binding :src="siteMainLogo"')
  assert.match(code, /h-10 lg:h-\[56px\]/, 'main logo header phải to nổi bật')
  assert.match(code, /siteMainLogo \? 'h-7 lg:h-\[38px\]' : 'h-9 lg:h-\[50px\]'/, 'logo con chưa hạ tỷ lệ khi có main logo')

  // Footer: 2 logo ở footer to hơn nổi bật (h-16 md:h-[72px] cho main, h-12 md:h-[52px] cho logo con)
  assert.match(code, /h-16 md:h-\[72px\]/, 'main logo footer phải to nổi bật')
  assert.match(code, /siteMainLogo \? 'h-12 md:h-\[52px\]' : 'h-14 md:h-16'/, 'logo con footer to rõ và tương xứng tỷ lệ')
})

test('layout default và login vẫn hiển thị đúng nếu thiếu 1 trong 2 logo', () => {
  const layout = read('app/layouts/default.vue')
  // Vẫn bao bọc v-if và chỉ hiện divider khi CẢ HAI cùng tồn tại
  assert.match(layout, /v-if="siteMainLogo \|\| siteLogo"/, 'thiếu bọc an toàn v-if khi thiếu cả 2 logo')
  assert.match(layout, /v-if="siteMainLogo && siteLogo"/, 'divider chỉ được hiển thị khi cả 2 logo đều có mặt')
  assert.match(layout, /v-if="siteLogo"/, 'logo con phải có v-if riêng để không bị vỡ ảnh khi không có logo con')

  // Admin login page cũng hỗ trợ logo kép và fallback an toàn
  const login = read('app/pages/admin/login.vue')
  assert.match(login, /v-if="siteMainLogo \|\| siteLogo"/, 'login page thiếu bọc dual logo')
  assert.match(login, /v-if="siteMainLogo && siteLogo"/, 'login page divider chỉ hiện khi có cả 2')
})
