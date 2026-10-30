/**
 * Mẫu và phép khớp của bộ khớp chủ quyền biển, đảo — hàm thuần, không trạng thái, không import guard. Tách khỏi
 * `sovereignty-guard.ts` (guard giữ chính sách: câu trả lời viết sẵn, lớp chặn đầu ra, lịch sử, điều khoản prompt).
 * Tên xuất có tiền tố `sovereignty`: Nitro tự import mọi export của `server/utils/**`.
 *
 * Nguyên tắc (bốn vòng kiểm chứng độc lập, docs/decisions/chatbot.md): đây là cổng an ninh của cổng thông tin Bộ Công an
 * — bỏ sót nặng hơn chặn oan, nên RECALL là cổng cứng (tests/chatbot-sovereignty-corpora.test.ts: câu nào một phiên bản
 * từng bắt thì phải bắt). Chữ thường, không dấu, nửa viết hoa mặc định bắt. Ngoại lệ chặn oan chỉ VÔ HIỆU một đoạn khớp
 * cụ thể trên chữ CÓ DẤU gốc, SAU khi đã dò (`sovereigntyScriptMentions`), không bao giờ cho tên đầy đủ, và tắt hết khi câu
 * có tín hiệu quyền sở hữu. Tên trùng từ thường ("bien dong" không dấu = "biến động", "đảo sinh tồn") cần chữ hỏi chủ quyền.
 */
import { sovereigntyFold as fold, sovereigntyHanKey as hanKey, sovereigntyLatinKey as latinKey } from './sovereignty-normalize'

// ─── Chữ Hán ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Tên khớp trên khoá NỐI LIỀN (bỏ mọi dấu câu giữa chữ Hán): "南，海", "西.沙", "西，沙群岛" là tên. Khoá có ngắt "|"
// (`hanKey`) chỉ dùng cho NGOẠI LỆ của tên trần: chữ đứng trước / hậu tố chỉ loại khi cùng mệnh đề.
// Tên đầy đủ, 三沙, đường chín đoạn, bãi đá: không bao giờ có ngoại lệ.
const HAN_FULL_NAMES = [
  // 南中国海 không có ngoại lệ (vòng 5 bỏ "(?<!越)": tên chứa chữ sở hữu 中国 nên ngoại lệ đó không bao giờ có hiệu lực
  // dưới luật chữ sở hữu) — "越南、中国海军", "越南中国海关" là chặn oan có chủ đích.
  /[南西中东黄长]沙群岛|南海诸岛|南中国海/,
  /黄沙.{0,2}长沙|长沙.{0,2}黄沙|[黄长]沙岛/,
  /三沙/,
  /[九十]段线/,
  // 永兴岛 = Phú Lâm, 南威岛 = Trường Sa Lớn, 赤瓜礁 = Gạc Ma, 黄岩岛 = Scarborough, 太平岛 = Ba Bình, 仁爱礁 = Second Thomas.
  /永兴岛|南威岛|赤瓜礁|永暑礁|华阳礁|东门礁|南薰礁|渚碧礁|美济礁|黄岩岛|仁爱礁|太平岛/,
]
// 南海/南沙/西沙 TRẦN: không tính khi chữ đứng trước TRONG CÙNG MỆNH ĐỀ ghép thành từ khác (越南海防, 河南沙县, 海南海口,
// 中南海, 东西沙发; "越南。沙坝" — chữ 南 vẫn cùng mệnh đề với 越), khi địa danh hai chữ đứng trước (佛山南海, 广州南沙) hoặc khi
// liền sau là đơn vị hành chính/cơ sở (佛山市南海区, 广州市南沙区人民法院, 南沙新区, 南海观音, 南海電鉄). "广州，南沙" thì bắt.
// Vòng 6 thu hẹp: chữ đứng trước một chữ chỉ còn bộ của 611588c2 — 周/王/张/山/州 lẻ là chữ thường (本周南海, 称王南海, 扩张
// 南海, 登山南海), họ người (张南海) nhận lập trường như ở 611588c2; hậu tố một chữ không loại khi là đầu từ khác (区域, 县域);
// 西沙区 là tên đơn vị Trung Quốc đặt cho Hoàng Sa — không có hậu tố 区.
const HAN_BARE_NAMES = [
  { name: /南[海沙]/g, before: new Set('越河云湖济海江华西东中岭闽安'), beforeWords: ['佛山', '广州'], after: /^(?:[区县镇市港](?!域)|新区|街道|法院|观音|[电電][铁鉄])/ },
  { name: /西沙/g, before: new Set('东广江山陕'), beforeWords: [], after: /^[县镇市](?!域)/ },
]
// Tín hiệu quyền sở hữu trên khoá nối liền ("属，于" vẫn là 属于); chữ sở hữu hệ chữ khác do nơi gọi đưa vào.
const HAN_OWNERSHIP = /中国|主权|属于|哪个国家|哪国|领土|归属|归谁|谁的/

