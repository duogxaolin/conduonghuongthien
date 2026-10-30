/**
 * Ngữ cảnh đảo/biển và cụm yêu sách của bộ khớp chủ quyền (lớp đầu ra) — hàm thuần, không trạng thái, không import guard.
 * Tách khỏi `sovereignty-patterns.ts` ở vòng 7 (tệp đó chạm trần 400 dòng); bộ khớp tên ở đó gọi `sovereigntyHanClaim` /
 * `sovereigntyTextClaim` khi đang xét chữ do model viết. Tên xuất có tiền tố `sovereignty`: Nitro tự import mọi export
 * của `server/utils/**`.
 *
 * Yêu sách không gọi tên quần đảo chỉ tính khi có nói tới đảo/biển (trong câu trả lời, hoặc câu hỏi hỏi về một hòn đảo):
 * người hoàn lương từng chấp hành án "trên lãnh thổ Trung Quốc" là đúng đối tượng của cổng. Vòng 7 (verifier 6b): model
 * nói yêu sách bằng câu tự nhiên — "là của Trung Quốc", "是中国的", "归属中国", "is Chinese", "China owns it", Trung Quốc
 * gọi là Trung Hoa/TQ/Bắc Kinh/中华/PRC — lọt ở mọi phiên bản, kể cả khi câu trả lời CÓ chữ đảo. Chỉ thêm chỗ bắt.
 */
import { sovereigntyFold as fold, sovereigntyHanKey as hanKey, sovereigntyLatinKey as latinKey } from './sovereignty-normalize'

/** "đảo" là động từ ("đảo lộn", "đảo nợ", "đảo chiều"…), không phải hòn đảo. */
export const sovereigntyDaoVerb = '(?!\\s+(?:lộn|ngược|nợ|chính|mắt|chiều|điên|ngũ|mạch|hướng|vòng|phách)(?![\\p{L}]))'

// Từ cuối (có thể chưa viết xong). Lookbehind: chỉ vị trí ĐẦU từ mới quét tới cuối — không có nó, `[…]+$` thử lại từ
// mọi vị trí của một dãy chữ Hán dài không dấu cách (bậc hai, mỗi chunk).
const LAST_WORD = /(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}\p{N}]+$/u
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u
/** Bỏ từ cuối. Quét ngược tối đa 16 ký tự (từ tiếng Việt/Latin thường ngắn); từ dài hơn (dãy chữ Hán) thì regex tuyến tính. */
export function sovereigntyWithoutLastWord(text: string): string {
  const limit = Math.max(0, text.length - 16)
  let end = text.length
  while (end > limit && WORD_CHAR.test(text[end - 1]!)) end -= 1
  return end > limit || end === 0 ? text.slice(0, end) : text.replace(LAST_WORD, '')
}
const FIRST_WORD = /^[\p{L}\p{M}\p{N}]+/u
/** Khoá chữ Hán NỐI LIỀN (bỏ "|" của `sovereigntyHanKey`): "這．片．海．域" là 海域, "屬，於，中，國" là 属于中国. */
const joinedHan = (han: string) => han.includes('|') ? han.replace(/\|/g, '') : han

