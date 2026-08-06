import { getDb } from '../utils/db'
import { submissions, pages, pageBlocks } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getSmtpConfig, sendMail } from '../utils/mailer'
import { escapeHtml } from '../utils/escape-html'
import { recordRateLimitHit, type RateLimitRule } from '../utils/rate-limit-store'
import { logError, logWarn, SECURITY_EVENTS } from '../utils/logger'
import { getClientIp } from '../utils/client-ip'
import { rateLimitDeps } from '../utils/rate-limit-deps'

// Public, unauthenticated endpoint → rate limit by the real peer IP
// (`x-forwarded-for` is client-controlled and therefore spoofable).
// Counters live in a shared table so a restart or a second replica does not
// hand every source a fresh quota. See server/utils/rate-limit-store.ts.
const SUBMIT_RULE: RateLimitRule = { limit: 5, windowSeconds: 10 * 60 }

async function submitRateLimited(ip: string): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const deps = rateLimitDeps()
  const state = await recordRateLimitHit(`submit:${ip}`, SUBMIT_RULE, deps)
  return { limited: state.blocked, retryAfterSeconds: state.retryAfterSeconds }
}

const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

const VALID_TYPES = ['text', 'email', 'tel', 'number', 'textarea', 'select']
const VALID_MAPS = ['name', 'phone', 'email', 'address', 'message', 'none']

type Answer = {
  id: string
  label: string
  value: string
  map: string
  type: string
  required: boolean
}

/**
 * Normalize an incoming answers[] payload (from the dynamic contact form). Each
 * answer is validated server-side by its own field config — the server is the
 * trust boundary, so we never rely on the client having validated.
 */
function normalizeAnswers(raw: unknown): Answer[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((item, i) => {
      const a = item as Record<string, unknown>
      return {
        id: String(a.id || `f_${i}`),
        label: String(a.label || '').trim(),
        value: String(a.value ?? '').trim(),
        map: VALID_MAPS.includes(String(a.map)) ? (a.map as Answer['map']) : 'none',
        type: VALID_TYPES.includes(String(a.type)) ? (a.type as Answer['type']) : 'text',
        required: !!a.required,
      }
    })
    .filter((a) => a.label)
}

/** Server-side per-answer validation mirroring the client rules. */
function validateAnswer(a: Answer): string | null {
  if (a.required && !a.value) return `Vui lòng nhập "${a.label}".`
  if (!a.value) return null
  if (a.type === 'email' && !EMAIL_RE.test(a.value)) return `Email không hợp lệ ("${a.label}").`
  if (a.type === 'tel' && !PHONE_RE.test(a.value)) return `Số điện thoại không hợp lệ ("${a.label}").`
  if (a.type === 'number' && !NUMBER_RE.test(a.value)) return `Giá trị số không hợp lệ ("${a.label}").`
  return null
}

/**
 * Walk a nested block tree (pages.published_blocks / draft_blocks) collecting the
 * data.recipientEmail of every contact_form block. Recurses into children[].
 */
function collectFromTree(nodes: unknown, out: Set<string>): void {
  if (!Array.isArray(nodes)) return
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue
    const n = item as { blockType?: unknown, data?: { recipientEmail?: unknown }, children?: unknown }
    if (n.blockType === 'contact_form' || n.blockType === 'support_form') {
      const to = String(n.data?.recipientEmail || '').trim().toLowerCase()
      if (to && EMAIL_RE.test(to)) out.add(to)
    }
    if (Array.isArray(n.children)) collectFromTree(n.children, out)
  }
}

/**
 * Server-side allow-list of mail recipients: the set of recipientEmail values
 * actually configured on stored contact_form/support_form blocks across all
 * pages (both the published/draft node trees and the legacy flat page_blocks
 * table). The client-supplied recipient is only honored if it appears here —
 * this removes the arbitrary-recipient / open-relay capability while keeping the
 * recipient editable through the page builder (the source of truth).
 */
async function getConfiguredRecipients(db: ReturnType<typeof getDb>): Promise<Set<string>> {
  const out = new Set<string>()
  // Node trees stored as JSON on pages.
  const pageRows = await db
    .select({ published: pages.publishedBlocks, draft: pages.draftBlocks })
    .from(pages)
  for (const row of pageRows) {
    collectFromTree(row.published, out)
    collectFromTree(row.draft, out)
  }
  // Legacy flat blocks.
  const flat = await db
    .select({ blockType: pageBlocks.blockType, data: pageBlocks.data })
    .from(pageBlocks)
    .where(eq(pageBlocks.blockType, 'contact_form'))
  for (const b of flat) {
    const to = String(b.data?.recipientEmail || '').trim().toLowerCase()
    if (to && EMAIL_RE.test(to)) out.add(to)
  }
  return out
}

