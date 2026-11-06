/**
 * Phần dùng chung của dịch vụ đồng bộ ảnh (`media-sync*.ts`): kiểu, hằng số và lượt chọn
 * hàng cần chuyển. Không giữ trạng thái — trạng thái job sống ở một chỗ (`media-sync.ts`).
 */
import { eq } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { media } from '../db/schema'

export const LOCK_TIMEOUT_SECONDS = 0
export const BUSY_MESSAGE = 'Một lượt đồng bộ khác đang chạy. Thử lại sau.'

export type SyncDirection = 'to-r2' | 'to-local'

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
  /** Số hàng nội dung (bài viết, bản dịch, khối trang) đã được thay URL. */
  articlesRewritten: number
}

export interface SyncJobStatus {
  jobId: string
  direction: SyncDirection
  running: boolean
  cancelling: boolean
  /** Tổng số hàng cần sync (đếm khi worker đã giữ khoá). */
  total: number
  /** Số hàng đã xử lý (OK + skip). */
  done: number
  synced: number
  skipped: number
  errors: string[]
  /** Số hàng nội dung đã được thay URL (gồm cả lượt vá đầu job). */
  articlesRewritten: number
  /** Số URL dở dang từ lượt đồng bộ trước đã được vá ở đầu job. */
  urlsRepaired: number
  phase: 'backup' | 'sync' | 'rewrite' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  /** Stamp snapshot backup trước sync (để recover thủ công nếu thảm họa). */
  preBackupStamp: string | null
}

export type SyncItem = typeof media.$inferSelect

/** Chọn hàng cần sync theo hướng. */
export async function selectItems(direction: SyncDirection): Promise<SyncItem[]> {
  const db = getDb()
  return direction === 'to-r2'
    ? await db.select().from(media).where(eq(media.provider, 'local'))
    : await db.select().from(media).where(eq(media.provider, 'r2'))
}
