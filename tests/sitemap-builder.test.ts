import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSitemapXml, type SitemapUrl } from '../server/utils/sitemap-builder'

test('buildSitemapXml — empty list returns valid urlset', () => {
  const xml = buildSitemapXml('https://cdht.delify.vn', [])
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  assert.match(xml, /<\/urlset>$/)
  assert.doesNotMatch(xml, /<url>/)
})

test('buildSitemapXml — emits loc, lastmod, changefreq, priority', () => {
  const urls: SitemapUrl[] = [
    { loc: '/', changefreq: 'monthly', priority: 1.0 },
    { loc: '/news', lastmod: '2026-09-26', changefreq: 'daily', priority: 0.9 },
  ]
  const xml = buildSitemapXml('https://cdht.delify.vn', urls)
  assert.match(xml, /<loc>https:\/\/cdht\.delify\.vn\/<\/loc>/)
  assert.match(xml, /<loc>https:\/\/cdht\.delify\.vn\/news<\/loc>/)
  assert.match(xml, /<lastmod>2026-09-26<\/lastmod>/)
  assert.match(xml, /<changefreq>daily<\/changefreq>/)
  assert.match(xml, /<priority>1\.0<\/priority>/)
  assert.match(xml, /<priority>0\.9<\/priority>/)
})

test('buildSitemapXml — escapes XML special chars in loc', () => {
  const xml = buildSitemapXml('https://cdht.delify.vn', [
    { loc: '/news?a=1&b=2' },
  ])
  assert.match(xml, /<loc>https:\/\/cdht\.delify\.vn\/news\?a=1&#38;b=2<\/loc>/)
  assert.doesNotMatch(xml, /\?a=1&[^#]/)
})

test('buildSitemapXml — strips trailing slash from base', () => {
  const xml = buildSitemapXml('https://cdht.delify.vn/', [{ loc: '/about' }])
  assert.match(xml, /<loc>https:\/\/cdht\.delify\.vn\/about<\/loc>/)
  assert.doesNotMatch(xml, /\/\/about/)
})

test('buildSitemapXml — lastmod omitted when null/undefined', () => {
  const xml = buildSitemapXml('https://x.vn', [{ loc: '/a', lastmod: null }, { loc: '/b' }])
  assert.doesNotMatch(xml, /<lastmod>/)
})
