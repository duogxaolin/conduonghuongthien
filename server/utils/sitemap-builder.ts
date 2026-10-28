import { eq, isNull } from 'drizzle-orm'

import { getDb } from './db'
import { pages, articles, categories, contentTypes, chatbotKnowledge } from '../db/schema'

/**
 * Ánh xạ `articles.type` / `categories.type` (slug content-type) → đường dẫn list
 * công khai. 5 type hệ thống có route tĩnh riêng (hardcode ở `nuxt.config.ts`
 * `routeRules` + `app/pages/`); type custom (do admin tạo ở
 * `/admin/content/content-types`) dùng path segment `/<slug>`.
 *
 * Đồng bộ với `typeLabels` ở `app/pages/news/[category]/index.vue` +
 * `app/pages/[slug]/[id].vue` và `LIST_PAGES` ở dưới.
 */
const SYSTEM_TYPE_TO_PATH: Record<string, string> = {
  news: '/news',
  role_model: '/role-models',
  reintegration: '/reintegration-models',
  document: '/documents',
  faq: '/legal-qa',
}

/**
 * Trả path list cho một type. Nếu type có route hệ thống → trả path đó; nếu là
 * type custom → trả `/<slug>` (slug từ contentTypes). Trả `null` nếu type không
 * nhận diện — caller bỏ qua.
 */
function typeToListPath(type: string, customSlugs: Set<string>): string | null {
  if (SYSTEM_TYPE_TO_PATH[type]) return SYSTEM_TYPE_TO_PATH[type]
  if (customSlugs.has(type)) return `/${type}`
  return null
}

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

  // Content-type custom (isSystem=false) — mỗi type có trang list `/<slug>`.
  // Type hệ thống (news/role_model/...) đã có ở LIST_PAGES, không lặp lại ở đây.
  const ctRows = await db
    .select({ slug: contentTypes.slug, isSystem: contentTypes.isSystem, updatedAt: contentTypes.createdAt })
    .from(contentTypes)
  const customSlugs = new Set<string>()
  for (const ct of ctRows) {
    if (ct.isSystem) continue
    customSlugs.add(ct.slug)
    urls.push({ loc: `/${ct.slug}`, lastmod: isoDate(ct.updatedAt), changefreq: 'daily', priority: 0.7 })
  }

  const pageRows = await db.select({ slug: pages.slug, updatedAt: pages.updatedAt }).from(pages)
  // Slug trang cố định trùng path list (news/role-models/...) hoặc custom type →
  // ưu tiên LIST_PAGES + custom type ở trên, không lặp lại ở đây.
  const reservedSlugs = new Set<string>([
    ...Object.values(SYSTEM_TYPE_TO_PATH).map((p) => p.slice(1)),
    ...customSlugs,
  ])
  for (const p of pageRows) {
    if (p.slug === 'home' || reservedSlugs.has(p.slug)) continue
    urls.push({ loc: `/${p.slug}`, lastmod: isoDate(p.updatedAt), changefreq: 'monthly', priority: 0.6 })
  }

  // Category root (parentId=null) — mỗi category có trang list theo path
  // segment `/<type-path>/<cat-slug>` (xem `app/pages/news/[category]/index.vue`
  // + `app/pages/[slug]/[id].vue`). Sub-category (parentId !== null) không có
  // trang list riêng — chỉ là filter con, không sinh URL.
  const catRows = await db
    .select({ slug: categories.slug, type: categories.type, name: categories.name, updatedAt: categories.createdAt })
    .from(categories)
    .where(isNull(categories.parentId))
  for (const c of catRows) {
    const basePath = typeToListPath(c.type, customSlugs)
    if (!basePath) continue
    urls.push({
      loc: `${basePath}/${c.slug}`,
      lastmod: isoDate(c.updatedAt),
      changefreq: 'weekly',
      priority: 0.6,
    })
  }

  const articleRows = await db
    .select({ slug: articles.slug, type: articles.type, updatedAt: articles.updatedAt, publishedAt: articles.publishedAt })
    .from(articles)
    .where(eq(articles.status, 'published'))
  for (const a of articleRows) {
    const basePath = typeToListPath(a.type, customSlugs)
    if (!basePath) continue // type không nhận diện — không có trang công khai
    urls.push({
      loc: `${basePath}/${a.slug}`,
      lastmod: isoDate(a.publishedAt) ?? isoDate(a.updatedAt),
      changefreq: 'weekly',
      priority: 0.8,
    })
  }

  const qaRows = await db
    .select({ publishedAt: chatbotKnowledge.publishedAt, updatedAt: chatbotKnowledge.updatedAt })
    .from(chatbotKnowledge)
    .where(eq(chatbotKnowledge.status, 'published'))
  // `/qa-documents` is already a list page above; it takes the date of the latest
  // published Q&A. Pushing a second entry listed the URL twice in the sitemap.
  const qaPage = urls.find((u) => u.loc === '/qa-documents')
  if (qaPage && qaRows.length > 0) {
    qaPage.lastmod = qaRows
      .map((k) => isoDate(k.publishedAt) ?? isoDate(k.updatedAt))
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1)
  }

  return urls
}

export async function generateSitemap(baseUrl: string, db = getDb()): Promise<string> {
  const urls = await collectSitemapUrls(db)
  return buildSitemapXml(baseUrl, urls)
}
