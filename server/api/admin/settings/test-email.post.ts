import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { getSmtpConfig, sendMail, type SmtpConfig } from '../../../utils/mailer'
import { requireResourcePermission } from '../../../utils/permissions'

// Sends a test message using either the payload's SMTP fields (when the admin is
// trying settings before saving) or the persisted config. Gated by the
// `settings` `update` permission — same trust level as saving SMTP config.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const to = String(body?.to || '').trim()
  if (!to) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập địa chỉ email nhận thử.' })
  }

  // Build an override config from the request when host is supplied. When the
  // password field is the mask token (or blank), fall back to the saved value.
  let config: SmtpConfig | null = null
  const bodyHost = String(body?.smtp_host || '').trim()
  if (bodyHost) {
    let pass = String(body?.smtp_pass ?? '')
    if (pass === '********' || pass === '') {
      const rows = await getDb().select().from(settings)
      pass = rows.find((r) => r.key === 'smtp_pass')?.value ?? ''
    }
    const user = String(body?.smtp_user || '').trim()
    config = {
      host: bodyHost,
      port: Number(body?.smtp_port) || 587,
      secure: ['true', '1', 'yes', 'on'].includes(String(body?.smtp_secure || '').trim().toLowerCase()),
      user,
      pass,
      from: String(body?.smtp_from || '').trim() || user,
    }
    if (!config.host || !config.user) config = null
  } else {
    config = await getSmtpConfig()
  }

  if (!config) {
    throw createError({ statusCode: 400, statusMessage: 'SMTP chưa được cấu hình (thiếu host hoặc user).' })
  }

  try {
    await sendMail({
      to,
      subject: '[CDKT] Email thử nghiệm cấu hình SMTP',
      text: 'Đây là email thử nghiệm từ Cổng thông tin Con Đường Hướng Thiện. Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động.',
      html: '<div style="font-family:Arial,sans-serif;"><h2 style="color:#4A6741;">Cấu hình SMTP hoạt động</h2><p>Đây là email thử nghiệm từ Cổng thông tin Con Đường Hướng Thiện. Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động chính xác.</p></div>',
      config,
    })
    return { ok: true, message: `Đã gửi email thử tới ${to}. Vui lòng kiểm tra hộp thư.` }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: `Gửi email thử thất bại: ${err?.message || 'Lỗi kết nối SMTP.'}`,
    })
  }
})
