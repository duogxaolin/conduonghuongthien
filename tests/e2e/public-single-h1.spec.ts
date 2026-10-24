/**
 * Exactly one `<h1>` on every public page (spec public-accessibility, design D22).
 *
 * The header brand was an `<h1>` on every page, so article, list and media pages
 * had two and the home page three. Source checks (`tests/public-single-h1.test.ts`)
 * show the brand is a `<p>` and that block pages add a screen-reader `<h1>` only
 * without a hero; only a browser shows what a real page ends up with after SSR
 * and hydration — both counted here, page by page.
 *
 * One test walking the routes, not one per route: the suite runs close to its
 * 300 s global budget, and each test pays a fresh page.
 */
import mysql from 'mysql2/promise'
import { expect, test } from '@playwright/test'
import { e2eDbConfig } from './harness'

const stamp = `${Date.now()}`
const tag = `E2EH1${stamp}`
const ARTICLE_SLUG = `${tag.toLowerCase()}-bai-tin`
const ARTICLE_TITLE = `${tag} Bài tin một tiêu đề`

let connection: mysql.Connection

test.beforeAll(async () => {
  connection = await mysql.createConnection(e2eDbConfig())
  const [[category]] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id FROM categories WHERE slug = 'tin-noi-bat' LIMIT 1`)
  await connection.execute(
    `INSERT INTO articles (type, category_id, title, slug, excerpt, content, status, published_at)
     VALUES ('news', ?, ?, ?, 'Trích đoạn', '<h2>Mục</h2><p>Nội dung</p>', 'published', DATE_SUB(NOW(), INTERVAL 5 MINUTE))`,
    [category?.id ?? null, ARTICLE_TITLE, ARTICLE_SLUG])
})

test.afterAll(async () => {
  await connection.execute('DELETE FROM articles WHERE slug = ?', [ARTICLE_SLUG])
  await connection.end()
})

const ROUTES = [
  '/',
  '/news',
  `/news/tin-noi-bat/${ARTICLE_SLUG}`,
  '/about',
  '/contact',
  '/media',
  '/legal-qa',
  '/documents',
  '/search?q=a',
]

/** `<h1` opening tags in server HTML (Vue SSR writes them lower-case). */
const ssrH1Count = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length

test('every listed public page has exactly one <h1>, server-rendered and after hydration', async ({ page }) => {
  const report: string[] = []
  for (const route of ROUTES) {
    const response = await page.request.get(route)
    expect(response.status(), `${route} did not render`).toBe(200)
    const ssr = ssrH1Count(await response.text())

    await page.goto(route)
    await page.waitForLoadState('networkidle')
    const hydrated = await page.locator('h1').count()
    if (ssr !== 1 || hydrated !== 1) report.push(`${route}: SSR ${ssr}, hydrated ${hydrated}`)
  }
  expect(report, 'pages with zero or several <h1>').toEqual([])

  // The article's one heading is its title, not the site brand.
  await page.goto(`/news/tin-noi-bat/${ARTICLE_SLUG}`)
  await expect(page.locator('h1')).toHaveText(ARTICLE_TITLE)
})
