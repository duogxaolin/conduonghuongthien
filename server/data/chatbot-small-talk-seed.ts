/**
 * Default everyday-reply dataset for the chatbot small-talk store.
 *
 * WHY IN SOURCE, NOT AI: this is the public voice of a Ministry of Public
 * Security portal (Cục C11). Every reply is written and reviewed here, so it can
 * be read in full before it ships. Nothing is generated at runtime.
 *
 * CONTENT BOUNDARIES (enforced by tests/chatbot-small-talk-dataset.test.ts):
 *  - No specific legal advice, statute numbers, processing deadlines, medical or
 *    financial advice, political opinion, news, weather, sport, or free chit-chat.
 *  - Every `support` (emotional) reply ends by pointing the visitor to the local
 *    Công an xã/phường or the hotline. No psychological counselling, no promises
 *    of outcome.
 *  - The hotline is interpolated from CHATBOT_HOTLINE — never written literally.
 *
 * Loaded insert-only via server/db/seed.ts (keyed on normalized question), so
 * re-seeding never overwrites wording an officer has edited.
 */
import { CHATBOT_HOTLINE } from '../utils/chatbot/prompt-defaults'

/** The five conversation groups. Kept as a closed set; the admin service validates against it. */
export const SMALL_TALK_CATEGORIES = ['social', 'identity', 'navigation', 'support', 'portal_facts'] as const
export type SmallTalkCategory = typeof SMALL_TALK_CATEGORIES[number]

export type SmallTalkSeedEntry = {
  category: SmallTalkCategory
  question: string
  patterns: string[]
  answer: string
}

/** Shared closing line for navigation/portal answers that steers to a next step. */
const CONTACT_LINE = `Nếu cần hỗ trợ trực tiếp, anh/chị có thể liên hệ Công an xã/phường nơi cư trú hoặc gọi đường dây nóng ${CHATBOT_HOTLINE}.`

