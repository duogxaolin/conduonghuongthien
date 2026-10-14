/**
 * Biến đoạn trích (excerpt) của bài viết thành văn bản thuần để hiển thị bằng
 * `{{ }}` trên thẻ danh sách.
 *
 * Excerpt lưu trong CSDL có thể là HTML do TinyMCE sinh, kèm thực thể HTML
 * (`Ng&agrave;y`, `&ldquo;…&rdquo;`, `&#273;`). Hiển thị thẳng thì người đọc thấy
 * nguyên chuỗi `&agrave;`. Trước đây hàm này có 4 bản chép (news, role-models,
 * reintegration-models và một bản yếu hơn trong `ContentTypeListSection.vue` chỉ
 * bóc thẻ) — mỗi bản giải mã một tập thực thể khác nhau.
 *
 * Kết quả là **văn bản**, không phải HTML: nơi gọi luôn hiển thị bằng nội suy
 * `{{ }}` (Vue tự thoát), không bao giờ `v-html`. Vì vậy `&lt;script&gt;` giải mã
 * thành chữ `<script>` là đúng và vô hại.
 */

/** Thực thể có tên hay gặp trong nội dung tiếng Việt và văn bản biên tập. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  bull: '•', middot: '·', deg: '°', times: '×', divide: '÷',
  copy: '©', reg: '®', trade: '™', euro: '€',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Abreve: 'Ă',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê',
  Igrave: 'Ì', Iacute: 'Í', Itilde: 'Ĩ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Ugrave: 'Ù', Uacute: 'Ú', Utilde: 'Ũ',
  Yacute: 'Ý', Dstrok: 'Đ',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', abreve: 'ă',
  egrave: 'è', eacute: 'é', ecirc: 'ê',
  igrave: 'ì', iacute: 'í', itilde: 'ĩ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ugrave: 'ù', uacute: 'ú', utilde: 'ũ',
  yacute: 'ý', yuml: 'ÿ', dstrok: 'đ',
}

/**
 * Một lượt duy nhất cho cả ba dạng thực thể. Giải mã hai lượt (số trước, tên sau)
 * từng biến `&amp;#60;` — chữ `&#60;` mà tác giả cố ý gõ — thành `<`: lượt sau
 * giải mã lại kết quả của lượt trước.
 */
const ENTITY = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g

/**
 * Điểm mã hợp lệ cho `String.fromCodePoint`. Ngoài khoảng này hàm đó **ném lỗi**
 * (`&#99999999;` trong một excerpt sẽ làm hỏng cả lượt dựng trang phía máy chủ);
 * nửa cặp thay thế (surrogate) và NUL cũng không phải ký tự. Theo đặc tả HTML,
 * cả ba thay bằng U+FFFD.
 */
function decodeCodePoint(codePoint: number): string {
  if (!Number.isSafeInteger(codePoint) || codePoint <= 0 || codePoint > 0x10FFFF) return '�'
  if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return '�'
  return String.fromCodePoint(codePoint)
}

function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const hex = body[1] === 'x' || body[1] === 'X'
    return decodeCodePoint(hex ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1)))
  }
  // Thực thể lạ giữ nguyên — đoán bừa còn tệ hơn để nguyên chữ.
  return NAMED_ENTITIES[body] ?? match
}

export function cleanExcerpt(html: string | null | undefined): string {
  if (!html) return ''
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(ENTITY, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim()
}
