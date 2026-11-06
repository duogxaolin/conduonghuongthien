import { z } from 'zod'
import { getClientIp } from '../../../../utils/client-ip'
import { requireResourcePermission } from '../../../../utils/permissions'
import { readValidated } from '../../../../utils/request-body'
import {
  ANSWER_EDIT_MAX_CHARS,
  FOLLOW_UP_MAX_CHARS,
  FOLLOW_UP_MAX_COUNT,
  answerCacheContext,
  answerCacheKeyIsLive,
  getAnswerCacheDetail,
  updateCachedAnswer,
} from '../../../../services/chatbot-answer-cache'

/**
 * Sửa tay MỘT câu trả lời đã cache: nội dung và các câu hỏi gợi ý.
 *
 * Quyền `chatbot_knowledge.update` — đọc được danh sách không đủ để thay lời mà cổng sẽ nói
 * với người dân. Câu hỏi, khoá, nguồn trích dẫn, số lượt dùng không sửa được (đổi câu hỏi là
 * đổi khoá = một hàng khác). Bản sửa chỉ sống tới khi dữ liệu nền/cấu hình AI đổi (phiên bản
 * nằm trong khoá) — trang nói rõ điều này; muốn câu trả lời bền thì đưa vào kho kiến thức.
 *
 * Body qua `readValidated` (thân bị cắt cụt là 400, không phải "không gửi gì").
 *
 * Hàng CHẾT (đã tăng phiên bản / đổi cấu hình AI sau khi lưu — `answerCacheKeyIsLive`) hoặc đã HẾT HẠN bị
 * từ chối 409: không lượt hỏi nào còn nhận câu đó, nên "sửa" nó là cán bộ tưởng đã sửa câu người dân nhận
 * trong khi không ai nhận được. Hàng hết hạn mà sửa được thì được gia hạn thêm 30 ngày — vượt trần lưu giữ
 * câu hỏi của người dân, và trái với danh sách vốn đã ẩn hàng đó. Lượt dọn định kỳ xoá các hàng này.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'update')

  const key = getRouterParam(event, 'key') ?? ''
  if (!/^[0-9a-f]{64}$/u.test(key)) throw createError({ statusCode: 400, statusMessage: 'Mã cache không hợp lệ.' })

  const body = await readValidated(event, z.object({
    answer: z.string({ error: 'Nội dung câu trả lời phải là chuỗi.' }),
    followUps: z.array(z.string({ error: 'Câu hỏi gợi ý phải là chuỗi.' }), { error: 'Câu hỏi gợi ý phải là danh sách.' }).optional(),
  }))

  const answer = body.answer.replace(/\r\n?/gu, '\n').trim()
  if (!answer) throw createError({ statusCode: 400, statusMessage: 'Câu trả lời không được để trống.' })
  if (answer.length > ANSWER_EDIT_MAX_CHARS) {
    throw createError({ statusCode: 400, statusMessage: `Câu trả lời tối đa ${ANSWER_EDIT_MAX_CHARS} ký tự.` })
  }

  // Bỏ dòng trống/trùng; từ chối (không lặng lẽ cắt) khi quá trần để người sửa thấy mình gửi gì.
  const followUps = [...new Set((body.followUps ?? []).map(item => item.replace(/\s+/gu, ' ').trim()).filter(Boolean))]
  if (followUps.length > FOLLOW_UP_MAX_COUNT) {
    throw createError({ statusCode: 400, statusMessage: `Tối đa ${FOLLOW_UP_MAX_COUNT} câu hỏi gợi ý.` })
  }
  if (followUps.some(item => item.length > FOLLOW_UP_MAX_CHARS)) {
    throw createError({ statusCode: 400, statusMessage: `Mỗi câu hỏi gợi ý tối đa ${FOLLOW_UP_MAX_CHARS} ký tự.` })
  }

  const current = await getAnswerCacheDetail(key)
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy câu trả lời đã cache.' })
  const context = await answerCacheContext()
  const expired = new Date(current.expiresAt).getTime() <= Date.now()
  if (expired || !context || !answerCacheKeyIsLive(current, context.settings, context.version)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Câu trả lời này không còn được phát lại: kho kiến thức, bài viết hoặc cấu hình AI đã đổi sau khi nó được lưu. Hàng sẽ được dọn tự động; muốn câu trả lời bền, hãy đưa vào kho kiến thức.',
    })
  }

  const result = await updateCachedAnswer({
    key,
    answer,
    followUps,
    actorId: adminUser.id ?? null,
    ip: getClientIp(event),
  })
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy câu trả lời đã cache.' })

  return { ok: true, changed: result.changedAnswer || result.changedFollowUps, item: await getAnswerCacheDetail(key) }
})
