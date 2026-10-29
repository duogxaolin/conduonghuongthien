/**
 * Mẫu và phép khớp của bộ khớp chủ quyền biển, đảo — hàm thuần, không trạng thái, không import guard. Tách khỏi
 * `sovereignty-guard.ts` (guard giữ chính sách: câu trả lời viết sẵn, lớp chặn đầu ra, lịch sử, điều khoản prompt).
 * Tên xuất có tiền tố `sovereignty`: Nitro tự import mọi export của `server/utils/**`.
 *
 * Nguyên tắc (sau ba vòng kiểm chứng độc lập, docs/decisions/chatbot.md): đây là cổng an ninh nên THIÊN VỀ BẮT.
 * Chữ thường, không dấu, nửa viết hoa mặc định bắt ("hoàng sa có phải…", "hoang sa co phai…"). Loại trừ CHỈ bằng
 * cụm CÓ DẤU rất cụ thể trên chữ còn dấu (`maskBenign`: "sa thải", "sà vào", "sa vào tù", "Sa Pa"…) — một danh sách
 * từ trên chữ bỏ dấu ("co", "da", "vao"…) từng loại luôn "hoàng sa có/đã/vào…". Tên trùng từ thường ("bien dong"
 * không dấu = "biến động", "đảo sinh tồn", "đá chữ thập") cần chữ hỏi chủ quyền đi kèm.
 */
import { sovereigntyFold as fold, sovereigntyHanKey as hanKey, sovereigntyLatinKey as latinKey } from './sovereignty-normalize'

// ─── Chữ Hán ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Tên đầy đủ (…沙群岛, 南海诸岛) bắt vô điều kiện. 南海/南沙/西沙 TRẦN: không tính khi chữ đứng trước trong cùng mệnh
// đề ghép thành từ khác (越南海防, 河南沙县, 海南海口, 中南海, 东西沙发, 广西沙田, 佛山南海, 广州南沙, tên người 张南海…)
// — `hanKey` ngắt mệnh đề ở dấu câu nên "广州，南沙" không bị loại — hoặc khi theo sau là tên đơn vị hành chính/cơ sở
// (佛山市南海区, 广州市南沙区人民法院, 南沙新区, 南海观音, 南海電鉄). "三沙市南沙区" khớp qua 三沙.
const HAN_PATTERNS = [
  /[南西中东黄长]沙群岛|南海诸岛|(?<!越)南中国海/,
  /(?<![越河云湖济海江华西东中岭闽安州山张王李刘陈杨赵周吴])南[海沙](?![区县镇市港]|新区|街道|法院|观音|[电電][铁鉄])/,
  /(?<![东广江山陕])西沙(?![区县镇市])/,
  /黄沙.{0,2}长沙|长沙.{0,2}黄沙|[黄长]沙岛/,
  /三沙/,
  /[九十]段线/,
  // 永兴岛 = Phú Lâm, 南威岛 = Trường Sa Lớn, 赤瓜礁 = Gạc Ma, 黄岩岛 = Scarborough, 太平岛 = Ba Bình, 仁爱礁 = Second Thomas.
  /永兴岛|南威岛|赤瓜礁|永暑礁|华阳礁|东门礁|南薰礁|渚碧礁|美济礁|黄岩岛|仁爱礁|太平岛/,
]

