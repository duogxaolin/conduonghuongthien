/**
 * Build-time ADMIN_PASSWORD guard.
 *
 * The password policy was only enforced in two places, both of them *after* a
 * build had already succeeded: `server/db/seed.ts` (exit 1) and the Nitro boot
 * plugin (throw). On a production deploy that means you pay for a full
 * `nuxt build` and only then find out the seed refuses the password — which is
 * exactly what happened with `ADMIN_PASSWORD=Admin@conduonghuongthien2026`
 * (it contains the username `admin`).
 *
 * This runs before `nuxt build` and reads the same policy, so the mistake
 * surfaces in seconds instead of minutes.
 *
 * Deliberate asymmetry between "absent" and "invalid":
 *   • absent  → warn, exit 0. The seed is insert-only, so an existing
 *     deployment whose admin account was created long ago has no reason to keep
 *     the password in .env. CI and the Docker builder stage have no .env at all
 *     (see .dockerignore); failing them would be nonsense.
 *   • invalid → exit 1. A value is present and it will be rejected later. There
 *     is no scenario where continuing the build helps.
 *
 * Run directly: npm run check:admin-password
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePassword } from '../server/utils/password-policy'

/** The seed always creates this account, so the policy is checked against it. */
export const SEED_USERNAME = 'admin'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type AdminPasswordVerdict =
  | { status: 'ok'; source: string }
  | { status: 'absent'; reason: string }
  | { status: 'invalid'; errors: string[]; source: string }

/**
 * Minimal dotenv reader. The build guard must see the same value Nuxt/Nitro
 * will, and this script runs as plain Node — nothing has loaded .env for it.
 *
 * Quoted values are taken verbatim (a password may legitimately contain `#`).
 * Unquoted values drop a trailing ` #comment`, matching dotenv.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    out[key] = value
  }
  return out
}

/**
 * Decide the verdict from an explicit process value and the .env text.
 * Pure, so the test suite can exercise it without touching the filesystem.
 */
export function evaluateAdminPassword(input: {
  processValue?: string | undefined
  secretValue?: string | undefined
  envFileText?: string | null
  envFileLabel?: string
}): AdminPasswordVerdict {
  const label = input.envFileLabel || '.env'
  const fromProcess = (input.processValue ?? '').trim()
  const fromSecret = (input.secretValue ?? '').trim()
  const fromFile = input.envFileText ? (parseEnvFile(input.envFileText).ADMIN_PASSWORD ?? '').trim() : ''

  // Precedence matches the runtime: a real environment variable wins over .env.
  // The secret file sits between them — it is how the Docker build stage receives
  // the value (a BuildKit mount), where no .env exists at all.
  const value = fromProcess || fromSecret || fromFile
  const source = fromProcess
    ? 'biến môi trường ADMIN_PASSWORD'
    : fromSecret ? 'tệp bí mật ADMIN_PASSWORD_FILE' : label

  if (!value) {
    return {
      status: 'absent',
      reason: input.envFileText === null || input.envFileText === undefined
        ? `không tìm thấy ${label} và biến môi trường ADMIN_PASSWORD cũng trống`
        : `${label} không đặt ADMIN_PASSWORD`,
    }
  }

  const { ok, errors } = validatePassword(value, { username: SEED_USERNAME })
  return ok ? { status: 'ok', source } : { status: 'invalid', errors, source }
}

/** Read the .env this build would use, or null when there is none. */
function readEnvFile(): { text: string | null; label: string } {
  const label = process.env.ENV_FILE || '.env'
  const file = path.isAbsolute(label) ? label : path.join(ROOT, label)
  return { text: existsSync(file) ? readFileSync(file, 'utf8') : null, label }
}

/**
 * Read ADMIN_PASSWORD_FILE, the standard way a container receives a secret
 * without it appearing in `docker history`, `ps`, or the image layers.
 * A missing file is not an error: the Dockerfile mounts the secret with
 * `required=false` so builds that do not supply one still work.
 */
function readSecretFile(): string | undefined {
  const file = (process.env.ADMIN_PASSWORD_FILE || '').trim()
  if (!file || !existsSync(file)) return undefined
  // Trailing newline is near-universal in secret files and is not part of the value.
  return readFileSync(file, 'utf8').replace(/\r?\n$/, '')
}

export function runCheck(): number {
  const { text, label } = readEnvFile()
  const verdict = evaluateAdminPassword({
    processValue: process.env.ADMIN_PASSWORD,
    secretValue: readSecretFile(),
    envFileText: text,
    envFileLabel: label,
  })

  if (verdict.status === 'ok') {
    console.log(`✅ ADMIN_PASSWORD đạt chính sách mật khẩu (nguồn: ${verdict.source}).`)
    return 0
  }

  if (verdict.status === 'absent') {
    console.warn(`⚠️  Bỏ qua kiểm tra ADMIN_PASSWORD: ${verdict.reason}.`)
    console.warn('   Build vẫn tiếp tục. Nếu đây là lần triển khai ĐẦU TIÊN, seed sẽ dừng vì chưa có mật khẩu quản trị.')
    return 0
  }

  console.error('')
  console.error(`❌ Build dừng: ADMIN_PASSWORD (${verdict.source}) không đạt chính sách mật khẩu.`)
  for (const problem of verdict.errors) console.error(`   • ${problem}`)
  console.error('')
  console.error(`   Lưu ý: tài khoản seed là "${SEED_USERNAME}", nên mật khẩu KHÔNG được chứa chuỗi "${SEED_USERNAME}"`)
  console.error('   (không phân biệt hoa/thường) — ví dụ "Admin@..." sẽ bị từ chối.')
  console.error('   Sinh mật khẩu hợp lệ:  ADMIN_PASSWORD=$(openssl rand -base64 18)')
  console.error('   Sửa xong thì chạy lại build. Với Docker: docker compose up -d --build (restart không nạp lại .env).')
  console.error('')
  return 1
}

// Only exit when invoked as a script; importing this module (tests) must be inert.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(runCheck())
}
