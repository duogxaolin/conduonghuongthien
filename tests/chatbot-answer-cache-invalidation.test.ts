import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { CACHE_INPUT_TABLES, handlerWritesCacheInput } from './_cache-input-writes'

/**
 * Mọi đường ghi dữ liệu mà câu trả lời cache PHỤ THUỘC đều phải tăng
 * `chatbot_settings.answer_cache_version` (`bumpAnswerCacheVersion`).
 *
 * Vì sao là một cổng quét thư mục chứ không phải một danh sách tay: một endpoint mới ghi
 * kho kiến thức, small-talk, bài viết hay cấu hình AI mà quên tăng phiên bản thì cache
 * tiếp tục phát lại câu trả lời của dữ liệu cũ — không lỗi, không log, chỉ là người dân
 * nhận thông tin đã sửa. Danh sách tay xanh vĩnh viễn với tệp nó chưa biết.
 *
 * Ranh giới của phép đo (đọc kỹ trước khi thêm ngoại lệ):
 *   - chỉ quét `server/api/admin/**` — mọi đường ghi dữ liệu nền đi qua admin API (job đồng bộ
 *     media nền: handler tăng phiên bản khi promise `finished` của worker xong);
 *   - "ghi dữ liệu nền" = code CHẠY TỚI ĐƯỢC từ handler (kể cả qua `server/services/**` /
 *     `server/utils/**`, `tests/_cache-input-writes.ts`) có thao tác ghi trên các bảng mà câu
 *     trả lời được dựng từ đó: kho kiến thức, small-talk, bài viết, ảnh/video, cấu hình AI;
 *   - bản dịch bài viết (không được nạp vào prompt chatbot) không thuộc phép đo này.
 *
 * Bản đầu của cổng chỉ đọc chữ trong CHÍNH tệp handler: `articles/bulk-status`,
 * `articles/bulk-delete` và `small-talk/[id]/toggle` ghi qua service, không tăng phiên bản,
 * cổng vẫn xanh (2026-11-06); ảnh/video còn không nằm trong danh sách bảng.
 */

const root = path.resolve(import.meta.dirname, '..')

/**
 * Tệp ghi vào một bảng nằm trong khoá cache nhưng CHỦ ĐÍCH không tăng phiên bản.
 * Mỗi dòng phải nói vì sao câu trả lời đã cache vẫn đúng sau lượt ghi đó.
 */
const EXEMPT: Record<string, string> = {
  'server/api/admin/articles/[id]/boost.post.ts':
    'chỉ đổi lượt xem (boost); công cụ tra bài không đọc hay sắp xếp theo lượt xem',
  'server/api/admin/articles/bulk-comments.post.ts':
    'chỉ bật/tắt bình luận của bài; không cột nào đi vào câu trả lời',
  'server/api/admin/chatbot/settings/index.get.ts':
    'chỉ tạo hàng cấu hình mặc định khi chưa có — chưa có hàng đó thì cũng chưa có phiên bản/hàng cache nào',
  // Tạo MỚI ảnh/video: link trong câu đã cache vẫn đúng, nhưng công cụ ảnh/video trả mục MỚI NHẤT trước
  // (`chat-policy-provider.ts`, 4 ảnh/3 video) nên câu sinh lại có thể nhắc mục mới — câu đã cache thì không,
  // tới lần tăng kế tiếp hoặc TTL. Chấp nhận có chủ đích: ảnh được tải lên liên tục (mỗi bài viết), tăng ở mỗi
  // lượt tải làm cache gần như vô dụng. Bài viết mới thì có tăng (`articles/index.post.ts`).
  'server/api/admin/livestream/[id]/recording.post.ts':
    'tạo video MỚI từ buổi phát — câu đã cache chỉ thiếu mục mới (đánh đổi có chủ đích, xem trên)',
  'server/api/admin/media-portal/external.post.ts':
    'tạo video MỚI (nguồn ngoài) — câu đã cache chỉ thiếu mục mới (đánh đổi có chủ đích, xem trên)',
  'server/api/admin/media-portal/[id]/process.post.ts':
    'chỉ xếp hàng chuyển mã lại (đặt lại trạng thái xử lý); giữ `storagePath`/`thumbnailUrl`, bản mới ghi đè cùng '
    + 'vị trí — đường dẫn /media/<id> và tiêu đề không đổi (`media-processing-queue.ts`)',
  'server/api/admin/media/upload.post.ts':
    'tải ảnh MỚI lên — câu đã cache chỉ thiếu mục mới (đánh đổi có chủ đích, xem trên)',
  'server/api/admin/media/scan.post.ts':
    'job quét chỉ NHẬP ảnh mới (kể cả tự đẩy R2 lúc nhập); hàng đã có chỉ được ghi cột đánh dấu `scanned_source_path`, '
    + 'không viết lại URL nào (`media-scan-import.ts`)',
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : []
  })
}

