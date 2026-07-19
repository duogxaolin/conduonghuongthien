import { promises as fs } from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'server/data')
const DATA_FILE = path.join(DATA_DIR, 'submissions.json')

async function ensureStore () {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(DATA_FILE)
  } catch {
    await fs.writeFile(DATA_FILE, '[]', 'utf-8')
  }
}

async function appendRecord (record) {
  await ensureStore()
  const raw = await fs.readFile(DATA_FILE, 'utf-8').catch(() => '[]')
  let arr = []
  try { arr = JSON.parse(raw || '[]') } catch { arr = [] }
  arr.push(record)
  await fs.writeFile(DATA_FILE, JSON.stringify(arr, null, 2), 'utf-8')
}

const PHONE_RE = /^[0-9+()\-\s.]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))

  const type = (body?.type === 'contact') ? 'contact' : 'support'
  const name = String(body?.name || '').trim()
  const phone = String(body?.phone || '').trim()
  const email = String(body?.email || '').trim()
  const city = String(body?.city || '').trim()
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

  const record = {
    id: Date.now(),
    type,
    name,
    phone,
    email: email || null,
    city: city || null,
    address: address || null,
    message,
    submittedAt: new Date().toISOString()
  }

  await appendRecord(record)

  return { ok: true, id: record.id }
})
