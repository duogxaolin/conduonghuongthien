import { getDb } from '../utils/db'
import { submissions } from '../db/schema'

const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))

  const name    = String(body?.name || '').trim()
  const phone   = String(body?.phone || '').trim()
  const email   = String(body?.email || '').trim()
  const city    = String(body?.city || '').trim()
  const address = String(body?.address || '').trim()
  const message = String(body?.message || '').trim()

  if (!name || name.length < 2) {
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

  // Combine city + address for storage
  const fullAddress = [city, address].filter(Boolean).join(', ') || null

  const db = getDb()
  const [result] = await db.insert(submissions).values({
    fullName: name,
    phone,
    email:   email || null,
    address: fullAddress,
    message,
  })

  return { ok: true, id: result.insertId }
})