// ─── Mặt nạ loại trừ: cụm CÓ DẤU, trước mọi phép khớp ─────────────────────────────────────────────────────────────
// "sa" thành "sah" nên không còn là "Sa" của tên quần đảo. Chỉ "sa" VIẾT THƯỜNG + cụm động từ đủ chữ: "Giám đốc Hoàng
// sa thải tôi", "Trường sa sút điểm thi", "trường sa đà vào game"; "Sa" viết hoa là tên riêng ("Hoàng Sa cơ quan nào quản
// lý?", "Hoàng Sa vào tù"). Âm tiết cũng là đầu từ ghép thì cần từ sau ("sa cơ lỡ vận", "sa chân vào", "sa lưới pháp
// luật") hoặc loại từ ghép ("ngã ba", "sút giảm", "lầy lội", "sầm uất"). Không dấu ("hoang sa thai") thì không loại.
const SA_VERB_FOLLOWERS = [
  'ngã(?!\\s+(?:ba|tư|năm|sáu|bảy|rẽ)(?![\\p{L}]))', 'sút(?!\\s+(?:giảm|kém)(?![\\p{L}]))', '(?:đọa|đoạ)(?!\\s+đày)',
  'lầy(?!\\s+lội)', 'sầm(?!\\s+uất)', 'đà\\s+vào', 'cơ\\s+(?:lỡ|thất)', 'chân\\s+(?:vào|lỡ|xuống)', 'lưới\\s+(?:pháp|công|cảnh)',
  'vào\\s+(?:lưới|tù|vòng|cạm|con|nghiện|tệ|ma|cờ|rượu|lô)',
].join('|')
const SA_VERB = new RegExp(`(?<![\\p{L}])(s)(a)(?=\\s+(?:${SA_VERB_FOLLOWERS})(?![\\p{L}]))`, 'gu')
// "sa thải" là động từ cố định, cả khi gõ hoa "Sa" ("Nam Sa thải tôi rồi", "Ông Hoàng. Sa thải tôi…") — mọi hoa/thường.
const SA_FIRE = /(?<![\p{L}])([Ss])([aA])(?=\s+(?:thải|THẢI)(?![\p{L}]))/gu
// Địa danh "Sa Pa/Đéc/Huỳnh/Thầy/Rài/Vĩ": "trường Sa Pa", "Trường Sa Đéc tuyển giáo viên", "TÂY SA PA". "Pa"/"Đéc" không
// có nghĩa thường nên mọi hoa/thường ("Việt Nam Sa pa"); "Huỳnh/Thầy/Rài/Vĩ" có ("Trường Sa thầy giáo nào dạy", "Hoàng Sa
// vĩ độ") nên chỉ khi viết hoa.
const SA_PLACE = /(?<![\p{L}])([Ss])([aA])(?=\s+(?:[Pp][Aa]|[Đđ][ÉéEe][Cc]|Huỳnh|HUỲNH|Thầy|THẦY|Rài|RÀI|Vĩ|VĨ|Vỹ|VỸ)(?![\p{L}])(?!-\p{L}))/gu
// "sà/sá/sả/sã/sạ" viết thường (có thanh) không phải "Sa": "Bé Hoàng sà vào lòng mẹ". "Hoàng Sá" viết hoa vẫn là tên.
const TONED_SA = /(?<![\p{L}])(s[àáảãạ])(?![\p{L}])/gu
// "biển Đông Á/Hồ/Hưng" VIẾT HOA là tấm biển, địa danh: "Đông Á Bank", "Bãi biển Đông Hồ". Viết thường "biển đông á,"
// (trợ từ miền Nam) vẫn bắt.
const DONG_PLACE = /(?<=[Bb]iển\s+)Đông(?=\s+(?:Á|Hồ|Hưng)(?![\p{L}]))/gu

function maskBenign(folded: string): string {
  return folded.replace(SA_VERB, '$1$2h').replace(SA_FIRE, '$1$2h').replace(SA_PLACE, '$1$2h').replace(TONED_SA, '$1h').replace(DONG_PLACE, 'Đôngh')
}

// ─── Khoá Latin bỏ dấu: mặc định bắt ──────────────────────────────────────────────────────────────────────────────
const LATIN_PATTERNS = [
  / hoang ?sa /,
  / truong ?sa /,
  // Tên Hán-Việt của tên gọi Trung Quốc: 西沙 = Tây Sa, 南沙 = Nam Sa, 三沙 = Tam Sa.
  / dao (?:tay|nam|tam) sa /,
  / gac ma (?!tuy )/, // không phải "gác ma túy" (cụm cụ thể, cả không dấu)
  / paracels? /,
  / spratle?ys? /,
  / xi ?sha /,
  / nan ?sha /,
  / sansha /,
  // Tiếng Nga (prompt hứa hỗ trợ): latinKey giữ chữ Kirin, khớp theo gốc từ; bỏ dấu nên "й" thành "и".
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
  / bien nam trung hoa /,
  // Tên đảo/bãi lẻ không trùng từ thường, kể cả không dấu ("dao ba binh cua ai").
  / dao (?:ba binh|song tu|nam yet|son ca|phan vinh|thi tu|phu lam|tri ton|huu nhat|linh con|duy mong|bach quy|loai ta|ben lac|an bang|quang hoa) /,
  / (?:da|bai) (?:xu bi|ga ven|chau vien|toc tan|hoang nham|ba dau|tu nghia) /,
  / woody island /,
  / itu aba /,
  / fiery cross /,
  / (?:mischief|subi|johnson(?: south)?|gaven|hughes|cuarteron) reefs? /,
  / scarborough (?:shoal|reef|island)s? /,
  / second thomas shoal /,
  / taiping island /,
]
// Không dấu, trùng từ thường ("bien dong" = "biến động", "tay sa", "nam sa"): chỉ khi CẢ văn bản không dấu và có chữ
// hỏi chủ quyền ("bien dong cua ai", "tay sa thuoc nuoc nao").
const LATIN_AMBIGUOUS = / (?:bien dong|tay sa|nam sa) /
const LATIN_QUESTION = / (?:cua ai|cua nuoc|thuoc|chu quyen|nuoc nao|la gi|ai quan ly|ai giu|lam chu|tranh chap|bao nhieu dao|co phai cua|khac gi) /