const rel = (full: string) => path.relative(root, full).split(path.sep).join('/')

/** Code với chú thích bị bỏ: một chú thích nhắc tên hàm không phải một lời gọi. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Handler tự gọi `bumpAnswerCacheVersion()` — SAU lượt ghi, ngoài transaction (xem `chatbot-answer-cache.ts`). */
const bumps = (name: string) => /\bbumpAnswerCacheVersion\s*\(/u.test(code(readFileSync(path.join(root, name), 'utf8')))
const writesCacheInput = (name: string) => handlerWritesCacheInput(path.join(root, name))

const handlers = files(path.join(root, 'server/api/admin')).map(rel)

test('the scan sees the admin write paths it is meant to check', () => {
  assert.ok(handlers.length > 200, `only ${handlers.length} admin handlers found`)
  for (const file of [
    'server/api/admin/chatbot/knowledge/[id].put.ts',
    'server/api/admin/chatbot/small-talk/[id].put.ts',
    'server/api/admin/articles/[id].put.ts',
    'server/api/admin/chatbot/settings/index.patch.ts',
  ]) {
    assert.ok(handlers.includes(file), `${file} not scanned`)
  }
})

test('the reachability walk sees writes made through a service, not only in the handler file', () => {
  // Ba lỗ của bản regex: mỗi handler chỉ gọi một hàm service, chữ `articles`/`chatbotSmallTalk`
  // không xuất hiện trong tệp handler.
  for (const name of [
    'server/api/admin/articles/bulk-status.post.ts',
    'server/api/admin/articles/bulk-delete.post.ts',
    'server/api/admin/chatbot/small-talk/[id]/toggle.patch.ts',
    'server/api/admin/media/[id].delete.ts',
  ]) assert.ok(writesCacheInput(name), `${name} not seen as a cache-input write`)
  // SQL với tên bảng là biểu thức (`UPDATE ${target.table}`): bỏ bump ở hai tệp này từng để cổng xanh.
  for (const name of ['server/api/admin/media/repoint-r2-urls.post.ts', 'server/api/admin/media/sync-storage.post.ts']) {
    assert.ok(writesCacheInput(name), `${name}: dynamic-table SQL not seen as a write`)
  }
  // Chính lời gọi tăng phiên bản không phải lượt ghi: tệp chỉ xoá cache + tăng phiên bản không bị tính là ghi.
  assert.equal(writesCacheInput('server/api/admin/chatbot/answer-cache/clear-all.post.ts'), false, 'the bump itself counted as a write')
  // Đọc thuần không bị tính là ghi.
  for (const name of ['server/api/admin/articles/index.get.ts', 'server/api/admin/chatbot/knowledge/index.get.ts']) {
    assert.ok(handlers.includes(name), `${name} not scanned`)
    assert.equal(writesCacheInput(name), false, `${name} counted as a write`)
  }
  for (const table of ['media', 'mediaItems']) assert.ok(CACHE_INPUT_TABLES.has(table), `${table} (photo/video tools) is not a cache input`)
})

test('every admin handler that writes a cache-input table bumps the answer-cache version', () => {
  const missing = handlers.filter(name => writesCacheInput(name) && !bumps(name) && !EXEMPT[name])
  assert.deepEqual(
    missing,
    [],
    'these admin handlers change data a cached answer depends on but never bump '
    + '`chatbot_settings.answer_cache_version` — call `bumpAnswerCacheVersion()` after the write, '
    + 'or name the file in EXEMPT with the reason the cached answer stays correct. '
    + 'A hand-written list is green forever for files it has never heard of; this gate walks '
    + 'the directory precisely because of that.',
  )
})

test('an exemption is not stale: each named file still writes a cache-input table', () => {
  const stale: string[] = []
  for (const name of Object.keys(EXEMPT)) {
    if (!handlers.includes(name)) {
      stale.push(`${name} — file no longer exists`)
      continue
    }
    if (!writesCacheInput(name)) stale.push(`${name} — no longer writes a cache-input table`)
    if (bumps(name)) stale.push(`${name} — now bumps the version, drop the exemption`)
  }
  assert.deepEqual(stale, [], 'a named exemption that stopped applying is how a gate quietly widens')
})

test('the article write paths bump the version in the handler, not only in a service', () => {
  for (const name of [
    'server/api/admin/articles/[id].put.ts',
    'server/api/admin/articles/[id].delete.ts',
    'server/api/admin/articles/index.post.ts',
    'server/api/admin/articles/bulk-status.post.ts',
    'server/api/admin/articles/bulk-delete.post.ts',
  ]) {
    const source = readFileSync(path.join(root, name), 'utf8')
    assert.match(source, /await bumpAnswerCacheVersion\(\)/u, `${name} does not bump`)
  }
})
