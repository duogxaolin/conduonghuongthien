/**
 * Tự vá ảnh R2 missing + repoint thumbnail — kiểm cấu trúc mã nguồn.
 *
 * Đây là guard text-source (không cần MySQL). Chặn các hồi quy cấu trúc mà
 * một review bằng mắt dễ bỏ sót:
 *
 *   1. `media-self-heal.ts` KHÔNG xoá file local — chỉ upload R2 + repoint URL.
 *      Self-heal chữa bệnh, không tạo bệnh. Nếu ai thêm `deleteLocalFile`/
 *      `fs.unlink` vào service thì file gốc (fallback cuối cùng) mất vĩnh viễn.
 *   2. `repointArticleThumbnails` phải tồn tại trong `media-sync.ts` và được gọi
 *      trong Phase 3 — trước đây sync chỉ repoint `content`, bỏ sót `thumbnail_url`
 *      → 1132 bài thumbnail gãy.
 *   3. `headR2Object` phải được dùng trong `syncOneToR2` TRƯỚC `deleteLocalFile`
 *      — verify R2 object tồn tại trước khi xoá local, không xoá vô điều kiện.
 *   4. Endpoint `self-heal.post.ts` wymag `media.update` quyền — không phải
 *      `media.create` (quét) hay `media.delete`.
 *   5. Backup trigger `'pre-self-heal'` phải nằm trong `BackupTrigger` union.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const svcHeal = readFileSync('server/services/media-self-heal.ts', 'utf8')
// `media-sync.ts` được tách làm 3 tệp (worker + rewrite bài viết + từng hàng); các khẳng định
// dưới đây nói về cấu trúc của dịch vụ đồng bộ chứ không về tệp nào giữ hàm nào.
const svcSync = ['media-sync.ts', 'media-sync-rewrite.ts', 'media-sync-files.ts']
  .map(name => readFileSync(`server/services/${name}`, 'utf8'))
  .join('\n')
const apiHeal = readFileSync('server/api/admin/media/self-heal.post.ts', 'utf8')
const backup = readFileSync('server/services/backup.ts', 'utf8')

describe('media-self-heal: cấu trúc mã nguồn', () => {
  it('KHÔNG xoá file local — chỉ upload + repoint', () => {
    // Self-heal chữa: upload lại R2 object missing, repoint thumbnail. Không
    // bao giờ xoá file local — file gốc là fallback cuối cùng khi R2 fail. Nếu
    // ai thêm xoá local vào đây thì mất ảnh vĩnh viễn.
    assert.ok(!/deleteLocalFile\(/.test(svcHeal), 'media-self-heal.ts không được gọi deleteLocalFile')
    assert.ok(!/fs\.unlink/.test(svcHeal), 'media-self-heal.ts không được gọi fs.unlink')
    assert.ok(!/fs\.rm\(/.test(svcHeal), 'media-self-heal.ts không được gọi fs.rm')
  })

  it('upload R2 lại từ buffer file local, không đổi URL/row', () => {
    // Upload lại vào cùng key (PUT idempotent) — không sinh URL mới, không UPDATE
    // media row. Chỉ bổ sung object R2 thiếu.
    assert.ok(/uploadR2File\(/.test(svcHeal), 'phải gọi uploadR2File cho R2 missing')
    // Không có tx.update(media) — không đổi hàng media đã có.
    assert.ok(!/tx\.update\(media\)/.test(svcHeal) && !/db\.update\(media\)/.test(svcHeal),
      'không UPDATE hàng media — chỉ upload lại object R2')
  })

  it('repoint thumbnail_url bằng JOIN basename + UPDATE WHERE id', () => {
    // Self-heal repoint theo flow: select candidates có thumbnail LIKE
    // /uploads/migrated/%, match basename với media.filename R2, UPDATE theo id.
    // Không UPDATE hàng loạt WHERE thumbnail_url = ... (không match được absolute).
    assert.ok(/like\(articles\.thumbnailUrl, '%\/uploads\/migrated\/%'\)/.test(svcHeal),
      'phải select candidates WHERE thumbnail_url LIKE %/uploads/migrated/%')
    assert.ok(/path\.basename\(a\.thumb\)/.test(svcHeal),
      'phải extract basename từ thumbnail để join với media.filename')
    assert.ok(/urlByFilename\.get\(basename\)/.test(svcHeal),
      'phải lookup R2 URL qua basename → media.filename map')
    assert.ok(/UPDATE articles SET thumbnail_url = .*WHERE id = /.test(svcHeal),
      'UPDATE theo id (đã select + match trước), không UPDATE hàng loạt')
  })

  it('dryRun không UPDATE/upload — chỉ đếm', () => {
    // dryRun: bỏ qua block upload, bỏ qua tx UPDATE articles. Chỉ đếm số sẽ sửa.
    assert.ok(/if \(opts\.dryRun\) continue/.test(svcHeal), 'dryRun phải skip upload block')
    assert.ok(/if \(!opts\.dryRun\) {[\s\S]*await db\.transaction/.test(svcHeal),
      'transaction UPDATE articles chỉ chạy khi không dryRun')
  })

  it('khoá named lock cdkt:media:self-heal', () => {
    assert.ok(/LOCK_NAME = 'cdkt:media:self-heal'/.test(svcHeal),
      'phải dùng named lock cdkt:media:self-heal')
    assert.ok(/withNamedLock\(pool, LOCK_NAME, 0/.test(svcHeal),
      'phải gọi withNamedLock timeout 0 (không xếp hàng)')
  })

  it('tự backup SQL trước khi chạy (không dryRun)', () => {
    assert.ok(/runBackup\('sql', 'pre-self-heal'/.test(svcHeal),
      'phải runBackup pre-self-heal trước khi vá')
  })

  it('báo cáo missingSamples để UI hiển thị', () => {
    assert.ok(/missingSamples/.test(svcHeal), 'report phải có missingSamples')
  })
})

describe('media-sync: repoint thumbnail_url + verify R2 trước xoá', () => {
  it('repointArticleThumbnails tồn tại và được gọi trong Phase 3', () => {
    assert.ok(/async function repointArticleThumbnails\(/.test(svcSync),
      'repointArticleThumbnails phải được định nghĩa')
    assert.ok(/await repointArticleThumbnails\(db, rewrites/.test(svcSync),
      'Phase 3 phải gọi repointArticleThumbnails')
  })

  it('syncOneToR2 gọi headR2Object TRƯỚC deleteLocalFile', () => {
    const idxHead = svcSync.indexOf('headR2Object(r2Key, r2Config)')
    const idxDelete = svcSync.indexOf('await deleteLocalFile(oldStoragePath)')
    assert.ok(idxHead > -1, 'phải gọi headR2Object(r2Key, r2Config)')
    assert.ok(idxDelete > -1, 'phải gọi deleteLocalFile(oldStoragePath)')
    assert.ok(idxHead < idxDelete, 'headR2Object phải TRƯỚC deleteLocalFile — verify R2 rồi mới xoá local')
  })

  it('nếu R2 HeadObject 404 → KHÔNG xoá local, log warn', () => {
    // Pattern: if (r2Exists) deleteLocalFile else logWarn
    assert.ok(/const r2Exists = await headR2Object/.test(svcSync))
    assert.ok(/if \(r2Exists\) {[\s\S]*await deleteLocalFile/.test(svcSync),
      'deleteLocalFile chỉ chạy trong nhánh r2Exists=true')
    assert.ok(/media\.sync_to_r2_local_kept/.test(svcSync),
      'log warn event media.sync_to_r2_local_kept khi R2 404')
  })
})

describe('endpoint self-heal.post.ts', () => {
  it('yêu cầu quyền media.update', () => {
    assert.ok(/requireResourcePermission\(adminUser, 'media', 'update'\)/.test(apiHeal),
      'endpoint phải yêu cầu quyền media.update')
  })

  it('nhận body dryRun boolean', () => {
    assert.ok(/dryRun/.test(apiHeal), 'phải đọc dryRun từ body')
    assert.ok(/typeof .*dryRun.* === 'boolean'/.test(apiHeal),
      'phải validate dryRun là boolean')
  })

  it('status code 409 khi lock busy, 400 khi R2 chưa cấu hình', () => {
    assert.ok(/statusCode: 409/.test(apiHeal), '409 khi lock busy')
    assert.ok(/statusCode: 400/.test(apiHeal), '400 khi R2 chưa cấu hình')
  })
})

describe('backup: trigger pre-self-heal', () => {
  it('BackupTrigger có pre-self-heal', () => {
    assert.ok(/'pre-self-heal'/.test(backup), "BackupTrigger phải có 'pre-self-heal'")
  })
})
