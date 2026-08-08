/**
 * Constants shared between playwright.config.ts, the global setup, and the specs.
 *
 * The port is a fixed constant rather than something the setup picks, because
 * `use.baseURL` in the config is evaluated before globalSetup runs — a port
 * chosen at setup time could never reach the config.
 */
export const E2E_PORT = 3123
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`

/** Env keys globalSetup exports for the workers to read. */
export const E2E_ADMIN_USERNAME = 'admin'
export const E2E_PASSWORD_ENV = 'CDKT_E2E_ADMIN_PASSWORD'

/**
 * Thông tin kết nối CSDL dùng một lần, để spec dựng dữ liệu mà không phải đi qua
 * một tính năng khác.
 *
 * Dựng dữ liệu qua endpoint công khai nghe có vẻ trung thực hơn, nhưng nó buộc
 * mỗi spec phụ thuộc vào một tính năng nó **không** kiểm: spec xoá hàng loạt đã
 * đỏ một lần vì tuyến chatbot trả 503 khi chưa cấu hình nhà cung cấp AI — một
 * lý do không liên quan gì tới điều nó khẳng định. Một test đỏ vì lý do sai sẽ
 * bị đọc là nhiễu.
 *
 * CSDL này bị xoá ở teardown, nên đây không phải một bí mật.
 */
export const E2E_DB_ENV = {
  host: 'CDKT_E2E_DB_HOST',
  port: 'CDKT_E2E_DB_PORT',
  user: 'CDKT_E2E_DB_USER',
  password: 'CDKT_E2E_DB_PASSWORD',
  database: 'CDKT_E2E_DB_NAME',
} as const

/** Đọc cấu hình kết nối mà globalSetup đã xuất, hoặc ném lỗi nói rõ vì sao. */
export function e2eDbConfig() {
  const missing = Object.values(E2E_DB_ENV).filter(key => !process.env[key])
  if (missing.length) throw new Error(`${missing.join(', ')} chưa đặt — globalSetup chưa chạy`)
  return {
    host: process.env[E2E_DB_ENV.host]!,
    port: Number(process.env[E2E_DB_ENV.port]),
    user: process.env[E2E_DB_ENV.user]!,
    password: process.env[E2E_DB_ENV.password]!,
    database: process.env[E2E_DB_ENV.database]!,
  }
}
