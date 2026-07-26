import { getRequestIP } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { submissions, settings } from '../../../db/schema'
import { getSmtpConfig, sendMail } from '../../../utils/mailer'
import { getChatbotSettings } from '../../../services/chatbot-settings'
import { escapeHtml } from '../../../utils/escape-html'

const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Simple in-memory rate limit by peer IP (spoof-resistant: xForwardedFor off).
const buckets = new Map<string, number[]>()
const LIMIT = 5
const WINDOW_MS = 10 * 60 * 1000
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (buckets.get(ip) || []).filter(t => t > now - WINDOW_MS)
  if (recent.length >= LIMIT) { buckets.set(ip, recent); return true }
  recent.push(now); buckets.set(ip, recent)
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value as string)
  return false
}

/**
 * Chatbot lead capture: when the bot has no answer it invites the visitor to
 * leave contact details. We persist the request (reusing the submissions table,
 * visible under /admin/submissions) and notify staff by email. The recipient is
 * resolved SERVER-side (chatbot lead email → site contact email), never from the
 * request body, so this cannot be abused as an open relay.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  if (rateLimited(ip)) throw createError({ statusCode: 429, statusMessage: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' })

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim().slice(0, 150)
  const phone = String(body?.phone || '').trim().slice(0, 30)
  const email = String(body?.email || '').trim().slice(0, 255)
  const question = String(body?.question || body?.message || '').trim().slice(0, 4000)

  if (!phone && !email) throw createError({ statusCode: 400, statusMessage: 'Vui lòng để lại số điện thoại hoặc email để cán bộ liên hệ.' })
  if (phone && !PHONE_RE.test(phone)) throw createError({ statusCode: 400, statusMessage: 'Số điện thoại không hợp lệ.' })
  if (email && !EMAIL_RE.test(email)) throw createError({ statusCode: 400, statusMessage: 'Email không hợp lệ.' })

  const db = getDb()
  const [result] = await db.insert(submissions).values({
    fullName: name || 'Khách (Chatbot)',
    phone: phone || '',
    email: email || null,
    message: question || null,
    formTitle: 'Chatbot – Yêu cầu hỗ trợ',
  })

  // Notify staff (best-effort; never fail the visitor on mail issues).
  try {
    const cbSettings = await getChatbotSettings()
    let to = (cbSettings.leadCaptureEmail || '').trim()
    if (!to) {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'email')).limit(1)
      to = (row?.value || '').trim()
    }
    if (to && EMAIL_RE.test(to)) {
      const config = await getSmtpConfig()
      if (config) {
        const rows: Array<[string, string]> = [
          ['Họ tên', name || '(không cung cấp)'],
          ['Số điện thoại', phone || '(không cung cấp)'],
          ['Email', email || '(không cung cấp)'],
          ['Câu hỏi / Nội dung', question || '(không cung cấp)'],
        ]
        const rowsHtml = rows
          .map(([label, value]) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#1E251C;">${escapeHtml(label)}</td><td style="padding:6px 12px;color:#4A5545;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`)
          .join('')
        await sendMail({
          to,
          subject: '[CDKT] Yêu cầu hỗ trợ mới từ Chatbot',
          text: rows.map(([l, v]) => `${l}: ${v}`).join('\n'),
          html: `<div style="font-family:Arial,sans-serif;"><h2 style="color:#4A6741;">Yêu cầu hỗ trợ từ Chatbot</h2><table style="border-collapse:collapse;">${rowsHtml}</table></div>`,
          config,
        })
      }
    }
  } catch (err) {
    console.error('[chatbot/lead] Gửi email thông báo thất bại:', err)
  }

  return { ok: true, id: result.insertId }
})
