/**
 * Dọn cây tài sản cũ khi THAY tệp một video (`completeUpload` nhánh replace).
 *
 *   - `enqueueReplacedAssetCleanup` hẹn dọn đúng gốc của mục cũ (theo `storagePath`,
 *     không theo slug), cả bản local lẫn bản R2, hoãn một nhịp, không bao giờ hẹn
 *     dọn gốc mà mục đang trỏ tới. Hành vi trong transaction thật (rollback → không
 *     task nào) ở `upload-concurrency-integration.test.ts`.
 *   - `deleteR2Tree` xoá theo THƯ MỤC: gốc slug cũ `media/tin` không được nuốt
 *     `media/tin-2/…` của mục khác, và tiền tố rỗng (= cả bucket) bị từ chối.
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const bucket = ['media/tin/original.mp4', 'media/tin/generations/g1/master.m3u8', 'media/tin-2/original.mp4', 'media/tinh/thumb.jpg']
const deletedKeys: string[] = []
const listedPrefixes: string[] = []

class Command {
  input: Record<string, unknown>
  constructor(input: Record<string, unknown>) { this.input = input }
}
mock.module('@aws-sdk/client-s3', {
  namedExports: {
    S3Client: class {
      async send(cmd: Command) {
        if (cmd instanceof ListCommand) {
          const prefix = String(cmd.input.Prefix)
          listedPrefixes.push(prefix)
          return { Contents: bucket.filter(k => k.startsWith(prefix)).map(Key => ({ Key })), IsTruncated: false }
        }
        if (cmd instanceof DeleteCommand) {
          const objects = (cmd.input.Delete as { Objects: { Key: string }[] }).Objects
          for (const o of objects) deletedKeys.push(o.Key)
          return {}
        }
        return {}
      }
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
    // `video-r2-sync` dựng client qua `openR2` của `utils/media-r2` (kiểm account
    // id / bucket lúc dùng), và tệp đó import thêm lệnh này.
    DeleteObjectCommand: Command,
    ListObjectsV2Command: class ListCommand extends Command {},
    DeleteObjectsCommand: class DeleteCommand extends Command {},
  },
})
// Lấy lại đúng lớp đã đăng ký để `instanceof` ở trên khớp.
const sdk = await import('@aws-sdk/client-s3')
const ListCommand = sdk.ListObjectsV2Command as unknown as typeof Command
const DeleteCommand = sdk.DeleteObjectsCommand as unknown as typeof Command

const { deleteR2Tree } = await import('../server/services/video-r2-sync.ts')
const { enqueueReplacedAssetCleanup } = await import('../server/services/media-asset-cleanup.ts')

// Account id 32 hex + bucket hợp lệ: client R2 video nay từ chối cấu hình dị dạng
// lúc dùng (`tests/r2-config-use-time.test.ts`).
const r2 = { accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'k', secretAccessKey: 's', bucket: 'video-bucket', publicUrl: '' }

test('deleteR2Tree xoá theo thư mục, không theo tiền tố chuỗi', async () => {
  const res = await deleteR2Tree('media/tin', r2)
  assert.deepEqual(listedPrefixes, ['media/tin/'])
  assert.deepEqual(deletedKeys.sort(), ['media/tin/generations/g1/master.m3u8', 'media/tin/original.mp4'])
  assert.equal(res.deleted, 2)
})

test('deleteR2Tree từ chối tiền tố rỗng (sẽ xoá cả bucket)', async () => {
  deletedKeys.length = 0
  await assert.rejects(() => deleteR2Tree('', r2), /tiền tố rỗng/)
  await assert.rejects(() => deleteR2Tree('/', r2), /tiền tố rỗng/)
  assert.deepEqual(deletedKeys, [])
})

function recordingTx() {
  const inserted: Record<string, unknown>[] = []
  return { inserted, tx: { insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v) } }) } }
}

test('mục R2 bị thay: hẹn dọn gốc cũ ở CẢ local (tệp gốc) lẫn R2 (rendition), hoãn 30s', async () => {
  const { inserted, tx } = recordingTx()
  const now = new Date('2026-10-13T10:00:00.000Z')
  const n = await enqueueReplacedAssetCleanup(tx as never,
    { slug: 'phim-cu', storagePath: 'media/old-upload-id/generations/g7', storageProvider: 'r2' }, 'media/new-upload-id', now)
  assert.equal(n, 2)
  assert.deepEqual(inserted.map(t => `${t.storageProvider}:${t.assetRoot}`), ['local:media/old-upload-id', 'r2:media/old-upload-id'])
  assert.ok(inserted.every(t => (t.nextAttemptAt as Date).getTime() === now.getTime() + 30_000))
  assert.notEqual(inserted[0]!.id, inserted[1]!.id)
})

test('mục local: một task local; gốc theo storagePath, KHÔNG theo slug', async () => {
  const { inserted, tx } = recordingTx()
  await enqueueReplacedAssetCleanup(tx as never, { slug: 'phim-cu', storagePath: 'media/old-upload-id', storageProvider: 'local' }, 'media/new')
  assert.deepEqual(inserted.map(t => `${t.storageProvider}:${t.assetRoot}`), ['local:media/old-upload-id'])
})

test('không hẹn dọn gốc mục đang trỏ tới, không hẹn dọn đường dẫn dị dạng', async () => {
  const { inserted, tx } = recordingTx()
  assert.equal(await enqueueReplacedAssetCleanup(tx as never, { slug: 's', storagePath: 'media/same', storageProvider: 'r2' }, 'media/same'), 0)
  assert.equal(await enqueueReplacedAssetCleanup(tx as never, { slug: 's', storagePath: '../../etc', storageProvider: 'local' }, 'media/new'), 0)
  assert.deepEqual(inserted, [])
})
