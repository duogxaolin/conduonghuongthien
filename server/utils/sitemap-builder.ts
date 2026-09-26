import { eq } from 'drizzle-orm'

import { getDb } from './db'
import { pages, articles, chatbotKnowledge } from '../db/schema'

/**
 * Sitemap builder — thuần để kiểm được không cần mount (tiền lệ `nav-config.ts`,
 * `analytics-noc.ts`). Hai mảnh tách bạch:
 *
 *  - `buildSitemapXml(baseUrl, urls)` thuần hoàn toàn — nhận list URL đã sẵn,
 *    dựng XML. Dễ viết test.
 *  - `collectSitemapUrls(db)` — query DB, trả list URL. Tách ra để test builder
 *    không cần CSDL; `collectSitemapUrls` kiểm bằng integration nếu cần.
 */

export interface SitemapUrl {
  loc: string
  lastmod?: string | null
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'always' | 'never' | string
  priority?: number
}

const ESC: Record<string, string> = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' }

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch)
}

function isoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/**
 * Dựng XML sitemap từ list URL. List rỗng trả sitemap hợp lệ (chỉ `<urlset>`).
 * `loc` bắt buộc và phải là URL tuyệt đối — caller chịu trách nhiệm ghép `baseUrl`.
 */
export function buildSitemapXml(baseUrl: string, urls: SitemapUrl[]): string {
  const base = baseUrl.replace(/\/+$/, '')
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
  for (const u of urls) {
    lines.push('  <url>')
    lines.push(`    <loc>${escapeXml(`${base}${u.loc}`)}</loc>`)
    if (u.lastmod) lines.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`)
    if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`)
    if (typeof u.priority === 'number') lines.push(`    <priority>${u.priority.toFixed(1)}</priority>`)
    lines.push('  </url>')
  }
  lines.push('</urlset>')
  return lines.join('\n')
}

const STATIC_PAGES: Array<{ loc: string; changefreq: 'monthly'; priority: number }> = [
  { loc: '/', changefreq: 'monthly', priority: 1.0 },
  { loc: '/about', changefreq: 'monthly', priority: 0.5 },
  { loc: '/contact', changefreq: 'monthly', priority: 0.5 },
]

const LIST_PAGES: Array<{ loc: string; changefreq: 'daily'; priority: number }> = [
  { loc: '/news', changefreq: 'daily', priority: 0.9 },
  { loc: '/role-models', changefreq: 'daily', priority: 0.9 },
  { loc: '/reintegration-models', changefreq: 'daily', priority: 0.9 },
  { loc: '/documents', changefreq: 'daily', priority: 0.7 },
  { loc: '/legal-qa', changefreq: 'daily', priority: 0.7 },
  { loc: '/qa-documents', changefreq: 'daily', priority: 0.7 },
]

export async function collectSitemapUrls(db = getDb()): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [
    ...STATIC_PAGES.map((p) => ({ loc: p.loc, changefreq: p.changefreq, priority: p.priority })),
    ...LIST_PAGES.map((p) => ({ loc: p.loc, changefreq: p.changefreq, priority: p.priority })),
  ]

  const pageRows = await db.select({ slug: pages.slug, updatedAt: pages.updatedAt }).from(pages)
  for (const p of pageRows) {
    if (p.slug === 'home') continue
    urls.push({ loc: `/${p.slug}`, lastmod: isoDate(p.updatedAt), changefreq: 'monthly', priority: 0.6 })
  }

  const articleRows = await db
    .select({ slug: articles.slug, updatedAt: articles.updatedAt, publishedAt: articles.publishedAt })
    .from(articles)
    .where(eq(articles.status, 'published'))
  for (const a of articleRows) {
    urls.push({
      loc: `/news/${a.slug}`,
      lastmod: isoDate(a.publishedAt) ?? isoDate(a.updatedAt),
      changefreq: 'weekly',
      priority: 0.8,
    })
  }

  const qaRows = await db
    .select({ publishedAt: chatbotKnowledge.publishedAt, updatedAt: chatbotKnowledge.updatedAt })
    .from(chatbotKnowledge)
    .where(eq(chatbotKnowledge.status, 'published'))
  if (qaRows.length > 0) {
    const latest = qaRows
      .map((k) => isoDate(k.publishedAt) ?? isoDate(k.updatedAt))
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1)
    urls.push({ loc: '/qa-documents', lastmod: latest, changefreq: 'weekly', priority: 0.6 })
  }

  return urls
}

export async function generateSitemap(baseUrl: string, db = getDb()): Promise<string> {
  const urls = await collectSitemapUrls(db)
  return buildSitemapXml(baseUrl, urls)
}
