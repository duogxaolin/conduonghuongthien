/**
 * Kho captcha in-memory cho login.
 *
 * Vì sao không dùng DB: captcha sống 5 phút, dùng đúng 1 lần. Persist qua restart
 * không mang lại gì — ένα lần dùng xong là xoá. Kho nằm trong bộ nhớ tiến trình,
 * cùng kiểu với fallback rate limit khi mất DB.
 *
 * Ràng buộc 1 bản sao: cổng chạy đúng một container (`container_name: cdkt_app`
 * trong docker-compose đã chặn scale). Nếu chạy nhiều bản sao, captcha sinh ở
 * replica A không thể verify ở replica B — khi đó phải chuyển sang DB/Redis
 * (xem `rate-limit-store.ts` cho pattern DB-backed tương tự).
 */
import svgCaptcha from 'svg-captcha'

const CAPTCHA_TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 500

interface Entry {
  text: string
  expiresAt: number
}

const store = new Map<string, Entry>()

/** Sinh captcha mới. Trả về id + SVG để client render, text giữ trong kho. */
export function createCaptcha(): { captchaId: string; svg: string } {
  const captcha = svgCaptcha.create({
    size: 6,
    noise: 2,
    color: true,
    background: '#f0f9ff',
    fontSize: 48,
    width: 150,
    height: 50,
  })
  const captchaId = crypto.randomUUID()
  store.set(captchaId, {
    text: captcha.text.toLowerCase(),
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  })
  if (store.size > MAX_ENTRIES) purgeExpiredCaptchas()
  return { captchaId, svg: captcha.data }
}

/**
 * Verify captcha. So sánh case-insensitive, **xoá ngay sau khi verify** dù đúng
 * hay sai — một captcha chỉ dùng một lần, không cho replay hoặc brute-force cùng
 * một id.
 *
 * Trả về true nếu khớp và chưa hết hạn. Trả về false nếu sai, hết hạn, hoặc id
 * không tồn tại — ba trường hợp này không phân biệt để không lộ id nào còn sống.
 */
export function verifyCaptcha(captchaId: string, input: string): boolean {
  const entry = store.get(captchaId)
  // Luôn xoá để không reuse.
  store.delete(captchaId)
  if (!entry) return false
  if (Date.now() > entry.expiresAt) return false
  return entry.text === input.trim().toLowerCase()
}

/** Dọn captcha hết hạn. Trả về số entry đã xoá. */
export function purgeExpiredCaptchas(now = Date.now()): number {
  let removed = 0
  for (const [id, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(id)
      removed++
    }
  }
  return removed
}

/** Chỉ cho test — xoá sạch. */
export function clearCaptchaStore(): void {
  store.clear()
}