// ─── Chữ còn dấu (viết thường) ───────────────────────────────────────────────────────────────────────────────────
// Hai từ của một tên nối bằng khoảng trắng/gạch (kể cả gạch Unicode), MỘT ký tự nối lạ (`_ / · • ・ * + ~ |`), hoặc
// không gì ("BiểnĐông", kể cả sau khi bỏ ký tự vô hình). Không dấu câu: "đi biển.Đông Anh là quê tôi".
const JOIN = '(?:[\\s\\-\\u2010-\\u2015]+|[_/·•∙・*+~|])?'
const DAO_VERB = '(?!\\s+(?:lộn|ngược|nợ|chính|mắt|chiều|điên|ngũ|mạch|hướng|vòng|phách)(?![\\p{L}]))'
// "biển đông" bỏ dấu trùng "biến động"/"biển động": chữ còn dấu, trừ "(bãi) biển đông người/khách…", hướng
// "biển đông bắc/nam". "hoàng xa" (gõ sai "Hoàng Sa") trừ "xa nhà/quê/con/xưa…" và "huy hoàng xa…" (tiếng Việt thường).
const MARKED_PATTERNS = [
  new RegExp(`(?<![\\p{L}])(?<!bãi\\s+)biển${JOIN}đông(?![\\p{L}])(?!\\s+(?:người|khách|nghịt|vui|đúc|kín|bắc|nam)(?![\\p{L}]))`, 'u'),
  new RegExp(`(?<![\\p{L}])trường${JOIN}sa(?![\\p{L}])`, 'u'),
  new RegExp(`(?<![\\p{L}])biển${JOIN}nam${JOIN}trung${JOIN}hoa(?![\\p{L}])`, 'u'),
  new RegExp(`(?<![\\p{L}])(?<!huy\\s+)hoàng${JOIN}xa(?![\\p{L}])(?!\\s+(?:nhà|quê|con|xưa|rồi|cách|lạ|xôi|vời|gia|vợ|chồng|mẹ|cha|bố|làng|xứ|lắm|quá|dần|em|anh|chị|bạn|người)(?![\\p{L}]))`, 'u'),
  // "Ba Bình" trần là tên người ("anh Ba Bình", "Chú Ba Bình đảo nợ…") và "ba bình oxy": chỉ khi chữ đảo (danh từ)
  // đứng SÁT ("Ba Bình là (một hòn) đảo…"; "đảo Ba Bình" ở FEATURES).
  new RegExp(`(?<![\\p{L}])ba\\s+bình\\s+(?:(?:là|cũng\\s+là|vốn\\s+là)\\s+)?(?:(?:một|hòn)\\s+)*đảo(?![\\p{L}])${DAO_VERB}`, 'u'),
]
// "tây sa"/"nam sa" viết thường: chỉ khi có chữ hỏi chủ quyền ("Việt Nam sa vào khủng hoảng" không phải).
const MARKED_AMBIGUOUS = new RegExp(`(?<![\\p{L}])(?:tây|nam)${JOIN}sa(?![\\p{L}])`, 'u')
const MARKED_QUESTION = /(?<![\p{L}])(?:của\s+ai|của\s+nước|thuộc|chủ\s+quyền|nước\s+nào|là\s+gì|ai\s+(?:quản\s+lý|giữ|làm\s+chủ|chiếm)|tranh\s+chấp|khác\s+gì|có\s+phải\s+của)(?![\p{L}])/u
const FEATURE_QUESTION = new RegExp(`${MARKED_QUESTION.source}|(?<![\\p{L}])(?:trung\\s+quốc|tq)(?![\\p{L}])`, 'u')

