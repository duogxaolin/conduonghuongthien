/**
 * Cái gì là "một tham chiếu tới ảnh X" — dùng chung cho lượt đồng bộ local ↔ R2
 * (`media-sync-rewrite.ts`): danh sách cột có thể mang URL ảnh, các dạng văn bản
 * của một URL trong cột, và RANH GIỚI URL (`a.jpg` không khớp bên trong
 * `a.jpg.webp`) ở cả bản SQL (REGEXP) lẫn bản JS (bộ dò của lượt vá). Tách khỏi
 * `media-sync-rewrite.ts` để hai bản ranh giới nằm cạnh nhau — lệch nhau thì hoặc
 * thay mà không thấy, hoặc thấy mà không thay.
 */
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core'

import {
  articles,
  articleTranslations,
  categories,
  chatbotKnowledge,
  chatbotSettings,
  chatbotSmallTalk,
  chatMessages,
  homeSections,
  langTranslations,
  livestreamSessions,
  mediaItems,
  pageBlocks,
  pageContents,
  pages,
  pageVersions,
  settings,
  socialLinks,
} from '../db/schema'

/** Cặp URL cần thay: URL cũ của hàng `media` → URL mới sau khi đổi chỗ lưu. */
export interface UrlRewrite {
  oldUrl: string
  newUrl: string
}

/**
 * `text`: chuỗi thô (HTML rich-text, markdown, URL trần).
 * `json`: URL có thể nằm trong một chuỗi JSON, nên dạng văn bản của nó là dạng đã
 * thoát JSON (`"` → `\"`, `\` → `\\`). MySQL chuẩn hoá `\/` → `/` khi lưu cột JSON,
 * nhưng một chuỗi JSON lưu trong cột TEXT (như `settings.value` của menu) giữ
 * nguyên văn, nên dạng `\/` cũng được thay. Với URL an toàn (không `"`/`\`), dạng
 * `json` bao luôn dạng `text`.
 */
export type ReferenceKind = 'text' | 'json'

export interface ReferenceTarget {
  label: string
  table: MySqlTable
  /** Khoá chính — số (đa số bảng) hoặc chuỗi (`settings.key`). */
  id: MySqlColumn
  column: MySqlColumn
  kind: ReferenceKind
}

/**
 * MỌI cột có thể mang URL một ảnh của thư viện `media` — nơi cán bộ chọn ảnh từ thư
 * viện (`useImagePicker`) hoặc dán URL, và nơi nội dung đã lưu được hiển thị lại.
 * Danh sách này dùng cho CẢ BA việc: thay URL, lưới an toàn trước khi xoá, và lượt vá.
 *
 * CÓ, vì sao:
 *  - `articles.*`, `article_translations.*`: nội dung bài (rich-text), ảnh đại diện.
 *  - `page_blocks.data`, `pages.published_blocks`/`draft_blocks`: Page Builder.
 *  - `page_versions.blocks`: ảnh chụp lịch sử — khôi phục một phiên bản cũ không được
 *    hồi sinh URL đã chết.
 *  - `home_sections.config`: khối trang chủ cũ, `/api/public/home-sections` vẫn phục vụ.
 *  - `page_contents.content`: bảng nội dung cũ (JSON) — chưa đọc ở đâu, nhưng còn dữ
 *    liệu thì không được để trỏ tệp đã xoá nếu được dùng lại.
 *  - `settings.value`: `main_logo_url`/`logo_url`/`hero_banner_url`/`favicon_url`/
 *    `og_image_url` chọn từ thư viện (`/admin/settings/general`), và các khoá JSON
 *    (menu, bố cục) có thể nhúng URL — dạng `json` phủ cả hai.
 *  - `social_links.icon` (icon kiểu ảnh/SVG chọn từ thư viện) và `.url`.
 *  - `media_items.thumbnail_url` (ảnh bìa video chọn từ thư viện, `media-portal.ts`),
 *    `livestream_sessions.thumbnail_url`, và mô tả của hai bảng đó.
 *  - `chat_messages.content`: câu trả lời chatbot (markdown ảnh từ kho) được lưu và
 *    hiển thị lại khi người dùng mở lại lịch sử.
 *  - `chatbot_knowledge.approved_answer`/`source_url`, `chatbot_small_talk.answer`,
 *    `chatbot_settings.knowledge_greeting`/`fallback_message`: văn bản trả lời
 *    markdown, có thể chèn ảnh.
 *  - `categories.description`, `lang_translations.value`: văn bản cán bộ gõ tự do,
 *    hiển thị công khai.
 *
 * KHÔNG, vì sao:
 *  - `activity_logs.meta`: nhật ký kiểm toán — chứa `oldUrl` CÓ CHỦ ĐÍCH và là nguồn
 *    sự thật của lượt vá. Sửa nó là xoá dấu vết; quét nó trong lưới an toàn thì bản
 *    cũ không bao giờ được xoá.
 *  - `ai_moderation_queue.*`: ảnh chụp bằng chứng kiểm duyệt tại thời điểm gắn cờ.
 *  - `submissions.*`, `submission_events.*`: hồ sơ công dân gửi — chứng cứ, không sửa.
 *  - `article_comments.body`, `livestream_messages.content`: văn bản thuần do người
 *    đọc viết, không hiển thị như ảnh; không sửa lời của người khác.
 *  - `media.*` (chính hàng được dời, do `commitMove` sửa), `media_items.storage_path`
 *    (kho video riêng), `analytics_*` (đường dẫn trang), bảng khoá/bí mật/phiên.
 */