export default defineEventHandler(async (event) => {
  const clientIp = getClientIp(event)
  const submitLimit = await submitRateLimited(clientIp)
  if (submitLimit.limited) {
    logWarn({ event: SECURITY_EVENTS.submissionThrottled, ip: clientIp })
    setResponseHeader(event, 'Retry-After', submitLimit.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' })
  }

  const body = await readBody(event).catch(() => ({}))

  const formTitle = String(body?.formTitle || '').trim() || null
  const recipientEmail = String(body?.recipientEmail || '').trim()

  // Fixed columns populated from mapped answers (or the legacy flat payload).
  let fullName = ''
  let phone = ''
  let email = ''
  let address = ''
  let message = ''
  // Answers whose map === 'none' are stored as free-form JSON [{label,value}].
  const extraAnswers: Array<{ label: string; value: string }> = []
  // Full answer set kept for the notification email body.
  let emailAnswers: Array<{ label: string; value: string }> = []

  const answers = normalizeAnswers(body?.answers)

  if (answers.length) {
    // ── New dynamic-form path ──
    for (const a of answers) {
      const err = validateAnswer(a)
      if (err) throw createError({ statusCode: 400, statusMessage: err })
    }
    for (const a of answers) {
      if (!a.value) {
        if (a.map === 'none') extraAnswers.push({ label: a.label, value: a.value })
        continue
      }
      switch (a.map) {
        case 'name': fullName = fullName || a.value; break
        case 'phone': phone = phone || a.value; break
        case 'email': email = email || a.value; break
        case 'address': address = address ? `${address}, ${a.value}` : a.value; break
        case 'message': message = message ? `${message}\n${a.value}` : a.value; break
        default: extraAnswers.push({ label: a.label, value: a.value })
      }
    }
    emailAnswers = answers.filter((a) => a.value).map((a) => ({ label: a.label, value: a.value }))
  } else {
    // ── Legacy flat payload path ({ name, phone, email, city, address, message }) ──
    fullName = String(body?.name || '').trim()
    phone = String(body?.phone || '').trim()
    email = String(body?.email || '').trim()
    const city = String(body?.city || '').trim()
    const addr = String(body?.address || '').trim()
    address = [city, addr].filter(Boolean).join(', ')
    message = String(body?.message || '').trim()

    if (!fullName || fullName.length < 2) {
      throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập họ tên hợp lệ.' })
    }
    if (!phone || !PHONE_RE.test(phone)) {
      throw createError({ statusCode: 400, statusMessage: 'Số điện thoại không hợp lệ.' })
    }
    if (email && !EMAIL_RE.test(email)) {
      throw createError({ statusCode: 400, statusMessage: 'Email không hợp lệ.' })
    }
    if (!message || message.length < 5) {
      throw createError({ statusCode: 400, statusMessage: 'Nội dung trợ giúp quá ngắn.' })
    }
    emailAnswers = [
      { label: 'Họ và tên', value: fullName },
      { label: 'Số điện thoại', value: phone },
      ...(email ? [{ label: 'Email', value: email }] : []),
      ...(address ? [{ label: 'Địa chỉ', value: address }] : []),
      { label: 'Nội dung', value: message },
    ]
  }

  // ── 3C step 1: ALWAYS persist the submission first. ──
  // full_name and phone are NOT NULL in the schema; coerce absent values to ''
  // (never null) so the insert can never throw under MySQL STRICT mode and a
  // submission is never lost — even when the form maps no name/phone field.
  const db = getDb()
  const [result] = await db.insert(submissions).values({
    fullName: fullName || '',
    phone: phone || '',
    email: email || null,
    address: address || null,
    message: message || null,
    answers: extraAnswers.length ? extraAnswers : null,
    formTitle,
  })

  // ── 3C step 2: send-if-configured. Never block or fail the response on mail. ──
  // The client-supplied recipientEmail is UNTRUSTED: it comes from the public,
  // unauthenticated request body. To prevent an attacker using the site's SMTP
  // credentials to mail arbitrary addresses (open-relay/spam), we only send when
  // the requested recipient matches a recipient actually configured on a stored
  // contact_form/support_form block. If it doesn't match (or none is resolvable),
  // we silently skip the email — the submission is already persisted above (3C).
  if (recipientEmail && EMAIL_RE.test(recipientEmail)) {
    try {
      const allowed = await getConfiguredRecipients(db)
      const to = recipientEmail.toLowerCase()
      const config = allowed.has(to) ? await getSmtpConfig() : null
      if (config) {
        const subject = `[CDKT] Đơn đăng ký mới${formTitle ? `: ${formTitle}` : ''}`
        const lines = emailAnswers.map((a) => `${a.label}: ${a.value}`).join('\n')
        // Escape: label/value are visitor-supplied and would otherwise inject
        // arbitrary HTML/links into the notification email read by staff.
        const rowsHtml = emailAnswers
          .map((a) => `<tr><td style="padding:6px 12px;font-weight:bold;color:#1E251C;">${escapeHtml(a.label)}</td><td style="padding:6px 12px;color:#4A5545;white-space:pre-wrap;">${escapeHtml(a.value)}</td></tr>`)
          .join('')
        await sendMail({
          to: recipientEmail,
          subject,
          text: `${formTitle ? formTitle + '\n\n' : ''}${lines}`,
          html: `<div style="font-family:Arial,sans-serif;"><h2 style="color:#4A6741;">${escapeHtml(formTitle || 'Đơn đăng ký mới')}</h2><table style="border-collapse:collapse;">${rowsHtml}</table></div>`,
          config,
        })
      }
    } catch (err) {
      // Log only — a mail failure must never surface to the visitor.
      logError({ event: 'public.submission_email_failed', submissionId: result.insertId, error: err })
    }
  }

  return { ok: true, id: result.insertId }
})