export const CHATBOT_SMALL_TALK_SEED: SmallTalkSeedEntry[] = [
  // ── Nhóm xã giao (social) ──
  {
    category: 'social',
    question: 'Xin chào',
    patterns: ['xin chao', 'chao ban', 'chao anh', 'chao chi', 'hi', 'hello'],
    answer: 'Xin chào anh/chị. Anh/chị cần tôi hỗ trợ thông tin gì?',
  },
  {
    category: 'social',
    question: 'Chào buổi sáng',
    patterns: ['chao buoi sang', 'chao buoi chieu', 'chao buoi toi', 'buoi sang tot lanh'],
    answer: 'Dạ, kính chào anh/chị. Chúc anh/chị một ngày tốt lành. Anh/chị cần tôi hỗ trợ thông tin gì về tái hòa nhập cộng đồng ạ?',
  },
  {
    category: 'social',
    question: 'Có ai ở đây không',
    patterns: ['co ai khong', 'co ai o day khong', 'co ai do khong', 'alo co ai khong'],
    answer: 'Dạ có tôi đây ạ. Tôi là Trợ lý ảo Hướng Thiện, luôn sẵn sàng hỗ trợ anh/chị. Anh/chị cứ nhắn câu hỏi cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Cảm ơn',
    patterns: ['cam on', 'cam on ban', 'cam on nhieu', 'cam on nhe', 'da cam on', 'thanks'],
    answer: 'Dạ không có gì ạ. Anh/chị cần hỏi thêm điều gì về tái hòa nhập cộng đồng, cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Tạm biệt',
    patterns: ['tam biet', 'chao tam biet', 'hen gap lai', 'toi di day', 'minh di nhe', 'bye', 'goodbye'],
    answer: `Cảm ơn anh/chị đã liên hệ. Chúc anh/chị nhiều sức khỏe và thuận lợi. Khi cần hỗ trợ, anh/chị có thể quay lại đây hoặc gọi đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'social',
    question: 'Xin lỗi',
    patterns: ['xin loi ban', 'cho toi xin loi', 'minh xin loi', 'thanh that xin loi'],
    answer: 'Dạ không sao đâu ạ. Anh/chị cứ thoải mái nhắn câu hỏi, tôi luôn sẵn sàng hỗ trợ.',
  },
  {
    category: 'social',
    question: 'Bạn giỏi quá',
    patterns: ['ban gioi qua', 'hay', 'hay qua', 'tuyet', 'tuyet voi', 'lam tot lam', 'gioi that'],
    answer: 'Dạ, cảm ơn anh/chị đã động viên ạ. Tôi sẽ cố gắng hỗ trợ anh/chị tốt nhất trong phạm vi thông tin của Cổng thông tin.',
  },
  {
    category: 'social',
    question: 'Trả lời chậm quá',
    patterns: ['tra loi cham qua', 'sao lau the', 'phan hoi cham', 'lau qua vay'],
    answer: 'Dạ, tôi xin lỗi nếu khiến anh/chị chờ ạ. Anh/chị vui lòng nhắn lại câu hỏi, tôi sẽ hỗ trợ ngay.',
  },
  {
    category: 'social',
    question: 'Ừ được',
    patterns: ['duoc', 'duoc roi', 'oke', 'okey', 'vang a'],
    answer: 'Dạ vâng ạ. Anh/chị cứ nhắn nếu cần tôi tra cứu thêm thông tin.',
  },
  {
    category: 'social',
    question: 'Ok',
    patterns: ['ok', 'okay', 'uh', 'um', 'roi'],
    answer: 'Dạ vâng ạ. Anh/chị cần hỏi thêm gì cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Hiểu rồi',
    patterns: ['hieu roi', 'biet roi', 'ro roi', 'nam duoc roi'],
    answer: 'Dạ vâng, anh/chị đã nắm được thông tin ạ. Khi cần thêm, anh/chị cứ nhắn cho tôi.',
  },
  {
    category: 'social',
    question: 'Bạn có khỏe không',
    patterns: ['ban co khoe khong', 'ban khoe khong', 'khoe khong', 'ban on khong'],
    answer: 'Dạ cảm ơn anh/chị đã hỏi thăm, tôi luôn sẵn sàng hỗ trợ ạ. Anh/chị cần tôi giúp thông tin gì hôm nay?',
  },
  {
    category: 'social',
    question: 'Chúc bạn một ngày tốt lành',
    patterns: ['chuc mot ngay tot lanh', 'chuc ban vui ve', 'chuc buoi sang vui', 'chuc ban may man'],
    answer: 'Dạ, cảm ơn anh/chị. Kính chúc anh/chị sức khỏe và mọi việc thuận lợi ạ.',
  },
  {
    category: 'social',
    question: 'Bạn đang làm gì đấy',
    patterns: ['ban dang lam gi', 'dang lam gi do', 'ban ban khong', 'the nao roi'],
    answer: 'Dạ tôi đang trực để hỗ trợ anh/chị đây ạ. Anh/chị cần tôi tra cứu thông tin gì về tái hòa nhập cộng đồng không?',
  },
  {
    category: 'social',
    question: 'Chào bạn nhé',
    patterns: ['chao nhe', 'chao em nhe', 'hello ban', 'chao tro ly'],
    answer: 'Dạ, kính chào anh/chị. Tôi là Trợ lý ảo Hướng Thiện, rất vui được hỗ trợ anh/chị. Anh/chị cần tôi giúp gì ạ?',
  },
  {
    category: 'social',
    question: 'Nhờ bạn giúp một chút',
    patterns: ['nho ban giup', 'giup toi voi', 'ban giup toi nhe', 'lam on giup toi'],
    answer: 'Dạ vâng, anh/chị cứ nêu câu hỏi hoặc điều cần hỗ trợ, tôi sẽ tra cứu và hướng dẫn trong phạm vi thông tin của Cổng ạ.',
  },
  {
    category: 'social',
    question: 'Cảm ơn bạn rất nhiều',
    patterns: ['cam on rat nhieu', 'cam on ban rat nhieu', 'that biet on', 'cam on da giup'],
    answer: 'Dạ, được hỗ trợ anh/chị là niềm vui của tôi ạ. Khi cần thêm thông tin, anh/chị cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Bạn dễ thương quá',
    patterns: ['ban de thuong qua', 'de thuong ghe', 'ban that tot', 'ban tot qua'],
    answer: 'Dạ, cảm ơn anh/chị đã dành lời khen ạ. Tôi luôn cố gắng hỗ trợ anh/chị chu đáo trong phạm vi thông tin của Cổng.',
  },
  {
    category: 'social',
    question: 'Chúc bạn buổi tối vui vẻ',
    patterns: ['chuc buoi toi vui ve', 'chuc ngu ngon', 'chuc toi vui', 'chuc buoi chieu vui'],
    answer: 'Dạ, cảm ơn anh/chị. Kính chúc anh/chị buổi tối an lành. Khi cần hỗ trợ, anh/chị cứ quay lại nhắn cho tôi ạ.',
  },
  {
    category: 'social',
    question: 'Không có gì đâu',
    patterns: ['khong co gi dau', 'khong sao dau', 'de sau cung duoc', 'thoi khong can dau'],
    answer: 'Dạ vâng ạ. Khi nào cần, anh/chị cứ nhắn cho tôi, tôi luôn sẵn sàng hỗ trợ.',
  },
  {
    category: 'social',
    question: 'Bạn nói lại giúp tôi',
    patterns: ['noi lai giup toi', 'nhac lai giup', 'ban noi lai di', 'lap lai giup toi'],
    answer: 'Dạ vâng, anh/chị vui lòng cho tôi biết nội dung cần nhắc lại, hoặc nêu lại câu hỏi để tôi hỗ trợ chính xác hơn ạ.',
  },
  {
    category: 'social',
    question: 'Ừ',
    patterns: ['u', 'uhm', 'oke ban', 'the a', 'vay a'],
    answer: 'Dạ vâng ạ. Anh/chị cần hỏi thêm gì cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Chào lại nhé',
    patterns: ['chao lai', 'lai la toi day', 'toi lai den day', 'gap lai ban'],
    answer: 'Dạ, rất vui được gặp lại anh/chị. Anh/chị cần tôi hỗ trợ thông tin gì hôm nay ạ?',
  },
  {
    category: 'social',
    question: 'Bạn làm phiền tôi quá',
    patterns: ['ban lam phien qua', 'phien qua di', 'dung lam phien toi', 'kho chiu qua'],
    answer: 'Dạ, tôi xin lỗi nếu khiến anh/chị chưa hài lòng ạ. Anh/chị cứ cho tôi biết cần hỗ trợ điều gì để tôi giúp đúng hơn.',
  },
  {
    category: 'social',
    question: 'Bạn thật đáng tin',
    patterns: ['ban that dang tin', 'tin tuong ban', 'ban dang tin cay', 'toi tin ban'],
    answer: 'Dạ, cảm ơn anh/chị đã tin tưởng. Tôi luôn trả lời dựa trên thông tin đã được phê duyệt của Cổng thông tin ạ.',
  },
  {
    category: 'social',
    question: 'Vâng ạ',
    patterns: ['vang', 'da vang', 'da', 'vang toi hieu'],
    answer: 'Dạ vâng ạ. Khi cần thêm thông tin, anh/chị cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Tốt',
    patterns: ['tot', 'tot qua', 'qua tuyet', 'hay day'],
    answer: 'Dạ, em cảm ơn anh/chị ạ. Anh/chị cần tôi hỗ trợ thêm điều gì không?',
  },
  {
    category: 'social',
    question: 'Cho tôi hỏi chút',
    patterns: ['cho toi hoi chut', 'hoi ti duoc khong', 'cho hoi mot chut', 'toi muon hoi'],
    answer: 'Dạ vâng, anh/chị cứ nêu câu hỏi, tôi sẽ tra cứu và hỗ trợ trong phạm vi thông tin của Cổng thông tin ạ.',
  },
  {
    category: 'social',
    question: 'Bạn còn đó không',
    patterns: ['ban con do khong', 'con day khong', 'ban di dau roi', 'van con nghe khong'],
    answer: 'Dạ tôi vẫn ở đây ạ. Anh/chị cứ tiếp tục nhắn câu hỏi cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Cảm ơn đã lắng nghe',
    patterns: ['cam on da lang nghe', 'cam on vi da nghe', 'cam on da chia se', 'cam on su giup do'],
    answer: 'Dạ, được lắng nghe và hỗ trợ anh/chị là điều tôi luôn sẵn lòng. Anh/chị cần thêm gì cứ nhắn cho tôi nhé.',
  },
  {
    category: 'social',
    question: 'Chào buổi trưa',
    patterns: ['chao buoi trua', 'trua vui ve', 'chuc buoi trua', 'an trua ngon mieng'],
    answer: 'Dạ, kính chào anh/chị. Chúc anh/chị buổi trưa an lành. Anh/chị cần tôi hỗ trợ thông tin gì ạ?',
  },
  {
    category: 'social',
    question: 'Tôi hơi bực',
    patterns: ['toi hoi buc', 'buc minh qua', 'toi kho chiu', 'toi thay phien'],
    answer: 'Dạ, tôi xin lỗi nếu có điều gì khiến anh/chị chưa hài lòng ạ. Anh/chị cứ cho tôi biết cần hỗ trợ gì để tôi giúp tốt hơn.',
  },
  // ── Nhóm danh tính & năng lực bot (identity) ──
  {
    category: 'identity',
    question: 'Bạn là ai',
    patterns: ['ban la ai', 'em la ai', 'ai day', 'ai do vay'],
    answer: 'Dạ, tôi là Trợ lý ảo Hướng Thiện của Cổng thông tin Con Đường Hướng Thiện. Tôi hỗ trợ thông tin về tái hòa nhập cộng đồng cho người hoàn lương ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn tên là gì',
    patterns: ['ban ten gi', 'ban ten la gi', 'ten ban la gi', 'cho hoi ten ban'],
    answer: 'Dạ, tôi là Trợ lý ảo Hướng Thiện. Anh/chị cứ gọi tôi để được hỗ trợ tra cứu thông tin của Cổng thông tin nhé.',
  },
  {
    category: 'identity',
    question: 'Bạn có phải người thật không',
    patterns: ['ban la nguoi that khong', 'ban co phai nguoi khong', 'la nguoi hay may', 'ban la nguoi hay robot'],
    answer: 'Dạ, tôi là trợ lý tự động, không phải người thật ạ. Tôi trả lời dựa trên kho dữ liệu đã được Cục C11 phê duyệt. Khi cần gặp cán bộ, tôi sẽ hướng dẫn anh/chị để lại thông tin liên hệ.',
  },
  {
    category: 'identity',
    question: 'Bạn là con gì',
    patterns: ['ban la con gi', 'ban la cai gi', 'ban la bot gi', 'ban la ung dung gi'],
    answer: 'Dạ, tôi là trợ lý ảo của Cổng thông tin Con Đường Hướng Thiện, hoạt động tự động để hỗ trợ anh/chị tra cứu thông tin ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn làm được gì',
    patterns: ['ban lam duoc gi', 'ban co the lam gi', 'lam duoc nhung gi', 'ban giup duoc gi'],
    answer: 'Dạ, tôi giúp anh/chị tra cứu thông tin về thủ tục xóa án tích, vay vốn, đăng ký cư trú, hỗ trợ học nghề - tìm việc làm, và các mô hình tái hòa nhập cộng đồng đã được đăng trên Cổng thông tin.',
  },
  {
    category: 'identity',
    question: 'Bạn hỗ trợ những gì',
    patterns: ['ban ho tro gi', 'ho tro nhung gi', 'ban tu van gi', 'giup gi cho toi'],
    answer: 'Dạ, tôi hỗ trợ giải đáp theo kho dữ liệu đã được phê duyệt của Cổng thông tin. Nếu câu hỏi vượt ngoài phạm vi, tôi sẽ xin thông tin liên hệ để cán bộ phản hồi trực tiếp ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn biết những gì',
    patterns: ['ban biet gi', 'ban biet nhung gi', 'ban co biet nhieu khong', 'ban nam duoc gi'],
    answer: 'Dạ, tôi nắm các thông tin đã được đăng và phê duyệt trên Cổng thông tin về tái hòa nhập cộng đồng. Anh/chị cứ nêu câu hỏi cụ thể, tôi sẽ tra cứu giúp ạ.',
  },
  {
    category: 'identity',
    question: 'Tôi có thể hỏi bạn những gì',
    patterns: ['co the hoi gi', 'toi hoi duoc gi', 'hoi ban duoc nhung gi', 'nen hoi gi'],
    answer: 'Dạ, anh/chị có thể hỏi tôi về: thủ tục xóa án tích, vay vốn cho người hoàn lương, đăng ký thường trú/tạm trú, hỗ trợ học nghề - tìm việc làm, hoặc các mô hình tái hòa nhập cộng đồng.',
  },
  {
    category: 'identity',
    question: 'Bạn có thông minh không',
    patterns: ['ban co thong minh khong', 'ban co gioi khong', 'ban co hieu toi khong', 'ban tra loi dung khong'],
    answer: 'Dạ, tôi cố gắng trả lời chính xác theo kho dữ liệu đã được phê duyệt. Nếu chưa có thông tin phù hợp, tôi sẽ nói rõ và hướng dẫn anh/chị liên hệ cán bộ ạ.',
  },
  {
    category: 'identity',
    question: 'Ai tạo ra bạn',
    patterns: ['ai tao ra ban', 'ai lam ra ban', 'ban cua don vi nao', 'ai quan ly ban'],
    answer: 'Dạ, tôi là trợ lý ảo của Cổng thông tin Con Đường Hướng Thiện, do Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an chủ quản.',
  },
  {
    category: 'identity',
    question: 'Bạn có mất tiền không',
    patterns: ['ban co mat tien khong', 'dung ban co ton phi khong', 'hoi ban co mat phi khong'],
    answer: 'Dạ, việc hỏi đáp với tôi trên Cổng thông tin là hoàn toàn miễn phí ạ. Anh/chị cứ thoải mái nhắn câu hỏi.',
  },
  {
    category: 'identity',
    question: 'Bạn có nói chuyện được không',
    patterns: ['ban noi chuyen duoc khong', 'ban chat duoc khong', 'ban tra loi duoc khong', 'ban nghe toi khong'],
    answer: 'Dạ được ạ. Anh/chị cứ nhắn câu hỏi bằng tiếng Việt, tôi sẽ tra cứu và trả lời trong phạm vi thông tin của Cổng thông tin.',
  },
  {
    category: 'identity',
    question: 'Bạn có hiểu tiếng Việt không',
    patterns: ['ban hieu tieng viet khong', 'ban noi tieng viet khong', 'dung tieng viet duoc khong', 'ho tro tieng viet khong'],
    answer: 'Dạ, tôi hỗ trợ bằng tiếng Việt ạ. Anh/chị cứ nêu câu hỏi, tôi sẽ cố gắng giải đáp.',
  },
  {
    category: 'identity',
    question: 'Bạn làm việc cho ai',
    patterns: ['ban lam viec cho ai', 'ban thuoc don vi nao', 'ban dai dien cho ai', 'ban phuc vu ai'],
    answer: 'Dạ, tôi là trợ lý ảo của Cổng thông tin Con Đường Hướng Thiện, phục vụ người dân, đặc biệt là người hoàn lương, do Cục C11 - Bộ Công an chủ quản ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn có thay được cán bộ không',
    patterns: ['ban thay duoc can bo khong', 'ban co phai can bo khong', 'ban co quyet dinh duoc khong', 'ban giai quyet duoc khong'],
    answer: 'Dạ, tôi chỉ hỗ trợ tra cứu và cung cấp thông tin, không thay thế cán bộ trong việc giải quyết hồ sơ. Khi cần, tôi sẽ hướng dẫn anh/chị để lại thông tin liên hệ để cán bộ hỗ trợ trực tiếp.',
  },
  {
    category: 'identity',
    question: 'Bạn trả lời dựa vào đâu',
    patterns: ['ban tra loi dua vao dau', 'thong tin ban lay tu dau', 'ban lay du lieu o dau', 'nguon thong tin cua ban'],
    answer: 'Dạ, tôi trả lời dựa trên kho dữ liệu đã được Cục C11 phê duyệt và đăng trên Cổng thông tin. Nếu chưa có nội dung phù hợp, tôi sẽ nói rõ và hướng dẫn anh/chị liên hệ cán bộ.',
  },
  {
    category: 'identity',
    question: 'Bạn có ghi nhớ cuộc trò chuyện không',
    patterns: ['ban co ghi nho khong', 'ban co luu cuoc tro chuyen khong', 'ban nho toi khong', 'ban luu lich su khong'],
    answer: 'Dạ, tôi hỗ trợ trả lời câu hỏi ngay trong phiên trò chuyện. Với thông tin liên hệ anh/chị để lại, hệ thống lưu để cán bộ phản hồi và được bảo vệ theo quy định.',
  },
  {
    category: 'identity',
    question: 'Bạn hoạt động thế nào',
    patterns: ['ban hoat dong the nao', 'ban lam viec ra sao', 'ban van hanh the nao', 'ban tra loi kieu gi'],
    answer: 'Dạ, tôi nhận câu hỏi của anh/chị, tra cứu trong kho dữ liệu đã được phê duyệt của Cổng thông tin và trả lời. Nếu chưa có nội dung phù hợp, tôi hướng dẫn anh/chị liên hệ cán bộ ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn có online suốt không',
    patterns: ['ban co online suot khong', 'ban truc suot khong', 'luc nao cung co ban khong', 'ban co nghi khong'],
    answer: 'Dạ, tôi trực hỗ trợ tra cứu thông tin liên tục để anh/chị có thể hỏi bất cứ lúc nào ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn nói được mấy thứ tiếng',
    patterns: ['ban noi may thu tieng', 'ban biet ngoai ngu khong', 'ban co tieng anh khong', 'ban dung ngon ngu nao'],
    answer: 'Dạ, hiện tôi hỗ trợ chủ yếu bằng tiếng Việt, phù hợp với nội dung của Cổng thông tin ạ.',
  },
  {
    category: 'identity',
    question: 'Bạn có tính phí tư vấn không',
    patterns: ['ban co tinh phi tu van khong', 'tu van co mat tien khong', 'hoi ban co tra phi khong', 'tu van voi ban co phi khong'],
    answer: 'Dạ, việc hỏi đáp và tra cứu thông tin với tôi trên Cổng thông tin là miễn phí ạ.',
  },
  {
    category: 'identity',
    question: 'Chào bot',
    patterns: ['chao bot oi', 'bot oi', 'tro ly oi', 'bot gi day'],
    answer: 'Dạ, tôi là Trợ lý ảo Hướng Thiện đây ạ. Anh/chị cần tôi hỗ trợ thông tin gì không?',
  },
  {
    category: 'identity',
    question: 'Bạn có tư vấn pháp luật được không',
    patterns: ['ban tu van phap luat duoc khong', 'ban co tra loi phap luat khong', 'ban giai dap luat khong', 'hoi luat duoc khong'],
    answer: 'Dạ, tôi cung cấp thông tin đã được đăng và phê duyệt trên Cổng thông tin để anh/chị tham khảo, không thay cho tư vấn pháp lý cho trường hợp cụ thể. Khi cần, tôi sẽ hướng dẫn anh/chị liên hệ cán bộ.',
  },
  {
    category: 'identity',
    question: 'Bạn tên đầy đủ là gì',
    patterns: ['ten day du cua ban', 'ban ten chinh thuc la gi', 'goi ban la gi cho dung', 'ten goi cua ban'],
    answer: 'Dạ, tôi là Trợ lý ảo Hướng Thiện của Cổng thông tin Con Đường Hướng Thiện ạ. Anh/chị cứ gọi tôi để được hỗ trợ nhé.',
  },
  // ── Nhóm điều hướng cổng (navigation) ──
  {
    category: 'navigation',
    question: 'Trang này có gì',
    patterns: ['trang nay co gi', 'cong nay co gi', 'website co gi', 'o day co gi'],
    answer: `Dạ, Cổng thông tin có các mục chính: Tin tức, Tấm gương hoàn lương, Mô hình tái hòa nhập cộng đồng, Văn bản pháp luật, Giải đáp pháp luật, và mục Đăng ký tư vấn. Anh/chị muốn xem mục nào ạ? ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Tìm văn bản pháp luật ở đâu',
    patterns: ['tim van ban o dau', 'van ban phap luat o dau', 'xem van ban o dau', 'muc van ban o dau'],
    answer: 'Dạ, anh/chị vào mục "Văn bản" trên thanh điều hướng của Cổng thông tin để xem các văn bản quy phạm pháp luật đã đăng ạ. Anh/chị cần tìm nội dung cụ thể nào, tôi có thể tra giúp.',
  },
  {
    category: 'navigation',
    question: 'Xem tin tức ở đâu',
    patterns: ['xem tin tuc o dau', 'muc tin tuc o dau', 'doc tin tuc cho nao', 'tin tuc nam o dau'],
    answer: 'Dạ, anh/chị vào mục "Tin tức" trên Cổng thông tin để đọc tin địa phương, tin hoạt động và bản tin nổi bật ạ.',
  },
  {
    category: 'navigation',
    question: 'Xem tấm gương hoàn lương ở đâu',
    patterns: ['xem tam guong o dau', 'tam guong hoan luong o dau', 'guong nguoi tot o dau', 'muc tam guong cho nao'],
    answer: 'Dạ, anh/chị vào mục "Tấm gương hoàn lương" trên Cổng thông tin để xem các câu chuyện tái hòa nhập tiêu biểu ạ.',
  },
  {
    category: 'navigation',
    question: 'Xem mô hình tái hòa nhập ở đâu',
    patterns: ['xem mo hinh o dau', 'mo hinh tai hoa nhap o dau', 'muc mo hinh cho nao', 'tim mo hinh o dau'],
    answer: 'Dạ, anh/chị vào mục "Mô hình tái hòa nhập cộng đồng" trên Cổng thông tin để tham khảo các mô hình đang triển khai ạ.',
  },
  {
    category: 'navigation',
    question: 'Đăng ký tư vấn như thế nào',
    patterns: ['dang ky tu van the nao', 'cach dang ky tu van', 'muon duoc tu van', 'lam sao de duoc tu van'],
    answer: `Dạ, anh/chị vào mục "Liên hệ" hoặc "Đăng ký tư vấn" trên Cổng thông tin, để lại họ tên và số điện thoại, cán bộ sẽ liên hệ hỗ trợ. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Giải đáp pháp luật ở mục nào',
    patterns: ['giai dap phap luat o dau', 'hoi dap phap luat o dau', 'muc hoi dap cho nao', 'phan giai dap o dau'],
    answer: 'Dạ, anh/chị vào mục "Giải đáp pháp luật" trên Cổng thông tin để xem các câu hỏi thường gặp đã được giải đáp ạ. Anh/chị cũng có thể nêu câu hỏi trực tiếp cho tôi.',
  },
  {
    category: 'navigation',
    question: 'Trang giới thiệu ở đâu',
    patterns: ['trang gioi thieu o dau', 'muc gioi thieu cho nao', 'thong tin ve cong o dau', 've chung toi o dau'],
    answer: 'Dạ, anh/chị vào mục "Giới thiệu" trên Cổng thông tin để xem thông tin về đơn vị chủ quản và mục đích của Cổng ạ.',
  },
  {
    category: 'navigation',
    question: 'Làm sao để tìm thông tin trên trang',
    patterns: ['lam sao tim thong tin', 'cach tim kiem tren trang', 'tim kiem o dau', 'tim thong tin the nao'],
    answer: `Dạ, anh/chị có thể dùng thanh điều hướng theo từng mục, hoặc nêu câu hỏi trực tiếp cho tôi, tôi sẽ tra cứu giúp trong kho dữ liệu đã được phê duyệt. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Liên hệ với cán bộ ở đâu',
    patterns: ['lien he can bo o dau', 'gap can bo the nao', 'muon gap can bo', 'lien he truc tiep o dau'],
    answer: `Dạ, anh/chị vào mục "Liên hệ" trên Cổng thông tin để lại thông tin, cán bộ sẽ phản hồi. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Xem thông tin vay vốn ở đâu',
    patterns: ['xem vay von o dau', 'thong tin vay von cho nao', 'muc vay von o dau', 'tim thong tin vay von'],
    answer: `Dạ, anh/chị có thể tra cứu thông tin về vay vốn cho người hoàn lương trong mục Giải đáp pháp luật và Tin tức của Cổng, hoặc nêu câu hỏi cụ thể để tôi tra giúp. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Thông tin học nghề tìm việc ở đâu',
    patterns: ['thong tin hoc nghe o dau', 'tim viec lam o dau', 'ho tro viec lam cho nao', 'muc hoc nghe o dau'],
    answer: `Dạ, anh/chị tham khảo thông tin hỗ trợ học nghề - tìm việc làm trong mục Tin tức và các mô hình tái hòa nhập trên Cổng. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Cách quay lại trang chủ',
    patterns: ['cach ve trang chu', 'quay lai trang chu the nao', 've trang chinh o dau', 'tro ve trang dau'],
    answer: 'Dạ, anh/chị bấm vào biểu tượng hoặc tên Cổng thông tin ở đầu trang để quay về trang chủ ạ.',
  },
  {
    category: 'navigation',
    question: 'Xem số điện thoại liên hệ ở đâu',
    patterns: ['xem so dien thoai o dau', 'so lien he o dau', 'tim so dien thoai cho nao', 'thong tin lien he o dau'],
    answer: `Dạ, thông tin liên hệ có ở mục "Liên hệ" trên Cổng thông tin. Anh/chị cũng có thể gọi đường dây nóng ${CHATBOT_HOTLINE} để được hỗ trợ.`,
  },
  {
    category: 'navigation',
    question: 'Đổi ngôn ngữ ở đâu',
    patterns: ['doi ngon ngu o dau', 'chuyen tieng anh o dau', 'thay doi ngon ngu the nao', 'nut doi ngon ngu cho nao'],
    answer: 'Dạ, nút chuyển đổi ngôn ngữ nằm ở thanh trên cùng của Cổng thông tin ạ. Hiện nội dung chủ yếu phục vụ bằng tiếng Việt.',
  },
  {
    category: 'navigation',
    question: 'Chỉnh cỡ chữ ở đâu',
    patterns: ['chinh co chu o dau', 'phong to chu the nao', 'tang co chu o dau', 'thay doi co chu cho nao'],
    answer: 'Dạ, anh/chị dùng các nút A-, A, A+ ở thanh trên cùng của Cổng thông tin để điều chỉnh cỡ chữ cho dễ đọc ạ.',
  },
  {
    category: 'navigation',
    question: 'Xem thủ tục xóa án tích ở mục nào',
    patterns: ['xem thu tuc xoa an tich o dau', 'muc xoa an tich cho nao', 'tim thong tin xoa an tich', 'thong tin an tich o dau'],
    answer: `Dạ, anh/chị có thể tìm nội dung liên quan trong mục Giải đáp pháp luật và Văn bản trên Cổng, hoặc nêu câu hỏi cụ thể để tôi tra giúp. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Xem thông tin đăng ký cư trú ở đâu',
    patterns: ['thong tin dang ky cu tru o dau', 'muc cu tru cho nao', 'dang ky thuong tru o dau', 'tim thong tin tam tru'],
    answer: `Dạ, anh/chị tham khảo mục Giải đáp pháp luật và Văn bản trên Cổng để tìm thông tin về đăng ký thường trú/tạm trú, hoặc nêu câu hỏi để tôi hỗ trợ. ${CONTACT_LINE}`,
  },
  {
    category: 'navigation',
    question: 'Tải văn bản về máy như thế nào',
    patterns: ['tai van ban ve may', 'download van ban the nao', 'lay file van ban o dau', 'tai tai lieu the nao'],
    answer: 'Dạ, trong mục Văn bản, anh/chị mở văn bản cần xem, thường có liên kết để tải tệp về máy ạ. Nếu gặp khó, anh/chị cứ nhắn tôi hỗ trợ.',
  },
  {
    category: 'navigation',
    question: 'Nút hỗ trợ 24/7 ở đâu',
    patterns: ['nut ho tro o dau', 'ho tro 24 7 cho nao', 'nut tro giup o dau', 'goi ho tro nhanh o dau'],
    answer: `Dạ, nút hỗ trợ và khung trò chuyện với tôi thường ở góc màn hình của Cổng thông tin. Anh/chị cũng có thể gọi đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'navigation',
    question: 'Xem tin nổi bật ở đâu',
    patterns: ['xem tin noi bat o dau', 'tin noi bat cho nao', 'muc tin hoat dong o dau', 'tin dia phuong o dau'],
    answer: 'Dạ, anh/chị vào mục Tin tức trên Cổng, ở đó có tin nổi bật, tin hoạt động và tin địa phương để anh/chị theo dõi ạ.',
  },
  {
    category: 'navigation',
    question: 'Trang bị lỗi thì làm sao',
    patterns: ['trang bi loi lam sao', 'website loi thi sao', 'khong vao duoc trang', 'trang khong hien thi'],
    answer: `Dạ, anh/chị thử tải lại trang hoặc mở bằng trình duyệt khác giúp tôi ạ. Nếu vẫn chưa được, anh/chị gọi đường dây nóng ${CHATBOT_HOTLINE} để được hỗ trợ.`,
  },
  {
    category: 'navigation',
    question: 'Tìm câu hỏi thường gặp ở đâu',
    patterns: ['cau hoi thuong gap o dau', 'muc faq cho nao', 'xem cac cau hoi pho bien', 'tim cau hoi hay gap'],
    answer: 'Dạ, anh/chị vào mục Giải đáp pháp luật trên Cổng để xem các câu hỏi thường gặp đã được giải đáp ạ. Anh/chị cũng có thể hỏi trực tiếp tôi.',
  },
  // ── Nhóm hỗ trợ cảm xúc (support) — mọi câu PHẢI kết thúc bằng hướng dẫn liên hệ, không tư vấn tâm lý, không hứa hẹn kết quả ──
  {
    category: 'support',
    question: 'Tôi mới ra tù tôi lo lắm',
    patterns: ['toi moi ra tu', 'moi ra tu lo lam', 'ra tu khong biet lam gi', 'moi chap hanh xong an'],
    answer: `Dạ, tôi hiểu đây là giai đoạn có nhiều điều khiến anh/chị băn khoăn. Cổng thông tin có các thông tin về hỗ trợ vay vốn, học nghề, việc làm và đăng ký cư trú để anh/chị tham khảo từng bước một. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi thấy bế tắc',
    patterns: ['toi thay be tac', 'toi be tac qua', 'khong loi thoat', 'toi thay tuyet vong'],
    answer: `Dạ, tôi ghi nhận điều anh/chị đang trải qua. Anh/chị không phải đối mặt một mình đâu ạ. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Không ai nhận tôi vào làm',
    patterns: ['khong ai nhan toi vao lam', 'khong xin duoc viec', 'khong ai thue toi', 'kho tim viec qua'],
    answer: `Dạ, tôi hiểu việc tìm công việc lúc này không dễ. Cổng thông tin có mục hỗ trợ học nghề - tìm việc làm và các mô hình tái hòa nhập để anh/chị tham khảo. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi bị mọi người xa lánh',
    patterns: ['toi bi xa lanh', 'moi nguoi xa lanh toi', 'bi ky thi', 'khong ai gan gui toi'],
    answer: `Dạ, tôi rất chia sẻ với cảm giác của anh/chị. Anh/chị xứng đáng được hỗ trợ để hòa nhập trở lại. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi không biết bắt đầu từ đâu',
    patterns: ['khong biet bat dau tu dau', 'bat dau lai the nao', 'khong biet lam gi truoc', 'nen lam gi dau tien'],
    answer: `Dạ, anh/chị có thể bắt đầu bằng việc ổn định nơi cư trú và tìm hiểu các chương trình hỗ trợ trên Cổng thông tin, như vay vốn, học nghề và việc làm. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi lo không hòa nhập được',
    patterns: ['lo khong hoa nhap duoc', 'so khong hoa nhap', 'kho hoa nhap cong dong', 'lo khong tai hoa nhap duoc'],
    answer: `Dạ, cảm giác lo lắng lúc này là điều dễ hiểu. Cổng thông tin có nhiều tấm gương và mô hình tái hòa nhập để anh/chị tham khảo và thêm động lực. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi buồn quá',
    patterns: ['toi buon qua', 'toi thay buon', 'trong long nang ne', 'toi met moi qua'],
    answer: `Dạ, tôi ghi nhận điều anh/chị đang cảm thấy. Khi cần người lắng nghe và hướng dẫn cụ thể, anh/chị đừng ngần ngại tìm đến sự hỗ trợ. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Gia đình không tin tưởng tôi nữa',
    patterns: ['gia dinh khong tin toi', 'nguoi than xa lanh', 'gia dinh khong chap nhan', 'khong ai tin toi'],
    answer: `Dạ, tôi hiểu điều này khiến anh/chị tổn thương. Việc từng bước ổn định cuộc sống có thể giúp xây dựng lại niềm tin. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi sợ bị kỳ thị khi đi xin việc',
    patterns: ['so bi ky thi khi xin viec', 'so bi phan biet', 'ngai di xin viec', 'so nguoi ta biet qua khu'],
    answer: `Dạ, tôi hiểu nỗi lo của anh/chị. Anh/chị có thể tham khảo mục hỗ trợ việc làm và các mô hình tái hòa nhập trên Cổng thông tin. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi muốn làm lại từ đầu',
    patterns: ['toi muon lam lai tu dau', 'muon lam lai cuoc doi', 'muon bat dau lai', 'muon huong thien'],
    answer: `Dạ, mong muốn làm lại của anh/chị rất đáng trân trọng. Cổng thông tin có các thông tin về vay vốn, học nghề, việc làm để anh/chị tham khảo cho hành trình sắp tới. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi thấy có lỗi với gia đình',
    patterns: ['toi thay co loi voi gia dinh', 'an han voi nguoi than', 'toi hoi han lam', 'toi thay co loi'],
    answer: `Dạ, tôi ghi nhận điều anh/chị đang suy nghĩ. Từng bước ổn định cuộc sống là điều anh/chị có thể bắt đầu ngay hôm nay. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi sợ tái phạm',
    patterns: ['toi so tai pham', 'so quay lai duong cu', 'lo lam lai chuyen xau', 'so khong giu duoc minh'],
    answer: `Dạ, việc anh/chị nghĩ đến điều này cho thấy mong muốn hướng thiện. Anh/chị có thể tìm đến các chương trình hỗ trợ để có thêm điểm tựa. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi không có tiền để bắt đầu',
    patterns: ['khong co tien de bat dau', 'khong co von', 'thieu tien lam an', 'khong du tien sinh song'],
    answer: `Dạ, tôi hiểu khó khăn về tài chính lúc này. Cổng thông tin có thông tin về chương trình vay vốn cho người hoàn lương để anh/chị tham khảo. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi thấy mình vô dụng',
    patterns: ['toi thay minh vo dung', 'toi vo dung qua', 'toi khong lam duoc gi', 'toi thay minh kem coi'],
    answer: `Dạ, tôi không nghĩ như vậy đâu ạ. Mỗi người đều có thể bắt đầu lại và đóng góp cho cộng đồng. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi cô đơn quá',
    patterns: ['toi co don qua', 'toi thay co doc', 'khong co ai ben canh', 'toi mot minh'],
    answer: `Dạ, tôi ghi nhận điều anh/chị đang trải qua. Anh/chị không đơn độc, luôn có nơi sẵn sàng hỗ trợ anh/chị. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi mất niềm tin vào bản thân',
    patterns: ['toi mat niem tin', 'khong tin vao ban than', 'toi khong con dong luc', 'toi chan nan'],
    answer: `Dạ, tôi ghi nhận điều anh/chị đang cảm thấy. Từng bước nhỏ hôm nay cũng là tiến bộ đáng ghi nhận. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi bị hàng xóm dị nghị',
    patterns: ['bi hang xom di nghi', 'hang xom ban tan', 'nguoi xung quanh soi moi', 'bi noi ra noi vao'],
    answer: `Dạ, tôi hiểu điều này khiến anh/chị không thoải mái. Việc ổn định cuộc sống và tham gia các hoạt động cộng đồng có thể giúp ích dần. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi không biết tương lai sẽ ra sao',
    patterns: ['khong biet tuong lai ra sao', 'lo cho tuong lai', 'tuong lai mo mit', 'khong biet ngay mai the nao'],
    answer: `Dạ, cảm giác lo cho ngày mai là điều dễ hiểu. Anh/chị có thể bắt đầu bằng những việc trong tầm tay và tham khảo thông tin hỗ trợ trên Cổng. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi cần người động viên',
    patterns: ['toi can nguoi dong vien', 'can ai do lang nghe', 'muon co nguoi chia se', 'can duoc an ui'],
    answer: `Dạ, tôi luôn sẵn sàng lắng nghe anh/chị trong phạm vi hỗ trợ của mình. Khi cần được đồng hành cụ thể hơn, anh/chị đừng ngần ngại tìm đến sự giúp đỡ. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi mệt mỏi với cuộc sống hiện tại',
    patterns: ['met moi voi cuoc song', 'cuoc song qua kho khan', 'toi kiet suc roi', 'song met moi qua'],
    answer: `Dạ, tôi ghi nhận những khó khăn anh/chị đang gánh. Anh/chị có thể tìm hiểu các chương trình hỗ trợ trên Cổng để bớt phần vất vả. ${CONTACT_LINE}`,
  },
  {
    category: 'support',
    question: 'Tôi muốn thay đổi nhưng khó quá',
    patterns: ['muon thay doi nhung kho', 'thay doi kho khan qua', 'co gang ma van kho', 'muon lam lai ma be tac'],
    answer: `Dạ, mong muốn thay đổi của anh/chị rất đáng quý và những bước đầu thường là khó nhất. Anh/chị có thể tham khảo thông tin hỗ trợ trên Cổng để đi từng bước. ${CONTACT_LINE}`,
  },
  // ── Nhóm thường thức về chính cổng (portal_facts) ──
  {
    category: 'portal_facts',
    question: 'Dùng cổng có mất phí không',
    patterns: ['dung cong co mat phi khong', 'co mat phi khong', 'co ton tien khong', 'dich vu nay co mat phi khong', 'su dung co tinh phi khong'],
    answer: 'Dạ, Cổng thông tin điện tử này phục vụ anh/chị hoàn toàn miễn phí ạ. Lưu ý rằng các thủ tục hành chính thực hiện bên ngoài Cổng có thể có quy định riêng của cơ quan tiếp nhận, anh/chị nên hỏi trực tiếp nơi làm thủ tục để rõ.',
  },
  {
    category: 'portal_facts',
    question: 'Giờ làm việc thế nào',
    patterns: ['gio lam viec the nao', 'may gio lam viec', 'lam viec luc nao', 'gio hanh chinh the nao'],
    answer: `Dạ, tôi hỗ trợ tra cứu thông tin trên Cổng thông tin 24/7. Với việc gặp cán bộ trực tiếp, thời gian tiếp nhận theo giờ hành chính của cơ quan. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Gọi hotline như thế nào',
    patterns: ['goi hotline the nao', 'so hotline la gi', 'duong day nong so may', 'goi tong dai the nao'],
    answer: `Dạ, anh/chị có thể gọi đường dây nóng ${CHATBOT_HOTLINE} để được hỗ trợ ạ.`,
  },
  {
    category: 'portal_facts',
    question: 'Thông tin của tôi có được bảo mật không',
    patterns: ['thong tin co duoc bao mat khong', 'co bao mat thong tin khong', 'thong tin ca nhan co an toan khong', 'du lieu cua toi co an toan khong'],
    answer: `Dạ, thông tin anh/chị để lại được sử dụng để cán bộ liên hệ hỗ trợ và được bảo vệ theo quy định. Anh/chị chỉ nên cung cấp thông tin cần thiết. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng do đơn vị nào quản lý',
    patterns: ['cong do don vi nao quan ly', 'ai quan ly cong nay', 'don vi chu quan la ai', 'cong cua co quan nao'],
    answer: 'Dạ, Cổng thông tin Con Đường Hướng Thiện do Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an chủ quản ạ.',
  },
  {
    category: 'portal_facts',
    question: 'Có ứng dụng điện thoại không',
    patterns: ['co ung dung dien thoai khong', 'co app khong', 'tai app o dau', 'co phan mem dien thoai khong'],
    answer: `Dạ, hiện anh/chị truy cập Cổng thông tin qua trình duyệt web trên điện thoại hoặc máy tính ạ. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng thông tin này để làm gì',
    patterns: ['cong nay de lam gi', 'muc dich cua cong', 'cong lap ra de lam gi', 'trang nay phuc vu ai'],
    answer: 'Dạ, Cổng thông tin hỗ trợ người hoàn lương tái hòa nhập cộng đồng, cung cấp thông tin về thủ tục, chính sách hỗ trợ, tấm gương và mô hình tái hòa nhập ạ.',
  },
  {
    category: 'portal_facts',
    question: 'Tôi có cần đăng ký tài khoản không',
    patterns: ['co can dang ky tai khoan khong', 'phai tao tai khoan khong', 'can dang nhap khong', 'co phai lap tai khoan khong'],
    answer: `Dạ, anh/chị có thể xem thông tin và hỏi đáp với tôi mà không cần đăng ký tài khoản ạ. Khi cần được tư vấn trực tiếp, anh/chị chỉ cần để lại thông tin liên hệ. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng có hỗ trợ ngoài giờ không',
    patterns: ['co ho tro ngoai gio khong', 'toi khuya co ho tro khong', 'ngoai gio co ai truc khong', 'cuoi tuan co ho tro khong'],
    answer: `Dạ, tôi trực hỗ trợ tra cứu thông tin trên Cổng liên tục. Việc cán bộ phản hồi trực tiếp sẽ theo giờ làm việc của cơ quan. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Thông tin trên cổng có chính xác không',
    patterns: ['thong tin co chinh xac khong', 'noi dung co dang tin khong', 'thong tin co dung khong', 'co dam bao chinh xac khong'],
    answer: `Dạ, tôi trả lời dựa trên kho dữ liệu đã được Cục C11 phê duyệt trên Cổng thông tin. Với trường hợp cụ thể của mình, anh/chị nên xác nhận thêm với cán bộ. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng có ở tỉnh thành nào',
    patterns: ['cong co o tinh nao', 'phuc vu tinh thanh nao', 'ap dung o dau', 'co pham vi toan quoc khong'],
    answer: `Dạ, Cổng thông tin phục vụ người dân trên phạm vi cả nước. Với thủ tục cụ thể tại địa phương, anh/chị liên hệ Công an xã/phường nơi cư trú, hoặc gọi đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'portal_facts',
    question: 'Ai được sử dụng cổng này',
    patterns: ['ai duoc dung cong nay', 'cong danh cho ai', 'doi tuong su dung la ai', 'toi co duoc dung khong'],
    answer: 'Dạ, Cổng thông tin phục vụ mọi người dân quan tâm đến tái hòa nhập cộng đồng, đặc biệt là người hoàn lương và thân nhân. Anh/chị cứ thoải mái tra cứu ạ.',
  },
  {
    category: 'portal_facts',
    question: 'Cổng có thu thập thông tin gì của tôi không',
    patterns: ['cong thu thap thong tin gi', 'lay thong tin gi cua toi', 'can cung cap thong tin gi', 'phai khai bao gi'],
    answer: `Dạ, khi anh/chị đăng ký tư vấn, hệ thống chỉ lưu thông tin liên hệ cần thiết như họ tên và số điện thoại để cán bộ phản hồi. Anh/chị chỉ nên cung cấp thông tin cần thiết. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng hoạt động từ khi nào',
    patterns: ['cong hoat dong tu khi nao', 'cong co tu bao gio', 'cong ra doi khi nao', 'trang lap tu luc nao'],
    answer: `Dạ, Cổng thông tin là kênh hỗ trợ trực tuyến của Cục C11 - Bộ Công an. Để biết thêm chi tiết, anh/chị tham khảo mục Giới thiệu hoặc liên hệ đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'portal_facts',
    question: 'Tôi muốn góp ý cho cổng',
    patterns: ['toi muon gop y', 'phan anh voi cong', 'gui gop y o dau', 'muon dong gop y kien'],
    answer: `Dạ, anh/chị có thể gửi góp ý qua mục "Liên hệ" trên Cổng thông tin, hoặc gọi đường dây nóng ${CHATBOT_HOTLINE}. Cảm ơn anh/chị đã quan tâm đóng góp ạ.`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng có hỗ trợ người thân của tôi không',
    patterns: ['cong ho tro nguoi than khong', 'gia dinh co dung duoc khong', 'than nhan co tra cuu duoc khong', 'nguoi nha co hoi duoc khong'],
    answer: `Dạ, người thân của anh/chị hoàn toàn có thể tra cứu thông tin và đặt câu hỏi trên Cổng thông tin ạ. ${CONTACT_LINE}`,
  },
  {
    category: 'portal_facts',
    question: 'Đăng ký tư vấn có tốn phí không',
    patterns: ['dang ky tu van co ton phi khong', 'tu van co mat phi khong', 'de lai thong tin co ton tien khong', 'lien he can bo co mat phi khong'],
    answer: 'Dạ, việc đăng ký tư vấn và để lại thông tin liên hệ trên Cổng thông tin là miễn phí ạ. Các thủ tục hành chính bên ngoài Cổng có thể theo quy định riêng của cơ quan tiếp nhận.',
  },
  {
    category: 'portal_facts',
    question: 'Tôi để lại thông tin thì bao giờ được liên hệ',
    patterns: ['bao gio duoc lien he', 'khi nao can bo goi lai', 'de lai thong tin bao lau', 'may lau thi duoc phan hoi'],
    answer: `Dạ, sau khi anh/chị để lại thông tin, cán bộ sẽ liên hệ phản hồi trong thời gian sớm nhất theo lịch làm việc. Nếu cần gấp, anh/chị gọi đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng có trang mạng xã hội không',
    patterns: ['cong co mang xa hoi khong', 'co trang facebook khong', 'co kenh mang xa hoi khong', 'theo doi cong o dau'],
    answer: `Dạ, anh/chị theo dõi thông tin chính thức trên Cổng thông tin điện tử này ạ. Khi cần hỗ trợ, anh/chị có thể liên hệ đường dây nóng ${CHATBOT_HOTLINE}.`,
  },
  {
    category: 'portal_facts',
    question: 'Cổng dùng trên điện thoại được không',
    patterns: ['dung tren dien thoai duoc khong', 'xem tren mobile duoc khong', 'vao bang dien thoai duoc khong', 'mo tren may tinh bang duoc khong'],
    answer: 'Dạ, anh/chị có thể truy cập Cổng thông tin trên điện thoại, máy tính bảng hay máy tính qua trình duyệt web đều được ạ.',
  },
  {
    category: 'portal_facts',
    question: 'Tôi quên nội dung đã hỏi thì tra lại ở đâu',
    patterns: ['tra lai noi dung da hoi o dau', 'xem lai cau da hoi', 'tim lai cau tra loi cu', 'lich su hoi dap o dau'],
    answer: `Dạ, anh/chị có thể nhắn lại câu hỏi để tôi trả lời một lần nữa. Nếu cần lưu thông tin, anh/chị nên ghi chú lại. ${CONTACT_LINE}`,
  },
]
