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
