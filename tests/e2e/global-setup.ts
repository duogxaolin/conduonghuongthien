/**
 * Brings up a throwaway portal for the browser tests: a single-use database, a
 * seeded SuperAdmin, and the real production build served on a fixed port.
 *
 * Why the real build rather than `nuxt dev`: the thing under test is a
 * client-side fetch failing and being retried. Dev-mode HMR sockets and
 * on-demand compilation add their own reloads and their own network traffic,
 * both of which are exactly what these specs assert the absence of.
 *
 * Everything is created here and destroyed by the returned teardown, so a run
 * leaves no database, no server process, and no rows behind.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { passwordRejectionMessage } from '../../server/utils/password-policy'
import { E2E_ADMIN_USERNAME, E2E_BASE_URL, E2E_DB_ENV, E2E_PASSWORD_ENV, E2E_PORT } from './harness'

const host = process.env.E2E_DB_HOST || '127.0.0.1'
const port = Number(process.env.E2E_DB_PORT || 3306)
const user = process.env.E2E_DB_USER || 'root'
const password = process.env.E2E_DB_PASSWORD || ''
const database = `cdkt_e2e_${Date.now()}_${process.pid}`

/**
 * The suite drops this database at the end. Refusing to touch anything that is
 * not visibly single-use is the guard that keeps a mistyped env var from
 * deleting a real deployment.
 */
function assertDisposableDatabase(name: string) {
  if (!/^cdkt_e2e_\d+_\d+$/.test(name)) throw new Error(`refusing to manage a non-throwaway database: ${name}`)
  if (name === 'cdkt_admin') throw new Error('refusing to manage cdkt_admin')
  if (process.env.DB_NAME && name === process.env.DB_NAME) throw new Error('refusing to manage the configured DB_NAME')
}

/**
 * The seed enforces the real password policy, so the harness has to satisfy it
 * — including "must not contain the username", which rules out anything built
 * around the word admin. Generated per run and checked against the same
 * function the seed uses, so a policy change surfaces here instead of as an
 * opaque seed failure.
 */
function generateAdminPassword(): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `Qx7#${randomBytes(12).toString('base64url')}`
    if (!passwordRejectionMessage(candidate, { username: E2E_ADMIN_USERNAME })) return candidate
  }
  throw new Error('could not generate a password satisfying the policy')
}

async function waitForServer(url: string, timeoutMs: number, describeFailure: () => string) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status < 500) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`server never answered ${url} (last: ${lastError})\n${describeFailure()}`)
}

export default async function globalSetup() {
  assertDisposableDatabase(database)
  // Building here would add a minute to every run and hide which step failed.
  // Naming the missing artifact is more useful than a connection refused later.
  if (!existsSync('.output/server/index.mjs')) {
    throw new Error('.output/server/index.mjs is missing — run `npm run build` before `npm run test:e2e`.')
  }
  const adminPassword = generateAdminPassword()

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(E2E_PORT),
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: user,
    DB_PASSWORD: password,
    DB_NAME: database,
    // Required at boot in production. Generated per run: a fixed value here
    // would be a committed secret that happens to live in a test file.
    JWT_SECRET: randomBytes(32).toString('hex'),
    CHATBOT_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
    ANALYTICS_HMAC_SECRET: randomBytes(32).toString('hex'),
    // Nitro reads runtime config from the NUXT_-prefixed name; the bare name is
    // for the code paths that read process.env directly.
    NUXT_ANALYTICS_HMAC_SECRET: '',
    ADMIN_PASSWORD: adminPassword,
    ADMIN_EMAIL: 'e2e@example.test',
    // Both schedulers off. A retention pass firing mid-run would delete rows
    // underneath an assertion, and the failure would look like a UI bug.
    RETENTION_SCHEDULER: '0',
    VIEW_BOOST_SCHEDULER: '0',
  }
  env.NUXT_ANALYTICS_HMAC_SECRET = env.ANALYTICS_HMAC_SECRET

  for (const script of ['db:init', 'db:seed']) {
    const result = spawnSync('npm', ['run', script], { env, encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`npm run ${script} failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`)
    }
  }

  let server: ChildProcess | null = spawn('node', ['.output/server/index.mjs'], { env })
  // Kept so a startup crash reports why instead of just "never answered".
  let log = ''
  server.stdout?.on('data', chunk => { log += chunk })
  server.stderr?.on('data', chunk => { log += chunk })

  try {
    await waitForServer(`${E2E_BASE_URL}/admin/login`, 60_000, () => log)
  } catch (error) {
    server.kill('SIGKILL')
    await dropDatabase()
    throw error
  }

  // Workers are forked after globalSetup returns, so they inherit this.
  // It is a throwaway credential for a database that is dropped below.
  process.env[E2E_PASSWORD_ENV] = adminPassword
  // Cùng lý do: spec cần dựng dữ liệu trực tiếp thay vì đi vòng qua một tính
  // năng nó không kiểm. CSDL này bị xoá ở teardown ngay bên dưới.
  process.env[E2E_DB_ENV.host] = host
  process.env[E2E_DB_ENV.port] = String(port)
  process.env[E2E_DB_ENV.user] = user
  process.env[E2E_DB_ENV.password] = password
  process.env[E2E_DB_ENV.database] = database

  return async () => {
    if (server) {
      server.kill('SIGTERM')
      const exited = await Promise.race([
        new Promise<boolean>(resolve => server!.once('exit', () => resolve(true))),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5_000)),
      ])
      if (!exited) server.kill('SIGKILL')
      server = null
    }
    delete process.env[E2E_PASSWORD_ENV]
    for (const key of Object.values(E2E_DB_ENV)) delete process.env[key]
    await dropDatabase()
  }
}

async function dropDatabase() {
  assertDisposableDatabase(database)
  const connection = await mysql.createConnection({ host, port, user, password })
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await connection.end()
}
