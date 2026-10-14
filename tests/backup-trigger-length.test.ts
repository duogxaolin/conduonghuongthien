import assert from 'node:assert/strict'
import test from 'node:test'
import { getTableConfig } from 'drizzle-orm/mysql-core'

/**
 * Mọi trigger mà ứng dụng ghi vào `backups.trigger` phải vừa cột.
 *
 * Cột từng là VARCHAR(16) trong khi `pre-fix-thumbnails` dài 18 ký tự: dưới
 * strict sql_mode (mặc định của MySQL 8, đúng cấu hình production) lượt
 * `runBackup('sql', 'pre-fix-thumbnails')` chết với ER_DATA_TOO_LONG — không
 * ghi nổi cả hàng `failed`, file dump bị xoá, và lượt "sửa thumbnail" chạy tiếp
 * KHÔNG có bản sao lưu. Kiểm trên MySQL thật: `tests/backup-dump-integration.test.ts`
 * (CSDL mới + CSDL cũ được nới lúc khởi động). Test này là lưới nhanh không cần
 * MySQL: thêm một trigger dài hơn cột thì đỏ ngay ở đây.
 */

const { backups } = await import('../server/db/schema')
const { BACKUP_TRIGGERS } = await import('../server/services/backup')

test('every BackupTrigger fits backups.trigger', () => {
  const column = getTableConfig(backups).columns.find(c => c.name === 'trigger')
  assert.ok(column, 'backups.trigger exists in schema.ts')
  const length = (column as unknown as { length?: number }).length
  assert.equal(typeof length, 'number')
  assert.ok(BACKUP_TRIGGERS.length >= 8)
  for (const trigger of BACKUP_TRIGGERS) {
    assert.ok(trigger.length <= length!, `"${trigger}" (${trigger.length}) must fit VARCHAR(${length})`)
  }
  assert.ok(BACKUP_TRIGGERS.includes('pre-fix-thumbnails'))
})

test('every trigger passed to runBackup in server code is a declared BackupTrigger', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const path = await import('node:path')
  const root = path.resolve(import.meta.dirname, '..', 'server')
  const used = new Set<string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.ts')) {
        for (const match of readFileSync(full, 'utf8').matchAll(/runBackup\(\s*'[a-z]+'\s*,\s*'([^']+)'/g)) used.add(match[1]!)
      }
    }
  }
  walk(root)
  assert.ok(used.size >= 6, `found ${[...used].join(', ')}`)
  for (const trigger of used) {
    assert.ok((BACKUP_TRIGGERS as readonly string[]).includes(trigger), `runBackup trigger "${trigger}" is not in BACKUP_TRIGGERS`)
  }
})
