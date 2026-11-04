import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

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
 *   - chỉ quét `server/api/admin/**` — mọi đường ghi dữ liệu nền đi qua admin API;
 *   - "ghi dữ liệu nền" = tệp có thao tác ghi trên ĐÚNG các bảng nằm trong khoá cache:
 *     `chatbot_knowledge`, `chatbot_small_talk`, `articles` và cấu hình AI
 *     (`chatbot_settings`, `ai_providers`, `ai_service_configs`);
 *   - handler CHỈ ĐỌC, đổi thứ không nằm trong khoá, và bản dịch bài viết (không được nạp
 *     vào prompt chatbot) không thuộc phép đo này.
 */

const root = path.resolve(import.meta.dirname, '..')

/** Bảng (tên cột Drizzle) mà nội dung đi vào câu trả lời hoặc vào khoá cache. */
const CACHE_INPUTS = ['chatbotKnowledge', 'chatbotSmallTalk', 'articles', 'chatbotSettings', 'aiProviders', 'aiServiceConfigs']

/**
 * Tệp ghi vào một bảng nằm trong khoá cache nhưng CHỦ ĐÍCH không tăng phiên bản.
 * Mỗi dòng phải nói vì sao câu trả lời đã cache vẫn đúng sau lượt ghi đó.
 */
const EXEMPT: Record<string, string> = {
  // Hiện KHÔNG có tệp nào cần miễn: mọi handler ghi vào bảng nằm trong khoá cache đều
  // tăng phiên bản. Giữ bảng rỗng để một ngoại lệ sau này phải kèm lý do, và cổng
  // "exemption is not stale" sẽ đỏ nếu mục đó thôi đúng.
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : []
  })
}

const rel = (full: string) => path.relative(root, full).split(path.sep).join('/')

/** Code với chú thích bị bỏ: một chú thích nhắc tên bảng không phải một lượt ghi. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Ghi vào một bảng nằm trong khoá cache: `.insert|.update|.delete(<table>…`. */
function writesCacheInput(source: string): boolean {
  const body = code(source)
  return CACHE_INPUTS.some(table => new RegExp(`\\.(?:insert|update|delete)\\(\\s*${table}\\b`, 'u').test(body))
}

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

test('every admin handler that writes a cache-input table bumps the answer-cache version', () => {
  const missing = handlers.filter((name) => {
    const source = readFileSync(path.join(root, name), 'utf8')
    return writesCacheInput(source) && !/\bbumpAnswerCacheVersion\b/u.test(source) && !EXEMPT[name]
  })
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
    let source: string
    try {
      source = readFileSync(path.join(root, name), 'utf8')
    } catch {
      stale.push(`${name} — file no longer exists`)
      continue
    }
    if (!writesCacheInput(source)) stale.push(`${name} — no longer writes a cache-input table`)
    if (/\bbumpAnswerCacheVersion\b/u.test(source)) stale.push(`${name} — now bumps the version, drop the exemption`)
  }
  assert.deepEqual(stale, [], 'a named exemption that stopped applying is how a gate quietly widens')
})

test('the article write paths bump the version in the handler, not only in a service', () => {
  for (const name of [
    'server/api/admin/articles/[id].put.ts',
    'server/api/admin/articles/[id].delete.ts',
    'server/api/admin/articles/index.post.ts',
  ]) {
    const source = readFileSync(path.join(root, name), 'utf8')
    assert.match(source, /await bumpAnswerCacheVersion\(\)/u, `${name} does not bump`)
  }
})
