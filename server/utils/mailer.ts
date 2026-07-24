// ─── SMTP mailer ─────────────────────────────────────────────────────────────
// Server-only helper (nodemailer is never bundled to the client). Reads SMTP
// configuration from the `settings` key/value table and lazily builds a
// nodemailer transport. Callers follow the "3C" policy: persist first, then
// send-if-configured, and never let a mail failure block the request.
import nodemailer from 'nodemailer'
import { getDb } from './db'
import { settings } from '../db/schema'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from'] as const

/** Read the SMTP-related rows from the settings table into a plain map. */
async function readSmtpSettings(): Promise<Record<string, string>> {
  const db = getDb()
  const rows = await db.select().from(settings)
  const map: Record<string, string> = {}
  for (const row of rows) {
    if ((SMTP_KEYS as readonly string[]).includes(row.key)) {
      map[row.key] = row.value ?? ''
    }
  }
  return map
}

/**
 * Resolve the effective SMTP configuration, or `null` when the transport is
 * not usable. We consider SMTP "configured" only when both host and user are
 * present — this is the guard the submission handler uses to skip silently.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const map = await readSmtpSettings()
  const host = (map.smtp_host || '').trim()
  const user = (map.smtp_user || '').trim()
  if (!host || !user) return null

  const port = Number(map.smtp_port) || 587
  // `secure` true → implicit TLS (usually port 465). Accept common truthy strings.
  const secure = ['true', '1', 'yes', 'on'].includes(String(map.smtp_secure || '').trim().toLowerCase())
  const pass = map.smtp_pass || ''
  const from = (map.smtp_from || '').trim() || user

  return { host, port, secure, user, pass, from }
}

/** True when SMTP host + user are configured (mail can be attempted). */
export async function isConfigured(): Promise<boolean> {
  return (await getSmtpConfig()) !== null
}

export interface SendMailArgs {
  to: string
  subject: string
  text?: string
  html?: string
  /** Overrides the settings config (used by the "send test" endpoint). */
  config?: SmtpConfig
}

/**
 * Send a message via the configured SMTP transport. Throws when SMTP is not
 * configured or when the transport rejects — callers that must not fail the
 * request wrap this in try/catch.
 */
export async function sendMail(args: SendMailArgs): Promise<void> {
  const config = args.config ?? (await getSmtpConfig())
  if (!config) {
    throw new Error('SMTP chưa được cấu hình.')
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.pass ? { user: config.user, pass: config.pass } : undefined,
  })

  await transport.sendMail({
    from: config.from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  })
}