// ─── Ngữ cảnh đảo/biển ─────────────────────────────────────────────────────────────────────────────────────────────
// "đảo" động từ và "Côn Đảo" (trại giam) không tính. Chữ Hán xét trên khoá NỐI LIỀN (vòng 7: "這．片．海．域．屬．於．中．國"
// từng lọt mọi phiên bản — 海|域 trên khoá có ngắt không là 海域).
const ISLAND_HAN = /岛|礁|海域|领海/
const ISLAND_WORDS = new RegExp([
  '(?<![\\p{L}])(?:vùng biển|lãnh hải|hải phận|bãi đá|đá ngầm|ba bình|đá chữ thập|vành khăn|xu bi|hoàng nham',
  '|islands?|islets?|archipelagos?|reefs?|shoals?|atolls?|itu aba|fiery cross|scarborough)(?![\\p{L}])',
  `|(?<![\\p{L}])(?<!(?:khuynh|điên|lảo|chao|côn)\\s+)đảo(?![\\p{L}])${sovereigntyDaoVerb}`,
].join(''), 'u')
const ISLAND_WORDS_ALL = new RegExp(ISLAND_WORDS.source, 'gu')
// Ngữ cảnh lấy từ CÂU HỎI thì hẹp hơn: hỏi về một hòn đảo, không phải người ở "huyện đảo Lý Sơn" hay ngư dân "bị bắt
// trên vùng biển" kể chuyện thụ án ở Trung Quốc.
const QUESTION_ISLAND_HAN = /群岛|岛礁|礁/
const QUESTION_ISLAND_WORDS = /(?<![\p{L}])(?:quần đảo|hòn đảo|đảo (?:này|đó|ấy|kia|nào)|ba bình|đá chữ thập|vành khăn|xu bi|hoàng nham|islands?|archipelagos?|reefs?|itu aba|fiery cross|scarborough)(?![\p{L}])/u
// Vòng 7: câu hỏi CHỦ QUYỀN của một hòn đảo tên lạ ("Đảo Quang Ảnh của nước nào?", "金银岛是哪个国家的？", "Bãi đá ngầm này của
// ai", "Who owns Pattle Island?") cũng là hỏi về một hòn đảo — tên đảo lạ không liệt kê được. Chỉ là NGỮ CẢNH cho câu trả lời,
// không phải cổng đầu vào: vòng 7 thử làm cổng đầu vào rồi bỏ — 21/22 câu hỏi về đảo không tranh chấp ("Đảo Phú Quốc của nước
// nào?", "海南岛是哪个国家的？", "Who owns Jeju Island?") nhận lập trường thay câu trả lời (chặn oan). Hẹp: chữ hỏi phải đứng SÁT
// sau chữ đảo (≤ 5 từ, không qua dấu câu) và hỏi QUỐC GIA/người sở hữu — câu kể chuyện thụ án ("Tôi ở đảo Phú Quý, giờ ai quản
// lý hồ sơ…", "我在海南岛服过刑，哪个国家的政策更好") không bật cờ; "thuộc tỉnh nào", "ai quản lý trại giam", "海南岛属于哪个省",
// "金银岛是哪个国家的作家写的" không phải.
// Chữ hỏi: quốc gia/người sở hữu ("ai quản lý" không — "trại giam trên đảo do ai quản lý"; "nước nào quản lý" thì có).
const OWNER_VI = [
  '(?:của\\s+(?:ai|nước\\s+nào|quốc\\s+gia\\s+nào)|thuộc\\s+(?:về\\s+)?(?:ai|nước\\s+nào|quốc\\s+gia\\s+nào)|thuộc\\s+chủ\\s+quyền\\s+(?:của\\s+)?(?:ai|nước\\s+nào)',
  '|(?:do\\s+)?(?:ai|nước\\s+nào|quốc\\s+gia\\s+nào)\\s+(?:đang\\s+)?(?:sở\\s+hữu|làm\\s+chủ|kiểm\\s+soát|chiếm|nắm\\s+giữ|giữ(?!\\s+gìn))',
  '|(?:do\\s+)?(?:nước|quốc\\s+gia)\\s+nào\\s+(?:đang\\s+)?quản\\s+lý|của\\s+(?:mình|ta|việt\\s+nam|vn)\\s+hay\\s+(?:của\\s+)?(?:họ|trung\\s+quốc|tq))',
].join('')
const ISLAND_VI = `(?:(?:quần|hòn)\\s+)?(?<!(?:khuynh|điên|lảo|chao|côn)\\s+)đảo(?![\\p{L}])${sovereigntyDaoVerb}|bãi\\s+đá|đá\\s+ngầm|bãi\\s+cạn|rạn\\s+san\\s+hô`
// "cay" (đảo cát) chỉ trong câu tiếng Anh: không dấu thì là "cay" (vị cay) — "Món cay này của ai?".
const ISLAND_EN_WORDS = 'islands?|isles?|islets?|archipelagos?|reefs?|shoals?|atolls?'
const ISLAND_EN = `(?<![\\p{L}])(?:${ISLAND_EN_WORDS}|cays?)(?![\\p{L}])`
// Tối đa 5 từ ở giữa, không qua dấu câu, không qua giới từ ("Who controls the ferry to the island?").
const NEAR = '(?![\\p{L}])(?:\\s+(?!(?:to|on|at|in|of|from|for|near|by|with)(?![\\p{L}]))[\\p{L}\\p{N}\'’]+){0,5}?\\s+'
const COUNTRY_EN = 'chinese|vietnamese|filipino|taiwanese|malaysian'
const ISLAND_OWNER_QUESTION = new RegExp([
  `(?<![\\p{L}])(?:${ISLAND_VI}|(?:${ISLAND_EN_WORDS})(?![\\p{L}]))(?:\\s+[\\p{L}\\p{N}]+){0,5}?\\s+(?:là\\s+)?${OWNER_VI}(?![\\p{L}])`,
  `|(?<![\\p{L}])(?:ai|nước\\s+nào|quốc\\s+gia\\s+nào)\\s+(?:đang\\s+)?(?:sở\\s+hữu|làm\\s+chủ|kiểm\\s+soát|chiếm|nắm\\s+giữ)\\s+(?:${ISLAND_VI})`,
  `|(?<![\\p{L}])chủ\\s+quyền\\s+(?:(?:của|đối\\s+với|với)\\s+)?(?:${ISLAND_VI})`,
  // Tiếng Anh, chữ hỏi và chữ đảo cách nhau ≤ 5 từ: "Who owns Pattle Island?", "Pattle Island belongs to which country?",
  // "Which country does Money Island belong to?", "Whose is that reef?", "Robert Island — whose is it?", "Is Triton Island
  // Chinese or Vietnamese?" — không "Whose job is it to help … on the island?".
  `|(?<![\\p{L}])(?:who\\s+(?:owns|controls|claims|holds)|which\\s+(?:country|nation)\\s+(?:owns|controls|claims)|owned\\s+by\\s+(?:whom|who|which)|sovereignty\\s+over)${NEAR}${ISLAND_EN}`,
  `|(?<![\\p{L}])whose(?:\\s+[\\p{L}'’]+){0,3}?\\s+${ISLAND_EN}|${ISLAND_EN}\\s*[-–—:,]?\\s*whose\\s+(?:is|are)\\s+(?:it|they|this|that)(?![\\p{L}])`,
  `|(?<![\\p{L}])which\\s+(?:country|nation)\\s+(?:does|do|did)${NEAR}${ISLAND_EN}(?:\\s+[\\p{L}'’]+){0,2}?\\s+belong`,
  `|${ISLAND_EN}${NEAR}(?:belongs?\\s+to\\s+(?:whom|who|which)|owned\\s+by\\s+(?:whom|who|which))(?![\\p{L}])`,
  `|(?<![\\p{L}])(?:is|are)(?:\\s+[\\p{L}\\p{N}'’]+){0,4}?\\s+${ISLAND_EN}\\s+(?:${COUNTRY_EN})\\s+or\\s+(?:${COUNTRY_EN})(?![\\p{L}])`,
].join(''), 'u')
// Tên đảo/bãi/đá viết hoa như tên riêng ("bãi Vũng Mây thuộc ai", "đá Núi Le ai đang chiếm", "hòn Mù của nước nào") — trên chữ
// GIỮ hoa/thường; "bãi xe này thuộc ai", "hòn đá này của ai" (viết thường) không phải.
// "Northeast Cay" viết hoa (tên tiếng Anh) cũng vậy.
const FEATURE_OWNER_QUESTION = new RegExp(`(?<![\\p{L}])(?:(?:[Bb]ãi|[Hh]òn|[Đđ]á)(?:\\s+\\p{Lu}\\p{Ll}*){1,3}|(?:\\p{Lu}\\p{Ll}+\\s+){1,3}Cays?)(?:\\s+[\\p{L}\\p{N}]+){0,3}?\\s+(?:là\\s+)?${OWNER_VI}(?![\\p{L}])`, 'u')
// Chữ Hán trên khoá CÓ ngắt ("是谁的" phải hết mệnh đề: "金银岛是哪个国家的作家写的" là hỏi tác giả); "是中国的吗/属于越南吗" là hỏi
// chủ quyền.
const ISLAND_OWNER_QUESTION_HAN = new RegExp([
  '(?:岛|礁|海域)[^|]{0,12}?(?:是(?:谁|哪个国家|哪国)的(?:\\||$)|属于(?:谁|哪个国家|哪国)|归属(?:于)?(?:谁|哪)|归谁|(?:谁|哪个国家|哪国)(?:拥有|管辖|控制)',
  '|主权(?:属于|归|在)?(?:谁|哪)|(?:是|属于)(?:中国|越南|菲律宾|台湾|马来西亚)的?(?:吗|么|嗎))|(?:谁|哪个国家|哪国)(?:拥有|管辖|控制)[^|]{0,8}?(?:岛|礁|海域)',
].join(''))