export const URL_REFERENCE_TARGETS: readonly ReferenceTarget[] = [
  { label: 'articles.content', table: articles, id: articles.id, column: articles.content, kind: 'text' },
  { label: 'articles.excerpt', table: articles, id: articles.id, column: articles.excerpt, kind: 'text' },
  { label: 'articles.thumbnail_url', table: articles, id: articles.id, column: articles.thumbnailUrl, kind: 'text' },
  { label: 'article_translations.content', table: articleTranslations, id: articleTranslations.id, column: articleTranslations.content, kind: 'text' },
  { label: 'article_translations.excerpt', table: articleTranslations, id: articleTranslations.id, column: articleTranslations.excerpt, kind: 'text' },
  { label: 'article_translations.title', table: articleTranslations, id: articleTranslations.id, column: articleTranslations.title, kind: 'text' },
  { label: 'page_blocks.data', table: pageBlocks, id: pageBlocks.id, column: pageBlocks.data, kind: 'json' },
  { label: 'pages.published_blocks', table: pages, id: pages.id, column: pages.publishedBlocks, kind: 'json' },
  { label: 'pages.draft_blocks', table: pages, id: pages.id, column: pages.draftBlocks, kind: 'json' },
  { label: 'page_versions.blocks', table: pageVersions, id: pageVersions.id, column: pageVersions.blocks, kind: 'json' },
  { label: 'home_sections.config', table: homeSections, id: homeSections.id, column: homeSections.config, kind: 'json' },
  { label: 'page_contents.content', table: pageContents, id: pageContents.id, column: pageContents.content, kind: 'json' },
  { label: 'settings.value', table: settings, id: settings.key, column: settings.value, kind: 'json' },
  { label: 'social_links.icon', table: socialLinks, id: socialLinks.id, column: socialLinks.icon, kind: 'text' },
  { label: 'social_links.url', table: socialLinks, id: socialLinks.id, column: socialLinks.url, kind: 'text' },
  { label: 'media_items.thumbnail_url', table: mediaItems, id: mediaItems.id, column: mediaItems.thumbnailUrl, kind: 'text' },
  { label: 'media_items.description', table: mediaItems, id: mediaItems.id, column: mediaItems.description, kind: 'text' },
  { label: 'livestream_sessions.thumbnail_url', table: livestreamSessions, id: livestreamSessions.id, column: livestreamSessions.thumbnailUrl, kind: 'text' },
  { label: 'livestream_sessions.description', table: livestreamSessions, id: livestreamSessions.id, column: livestreamSessions.description, kind: 'text' },
  { label: 'chat_messages.content', table: chatMessages, id: chatMessages.id, column: chatMessages.content, kind: 'text' },
  { label: 'chatbot_knowledge.approved_answer', table: chatbotKnowledge, id: chatbotKnowledge.id, column: chatbotKnowledge.approvedAnswer, kind: 'text' },
  { label: 'chatbot_knowledge.source_url', table: chatbotKnowledge, id: chatbotKnowledge.id, column: chatbotKnowledge.sourceUrl, kind: 'text' },
  { label: 'chatbot_small_talk.answer', table: chatbotSmallTalk, id: chatbotSmallTalk.id, column: chatbotSmallTalk.answer, kind: 'text' },
  { label: 'chatbot_settings.knowledge_greeting', table: chatbotSettings, id: chatbotSettings.id, column: chatbotSettings.knowledgeGreeting, kind: 'text' },
  { label: 'chatbot_settings.fallback_message', table: chatbotSettings, id: chatbotSettings.id, column: chatbotSettings.fallbackMessage, kind: 'text' },
  { label: 'categories.description', table: categories, id: categories.id, column: categories.description, kind: 'text' },
  { label: 'lang_translations.value', table: langTranslations, id: langTranslations.id, column: langTranslations.value, kind: 'text' },
]

