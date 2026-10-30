/**
 * Guard cho export bài viết → Google Sheets + Google Docs.
 *
 * Kiểm cấu trúc mã nguồn (guard text-source, không gọi Google API thật):
 *
 *   1. Endpoint tồn tại + validate `ids` (max 50, lọc NaN/<=0).
 *   2. Permission per-bài `requireResourcePermission(read)` — bài không có quyền bị bỏ qua,
 *      không chặn cả batch (giống export-batch).
 *   3. Chưa linked Google Drive → 400 (kiểm `getUsableDriveLink` + branch not_linked).
 *   4. Secret unreadable → 400 xoay CHATBOT_ENCRYPTION_SECRET.
 *   5. Service tách riêng (`article-export-google.ts`) — endpoint không chứa logic Google API.
 *   6. Scope OAuth có `spreadsheets` + `documents` (drive.file một mình không đủ).
 *   7. HTML→Docs converter tách riêng (`html-to-docs.ts`) — không nhúng trong service.
 *   8. Tuần tự (không Promise.all) — tránh 429 rate limit Google API.
 *   9. Bỏ bài lỗi (try/catch per-bài, tiếp tục batch).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const api = readFileSync('server/api/admin/articles/export-google.post.ts', 'utf8')
const svc = readFileSync('server/services/article-export-google.ts', 'utf8')
const converter = readFileSync('server/utils/html-to-docs.ts', 'utf8')
const oauthConfig = readFileSync('server/utils/google-oauth/config.ts', 'utf8')

describe('article-export-google: cấu trúc mã nguồn', () => {
  it('endpoint validate ids — lọc NaN/<=0, max EXPORT_GOOGLE_MAX', () => {
    // `body?.ids`: một POST không có body đọc ra undefined (FINDING-R6-18, article-export-behavior).
    assert.ok(/Array\.isArray\(body\?\.ids\)/.test(api), 'phải check Array.isArray(body?.ids)')
    assert.ok(/Number\.isFinite\(n\) && n > 0/.test(api), 'phải lọc NaN và n <= 0')
    assert.ok(/ids\.length > EXPORT_GOOGLE_MAX/.test(api), 'phải chặn > EXPORT_GOOGLE_MAX')
    assert.ok(/Tối đa \$\{EXPORT_GOOGLE_MAX\} bài/.test(api), 'thông báo max phải dùng EXPORT_GOOGLE_MAX')
  })

  it('permission per-bài requireResourcePermission(read) — bỏ qua bài không quyền', () => {
    assert.ok(/requireResourcePermission\(adminUser, articleResource\(r\.type\), 'read'\)/.test(api),
      'phải gọi requireResourcePermission per-bài với articleResource(type) read')
    assert.ok(/allowed\.length === 0/.test(api),
      'phải check allowed.length === 0 → 403 (không có bài nào được quyền)')
  })

  it('chưa linked Google Drive → 400', () => {
    assert.ok(/getUsableDriveLink\(\)/.test(api), 'phải gọi getUsableDriveLink()')
    assert.ok(/link\.ok/.test(api), 'phải check link.ok')
    assert.ok(/Chưa liên kết Google Drive/.test(api), 'phải có message chưa liên kết')
  })

  it('secret unreadable → 400 xoay CHATBOT_ENCRYPTION_SECRET', () => {
    assert.ok(/secret_unreadable/.test(api), 'phải handle secret_unreadable')
    assert.ok(/xoay CHATBOT_ENCRYPTION_SECRET/.test(api),
      'phải hướng dẫn xoay CHATBOT_ENCRYPTION_SECRET')
  })

  it('cấu hình OAuth client — getUsableDriveOauthConfig', () => {
    assert.ok(/getUsableDriveOauthConfig\(\)/.test(api),
      'phải gọi getUsableDriveOauthConfig() cho clientId/secret')
    assert.ok(/config\.ok/.test(api), 'phải check config.ok')
  })

  it('service tách riêng — endpoint chỉ validate + dispatch', () => {
    // Endpoint không import trực tiếp googleapis/phẩm — logic Google ở service.
    assert.ok(!/from 'google-auth-library'/.test(api),
      'endpoint không import google-auth-library (logic Google ở service)')
    assert.ok(!/from '@googleapis\//.test(api),
      'endpoint không import @googleapis/* (logic Google ở service)')
    assert.ok(/from '.*services\/article-export-google'/.test(api),
      'endpoint phải import từ services/article-export-google')
  })

  it('service export exportArticlesToGoogle + EXPORT_GOOGLE_MAX', () => {
    assert.ok(/export async function exportArticlesToGoogle/.test(svc),
      'service phải export exportArticlesToGoogle')
    assert.ok(/export const EXPORT_GOOGLE_MAX = 50/.test(svc),
      'EXPORT_GOOGLE_MAX phải = 50')
  })

  it('scope OAuth có spreadsheets + documents (drive.file không đủ)', () => {
    assert.ok(/spreadsheets/.test(oauthConfig),
      'DRIVE_SCOPE phải có spreadsheets')
    assert.ok(/documents/.test(oauthConfig),
      'DRIVE_SCOPE phải có documents')
    assert.ok(/drive\.file/.test(oauthConfig),
      'DRIVE_SCOPE giữ drive.file (tạo folder/file)')
  })

  it('HTML→Docs converter tách riêng (html-to-docs.ts)', () => {
    assert.ok(/from '.*utils\/html-to-docs'/.test(svc),
      'service phải import htmlToDocs từ utils/html-to-docs')
    assert.ok(/export function htmlToDocs/.test(converter),
      'html-to-docs phải export function htmlToDocs')
    // Converter không gọi Google API — chỉ tạo requests thuần.
    assert.ok(!/from '@googleapis\//.test(converter),
      'converter không import @googleapis/* (chỉ tạo request objects)')
  })

  it('tuần tự — không Promise.all cho tạo Docs (tránh 429)', () => {
    // Batch tạo Doc tuần tự trong for-loop, không Promise.all.
    assert.ok(/for \(const article of articles\)/.test(svc),
      'phải for...of articles (tuần tự)')
    assert.ok(!/Promise\.all\(.*article/.test(svc),
      'không Promise.all cho tạo Docs — tránh 429 rate limit')
  })

  it('bỏ bài lỗi — try/catch per-bài, tiếp tục batch', () => {
    assert.ok(/catch[\s\S]*Bỏ bài lỗi/.test(svc),
      'phải try/catch per-bài + comment bỏ bài lỗi')
    assert.ok(/results\.length === 0/.test(svc),
      'phải throw khi results.length === 0 (không tạo được bài nào)')
  })

  it('tạo folder + Sheets + Docs — cấu trúc 3 bước', () => {
    assert.ok(/createExportFolder/.test(svc), 'phải có createExportFolder')
    assert.ok(/createExportSheets/.test(svc), 'phải có createExportSheets')
    assert.ok(/createArticleDoc/.test(svc), 'phải có createArticleDoc')
    // Sheets dùng =IMAGE(thumbnail) formula.
    assert.ok(/=IMAGE\("/.test(svc), 'Sheets phải dùng =IMAGE(url) formula cho thumbnail')
    // Trả sheetUrl + folderUrl + count.
    assert.ok(/sheetUrl/.test(svc), 'phải trả sheetUrl')
    assert.ok(/folderUrl/.test(svc), 'phải trả folderUrl')
    assert.ok(/count: results\.length/.test(svc), 'phải trả count = results.length')
  })

  it('Docs content — title heading + meta + content từ converter', () => {
    assert.ok(/headingType: 'TITLE'/.test(svc), 'title phải set headingType TITLE')
    assert.ok(/htmlToDocs\(article\.content/.test(svc),
      'content phải qua htmlToDocs converter')
    assert.ok(/shiftRequestIndex/.test(svc),
      'phải shift index của converter requests (tiếp tục sau title/meta)')
  })
})