const HAN_BARE_ANY = /南[海沙]|西沙/
const NO_BREAKS = new Uint8Array(0)

/** Cho từng đơn vị UTF-16 của khoá nối liền: có dấu câu ("|") ngay trước nó không. */
function breaksOf(han: string): Uint8Array {
  const marks = new Uint8Array(han.length)
  let joinedIndex = 0
  let pending = 0
  for (let index = 0; index < han.length; index += 1) {
    if (han[index] === '|') { pending = 1; continue }
    marks[joinedIndex] = pending
    joinedIndex += 1
    pending = 0
  }
  return marks
}

function bareHanName(han: string, joined: string, ownership: () => boolean): boolean {
  if (!HAN_BARE_ANY.test(joined)) return false
  if (HAN_OWNERSHIP.test(joined) || ownership()) return true
  // Không có dấu câu thì không có chỗ ngắt nào (đọc ngoài mảng rỗng là undefined — "không ngắt").
  const breakBefore = han === joined ? NO_BREAKS : breaksOf(han)
  for (const { name, before, beforeWords, after } of HAN_BARE_NAMES) {
    for (const match of joined.matchAll(name)) {
      const start = match.index
      const end = start + match[0].length
      // Địa danh hai chữ: cả hai chữ cùng mệnh đề với tên ("广，州南沙" không phải 广州).
      const vetoBefore = start > 0 && !breakBefore[start] && (before.has(joined[start - 1]!)
        || beforeWords.some(word => joined.endsWith(word, start) && !breakBefore[start - 1]))
      const vetoAfter = !breakBefore[end] && after.test(joined.slice(end, end + 2))
      if (!vetoBefore && !vetoAfter) return true
    }
  }
  return false
}