/** Nhãn những cột mà khi bị thay thì bộ đệm favicon/og:image phải được xoá. */
export const SETTINGS_TARGET_LABEL = 'settings.value'

/**
 * Ký tự phá thuộc tính HTML / chuỗi JSON nếu lọt vào URL mới. Khoảng trắng thường
 * (tên tệp nhập qua quét thư mục) thì được — nằm trong thuộc tính có ngoặc kép.
 */
const UNSAFE_URL_CHARS = /["'<>\\`\t\r\n]/

/**
 * Từ chối cặp URL không thay an toàn được. Ném lỗi → hàng đó bị bỏ qua (file cũ
 * GIỮ NGUYÊN), không bao giờ ghi nửa vời.
 *
 * `newUrl` chứa `oldUrl` (vd. R2 public URL có đường dẫn `/uploads`): lượt thay sẽ
 * không còn idempotent và lưới an toàn sẽ thấy URL cũ bên trong URL mới. Đánh đổi
 * có chủ đích: cấu hình hiếm này dừng hàng lại với lỗi rõ thay vì ghi hỏng nội dung.
 */
export function assertRewritable(rewrite: UrlRewrite): void {
  const { oldUrl, newUrl } = rewrite
  if (!oldUrl || !newUrl) throw new Error('URL cũ/mới trống — không thay được.')
  if (oldUrl === newUrl) throw new Error('URL cũ và mới giống nhau.')
  if (UNSAFE_URL_CHARS.test(oldUrl) || UNSAFE_URL_CHARS.test(newUrl)) {
    throw new Error('URL chứa ký tự không an toàn cho HTML — không thay tự động.')
  }
  if (newUrl.includes(oldUrl)) {
    throw new Error('URL mới chứa URL cũ — thay chuỗi sẽ không idempotent, dừng hàng này.')
  }
}

// ─── Ranh giới URL ───────────────────────────────────────────────────────────
//
// Một lần xuất hiện của URL cũ chỉ là tham chiếu tới ĐÚNG tệp đó khi:
//   - BÊN PHẢI không nối tiếp đường dẫn: `a.jpg.webp`, `a.jpg-1`, `a.jpg/x`, `a.jpgx`
//     là tệp KHÁC. `?`/`#` (query/fragment — giữ nguyên sau URL mới), dấu nháy, `\`
//     (JSON `\"`), khoảng trắng, `<`, `)`, `&` (`&quot;` trong style), `,` `;`
//     (srcset/CSS) và hết chuỗi đều là ranh giới. Dấu câu (`.`, `-`, `~`…) chỉ nối
//     tiếp khi theo sau là chữ/số: `a.jpg.` cuối câu vẫn là `a.jpg`.
//   - BÊN TRÁI (URL tương đối `/uploads/…`) không nằm giữa một đường dẫn khác
//     (`/x/uploads/…`, `https://mirror/archive/uploads/…`), TRỪ khi ngay trước nó là
//     đúng `scheme://host` — dạng tuyệt đối của chính URL đó, được thay CẢ cụm.
//
// Ba nơi dùng CÙNG định nghĩa này: câu thay (REGEXP_REPLACE), lưới an toàn (REGEXP),
// và bộ dò của lượt vá (`findPresentOldUrls`, bản JS). Lệch nhau thì hoặc thay mà
// không thấy, hoặc thấy mà không thay.
//
// Cú pháp chạy được trên ICU (MySQL 8 — production dùng `mysql:8.0`) và PCRE
// (MariaDB): `(?-i)`, `\p{L}`, lookbehind một ký tự, lookahead.

/** Ký tự LUÔN nối tiếp một đường dẫn tệp. */
const CONT_CORE = '\\p{L}\\p{N}_%/'
/** Dấu câu chỉ nối tiếp khi theo sau là ký tự lõi. */
const CONT_PUNCT = '.~!:=@*$+\\-'
/** Bên phải: không nối tiếp. */
const RIGHT_BOUNDARY = `(?![${CONT_CORE}]|[${CONT_PUNCT}]+[${CONT_CORE}])`
/** Bên trái của URL tương đối: ký tự trước không thuộc một đường dẫn. */
const LEFT_BOUNDARY = `(?<![${CONT_CORE}.~+\\-])`
/** Phần host của dạng tuyệt đối — không `/` (không nuốt đường dẫn của URL khác). */
const HOST = '[^/"\'\\s<>\\\\()]+'

/** Thoát ký tự đặc biệt cho mẫu REGEXP (ICU ở MySQL 8, PCRE ở MariaDB đều hiểu). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Chuỗi thay thế của REGEXP_REPLACE coi `$` và `\` là đặc biệt (`$1`, `\1`). */
function escapeRegexReplacement(s: string): string {
  return s.replace(/[\\$]/g, '\\$&')
}

/** Mẫu LIKE "chứa chuỗi": `%`, `_`, `\` trong URL phải là chữ, không phải ký tự đại diện. */
function likeContains(s: string): string {
  return `%${s.replace(/[\\%_]/g, '\\$&')}%`
}

/** Phần trong của một chuỗi JSON — đúng như MySQL tuần tự hoá giá trị chuỗi. */
function jsonInner(s: string): string {
  return JSON.stringify(s).slice(1, -1)
}

function safeEncodeUri(s: string): string | null {
  try { return encodeURI(s) } catch { return null }
}

/**
 * Cặp URL thô + (nếu khác) dạng đã mã hoá phần trăm: trình soạn thảo có thể lưu
 * `ảnh mới.jpg` thành `%E1%BA%A3nh%20m%E1%BB%9Bi.jpg`. Cả hai dạng phải được thay,
 * không thì dạng còn lại trỏ vào tệp đã xoá.
 */
export function urlPairs(rewrite: UrlRewrite): { old: string; new: string }[] {
  const pairs = [{ old: rewrite.oldUrl, new: rewrite.newUrl }]
  const encOld = safeEncodeUri(rewrite.oldUrl)
  const encNew = safeEncodeUri(rewrite.newUrl)
  if (encOld && encNew && encOld !== rewrite.oldUrl && !encNew.includes(encOld)) {
    pairs.push({ old: encOld, new: encNew })
  }
  // Trong thuộc tính HTML đã lọc, `&` được lưu thành `&amp;`.
  if (rewrite.oldUrl.includes('&')) {
    const amp = (s: string) => s.replace(/&/g, '&amp;')
    pairs.push({ old: amp(rewrite.oldUrl), new: amp(rewrite.newUrl) })
  }
  return pairs
}

/** Một dạng văn bản của URL cũ trong một loại cột, với mẫu khớp có ranh giới. */
export interface RewriteForm {
  /** Dạng URL cũ đúng như nằm trong văn bản cột. */
  old: string
  /** Dạng URL mới tương ứng (cùng cách thoát). */
  new: string
  /** Lọc thô `LIKE` (chỉ để không chạm hàng không liên quan — mẫu REGEXP mới quyết định). */
  like: string
  /** Mẫu REGEXP có ranh giới (MySQL 8 ICU / PCRE). */
  pattern: string
  /** Chuỗi thay thế cho REGEXP_REPLACE (đã thoát `$`, `\`). */
  replacement: string
}

function buildForm(old: string, next: string, scheme: string): RewriteForm {
  // URL tương đối (`/uploads/…`, hoặc `\/uploads\/…` trong JSON thoát `/`) được
  // thay cả khi đứng sau `scheme://host` — dạng tuyệt đối của chính nó. URL tuyệt
  // đối (R2 → local) chỉ khớp đúng nó.
  const relative = old.startsWith('/') || old.startsWith('\\/')
  const left = relative ? `(?:${scheme}${HOST}|${LEFT_BOUNDARY})` : LEFT_BOUNDARY
  return {
    old,
    new: next,
    like: likeContains(old),
    pattern: `(?-i)${left}${escapeRegex(old)}${RIGHT_BOUNDARY}`,
    replacement: escapeRegexReplacement(next),
  }
}

/**
 * Mọi dạng văn bản của cặp URL trong một loại cột: thô / mã hoá phần trăm / `&amp;`,
 * và với cột `json` thêm dạng thoát `\/`.
 */
export function rewriteForms(kind: ReferenceKind, rewrite: UrlRewrite): RewriteForm[] {
  const out: RewriteForm[] = []
  for (const pair of urlPairs(rewrite)) {
    if (kind === 'text') {
      out.push(buildForm(pair.old, pair.new, 'https?://'))
      continue
    }
    const plainOld = jsonInner(pair.old)
    const plainNew = jsonInner(pair.new)
    out.push(buildForm(plainOld, plainNew, 'https?://'))
    const slashOld = plainOld.replace(/\//g, '\\/')
    if (slashOld !== plainOld) out.push(buildForm(slashOld, plainNew.replace(/\//g, '\\/'), 'https?:\\\\/\\\\/'))
  }
  return out
}

/**
 * Các dạng URL cũ cần DÒ (lưới an toàn): như `rewriteForms` nhưng không phụ thuộc
 * URL mới — dạng mã hoá phần trăm luôn được dò, kể cả khi lượt thay bỏ qua nó.
 */
export function detectionForms(kind: ReferenceKind, oldUrl: string): RewriteForm[] {
  const olds = new Set([oldUrl])
  const enc = safeEncodeUri(oldUrl)
  if (enc) olds.add(enc)
  if (oldUrl.includes('&')) olds.add(oldUrl.replace(/&/g, '&amp;'))
  const out: RewriteForm[] = []
  for (const old of olds) {
    if (kind === 'text') {
      out.push(buildForm(old, '', 'https?://'))
      continue
    }
    const plain = jsonInner(old)
    out.push(buildForm(plain, '', 'https?://'))
    const slash = plain.replace(/\//g, '\\/')
    if (slash !== plain) out.push(buildForm(slash, '', 'https?:\\\\/\\\\/'))
  }
  return out
}

// Bản JS của ranh giới URL — PHẢI khớp `RIGHT_BOUNDARY`/`LEFT_BOUNDARY` ở trên.
const JS_CONT_CORE = /[\p{L}\p{N}_%/]/u
const JS_CONT_PUNCT = /[.~!:=@*$+-]/u
const JS_LEFT_CONT = /[\p{L}\p{N}_%/.~+-]/u

/** Vị trí `p` trong `s` có phải ranh giới phải của một URL kết thúc ngay trước `p`. */
function isRightBoundary(s: string, p: number): boolean {
  if (p >= s.length) return true
  const ch = s[p]!
  if (JS_CONT_CORE.test(ch)) return false
  if (!JS_CONT_PUNCT.test(ch)) return true
  let q = p
  while (q < s.length && JS_CONT_PUNCT.test(s[q]!)) q += 1
  return q >= s.length || !JS_CONT_CORE.test(s[q]!)
}

/**
 * Tìm trong một đoạn văn bản những URL cũ (khoá của `candidates`) còn xuất hiện,
 * theo ĐÚNG ranh giới của câu thay. Tuyến tính theo độ dài văn bản: tách token dạng
 * URL rồi tra Set ở mỗi điểm ranh giới, thay vì quét từng ứng viên một (3000 ứng
 * viên × toàn bộ nội dung là quá chậm).
 *
 * Token tuyệt đối `http://host/uploads/a.png` được tra cả phần đường dẫn sau host —
 * để thấy URL cũ tương đối nằm trong dạng tuyệt đối của nó. Văn bản được chuẩn hoá
 * `\/` → `/` (JSON) và `&amp;` → `&` trước. Bỏ sót được chấp nhận: tên tệp chứa
 * khoảng trắng THÔ trong nội dung (upload luôn làm sạch tên về `[A-Za-z0-9_-]`; chỉ
 * ảnh nhập qua quét thư mục mới có thể có, và trình soạn thảo thường lưu `%20` —
 * dạng đó thì tìm được).
 */
export function findPresentOldUrls(text: string, candidates: ReadonlySet<string>, found: Set<string>): void {
  if (!text) return
  const normalized = text.replace(/\\\//g, '/').replace(/&amp;/g, '&')
  const tokenRe = /https?:\/\/[^\s"'<>\\()]+|\/[^\s"'<>\\()]+/g
  for (let m = tokenRe.exec(normalized); m; m = tokenRe.exec(normalized)) {
    const token = m[0]
    // Điểm bắt đầu hợp lệ của một URL trong token, đúng như mẫu SQL:
    //  - đầu token, nếu ký tự ngay trước token không nối tiếp một đường dẫn;
    //  - đường dẫn ngay sau `scheme://host` (dạng tuyệt đối của URL tương đối);
    //  - mọi `/` mà ký tự trước nó không nối tiếp (`?u=/uploads/…`).
    const starts = new Set<number>()
    if (m.index === 0 || !JS_LEFT_CONT.test(normalized[m.index - 1]!)) starts.add(0)
    if (!token.startsWith('/')) {
      const pathStart = token.indexOf('/', token.indexOf('://') + 3)
      if (pathStart > 0) starts.add(pathStart)
    }
    for (let i = 1; i < token.length; i += 1) {
      if (token[i] === '/' && !JS_LEFT_CONT.test(token[i - 1]!)) starts.add(i)
    }
    for (let p = 1; p <= token.length; p += 1) {
      if (!isRightBoundary(token, p)) continue
      for (const s of starts) {
        if (s >= p) continue
        const piece = token.slice(s, p)
        if (candidates.has(piece)) found.add(piece)
      }
    }
  }
}
