import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import defu from 'defu'
import { createRouter, toRouteMatcher } from 'radix3'

import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  CSP_REPORT_PATH,
  CSP_SCRIPT_SRC_HOSTS,
} from '../shared/csp-policy.ts'

/**
 * CSP giai đoạn 1 — quan sát (openspec `wave3-long-term`, task 2.2, design D-CSP).
 *
 * Mọi phản hồi mang HAI header:
 *  - `Content-Security-Policy` — chính sách đang THỰC THI, giữ nguyên từng byte như
 *    trước giai đoạn này (bản chụp `PINNED_ENFORCING` bên dưới);
 *  - `Content-Security-Policy-Report-Only` — chính sách ĐÍCH: `script-src` không có
 *    `'unsafe-inline'`, cùng tập host; mọi chỉ thị khác y hệt bản thực thi; báo cáo về
 *    `report-uri /api/csp-report`. Trình duyệt không chặn gì theo header này, chỉ báo.
 *
 * Hai chuỗi dựng ở `shared/csp-policy.ts` (mã thuần); `nuxt.config.ts` gắn chúng vào
 * `routeRules['/**'].headers`. Test nạp `nuxt.config.ts` thật (thay `defineNuxtConfig`
 * bằng hàm đồng nhất — không nạp Nuxt) rồi gộp route rule đúng như Nitro
 * (`getRouteRulesForPath`: `defu({}, ...matcher.matchAll(path).reverse())`, radix3).
 */

/**
 * Header thực thi NGAY TRƯỚC giai đoạn 1 (nhánh 423013d, đọc từ `nuxt.config.ts` đã
 * nạp). Giai đoạn 1 không được đổi nó; giai đoạn 5 đổi nó có chủ đích — và sửa dòng này
 * trong cùng PR.
 */
const PINNED_ENFORCING = "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://cdnjs.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com https://www.clarity.ms https://*.gov.vn; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn; img-src 'self' data: https://*.delify.vn https://*.conduonghuongthien.vn https://www.facebook.com https://www.googletagmanager.com https://*.gov.vn; media-src 'self' blob: https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn; font-src 'self' https://cdnjs.cloudflare.com https://*.delify.vn https://*.conduonghuongthien.vn https://*.gov.vn; frame-src https://www.youtube-nocookie.com https://*.delify.vn https://*.conduonghuongthien.vn https://www.googletagmanager.com https://*.gov.vn; connect-src 'self' https://static.cloudflareinsights.com https://*.delify.vn https://*.conduonghuongthien.vn https://www.google-analytics.com https://*.facebook.com https://analytics.tiktok.com https://www.clarity.ms https://*.gov.vn; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"

/** `name value value; name value` → Map(name → values). A repeated directive fails. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const name = tokens[0]!.toLowerCase()
    assert.ok(!directives.has(name), `directive ${name} appears twice — a browser keeps only the first`)
    directives.set(name, tokens.slice(1))
  }
  return directives
}

const enforcing = parsePolicy(CONTENT_SECURITY_POLICY)
const reportOnly = parsePolicy(CONTENT_SECURITY_POLICY_REPORT_ONLY)
const isHost = (token: string) => !token.startsWith("'") && token !== 'data:' && token !== 'blob:'

type RouteRule = { headers?: Record<string, string>, [key: string]: unknown }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineNuxtConfig = (config: unknown) => config
const nuxtConfig = (await import('../nuxt.config.ts')).default as unknown as { routeRules: Record<string, RouteRule> }
const routeRules = nuxtConfig.routeRules
const matcher = toRouteMatcher(createRouter({ routes: routeRules }))
/** Exactly what `nitropack/dist/runtime/internal/route-rules.mjs` does per request. */
const rulesFor = (path: string): RouteRule => defu({}, ...(matcher.matchAll(path) as RouteRule[]).reverse())

// ─── The enforcing policy does not move ───────────────────────────────────────

test('the enforcing Content-Security-Policy is byte-identical to the pre-phase-1 header', () => {
  assert.equal(CONTENT_SECURITY_POLICY, PINNED_ENFORCING)
  assert.equal(routeRules['/**']?.headers?.['Content-Security-Policy'], PINNED_ENFORCING)
})

test('nuxt.config sends the Report-Only policy from the shared module, next to the enforcing one', () => {
  const headers = routeRules['/**']?.headers ?? {}
  assert.equal(headers['Content-Security-Policy-Report-Only'], CONTENT_SECURITY_POLICY_REPORT_ONLY)
  assert.notEqual(CONTENT_SECURITY_POLICY_REPORT_ONLY, CONTENT_SECURITY_POLICY)
})