/**
 * Câu hỏi chủ quyền của một hòn đảo/bãi/vùng biển, kể cả tên lạ (cả câu hỏi; `folded`: `sovereigntyFold`). Chữ Hán xét trên
 * khoá có ngắt và cả khoá nối liền ("群，岛，是，谁，的？"). Chỉ dùng làm ngữ cảnh câu hỏi (`sovereigntyQuestionIslandContext`).
 */
export function sovereigntyIslandOwnershipQuestion(folded: string): boolean {
  if (ISLAND_OWNER_QUESTION.test(folded.toLowerCase()) || FEATURE_OWNER_QUESTION.test(folded)) return true
  const han = hanKey(folded)
  return ISLAND_OWNER_QUESTION_HAN.test(han) || ISLAND_OWNER_QUESTION_HAN.test(joinedHan(han))
}

// ─── Cụm yêu sách ──────────────────────────────────────────────────────────────────────────────────────────────────
// Tên nước của bên yêu sách trên khoá Latin bỏ dấu (khoá giữ chữ Hán: "thuộc chủ quyền 中國" → "thuoc chu quyen 中国"):
// Trung Quốc / Trung Hoa / Trung Cộng / TQ / Bắc Kinh / China / PRC / 中国 / 中华 (中華人民共和國) / 中共. "Tàu" KHÔNG ở đây:
// bỏ dấu là "tau" — tàu thuyền ("vùng biển có nhiều tàu", "thuộc về chủ tàu") — xem `TAU_CLAIM`.
const CN = '(?:cong hoa nhan dan trung hoa|trung quoc|trung hoa|trung cong|tq|bac kinh|(?:the )?people s republic of china|(?:the )?prc|china|(?:中国|中华|中共)\\S*)'
const LATIN_CLAIMS = [
  ` lanh tho (?:\\S+ ){0,5}${CN} `,
  ` thuoc (?:\\S+ ){0,4}${CN} `, // "thuộc (về / của / chủ quyền của) …"
  ` chu quyen (?:\\S+ ){0,3}${CN} `,
  ` ${CN} (?:\\S+ ){0,4}(?:chu quyen|quan ly|kiem soat|chiem dong|chiem giu|so huu|lam chu) `,
  ` (?:vung bien|lanh hai|hai phan) (?:\\S+ ){0,3}${CN} `,
  // "là của Trung Quốc", "đều là của TQ", "là của nước/chính quyền Trung Hoa".
  ` la (?:(?:hoan toan|that su|chinh thuc|tu lau|von|deu|da) )?cua (?:rieng |nuoc |phia |chinh quyen |nha nuoc )?${CN} `,
  // "là đất của", "là một phần không thể tách rời của", "là vùng biển của" — chỉ khi giữa "là" và "của" có danh từ đất đai
  // ("là tù nhân của Trung Quốc" không phải).
  ` la (?:\\S+ ){0,2}(?:dat|lanh tho|lanh dia|dia phan|phan|bo phan|vung|tai san|so huu|chu quyen|hai phan|lanh hai|dao|quan dao|bien) (?:\\S+ ){0,4}cua (?:nuoc |phia )?${CN} `,
  ` belong(?:s|ed|ing)? to ${CN} `,
  ` part of ${CN} `,
  ` ${CN} (?:\\S+ ){0,4}(?:sovereignty|territory) `,
  ` ${CN} (?:\\S+ ){0,2}owns? (?:it|them|these|those|this|that|the|all|both|its|each) `, // "China owns it"
  ` (?:owned|controlled|administered|governed|occupied) by ${CN} `,
  ` ${CN} s (?:territory|island|islands|sea|waters|sovereign) `, // "China's"
  ` chinese (?:territory|sovereignty|control|administration|jurisdiction|soil|land|waters) `,
  ` (?:indisputable|inherent) (?:sovereignty|part|territory) `,
].map(source => new RegExp(source))
// "is/are Chinese" chỉ khi HẾT CÂU hoặc liền sau là đất/đảo/biển ("Pattle Island is Chinese.", "They are Chinese.") — khoá
// Latin không còn dấu câu, nên xét trên chữ thường đã gấp. Dấu phẩy không tính ("…island are Chinese, so learning…").
const IS_CHINESE = /(?<![\p{L}])(?:is|are|was|were|remains?)\s+(?:(?:all|now|still|rightfully|historically|legally|indisputably|undeniably|always|clearly|officially)\s+)*chinese(?=\s*(?:[.!;。]|$)|\s+(?:territory|soil|land|islands?|waters|property|possessions?)(?![\p{L}]))/u
// "Tàu" (Trung Quốc, khẩu ngữ) chỉ khi VIẾT HOA như tên riêng, ngay sau động từ yêu sách ("thuộc về Tàu", "là của Tàu"), và
// không phải chữ đầu của một tên riêng dài hơn ("thuộc về Tàu Cao tốc Phú Quốc", "là của Tàu Hải Âu").
const TAU_CLAIM = /(?<![\p{L}])(?:[Ll]à|[Tt]huộc)(?:\s+(?:về|của|đất|lãnh\s+thổ|chủ\s+quyền|quyền|sở\s+hữu|một\s+phần))*\s+(?:nước\s+|bọn\s+|người\s+)?(?:Tàu|TÀU)(?![\p{L}])(?!\s+\p{Lu})/u
// Chữ Hán, trên khoá NỐI LIỀN, chữ phồn thể đã gộp ("中華人民共和國" → 中华人民共和国, "歸屬" → 归属).
const COUNTRY_HAN = ['中华人民共和国', '中国', '中华', '中共']
const HC = `(?:${COUNTRY_HAN.join('|')})`
const HAN_CLAIMS = new RegExp([
  `${HC}.{0,6}领土|领土.{0,6}${HC}|固有领土|属于${HC}|${HC}.{0,15}主权|主权.{0,4}${HC}|自古以来.{0,4}${HC}|${HC}.{0,4}管辖`,
  // Vòng 7: 归属(于)中国, 归/为中国所有, 属中国, 中国(一直)拥有 + vật sở hữu xác định (这些/它/主权…; "中国拥有很多工厂" không).
  `|归属.{0,2}${HC}|[归为]${HC}所有|属${HC}|${HC}.{0,2}拥有(?:这|那|该|它|其|此|主权|全部|整个)`,
].join(''))
// "是中国的" (这些岛屿是中国的。/ 它们是中国的): chỉ khi HẾT MỆNH ĐỀ hoặc liền sau là đất đai — "这是中国的法律" không phải. Xét trên
// khoá CÓ ngắt (khoá nối liền không còn biết đâu là hết mệnh đề), chữ nối bằng "|" tuỳ ý ("是，中，国，的，。"). Hết chữ ("$")
// chỉ tính khi đã biết hết câu: giữa luồng nơi gọi nối chữ thử sau khoá (chữ kế chưa tới).
const loose = (word: string) => [...word].join('\\|?')
const HAN_END_CLAIM = new RegExp(`是\\|?(?:${COUNTRY_HAN.map(loose).join('|')})\\|?的(?:\\||$|${['一部分', '岛', '海', '领', '国土', '土地', '地方', '属地'].map(loose).join('|')})`)
/** Mẫu chữ Hán dài nhất (`中华人民共和国.{0,15}主权`, 24 chữ): cửa sổ chữ Hán của lớp đầu ra phải dài hơn. */
export const SOVEREIGNTY_HAN_CLAIM_MAX = 24
/** Chữ thử nối sau khoá chữ Hán giữa luồng: không phải dấu câu, không phải chữ đất đai — "的" ở cuối chưa là hết mệnh đề. */
const HAN_SETTLE_PROBE = '区'
// Giữa luồng (mỗi chunk): mọi mẫu yêu sách ngoài chữ Hán cần một trong các chữ này — hoặc một chữ số, vì khoá Latin đọc
// "Ch1na"/"Chin4" là "china" — không có thì khỏi dựng khoá Latin.
const CLAIM_PREFILTER = /trung|china|chinese|indisputable|inherent|tq|kinh|prc|tàu|中[国华共]|\d/iu
// Mẫu nào ngoài chữ Hán cũng cần chữ Latin ("thuộc", "là … của", "owns"): đoạn chỉ có chữ Hán thì khỏi xét.
const NON_HAN_LETTER = /[^\p{Script=Han}\P{L}]/u