// ─── Ngoại lệ chặn oan: cụm CÓ DẤU, vô hiệu một đoạn khớp cụ thể SAU khi dò ──────────────────────────────────────────
// Đổi "sa" của đúng cụm đó thành "sah" rồi dò lại: còn khớp nơi khác thì vẫn là nhắc chủ đề. Vòng 5 chỉ còn "sa thải"
// trong họ động từ — mặt nạ "sa viết thường + ngã/sút/đà/vào…" (09eef836) che cả "hoàng sa ngã về tay trung quốc…",
// "quần đảo hoàng sa vào vòng kiểm soát…". Người tên Hoàng/Trường + "sa ngã/sa đà/sa vào…" là chặn oan có chủ đích.
// "sa thải" là động từ cố định, cả khi gõ hoa "Sa" ("Nam Sa thải tôi rồi", "Ông Hoàng. Sa thải tôi…") — mọi hoa/thường.
const SA_FIRE = /(?<![\p{L}])([Ss])([aA])(?=\s+(?:thải|THẢI)(?![\p{L}]))/gu
// Địa danh "Sa Pa/Đéc": "trường Sa Pa", "Trường Sa Đéc tuyển giáo viên", "TÂY SA PA" — không có nghĩa thường nên mọi
// hoa/thường ("Việt Nam Sa pa"). "Sa Huỳnh/Thầy/Rài/Vĩ" có nghĩa thường ("vĩ độ/vĩ đại", "huỳnh đệ", "thầy tôi") nên vòng 6
// thu hẹp: chỉ là TRƯỜNG HỌC — sau "trường", địa danh viết hoa chữ đầu, trong câu có chữ viết thường (câu IN HOA TOÀN BỘ
// hay Viết Hoa Mọi Chữ không cho biết đâu là tên riêng: "HOÀNG SA VĨ…", "Trường Sa Vĩ Đại", "Hoàng Sa Vĩ Tuyến" là quần đảo).
const SA_PLACE = /(?<![\p{L}])([Ss])([aA])(?=\s+(?:[Pp][Aa]|[Đđ][ÉéEe][Cc])(?![\p{L}])(?!-\p{L}))/gu
const SA_SCHOOL = /(?<=(?<![\p{L}])[Tt]rường\s+)([Ss])([aA])(?=\s+(?:Huỳnh|Thầy|Rài|Vĩ|Vỹ)(?![\p{L}])(?!-\p{L}))/gu
const LOWERCASE_WORD = /(?<![\p{L}\p{M}])\p{Ll}/u
// "sà vào/xuống" viết thường là động từ ("Bé Hoàng sà vào lòng mẹ"). Vòng 6 thu hẹp: "sà/sá/sả/sã/sạ" khác là tên gõ vội
// ("hoàng sà ai đang giữ", "trường sạ ai làm chủ" — 611588c2 bắt). "Hoàng Sà vào…" viết hoa vẫn là tên.
const TONED_SA = /(?<![\p{L}])(sà)(?=\s+(?:vào|xuống)(?![\p{L}]))/gu
// "biển Đông Á/Hồ/Hưng" VIẾT HOA là tấm biển, địa danh: "Đông Á Bank", "Bãi biển Đông Hồ". Viết thường "biển đông á,"
// (trợ từ miền Nam) vẫn bắt.
const DONG_PLACE = /(?<=[Bb]iển\s+)Đông(?=\s+(?:Á|Hồ|Hưng)(?![\p{L}]))/gu

function exceptBenign(folded: string): string {
  const schools = LOWERCASE_WORD.test(folded) ? folded.replace(SA_SCHOOL, '$1$2h') : folded
  return schools.replace(SA_FIRE, '$1$2h').replace(SA_PLACE, '$1$2h').replace(TONED_SA, '$1h').replace(DONG_PLACE, 'Đôngh')
}