// ─── The target script-src ────────────────────────────────────────────────────

test("Report-Only script-src: 'self' plus the same host set, and no 'unsafe-inline' or 'unsafe-eval'", () => {
  const target = reportOnly.get('script-src')
  const current = enforcing.get('script-src')
  assert.ok(target && current)
  assert.ok(!target.includes("'unsafe-inline'"), 'the target policy must report the inline scripts phase 3 will hash')
  assert.ok(!target.includes("'unsafe-eval'"))
  assert.ok(current.includes("'unsafe-inline'"), 'the enforcing policy still allows inline scripts until phase 5')
  assert.equal(target[0], "'self'")
  // Same hosts in the same order; phase 2 narrows them on report evidence, not here.
  assert.deepEqual(target.filter(isHost), current.filter(isHost))
  assert.deepEqual(target.filter(isHost), CSP_SCRIPT_SRC_HOSTS.map(host => `https://${host}`))
  // Nothing but 'self' and hosts: no hashes yet (phase 3), no nonces (swr would replay one).
  assert.deepEqual(target.filter(token => !isHost(token)), ["'self'"])
})

// ─── Reporting ────────────────────────────────────────────────────────────────

test('report-uri points at /api/csp-report, and that endpoint exists as a POST handler', () => {
  assert.equal(CSP_REPORT_PATH, '/api/csp-report')
  assert.deepEqual(reportOnly.get('report-uri'), [CSP_REPORT_PATH])
  assert.ok(existsSync(new URL(`../server${CSP_REPORT_PATH}.post.ts`, import.meta.url)), 'report-uri names a route that does not exist')
  assert.equal(enforcing.has('report-uri'), false, 'phase 1 must not change the enforcing header')
})

test('no report-to in phase 1: Chromium drops report-uri when report-to is present (observed), so Chrome reports would depend on an unverified Reporting-Endpoints path', () => {
  assert.equal(reportOnly.has('report-to'), false)
  assert.equal(routeRules['/**']?.headers?.['Reporting-Endpoints'], undefined)
})

// ─── Everything else mirrors the enforcing policy ─────────────────────────────

test('every directive other than script-src and report-uri is identical in both policies, in the same order', () => {
  const others = (policy: Map<string, string[]>) => [...policy].filter(([name]) => name !== 'script-src' && name !== 'report-uri')
  assert.deepEqual(others(reportOnly), others(enforcing))
  assert.deepEqual([...reportOnly.keys()], [...enforcing.keys(), 'report-uri'])
})

test("style-src keeps 'unsafe-inline' in both policies (accepted residual, D-CSP3)", () => {
  assert.ok(enforcing.get('style-src')?.includes("'unsafe-inline'"))
  assert.ok(reportOnly.get('style-src')?.includes("'unsafe-inline'"))
})

// ─── Every route gets both headers, once ──────────────────────────────────────

const ROUTES = [
  '/', // swr: 60
  '/news/tin-tuc/bai-viet', // swr: 60
  '/media/abc123', // swr: 60
  '/qa-documents', // swr: 60
  '/assistant', // no rule of its own
  '/admin/login', // cache: false
  '/admin/content/articles/1',
  '/in-bai/bai-viet',
  '/api/public/health', // /api/** cache: false
  '/api/public/social-links', // swr: 60
  '/api/csp-report',
  '/_ipx/w_100/x.webp', // its own headers rule
  '/assets/fonts/inter.css', // its own headers rule
  '/sitemap.xml', // its own headers rule
]

for (const path of ROUTES) {
  test(`route rules for ${path}: both CSP headers, exactly once each`, () => {
    const headers = rulesFor(path).headers ?? {}
    const names = Object.keys(headers).map(name => name.toLowerCase())
    assert.equal(names.filter(name => name === 'content-security-policy').length, 1, `${path}: ${names.join(', ')}`)
    assert.equal(names.filter(name => name === 'content-security-policy-report-only').length, 1, `${path}: ${names.join(', ')}`)
    assert.equal(headers['Content-Security-Policy'], PINNED_ENFORCING)
    assert.equal(headers['Content-Security-Policy-Report-Only'], CONTENT_SECURITY_POLICY_REPORT_ONLY)
  })
}

test('no other route rule writes a CSP header (one source, so a narrower rule cannot shadow it)', () => {
  const writers = Object.entries(routeRules)
    .filter(([, rule]) => Object.keys(rule.headers ?? {}).some(name => /content-security-policy/i.test(name)))
    .map(([pattern]) => pattern)
  assert.deepEqual(writers, ['/**'])
})