/**
 * Cụm yêu sách chữ Hán. `han`: khoá chữ Hán (`sovereigntyHanKey`) — có "|" thì "是中国的" hết mệnh đề cũng tính; khoá nối liền
 * chỉ có các cụm còn lại. Hết chuỗi tính là hết câu: giữa luồng, nối `HAN_SETTLE_PROBE` (xem `sovereigntySettledClaim`).
 */
export function sovereigntyHanClaim(han: string): boolean {
  return HAN_CLAIMS.test(joinedHan(han)) || HAN_END_CLAIM.test(han)
}

/** Cụm yêu sách ngoài chữ Hán, trên chữ đã gấp (`sovereigntyFold`). */
export function sovereigntyTextClaim(folded: string): boolean {
  if (!NON_HAN_LETTER.test(folded)) return false
  const lower = folded.toLowerCase()
  if (TAU_CLAIM.test(folded) || IS_CHINESE.test(lower)) return true
  const latin = latinKey(lower)
  return LATIN_CLAIMS.some(pattern => pattern.test(latin))
}

/** Chữ do model viết có nói tới đảo/biển — điều kiện để tính yêu sách. */
export function sovereigntyIslandContext(folded: string, han: string): boolean {
  return ISLAND_HAN.test(joinedHan(han)) || ISLAND_WORDS.test(folded.toLowerCase())
}