// Ngoại lệ không bao giờ áp cho tên đầy đủ ("quần đảo Hoàng Sa/Trường Sa", "Biển Đông" viết hoa) và tắt hết khi câu có tín
// hiệu quyền sở hữu: "hoàng sà của ai", "Hoàng Sa Vĩ độ bao nhiêu thuộc nước nào" bắt.
const FULL_NAME = /(?<![\p{L}])(?:quần\s+đảo\s+(?:hoàng|trường)\s*sa|quan\s+dao\s+(?:hoang|truong)\s*sa)(?![\p{L}])/iu
const FULL_NAME_DONG = /(?<![\p{L}])(?:Biển|BIỂN)\s+(?:Đông|ĐÔNG)(?![\p{L}])/u
// Chữ sở hữu xét trên CẢ câu, mọi hệ chữ: "广州南沙 thuộc nước nào?", "Who owns 佛山南海?", "Trường Sa Pa belongs to which
// country?" — chữ hỏi tiếng Việt/Anh tắt cả ngoại lệ chữ Hán và ngược lại.
// Vòng 6 thêm chữ hỏi/khẳng định sở hữu verifier 5 dùng ("ai đang giữ", "là gì", "ai làm chủ/quản lý", "khác gì", "có phải
// của", "phải ko", "là của", "của việt nam/vn/mình/ta/họ", "lấy lại"): chữ sở hữu chỉ TẮT ngoại lệ của một tên đã khớp,
// nên rộng tay không chặn oan câu không có tên.
const OWNERSHIP = new RegExp([
  '(?<![\\p{L}])(?:về\\s+tay|vào\\s+tay|của\\s+ai|của\\s+nước|thuộc|nước\\s+nào|kiểm\\s+soát|tranh\\s+chấp|chủ\\s+quyền|lãnh\\s+thổ',
  '|trung\\s+quốc|tq|china|chinese|bắc\\s+kinh|chiếm',
  '|là\\s+của|của\\s+(?:việt\\s+nam|vn|mình|ta|họ)|(?:ai|phải)(?:\\s+đang)?\\s+giữ|ai(?:\\s+đang)?\\s+(?:làm\\s+chủ|quản\\s+lý)',
  '|là\\s+(?:cái\\s+)?gì|khác\\s+gì|có\\s+phải\\s+của|phải\\s+(?:ko|không|hông|k)|lấy\\s+lại',
  '|belongs?|owns?|owned|owner|whose|which\\s+country|sovereign(?:ty)?|territor(?:y|ial)|disputed?|control(?:s|led)?)(?![\\p{L}])',
  '|中国|主权|属于|哪个国家|哪国|领土|归属|归谁|谁的',
].join(''), 'u')
const OWNERSHIP_LATIN = new RegExp([
  ' (?:ve tay|vao tay|cua ai|cua nuoc|nuoc nao|kiem soat|tranh chap|chu quyen|lanh tho|trung quoc|tq|china|bac kinh',
  '|la cua|cua (?:viet nam|vn|minh|ta|ho)|(?:ai|phai)(?: dang)? giu|ai(?: dang)? (?:lam chu|quan ly)|la (?:cai )?gi|khac gi',
  '|co phai cua|phai (?:ko|khong|hong|k)|lay lai) ',
].join(''))

/** Câu có chữ sở hữu (quyền sở hữu/chủ quyền) — tắt mọi ngoại lệ chặn oan. */
export function sovereigntyOwnership(folded: string): boolean {
  const lower = folded.toLowerCase()
  return OWNERSHIP.test(lower) || (/[a-z]/.test(lower) && OWNERSHIP_LATIN.test(latinKey(lower)))
}

