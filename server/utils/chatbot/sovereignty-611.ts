/**
 * Bộ khớp chủ quyền của 611588c2 (port trung thành, đã merge vào wave3/integration) — bản chép ĐÓNG BĂNG, chỉ để HỢP
 * (OR) với bộ khớp mới (`sovereignty-patterns.ts`) ở mọi điểm quyết định của `sovereignty-guard.ts`.
 *
 * Vì sao (vòng 6, 2026-10-30): recall là cổng cứng — câu nào 611588c2 bắt thì bản mới phải bắt, trên MỌI bộ câu chưa
 * thấy, không chỉ trên bộ đã đo. Bộ khớp mới có các ngoại lệ chặn oan mà 611588c2 không có (hậu tố hành chính chữ Hán,
 * 佛山/广州 đứng trước, "sà vào", "Sa thải", "Sa Pa/Đéc", "trường Sa Huỳnh/Thầy/Rài/Vĩ", "biển Đông Á/Hồ/Hưng"); bộ câu
 * dò riêng các ngoại lệ đó, không chữ sở hữu, lọt 28/32 câu mà 611588c2 bắt. Hợp hai bộ khớp cho "≥ 611588c2" theo cấu
 * trúc, đổi lại chặn oan quay về mức 611588c2 (đo ở docs/decisions/chatbot.md, vòng 6). Bỏ hợp = gỡ các lời gọi
 * `sovereignty611*` trong `sovereignty-guard.ts`, không phải sửa tệp này.
 *
 * KHÔNG SỬA mẫu ở đây: sửa bộ khớp ở `sovereignty-patterns.ts`. `tests/chatbot-sovereignty-611-layer.test.ts` ghim kết
 * quả từng câu của fixture bằng mặt nạ bit 1 (= 611588c2). Khác bản gốc chỉ ở hai chỗ không đổi kết quả: bỏ từ cuối
 * bằng vòng lặp tuyến tính (regex gốc `[\p{L}\p{M}\p{N}]+$` bậc hai trên dãy chữ Hán dài), và đường tắt "không có chữ
 * cái ngoài chữ Hán thì nhánh chữ viết không khớp".
 */

// Phồn thể cần dùng → giản thể; "⻄" (bộ thủ U+2EC4, NFKC không gộp) → "西".
const HAN_FOLD: Record<string, string> = {
  黃: '黄', 長: '长', 東: '东', 羣: '群', 島: '岛', 諸: '诸', 線: '线', 國: '国', 興: '兴', 濟: '济',
  門: '门', 華: '华', 陽: '阳', 雲: '云', 廣: '广', 陝: '陕', 閩: '闽', 嶺: '岭', '⻄': '西',
}
const HAN_FOLD_CHARS = new RegExp(`[${Object.keys(HAN_FOLD).join('')}]`, 'g')

function fold(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(HAN_FOLD_CHARS, char => HAN_FOLD[char]!)
    .replace(/Ð/g, 'Đ').replace(/ð/g, 'đ')
}

