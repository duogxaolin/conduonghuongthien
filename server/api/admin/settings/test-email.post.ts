import { getSmtpConfig, sendMail } from '../../../utils/mailer'
import { requireResourcePermission } from '../../../utils/permissions'
import { logWarn } from '../../../utils/logger'
import {
  SMTP_PORT_NOT_ALLOWED_MESSAGE,
  classifySmtpError,
  isAllowedSmtpPort,
  resolveSmtpTestConfig,
  smtpFailureMessage,
  smtpTestUsesSavedConfig,
} from '../../../utils/smtp-test-config'

// Sends a test message. Gated by the `settings` `update` permission — same trust
// level as saving SMTP config. Which config is used (saved vs. typed) is decided
// by resolveSmtpTestConfig: the saved password is never sent to a host taken from
// the request body.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const to = String(body?.to || '').trim()
  if (!to) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập địa chỉ email nhận thử.' })
  }

  const saved = smtpTestUsesSavedConfig(body) ? await getSmtpConfig() : null
  const { config, usedSaved, ignoredUnsavedChanges } = resolveSmtpTestConfig(body, saved)

  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: usedSaved
        ? 'SMTP chưa được cấu hình (thiếu host hoặc user). Hãy lưu cấu hình, hoặc nhập mật khẩu để thử máy chủ mới.'
        : 'Vui lòng nhập SMTP user để gửi thử.',
    })
  }

  // Cùng trần cổng với lúc lưu (`settings/index.put.ts`). Áp cả cho cấu hình đã
  // lưu: một cổng lạ lưu từ trước bản vá này không được quay số thêm lần nào nữa.
  if (!isAllowedSmtpPort(config.port)) {
    throw createError({ statusCode: 400, statusMessage: SMTP_PORT_NOT_ALLOWED_MESSAGE })
  }

  try {
    await sendMail({
      to,
      subject: '[CDKT] Email thử nghiệm cấu hình SMTP',
      text: 'Đây là email thử nghiệm từ Cổng thông tin Con Đường Hướng Thiện. Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động.',
      html: '<div style="font-family:Arial,sans-serif;"><h2 style="color:#4A6741;">Cấu hình SMTP hoạt động</h2><p>Đây là email thử nghiệm từ Cổng thông tin Con Đường Hướng Thiện. Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động chính xác.</p></div>',
      config,
    })
    const note = ignoredUnsavedChanges
      ? ` Lưu ý: đã gửi bằng cấu hình ĐÃ LƯU (${config.host}); thay đổi chưa lưu không được dùng vì mật khẩu chưa được nhập lại.`
      : ''
    return { ok: true, message: `Đã gửi email thử tới ${to}. Vui lòng kiểm tra hộp thư.${note}` }
  } catch (err: unknown) {
    // Chi tiết thô (IP:cổng, banner, phản hồi SMTP) chỉ vào log máy chủ; cán bộ
    // nhận một câu đã phân loại — xem `classifySmtpError`.
    const kind = classifySmtpError(err)
    logWarn({
      event: 'smtp.test_failed',
      userId: adminUser?.id,
      kind,
      usedSaved,
      code: typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code ?? '') : undefined,
      error: err instanceof Error ? err.message : String(err),
    })
    throw createError({
      statusCode: 400,
      statusMessage: `Gửi email thử thất bại: ${smtpFailureMessage(kind)}`,
    })
  }
})
