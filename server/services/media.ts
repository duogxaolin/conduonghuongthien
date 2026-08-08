/**
 * Media deletion, shared by the single-row and bulk routes.
 *
 * Deleting media is the one case here that touches storage as well as the
 * database, so the order matters: the file goes first, then the row. A row
 * removed before a failed storage delete would orphan the file with no record
 * left to find it by.
 *
 * The R2 credentials live in the `settings` table. `loadR2Config` is separate
 * from the delete so a lot of fifty files reads that table ONCE rather than
 * fifty times.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, media, settings } from '../db/schema'
import { deleteLocalFile } from '../utils/media-local'
import { deleteR2File, type R2Config } from '../utils/media-r2'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/** Read the R2 credentials out of `settings`. Call once per request, not per row. */
export async function loadR2Config(): Promise<R2Config> {
  const rows = await getDb().select().from(settings)
  const map = new Map(rows.map(row => [row.key, row.value]))
  return {
    accountId:       map.get('r2_account_id') || '',
    accessKeyId:     map.get('r2_access_key') || '',
    secretAccessKey: map.get('r2_secret_key') || '',
    bucket:          map.get('r2_bucket') || '',
    publicUrl:       map.get('r2_public_url') || '',
  }
}

/**
 * Delete one media item and its stored file.
 *
 * `r2Config` is optional so the single-row route keeps its original behaviour of
 * not reading `settings` at all for a local file. The bulk route passes it in,
 * which is what turns fifty reads into one.
 */
export async function deleteMediaById(actor: ActorLike, id: number, r2Config?: R2Config): Promise<void> {
  requireResourcePermission(actor, 'media', 'delete')

  const db = getDb()
  const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Media file không tồn tại.' })

  if (item.provider === 'r2') await deleteR2File(item.storagePath, r2Config ?? await loadR2Config())
  else await deleteLocalFile(item.storagePath)

  // Chỉ hai lượt ghi CSDL nằm trong transaction; lượt xoá tệp ở TRÊN, cố ý ngoài
  // khối. Tệp đã bị xoá khỏi đĩa hay khỏi R2 thì rollback không lấy lại được,
  // nên gói nó vào chỉ tạo ra một trạng thái tệ hơn: hàng còn nguyên và trông
  // như tệp vẫn ở đó. Trong khối, `tx` chứ không `db` — một `db.insert()` đặt
  // trong transaction vẫn commit độc lập trên pool.
  await db.transaction(async (tx) => {
    await tx.delete(media).where(eq(media.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'delete',
      resource: 'media',
      resourceId: id,
      meta: { filename: item.filename },
    })
  })
}