// Tên đảo/đá/bãi lẻ, sau "đảo"/"đá"/"bãi". Tên không trùng từ thường chỉ ở khoá Latin (` dao ba binh `, ` da xu bi `… ở
// LATIN_PATTERNS): mọi hoa/thường, có dấu hay không, mọi ký tự nối. Tên trùng từ thường ("đảo sinh tồn" — trò chơi,
// "đá chữ thập" — xếp đá, "bãi cỏ mây", "đá lát") viết hoa (chữ đầu hoặc toàn bộ) như tên riêng, hoặc có chữ hỏi chủ
// quyền và không đứng sau "trò chơi/xếp/mua…".
const REEF_COMMON = ['Chữ Thập', 'Vành Khăn', 'Cỏ Mây', 'Lát']
const ISLAND_COMMON = ['Sinh Tồn', 'Tiên Nữ']
const spaced = (names: string[]) => names.map(name => name.replace(/ /g, '\\s+'))
const titleOrUpper = (names: string[]) => spaced(names.flatMap(name => [name, name.toUpperCase()])).join('|')
const lowered = (names: string[]) => spaced(names.map(name => name.toLowerCase())).join('|')
const REEF_PREFIX = '(?:[Đđ]á|ĐÁ|[Bb]ãi|BÃI)\\s+'
const ISLAND_PREFIX = '(?:[Đđ]ảo|ĐẢO)\\s+'
const FEATURE_TITLE = new RegExp(`(?<![\\p{L}])(?:${REEF_PREFIX}(?:${titleOrUpper(REEF_COMMON)})|${ISLAND_PREFIX}(?:${titleOrUpper(ISLAND_COMMON)}))(?![\\p{L}])`, 'u')
const FEATURE_COMMON = new RegExp(`(?<![\\p{L}])(?<!(?:chơi|game|show|xếp|vẽ|mua|bán|lát|kiểu|mẫu|hình)\\s+)(?:(?:đá|bãi)\\s+(?:${lowered(REEF_COMMON)})|đảo\\s+(?:${lowered(ISLAND_COMMON)}))(?![\\p{L}])`, 'u')

// ─── Viết hoa: tên riêng ──────────────────────────────────────────────────────────────────────────────────────────
// (Hoàng Sa / Trường Sa ở mọi hoa/thường là khoá Latin ` hoang ?sa `, ` truong ?sa `.) Khớp bất kể từ đứng sau ("Biển
// Đông người Trung Quốc gọi…"); "Tây/Nam/Tam Sa" — trừ khi đứng trước một tên riêng khác ("công ty Tam Sa Việt Nam" —
// trừ "Tây Sa Trung Quốc gọi…", "Nam Sa Islands"); trừ hướng "(vùng) biển Đông Bắc/Đông Nam"; "Biển Hoa Nam" chỉ viết
// hoa "Hoa", trừ "… Nam Định".
const NOT_SA_PLACE = '(?!\\s+(?!Trung|Island|Archipelago)\\p{Lu}\\p{Ll})'
const PROPER_NAMES = new RegExp([
  `(?<![\\p{L}])(?:(?:Hoàng|HOÀNG)${JOIN}(?:Xa|XA)`,
  `|(?:Tây|Tay|TÂY|TAY|Nam|NAM|Tam|TAM)${JOIN}(?:Sa|SA)${NOT_SA_PLACE}`,
  `|(?:[Bb]iển|[Bb]ien|BIỂN|BIEN)${JOIN}(?:Đông|Dong|ĐÔNG|DONG)(?!\\s+(?:Bắc|Nam|bắc|nam|BẮC|NAM)(?![\\p{L}]))`,
  `|(?:[Bb]iển|BIỂN)${JOIN}(?:Hoa|HOA)${JOIN}(?:Nam|NAM)(?!\\s+(?:Định|ĐỊNH)(?![\\p{L}])))(?![\\p{L}])`,
].join(''), 'u')
const OTHER_SCRIPTS = /パラセル|スプラトリー|파라셀|스프래틀리|남중국해/