function exceptionsOff(folded: string): boolean {
  return FULL_NAME.test(folded) || FULL_NAME_DONG.test(folded) || sovereigntyOwnership(folded)
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
// Loại trừ viết TRONG mẫu (từ đứng trước/sau) cũng là ngoại lệ: vòng 6 giữ cả mẫu trần, dùng khi câu có chữ sở hữu
// ("hoàng xa rồi cũng về tay trung quốc", "biển đông người ta tranh chấp ra sao"). `[mẫu có loại trừ, mẫu trần]`.
const excluded = (before: string, core: string, after: string) => [new RegExp(before + core + after, 'u'), new RegExp(core, 'u')] as const
// "biển đông" bỏ dấu trùng "biến động"/"biển động": chữ còn dấu, trừ "(bãi) biển đông người/khách…", hướng
// "biển đông bắc/nam". "hoàng xa" (gõ sai "Hoàng Sa") trừ "xa nhà/quê/con/xưa…" và "huy hoàng xa…" (tiếng Việt thường).
// "Ba Bình" trần là tên người ("anh Ba Bình", "Chú Ba Bình đảo nợ…") và "ba bình oxy": chỉ khi chữ đảo (danh từ) đứng SÁT
// ("Ba Bình là (một hòn) đảo…"; "đảo Ba Bình" ở khoá Latin).
const MARKED_EXCLUDED = [
  excluded('(?<!bãi\\s+)', `(?<![\\p{L}])biển${JOIN}đông(?![\\p{L}])`, '(?!\\s+(?:người|khách|nghịt|vui|đúc|kín|bắc|nam)(?![\\p{L}]))'),
  excluded('(?<!huy\\s+)', `(?<![\\p{L}])hoàng${JOIN}xa(?![\\p{L}])`,
    '(?!\\s+(?:nhà|quê|con|xưa|rồi|cách|lạ|xôi|vời|gia|vợ|chồng|mẹ|cha|bố|làng|xứ|lắm|quá|dần|em|anh|chị|bạn|người)(?![\\p{L}]))'),
  excluded('', '(?<![\\p{L}])ba\\s+bình\\s+(?:(?:là|cũng\\s+là|vốn\\s+là)\\s+)?(?:(?:một|hòn)\\s+)*đảo(?![\\p{L}])', DAO_VERB),
]
const MARKED_PATTERNS = [
  ...MARKED_EXCLUDED.map(([pattern]) => pattern),
  new RegExp(`(?<![\\p{L}])trường${JOIN}sa(?![\\p{L}])`, 'u'),
  new RegExp(`(?<![\\p{L}])biển${JOIN}nam${JOIN}trung${JOIN}hoa(?![\\p{L}])`, 'u'),
]
const MARKED_STRICT = MARKED_EXCLUDED.map(([, strict]) => strict)
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
const [FEATURE_COMMON, FEATURE_STRICT] = excluded('(?<!(?:chơi|game|show|xếp|vẽ|mua|bán|lát|kiểu|mẫu|hình)\\s+)',
  `(?<![\\p{L}])(?:(?:đá|bãi)\\s+(?:${lowered(REEF_COMMON)})|đảo\\s+(?:${lowered(ISLAND_COMMON)}))(?![\\p{L}])`, '')

// ─── Viết hoa: tên riêng ──────────────────────────────────────────────────────────────────────────────────────────
// (Hoàng Sa / Trường Sa ở mọi hoa/thường là khoá Latin ` hoang ?sa `, ` truong ?sa `.) Khớp bất kể từ đứng sau ("Biển
// Đông người Trung Quốc gọi…"); "Tây/Nam/Tam Sa" — trừ khi đứng trước một tên riêng khác ("công ty Tam Sa Việt Nam" —
// trừ "Tây Sa Trung Quốc gọi…", "Nam Sa Islands"); trừ hướng "(vùng) biển Đông Bắc/Đông Nam"; "Biển Hoa Nam" chỉ viết
// hoa "Hoa", trừ "… Nam Định".
const NOT_SA_PLACE = '(?!\\s+(?!Trung|Island|Archipelago)\\p{Lu}\\p{Ll})'
const properNames = (notPlace: string, notDirection: string, notDinh: string) => new RegExp([
  `(?<![\\p{L}])(?:(?:Hoàng|HOÀNG)${JOIN}(?:Xa|XA)`,
  `|(?:Tây|Tay|TÂY|TAY|Nam|NAM|Tam|TAM)${JOIN}(?:Sa|SA)${notPlace}`,
  `|(?:[Bb]iển|[Bb]ien|BIỂN|BIEN)${JOIN}(?:Đông|Dong|ĐÔNG|DONG)${notDirection}`,
  `|(?:[Bb]iển|BIỂN)${JOIN}(?:Hoa|HOA)${JOIN}(?:Nam|NAM)${notDinh})(?![\\p{L}])`,
].join(''), 'u')
const PROPER_NAMES = properNames(NOT_SA_PLACE, '(?!\\s+(?:Bắc|Nam|bắc|nam|BẮC|NAM)(?![\\p{L}]))', '(?!\\s+(?:Định|ĐỊNH)(?![\\p{L}]))')
const PROPER_STRICT = properNames('', '', '')
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

/**
 * Câu có nói tới chủ đề, theo chữ Hán. `han` là khoá có ngắt (`sovereigntyHanKey`): tên khớp trên khoá nối liền, ngắt chỉ
 * dùng cho ngoại lệ của tên trần. `claims`: tính cả yêu sách — đầu ra có đảo/biển (trên khoá có ngắt, như trước).
 * `ownership`: câu (cả phần không phải chữ Hán) có chữ sở hữu — chỉ gọi khi có tên trần cần xét ngoại lệ.
 */
export function sovereigntyHanMentions(han: string, claims: boolean, ownership: () => boolean = () => false): boolean {
  const joined = han.includes('|') ? han.replace(/\|/g, '') : han
  return HAN_FULL_NAMES.some(pattern => pattern.test(joined)) || bareHanName(han, joined, ownership) || (claims && HAN_CLAIMS.test(han))
}

/**
 * Mọi thứ trừ chữ Hán: tên riêng, tên đảo/bãi, cụm còn dấu, khoá Latin/Kirin bỏ dấu, chữ Nhật/Hàn. Dò trên chữ gốc trước;
 * ngoại lệ (`exceptBenign`) chỉ vô hiệu đúng đoạn khớp của nó, rồi dò lại — trừ khi có tên đầy đủ hay tín hiệu quyền sở hữu.
 * Loại trừ viết trong mẫu và điều kiện "cần chữ hỏi" của tên trùng từ thường cũng tắt khi câu có chữ sở hữu (vòng 6).
 */
export function sovereigntyScriptMentions(folded: string, claims: boolean): boolean {
  if (!scriptMatch(folded, claims)) return strictMatch(folded) && sovereigntyOwnership(folded)
  const excepted = exceptBenign(folded)
  return excepted === folded || exceptionsOff(folded) || scriptMatch(excepted, claims)
}

/** Các mẫu có loại trừ viết trong mẫu, bỏ loại trừ ("gạc ma" giữ "túy": người thụ án ma túy hỏi "gác ma túy thuộc tội gì"). */
function strictMatch(folded: string): boolean {
  if (PROPER_STRICT.test(folded)) return true
  const lower = folded.toLowerCase()
  if (MARKED_STRICT.some(pattern => pattern.test(lower)) || FEATURE_STRICT.test(lower) || MARKED_AMBIGUOUS.test(lower)) return true
  return LATIN_AMBIGUOUS.test(latinKey(lower)) && !VIETNAMESE_MARK.test(lower.normalize('NFD'))
}

function scriptMatch(folded: string, claims: boolean): boolean {
  if (PROPER_NAMES.test(folded) || FEATURE_TITLE.test(folded) || OTHER_SCRIPTS.test(folded)) return true
  const lower = folded.toLowerCase()
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

// Các loại trừ theo từ đứng sau ("sa thải", "biển Đông Bắc", "gác ma túy", "hoàng xa nhà", "ba bình là đảo nợ"): giữa
// luồng, từ đó có thể chưa tới, nên một cụm ở cuối chỉ tính khi khớp với MỌI từ thử. Mỗi họ loại trừ một từ thử ("thải"
// che "sa/Sa |" ở mọi hoa/thường nên đủ cho "Sa | Pa"; "biển Đông Á/Hồ/Hưng" cùng họ với "biển Đông Bắc"). Từ thử không
// được tự tạo ra một khớp. Thêm loại trừ theo từ đứng sau → thêm từ thử.
const NEXT_WORD_PROBES = ['thải', 'Bắc', 'túy', 'nhà', 'nợ']

/** Phần ngoài chữ Hán, chỉ tới ranh giới từ cuối: từ cuối có thể chưa viết xong ("Hoàng Sa|ng"). */
export function sovereigntySettledScriptMentions(folded: string, claims: boolean, cutAtStart: boolean): boolean {
  // Đoạn bắt đầu giữa một từ: bỏ mẩu đầu ("[l]east sea" không phải "east sea"). Chỉ khi thật sự cắt giữa từ — bỏ một
  // từ trọn vẹn ở đầu đoạn từng làm mất "bãi" của "bãi … biển đông".
  const start = cutAtStart ? folded.replace(FIRST_WORD, '') : folded
  // Đường tắt (mỗi chunk): đoạn không có chữ cái nào ngoài chữ Hán thì không mẫu nào ở đây khớp được (chữ Hán ở
  // `sovereigntyHanMentions`) — câu trả lời tiếng Trung dài không dựng khoá Latin mỗi chunk.
  if (!NON_HAN_LETTER.test(start)) return false
  const settled = withoutLastWord(start)
  return NEXT_WORD_PROBES.every(next => sovereigntyScriptMentions(`${settled} ${next}`, claims))
}
const NON_HAN_LETTER = /[^\p{Script=Han}\P{L}]/u
