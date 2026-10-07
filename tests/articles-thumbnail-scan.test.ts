/**
 * Quét ảnh thumbnail hỏng — kiểm cấu trúc mã nguồn (guard text-source, không cần MySQL).
 *
 * Chặn các hồi quy cấu trúc mà review bằng mắt dễ bỏ sót:
 *
 *   1. Endpoint phải yêu cầu quyền `media.update` — không phải `articles.update`
 *      (resource `articles` không tồn tại trong `PERMISSION_RESOURCES`; article
 *      map theo type `news`/`role_models`/…; quét tất cả types → cần quyền cha).
 *   2. Service phải dùng named lock `cdkt:articles:scan-thumbnails` (timeout 0).
 *   3. Dry-run KHÔNG UPDATE — chỉ quét + trả danh sách.
 *   4. Fix phải bọc trong `db.transaction` + insert `activityLogs`.
 *   5. Fix phải tự backup SQL trước (`runBackup('sql', 'pre-fix-thumbnails'...)`).
 *   6. `DEFAULT_COVER` phải là `/assets/default_cover_light.png` (khớp SafeImg).
 *   7. `BackupTrigger` phải có `'pre-fix-thumbnails'`.
 *   8. Service KHÔNG xoá file local/media — chỉ UPDATE `thumbnail_url`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const svc = readFileSync('server/services/articles-thumbnail-scan.ts', 'utf8')
const api = readFileSync('server/api/admin/articles/scan-thumbnails.post.ts', 'utf8')
const backup = readFileSync('server/services/backup.ts', 'utf8')

describe('articles-thumbnail-scan: cấu trúc mã nguồn', () => {
  it('endpoint yêu cầu quyền media.update (không phải articles)', () => {
    // `articles` không có trong PERMISSION_RESOURCES — article map theo type.
    // Quét tất cả types → cần quyền cha; thao tác bản chất là vá media (cùng họ
    // self-heal/repair-urls đã dùng media.update).
    assert.ok(/requireResourcePermission\(adminUser, 'media', 'update'\)/.test(api),
      'endpoint phải yêu cầu quyền media.update')
    assert.ok(!/requireResourcePermission\(adminUser, 'articles'/.test(api),
      'không được dùng articles.update — resource này không tồn tại')
  })

  it('service dùng named lock cdkt:articles:scan-thumbnails (timeout 0)', () => {
    assert.ok(/LOCK_NAME = 'cdkt:articles:scan-thumbnails'/.test(svc),
      'phải khai báo LOCK_NAME')
    assert.ok(/withNamedLock\(pool, LOCK_NAME, 0/.test(svc),
      'phải gọi withNamedLock timeout 0 (không xếp hàng)')
    assert.ok(/Một lượt quét thumbnail khác đang chạy/.test(svc),
      'phải throw 409 message khi lock busy')
  })

  it('DEFAULT_COVER là /assets/default_cover_light.png (khớp SafeImg fallback)', () => {
    assert.ok(/DEFAULT_COVER = '\/assets\/default_cover_light\.png'/.test(svc),
      'DEFAULT_COVER phải là /assets/default_cover_light.png — khớp SafeImg.vue fallback')
  })

  it('dry-run KHÔNG UPDATE — chỉ quét + trả danh sách', () => {
    // Dry-run branch phải return trước khi tới transaction UPDATE.
    assert.ok(/isNotNull\(articles\.thumbnailUrl\)/.test(svc),
      'dry-run phải select WHERE thumbnailUrl IS NOT NULL')
    // Chỉ UPDATE trong branch !dryRun.
    assert.ok(/if \(!dryRun && uniqueFixIds\.length > 0\)/.test(svc),
      'UPDATE chỉ chạy khi dryRun=false VÀ fixIds không rỗng')
  })

  it('fix bọc trong db.transaction + insert activityLogs', () => {
    assert.ok(/await db\.transaction\(async \(tx\) => {[\s\S]*UPDATE articles SET thumbnail_url/.test(svc),
      'UPDATE thumbnail_url phải trong db.transaction')
    assert.ok(/tx\.insert\(activityLogs\)\.values\({[\s\S]*action: 'articles_fix_thumbnails'/.test(svc),
      'phải insert activityLogs action articles_fix_thumbnails')
  })

  it('fix tự backup SQL trước (pre-fix-thumbnails)', () => {
    assert.ok(/runBackup\('sql', 'pre-fix-thumbnails'/.test(svc),
      'phải runBackup pre-fix-thumbnails trước khi UPDATE')
  })

  it('KHÔNG xoá file local/media — chỉ UPDATE thumbnail_url', () => {
    assert.ok(!/deleteLocalFile\(/.test(svc), 'không được gọi deleteLocalFile')
    assert.ok(!/fs\.unlink/.test(svc), 'không được gọi fs.unlink')
    assert.ok(!/fs\.rm\(/.test(svc), 'không được gọi fs.rm')
    assert.ok(!/deleteR2File\(/.test(svc), 'không được gọi deleteR2File')
    assert.ok(!/tx\.delete\(articles\)/.test(svc) && !/db\.delete\(articles\)/.test(svc),
      'không được DELETE articles')
  })

  it('idempotent — không UPDATE bài đã có default cover', () => {
    // Skip bài đã có thumb === defaultCover → chạy lại không thay đổi.
    assert.ok(/a\.thumb === defaultCover/.test(svc),
      'phải skip bài đã có thumbnail === defaultCover (idempotent)')
  })

  it('kiểm R2 URL qua headR2Object + kiểm local qua fs.access', () => {
    assert.ok(/headR2Object\(key/.test(svc), 'phải gọi headR2Object cho R2 URL')
    assert.ok(/fs\.access\(localPath\)/.test(svc), 'phải dùng fs.access check file local')
  })

  it('giới hạn 500 bài hỏng trong report', () => {
    assert.ok(/broken\.length >= 500/.test(svc),
      'phải giới hạn broken list 500 bài (chống payload lớn)')
  })

  it('endpoint trả 409 khi lock busy, 503 khi DB chưa sẵn sàng', () => {
    assert.ok(/statusCode: 409/.test(api), '409 khi lock busy')
    assert.ok(/statusCode: 503/.test(api), '503 khi DB chưa sẵn sàng')
  })

  it('endpoint validate fixIds là số dương + defaultCover /assets/', () => {
    assert.ok(/Number\.isSafeInteger\(id\) && id > 0/.test(api),
      'phải filter fixIds số dương')
    assert.ok(/defaultCover\.startsWith\('\/assets\/'\)/.test(api),
      'phải validate defaultCover bắt đầu /assets/')
  })
})

describe('backup: trigger pre-fix-thumbnails', () => {
  it('BackupTrigger có pre-fix-thumbnails', () => {
    assert.ok(/'pre-fix-thumbnails'/.test(backup), "BackupTrigger phải có 'pre-fix-thumbnails'")
  })
})