// ─── Ngữ cảnh đảo/biển và yêu sách (đầu ra) ──────────────────────────────────────────────────────────────────────
// Yêu sách không gọi tên quần đảo chỉ tính khi cùng đoạn có nói tới đảo/biển: người hoàn lương từng chấp hành án
// "trên lãnh thổ Trung Quốc" là đúng đối tượng của cổng. "đảo" động từ ("đảo lộn", "đảo nợ", "khuynh đảo") và
// "Côn Đảo" (trại giam) không tính.
const ISLAND_HAN = /岛|礁|海域|领海/
const ISLAND_WORDS = new RegExp([
  '(?<![\\p{L}])(?:vùng biển|lãnh hải|hải phận|bãi đá|đá ngầm|ba bình|đá chữ thập|vành khăn|xu bi|hoàng nham',
  '|islands?|islets?|archipelagos?|reefs?|shoals?|atolls?|itu aba|fiery cross|scarborough)(?![\\p{L}])',
  `|(?<![\\p{L}])(?<!(?:khuynh|điên|lảo|chao|côn)\\s+)đảo(?![\\p{L}])${DAO_VERB}`,
].join(''), 'u')
const ISLAND_WORDS_ALL = new RegExp(ISLAND_WORDS.source, 'gu')
// Ngữ cảnh lấy từ CÂU HỎI thì hẹp hơn: hỏi về một hòn đảo, không phải người ở "huyện đảo Lý Sơn" hay ngư dân "bị bắt
// trên vùng biển" kể chuyện thụ án ở Trung Quốc.
const QUESTION_ISLAND_HAN = /群岛|岛礁|礁/
const QUESTION_ISLAND_WORDS = /(?<![\p{L}])(?:quần đảo|hòn đảo|đảo (?:này|đó|ấy|kia|nào)|ba bình|đá chữ thập|vành khăn|xu bi|hoàng nham|islands?|archipelagos?|reefs?|itu aba|fiery cross|scarborough)(?![\p{L}])/u
const HAN_CLAIMS = /中国.{0,6}领土|领土.{0,6}中国|固有领土|属于中国|中国.{0,15}主权|主权.{0,4}中国|自古以来.{0,4}中国|中国.{0,4}管辖/
const CLAIM_PREFILTER = /trung|china|chinese|indisputable|inherent/iu
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

// Từ cuối (có thể chưa viết xong). Lookbehind: chỉ vị trí ĐẦU từ mới quét tới cuối — không có nó, `[…]+$` thử lại từ
// mọi vị trí của một dãy chữ Hán dài không dấu cách (bậc hai, mỗi chunk).
const LAST_WORD = /(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}\p{N}]+$/u
const FIRST_WORD = /^[\p{L}\p{M}\p{N}]+/u
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u
/** Quét ngược tối đa 16 ký tự (từ tiếng Việt/Latin thường ngắn); từ dài hơn (dãy chữ Hán) thì regex tuyến tính. */
function withoutLastWord(text: string): string {
  const limit = Math.max(0, text.length - 16)
  let end = text.length
  while (end > limit && WORD_CHAR.test(text[end - 1]!)) end -= 1
  return end > limit || end === 0 ? text.slice(0, end) : text.replace(LAST_WORD, '')
}
const VIETNAMESE_MARK = /[\p{M}đĐ]/u

/** Câu có nói tới chủ đề, theo chữ Hán (`claims`: tính cả yêu sách — đầu ra có đảo/biển). */
export function sovereigntyHanMentions(han: string, claims: boolean): boolean {
  return HAN_PATTERNS.some(pattern => pattern.test(han)) || (claims && HAN_CLAIMS.test(han))
}

/** Mọi thứ trừ chữ Hán: tên riêng, tên đảo/bãi, cụm còn dấu, khoá Latin/Kirin bỏ dấu, chữ Nhật/Hàn. */
export function sovereigntyScriptMentions(folded: string, claims: boolean): boolean {
  const masked = maskBenign(folded)
  if (PROPER_NAMES.test(masked) || FEATURE_TITLE.test(masked) || OTHER_SCRIPTS.test(masked)) return true
  const lower = masked.toLowerCase()
  if (MARKED_PATTERNS.some(pattern => pattern.test(lower))) return true
  if ((FEATURE_COMMON.test(lower) && FEATURE_QUESTION.test(lower)) || (MARKED_AMBIGUOUS.test(lower) && MARKED_QUESTION.test(lower))) return true
  const latin = latinKey(lower)
  if (LATIN_PATTERNS.some(pattern => pattern.test(latin))) return true
  if (LATIN_AMBIGUOUS.test(latin) && LATIN_QUESTION.test(latin) && !VIETNAMESE_MARK.test(lower.normalize('NFD'))) return true
  return claims && LATIN_CLAIMS.some(pattern => pattern.test(latin))
}

