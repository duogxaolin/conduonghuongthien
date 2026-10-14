import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Xoay vòng backup không bao giờ xoá bản MỚI NHẤT của mỗi họ (SQL / uploads /
 * media) và không bao giờ xoá bản `pre-restore`, với mọi `keepCount` — kể cả 1.
 *
 * Trước đây xoay vòng giữ `keepCount` hàng `done` mới nhất theo `stamp`, bất kể
 * loại: một lượt "files" sinh HAI archive cùng stamp (`cdkt-uploads-…`,
 * `cdkt-media-…`), nên `keepCount=1` giữ một trong hai và xoá archive duy nhất còn
 * lại của họ kia, cùng toàn bộ SQL; bản `pre-restore` (ảnh chụp ngay trước một
 * lần khôi phục — đường lùi duy nhất) cũng bị đếm và xoá như mọi bản khác.
 */

const { selectRotationVictims, backupFamilyOf, isPreRestoreBackup } = await import('../server/services/backup')

type Row = { id: number, filename: string, stamp: string, trigger: string, status: string }
let nextId = 1
const row = (filename: string, stamp: string, trigger = 'manual', status = 'done'): Row => ({ id: nextId++, filename, stamp, trigger, status })

const HISTORY: Row[] = [
  row('cdkt-20261001T000000Z-scheduled.sql.gz', '20261001T000000Z', 'scheduled'),
  row('cdkt-uploads-20261001T000000Z-scheduled.tar.gz', '20261001T000000Z', 'scheduled'),
  row('cdkt-media-20261001T000000Z-scheduled.tar.gz', '20261001T000000Z', 'scheduled'),
  row('cdkt-20261002T000000Z-pre-restore.sql.gz', '20261002T000000Z', 'pre-restore'),
  row('cdkt-20261003T000000Z-manual.sql.gz', '20261003T000000Z'),
  row('cdkt-uploads-20261004T000000Z-manual.tar.gz', '20261004T000000Z'),
  row('cdkt-media-20261004T000000Z-manual.tar.gz', '20261004T000000Z'),
  row('cdkt-20261005T000000Z-manual.sql.gz', '20261005T000000Z'),
  row('cdkt-20261006T000000Z-manual.sql.gz', '20261006T000000Z', 'manual', 'failed'),
]

const names = (rows: Row[]) => rows.map(r => r.filename).sort()

test('families come from the file name (two archives share type=media)', () => {
  assert.equal(backupFamilyOf('cdkt-20261005T000000Z-manual.sql.gz'), 'sql')
  assert.equal(backupFamilyOf('cdkt-uploads-20261004T000000Z-manual.tar.gz'), 'uploads')
  assert.equal(backupFamilyOf('cdkt-media-20261004T000000Z-manual.tar.gz'), 'media')
  assert.ok(isPreRestoreBackup({ filename: 'cdkt-20261002T000000Z-pre-restore.sql.gz', trigger: 'pre-restore' }))
  assert.ok(isPreRestoreBackup({ filename: 'cdkt-20261002T000000Z-pre-restore.sql.gz', trigger: null }), 'recognised by name even without the trigger column')
})

for (const keepCount of [1, 2, 3, 0, -5, 0.5]) {
  test(`keepCount=${keepCount}: the newest of each family and every pre-restore backup survive`, () => {
    const victims = selectRotationVictims(HISTORY, keepCount)
    const deleted = new Set(victims.map(v => v.filename))
    for (const kept of [
      'cdkt-20261005T000000Z-manual.sql.gz',
      'cdkt-uploads-20261004T000000Z-manual.tar.gz',
      'cdkt-media-20261004T000000Z-manual.tar.gz',
      'cdkt-20261002T000000Z-pre-restore.sql.gz',
    ]) {
      assert.ok(!deleted.has(kept), `${kept} must survive keepCount=${keepCount}`)
    }
    assert.ok(!deleted.has('cdkt-20261006T000000Z-manual.sql.gz'), 'a failed row is never a rotation candidate')
  })
}

test('keepCount=1 deletes exactly the older copies', () => {
  assert.deepEqual(names(selectRotationVictims(HISTORY, 1)), [
    'cdkt-20261001T000000Z-scheduled.sql.gz',
    'cdkt-20261003T000000Z-manual.sql.gz',
    'cdkt-media-20261001T000000Z-scheduled.tar.gz',
    'cdkt-uploads-20261001T000000Z-scheduled.tar.gz',
  ])
})

test('pre-restore backups do not take a slot: keepCount=4 keeps the four newest ordinary backups', () => {
  assert.deepEqual(names(selectRotationVictims(HISTORY, 4)), [
    'cdkt-20261001T000000Z-scheduled.sql.gz',
    'cdkt-media-20261001T000000Z-scheduled.tar.gz',
    'cdkt-uploads-20261001T000000Z-scheduled.tar.gz',
  ])
})

test('nothing to rotate when the history fits', () => {
  assert.deepEqual(selectRotationVictims(HISTORY, 14), [])
})