/**
 * `sovereigntyIslandContext` giữa luồng, trên phần đã chốt: bỏ từ cuối chưa viết xong, và "đảo" ở cuối chỉ tính khi
 * vẫn là đảo với từ thử "lộn" theo sau (model stream theo âm tiết: "…bị đảo | lộn…"). `skipFirstWord`: đoạn bắt đầu ở
 * một từ chỉ làm ngữ cảnh (từ đứng trước, đã xét ở lượt trước) — "đảo" trùng từ đó không tính, vì từ trước NÓ đã trôi
 * khỏi đoạn ("[Côn] Đảo" từng bật cờ ở 4/5 cách chia chunk).
 */
export function sovereigntySettledIslandContext(folded: string, han: string, skipFirstWord: boolean): boolean {
  if (ISLAND_HAN.test(joinedHan(han))) return true
  const lower = `${sovereigntyWithoutLastWord(folded).toLowerCase()} lộn`
  const firstWordEnd = skipFirstWord ? (lower.match(FIRST_WORD)?.[0].length ?? 0) : 0
  for (const match of lower.matchAll(ISLAND_WORDS_ALL)) if (match.index >= firstWordEnd) return true
  return false
}

/** Câu hỏi hỏi về một hòn đảo: tên/chữ quần đảo, hoặc chữ đảo kèm chữ hỏi chủ quyền. */
export function sovereigntyQuestionIslandContext(question: string): boolean {
  const folded = fold(question)
  const han = joinedHan(hanKey(folded))
  const lower = folded.toLowerCase()
  return QUESTION_ISLAND_HAN.test(han) || QUESTION_ISLAND_WORDS.test(lower) || sovereigntyIslandOwnershipQuestion(folded)
}

/**
 * Chỉ cụm yêu sách, trên phần đã chốt (bỏ từ cuối chưa viết xong; chữ Hán cuối chưa biết chữ kế) — để biết khi nào phải
 * giữ chữ lại. `han`: khoá chữ Hán của cửa sổ, có hoặc không "|".
 */
export function sovereigntySettledClaim(folded: string, han: string): boolean {
  if (sovereigntyHanClaim(han + HAN_SETTLE_PROBE)) return true
  return CLAIM_PREFILTER.test(folded) && sovereigntyTextClaim(sovereigntyWithoutLastWord(folded))
}