/** Chữ do model viết có nói tới đảo/biển — điều kiện để tính yêu sách. */
export function sovereigntyIslandContext(folded: string, han: string): boolean {
  return ISLAND_HAN.test(han) || ISLAND_WORDS.test(folded.toLowerCase())
}

/**
 * `sovereigntyIslandContext` giữa luồng, trên phần đã chốt: bỏ từ cuối chưa viết xong, và "đảo" ở cuối chỉ tính khi
 * vẫn là đảo với từ thử "lộn" theo sau (model stream theo âm tiết: "…bị đảo | lộn…"). `skipFirstWord`: đoạn bắt đầu ở
 * một từ chỉ làm ngữ cảnh (từ đứng trước, đã xét ở lượt trước) — "đảo" trùng từ đó không tính, vì từ trước NÓ đã trôi
 * khỏi đoạn ("[Côn] Đảo" từng bật cờ ở 4/5 cách chia chunk).
 */
export function sovereigntySettledIslandContext(folded: string, han: string, skipFirstWord: boolean): boolean {
  if (ISLAND_HAN.test(han)) return true
  const lower = `${withoutLastWord(folded).toLowerCase()} lộn`
  const firstWordEnd = skipFirstWord ? (lower.match(FIRST_WORD)?.[0].length ?? 0) : 0
  for (const match of lower.matchAll(ISLAND_WORDS_ALL)) if (match.index >= firstWordEnd) return true
  return false
}

export function sovereigntyQuestionIslandContext(question: string): boolean {
  const folded = fold(question)
  return QUESTION_ISLAND_HAN.test(hanKey(folded)) || QUESTION_ISLAND_WORDS.test(folded.toLowerCase())
}

/** Chỉ cụm yêu sách, trên phần đã chốt (bỏ từ cuối chưa viết xong) — để biết khi nào phải giữ chữ lại. */
export function sovereigntySettledClaim(folded: string, han: string): boolean {
  if (HAN_CLAIMS.test(han)) return true
  // Mọi mẫu yêu sách Latin đều cần một trong các chữ này: không có thì khỏi dựng khoá Latin (mỗi chunk).
  if (!CLAIM_PREFILTER.test(folded)) return false
  const latin = latinKey(withoutLastWord(folded).toLowerCase())
  return LATIN_CLAIMS.some(pattern => pattern.test(latin))
}

// Các loại trừ theo từ đứng sau ("sa thải", "biển Đông Bắc", "gác ma túy", "hoàng xa nhà", "ba bình là đảo nợ"), kể cả
// cụm hai từ ("sa đà | vào", "sa cơ | lỡ", "sa lưới | pháp", "sa vào | tù"): giữa luồng, từ đó có thể chưa tới, nên một
// cụm ở cuối chỉ tính khi khớp với MỌI từ thử. Mỗi họ loại trừ một từ thử ("thải" che "sa/Sa |" ở mọi hoa/thường nên đủ
// cho "Sa | Pa"; "biển Đông Á/Hồ/Hưng" cùng họ với "biển Đông Bắc"). Từ thử không được tự tạo ra một khớp. Thêm loại trừ
// theo từ đứng sau → thêm từ thử.
const NEXT_WORD_PROBES = ['thải', 'vào', 'lỡ', 'pháp', 'tù', 'Bắc', 'túy', 'nhà', 'nợ']

/** Phần ngoài chữ Hán, chỉ tới ranh giới từ cuối: từ cuối có thể chưa viết xong ("Hoàng Sa|ng"). */
export function sovereigntySettledScriptMentions(folded: string, claims: boolean, cutAtStart: boolean): boolean {
  // Đoạn bắt đầu giữa một từ: bỏ mẩu đầu ("[l]east sea" không phải "east sea"). Chỉ khi thật sự cắt giữa từ — bỏ một
  // từ trọn vẹn ở đầu đoạn từng làm mất "bãi" của "bãi … biển đông".
  const start = cutAtStart ? folded.replace(FIRST_WORD, '') : folded
  const settled = withoutLastWord(start)
  return NEXT_WORD_PROBES.every(next => sovereigntyScriptMentions(`${settled} ${next}`, claims))
}