function latinKey(lower: string): string {
  return ` ${lower.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
}

function hanKey(folded: string): string {
  return folded.replace(/[^\p{Script=Han}]/gu, '')
}

const HAN_PATTERNS = [
  /(?<![越河云湖济海江华西东中岭闽安])南[海沙]/,
  /(?<![东广江山陕])西沙/,
  /(?<!越)南中国海/,
  /[中东黄长]沙群岛/,
  /黄沙.{0,2}长沙|长沙.{0,2}黄沙|[黄长]沙岛/,
  /三沙/,
  /[九十]段线/,
  /永兴岛|南威岛|赤瓜礁|永暑礁|华阳礁|东门礁|南薰礁|渚碧礁|美济礁/,
]

const NOT_SA_VERB = '(?!(?:thai|nga|doa|sut|lay|mac|sam|luoi|vao|da|co|chan|ban) )'

const LATIN_PATTERNS = [
  / hoang ?sa /,
  / dao truong ?sa /,
  new RegExp(` truong ?sa ${NOT_SA_VERB}`),
  new RegExp(` dao (?:tay|nam|tam) sa ${NOT_SA_VERB}`),
  / gac ma (?!tuy )/,
  / paracels? /,
  / spratle?ys? /,
  / xi ?sha /,
  / nan ?sha /,
  / sansha /,
  / парасел/,
  / спратли/,
  / южно китаиск/,
  / s(?:outh)? china sea /,
  / west philippine sea /,
  / mer de chine /,
  / mar de (?:la )?china /,
  / east sea /,
  / nine ?dash /,
  / duong luoi bo /,
  / duong chin doan /,
  / chu quyen bien dao /,
]

const MARKED_PATTERNS = [
  /(?<![\p{L}])(?<!bãi\s+)biển[\s-]+đông(?![\p{L}])(?!\s+(?:người|khách|nghịt|vui|đúc|kín|bắc|nam)(?![\p{L}]))/u,
  /(?<![\p{L}])trường\s*sa(?![\p{L}])(?!\s+(?:thải|ngã|đọa|đoạ|sút|lầy|mạc|sầm|lưới|vào|đà|cơ|chân|bàn)(?![\p{L}]))/u,
]
const SA_PLACES = ['pa', 'đéc', 'huỳnh', 'thầy', 'vỹ', 'vĩ', 'rài']
  .map(word => [...word].map(char => `[${char}${char.toUpperCase()}]`).join('')).join('|')
const NOT_SA_PLACE = `(?!\\s+(?:(?:${SA_PLACES})(?![\\p{L}])|(?!Trung|Island|Archipelago)\\p{Lu}\\p{Ll}|(?:thải|ngã|đọa|sút|lầy|mạc|sầm|lưới|vào|đà|cơ|chân|bàn)(?![\\p{L}])))`
const PROPER_NAMES = new RegExp(`(?<![\\p{L}])(?:(?:Trường|Truong|TRƯỜNG|TRUONG)\\s*(?:Sa|SA)|(?:Tây|Tay|TÂY|TAY|Nam|NAM|Tam|TAM)\\s*(?:Sa|SA)${NOT_SA_PLACE}|(?:[Bb]iển|[Bb]ien|BIỂN|BIEN)[\\s-]+(?:Đông|Dong|ĐÔNG|DONG)(?!\\s+(?:Bắc|Nam|bắc|nam|BẮC|NAM)(?![\\p{L}])))(?![\\p{L}])`, 'u')
const OTHER_SCRIPTS = /パラセル|スプラトリー|파라셀|스프래틀리|남중국해/

const ISLAND_HAN = /岛|礁|海域|领海/
const ISLAND_WORDS = new RegExp([
  '(?<![\\p{L}])(?:vùng biển|lãnh hải|hải phận|bãi đá|đá ngầm|ba bình|đá chữ thập|vành khăn|xu bi|hoàng nham',
  '|islands?|islets?|archipelagos?|reefs?|shoals?|atolls?|itu aba|fiery cross|scarborough)(?![\\p{L}])',
  '|(?<![\\p{L}])(?<!(?:khuynh|điên|lảo|chao|côn)\\s+)đảo(?![\\p{L}])',
  '(?!\\s+(?:lộn|ngược|nợ|chính|mắt|chiều|điên|ngũ|mạch|hướng|vòng|phách)(?![\\p{L}]))',
].join(''), 'u')
const HAN_CLAIMS = /中国.{0,6}领土|领土.{0,6}中国|固有领土|属于中国|中国.{0,15}主权|主权.{0,4}中国|自古以来.{0,4}中国|中国.{0,4}管辖/
const LATIN_CLAIMS = [
  / lanh tho (?:\S+ ){0,5}trung quoc /,
  / thuoc (?:\S+ ){0,4}trung quoc /,
  / chu quyen (?:\S+ ){0,3}trung quoc /,
  / trung quoc (?:\S+ ){0,4}(?:chu quyen|quan ly|kiem soat|chiem dong|chiem giu) /,
  / (?:vung bien|lanh hai|hai phan) (?:\S+ ){0,3}trung quoc /,
  / belongs? to china /,
  / part of china /,
  / china (?:\S+ ){0,4}(?:sovereignty|territory) /,
  / chinese (?:territory|sovereignty|control|administration|jurisdiction) /,
  / (?:indisputable|inherent) (?:sovereignty|part|territory) /,
]

function islandContext(folded: string, han: string): boolean {
  return ISLAND_HAN.test(han) || ISLAND_WORDS.test(folded.toLowerCase())
}

function scriptMentions(folded: string, claims: boolean): boolean {
  if (PROPER_NAMES.test(folded) || OTHER_SCRIPTS.test(folded)) return true
  const lower = folded.toLowerCase()
  if (MARKED_PATTERNS.some(pattern => pattern.test(lower))) return true
  const latin = latinKey(lower)
  return LATIN_PATTERNS.some(pattern => pattern.test(latin)) || (claims && LATIN_CLAIMS.some(pattern => pattern.test(latin)))
}

/** `mentionsSovereignty` của 611588c2. */
export function sovereignty611Mentions(text: string, options: { output?: boolean, island?: boolean } = {}): boolean {
  const folded = fold(text)
  if (!folded.trim()) return false
  const han = hanKey(folded)
  const claims = options.output === true && (options.island === true || islandContext(folded, han))
  return sovereignty611HanMentions(han, claims) || scriptMentions(folded, claims)
}

/** Nhánh chữ Hán của 611588c2, trên khoá CHỈ chữ Hán (khoá có ngắt "|" của bộ mới, bỏ "|", là đúng khoá này). */
export function sovereignty611HanMentions(han: string, claims: boolean): boolean {
  return HAN_PATTERNS.some(pattern => pattern.test(han)) || (claims && HAN_CLAIMS.test(han))
}

const NEXT_WORD_PROBES = ['thải', 'Bắc', 'túy']
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u
const NON_HAN_LETTER = /[^\p{Script=Han}\P{L}]/u
/** Bỏ dãy chữ/số ở cuối — như `replace(/[\p{L}\p{M}\p{N}]+$/u, '')` của bản gốc, tuyến tính. */
function withoutLastWord(text: string): string {
  let end = text.length
  while (end > 0 && WORD_CHAR.test(text[end - 1]!)) end -= 1
  return text.slice(0, end)
}

/** `settledScriptMentions` của 611588c2 (chữ CHƯA gấp — tự gấp): chỉ tới ranh giới từ cuối, khớp với mọi từ thử. */
export function sovereignty611SettledScriptMentions(text: string, claims: boolean, cutAtStart: boolean): boolean {
  let folded = fold(text)
  if (cutAtStart) folded = folded.replace(/^[\p{L}\p{M}\p{N}]+/u, '')
  if (!NON_HAN_LETTER.test(folded)) return false
  const settled = withoutLastWord(folded)
  return NEXT_WORD_PROBES.every(next => scriptMentions(`${settled} ${next}`, claims))
}

/** `settledClaim` của 611588c2: cụm yêu sách trên phần đã chốt (`han`: khoá chỉ chữ Hán). */
export function sovereignty611SettledClaim(text: string, han: string): boolean {
  if (HAN_CLAIMS.test(han)) return true
  const latin = latinKey(withoutLastWord(fold(text)).toLowerCase())
  return LATIN_CLAIMS.some(pattern => pattern.test(latin))
}
