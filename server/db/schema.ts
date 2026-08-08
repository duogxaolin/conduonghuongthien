import {
  mysqlTable, int, bigint, varchar, text, longtext, boolean,
  timestamp, datetime, date, json, mysqlEnum, uniqueIndex, index} from 'drizzle-orm/mysql-core'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'
import { ANALYTICS_LIVE_SCOPE_TYPES } from '../utils/analytics-live'
import type { BlockData, BlockNode } from '../../app/utils/blocks/types'
import type { ContactChannel, SubmissionEventType, SubmissionStatus } from '../../app/utils/submission-status'

// ─── Roles ───────────────────────────────────────────────────────────────────
export const roles = mysqlTable('roles', {
  id:          int('id').autoincrement().primaryKey(),
  name:        varchar('name', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  isSystem:    boolean('is_system').default(false), // superadmin không xoá được
  createdAt:   timestamp('created_at').defaultNow(),
})

// ─── Permissions ─────────────────────────────────────────────────────────────
// resource: news | role_models | reintegration | documents | faq |
//           home_sections | users | roles | media | settings | submissions
export const permissions = mysqlTable('permissions', {
  id:        int('id').autoincrement().primaryKey(),
  roleId:    int('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  resource:  varchar('resource', { length: 64 }).notNull(),
  canCreate: boolean('can_create').default(false),
  canRead:   boolean('can_read').default(false),
  canUpdate: boolean('can_update').default(false),
  canDelete: boolean('can_delete').default(false),
  canPublish: boolean('can_publish').default(false),
  canArchive: boolean('can_archive').default(false),
  canTest: boolean('can_test').default(false),
}, (t) => ({
  roleResourceIdx: uniqueIndex('role_resource_idx').on(t.roleId, t.resource),
}))

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = mysqlTable('users', {
  id:           int('id').autoincrement().primaryKey(),
  username:     varchar('username', { length: 64 }).notNull().unique(),
  email:        varchar('email', { length: 128 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roleId:       int('role_id').references(() => roles.id),
  isActive:     boolean('is_active').default(true),
  // Bumped whenever every existing session for this user must stop working
  // (logout, password change). Tokens carry the value they were minted with,
  // so a stolen cookie stops being accepted as soon as this moves.
  tokenVersion: int('token_version').notNull().default(0),
  createdAt:    timestamp('created_at').defaultNow(),
  lastLoginAt:  timestamp('last_login_at'),
})

// ─── Multi-factor authentication ─────────────────────────────────────────────
// One row per (user, factor type). A factor is enabled by the *existence* of a
// row with state 'active' and disabled by deleting the row, so "disabled" can
// never drift from "material still sitting in the database".
export const userMfaFactors = mysqlTable('user_mfa_factors', {
  id:         int('id').autoincrement().primaryKey(),
  userId:     int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // totp = authenticator app | email_otp = code mailed to the account address
  // | second_password = second-tier password
  factorType: mysqlEnum('factor_type', ['totp', 'email_otp', 'second_password']).notNull(),
  // 'pending' factors are ignored by the login challenge until confirmed.
  state:      mysqlEnum('state', ['pending', 'active']).notNull().default('pending'),

  // TOTP only — AES-256-GCM envelope, same shape as chatbot provider keys.
  // Never a plaintext column: the secret must be recoverable to verify codes,
  // so encryption (not hashing) is the only option for this one factor.
  secretCiphertext: text('secret_ciphertext'),
  secretNonce:      varchar('secret_nonce', { length: 64 }),
  secretAuthTag:    varchar('secret_auth_tag', { length: 64 }),
  secretVersion:    int('secret_version'),
  // Lets a key rotation be detected instead of surfacing as a decrypt failure.
  secretKeyId:      varchar('secret_key_id', { length: 32 }),

  // second_password only — bcrypt, verify-only.
  passwordHash: varchar('password_hash', { length: 255 }),

  // email_otp only — the outstanding code. bcrypt rather than SHA-256: six
  // digits is a 10^6 space, which a fast hash surrenders instantly on a leak.
  pendingCodeHash:      varchar('pending_code_hash', { length: 255 }),
  pendingCodeExpiresAt: datetime('pending_code_expires_at', { mode: 'date', fsp: 3 }),
  pendingCodeAttempts:  int('pending_code_attempts').notNull().default(0),

  // Enrollment window for a 'pending' factor; past this it cannot be confirmed.
  pendingExpiresAt: datetime('pending_expires_at', { mode: 'date', fsp: 3 }),
  // Last accepted TOTP step, so a code observed in transit cannot be replayed.
  lastAcceptedStep: bigint('last_accepted_step', { mode: 'number' }),

  lastUsedAt: timestamp('last_used_at'),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  userFactorIdx: uniqueIndex('user_factor_idx').on(t.userId, t.factorType),
}))

// One row per code: single-use consumption is a per-code fact, not a counter.
export const userRecoveryCodes = mysqlTable('user_recovery_codes', {
  id:       int('id').autoincrement().primaryKey(),
  userId:   int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // bcrypt, verify-only. Displayed once at generation and never again.
  codeHash: varchar('code_hash', { length: 255 }).notNull(),
  // Regenerating issues a new batch; codes from older batches stop verifying
  // without having to delete them in the same transaction.
  batchId:  varchar('batch_id', { length: 32 }).notNull(),
  usedAt:   timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  userBatchIdx: index('recovery_user_batch_idx').on(t.userId, t.batchId),
}))

// ─── Media ───────────────────────────────────────────────────────────────────
export const media = mysqlTable('media', {
  id:           int('id').autoincrement().primaryKey(),
  filename:     varchar('filename', { length: 255 }).notNull(),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  mimeType:     varchar('mime_type', { length: 64 }).notNull(),
  sizeBytes:    int('size_bytes').notNull(),
  provider:     varchar('provider', { length: 16 }).notNull().default('local'), // local | r2
  url:          varchar('url', { length: 1024 }).notNull(),
  storagePath:  varchar('storage_path', { length: 1024 }).notNull(),
  width:        int('width'),
  height:       int('height'),
  uploadedBy:   int('uploaded_by').references(() => users.id),
  createdAt:    timestamp('created_at').defaultNow(),
}, (t) => ({
  mimeIdx: index('mime_type_idx').on(t.mimeType),
}))

// ─── Content Types (Thể Loại) ───────────────────────────────────────────────
// Top-level taxonomy tier. Categories reference a type via its `slug`.
// System types (isSystem=1) back the fixed public pages and cannot be deleted.
export const contentTypes = mysqlTable('content_types', {
  id:           int('id').autoincrement().primaryKey(),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 64 }).notNull().unique(),
  icon:         varchar('icon', { length: 64 }),
  description:  text('description'),
  displayOrder: int('display_order').notNull().default(0),
  isSystem:     boolean('is_system').notNull().default(false),
  createdAt:    timestamp('created_at').defaultNow(),
})

// ─── Categories ───────────────────────────────────────────────────────────────
// type: slug of a content_types row (news | role_model | reintegration | document | faq | custom…)
export const categories = mysqlTable('categories', {
  id:           int('id').autoincrement().primaryKey(),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull().unique(),
  // Self-referencing FK — mirrors the `fk_categories_parent` constraint created
  // by server/db/init.ts (ON DELETE SET NULL). Previously missing here, which
  // made schema.ts disagree with the real database.
  parentId:     int('parent_id').references((): AnyMySqlColumn => categories.id, { onDelete: 'set null' }),
  type:         varchar('type', { length: 32 }).notNull(),
  description:  text('description'),
  displayOrder: int('display_order').notNull().default(0),
  createdAt:    timestamp('created_at').defaultNow(),
})

// ─── Articles ─────────────────────────────────────────────────────────────────
// type: news | role_model | reintegration | document | faq
// category: sub-category slug (e.g. "tin-noi-bat") — only for types that have sub-categories
export const articles = mysqlTable('articles', {
  id:          int('id').autoincrement().primaryKey(),
  type:        varchar('type', { length: 32 }).notNull(),
  category:    varchar('category', { length: 128 }),
  categoryId:  int('category_id').references(() => categories.id, { onDelete: 'set null' }),
  title:       varchar('title', { length: 512 }).notNull(),
  slug:        varchar('slug', { length: 512 }).notNull().unique(),
  excerpt:     text('excerpt'),
  content:     longtext('content'),
  thumbnailId: int('thumbnail_id').references(() => media.id),
  thumbnailUrl:varchar('thumbnail_url', { length: 1024 }),
  status:      varchar('status', { length: 16 }).notNull().default('draft'), // draft | published | archived
  authorId:    int('author_id').references(() => users.id),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow().onUpdateNow(),
  // Off by default (reader-google-login-comments design.md D9): opening every
  // historical article the moment this feature deploys would be a moderation
  // load no officer chose, decided by a schema migration rather than a click.
  commentsEnabled: boolean('comments_enabled').notNull().default(false),
}, (t) => ({
  typeIdx:      index('type_idx').on(t.type),
  statusIdx:    index('status_idx').on(t.status),
  categoryIdx:  index('category_idx').on(t.category),
  categoryIdIdx: index('category_id_idx').on(t.categoryId),
}))

// ─── Article view counter ────────────────────────────────────────────────────
// One row per (day, article, source category). Deliberately NOT joined to
// `analytics_daily_pages`: that table is keyed on URL path, so it answers "how
// busy was this URL", not "how many people read this article" — slugs move and
// four route prefixes map to the same content type.
//
// Real and fabricated counts are separated twice over: by column, and by a
// `source_category` value ('boost') that the public allowlist does not contain.
// Either separation alone would leave SUM(real_views) honest, which is the
// point — the true figure has to stay recoverable with one sum, forever.
//
// Holds no personal data: a day, an article, a category and two counts. That is
// why it is not registered with server/services/data-retention.ts.
export const articleViewDaily = mysqlTable('article_view_daily', {
  id:              int('id').autoincrement().primaryKey(),
  day:             date('day', { mode: 'string' }).notNull(),
  articleId:       int('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  sourceCategory:  varchar('source_category', { length: 32 }).notNull().default('direct'),
  realViews:       bigint('real_views', { mode: 'number', unsigned: true }).notNull().default(0),
  fabricatedViews: bigint('fabricated_views', { mode: 'number', unsigned: true }).notNull().default(0),
  createdAt:       timestamp('created_at').defaultNow(),
  updatedAt:       timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  dayArticleSourceIdx: uniqueIndex('article_view_daily_day_article_source_idx').on(t.day, t.articleId, t.sourceCategory),
  articleIdx: index('article_view_daily_article_idx').on(t.articleId),
}))

// ─── Gradual view inflation jobs ─────────────────────────────────────────────
// Only gradual mode writes here. Instant inflation is complete the moment it is
// authorised, and the activity log already records who did it — a row that says
// "finished" on creation would be a record of nothing.
//
// `applied_amount` is what the delivery pass compares against a time-derived
// target, so a missed tick, a restart, or a pass that ran late all resolve to
// the same answer instead of silently losing the downtime window.
export const articleViewBoost = mysqlTable('article_view_boost', {
  id:              int('id').autoincrement().primaryKey(),
  articleId:       int('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  totalAmount:     int('total_amount', { unsigned: true }).notNull(),
  appliedAmount:   int('applied_amount', { unsigned: true }).notNull().default(0),
  durationMinutes: int('duration_minutes', { unsigned: true }).notNull(),
  startedAt:       datetime('started_at', { mode: 'date' }).notNull(),
  endsAt:          datetime('ends_at', { mode: 'date' }).notNull(),
  status:          varchar('status', { length: 16 }).notNull().default('running'), // running | completed | cancelled
  createdBy:       int('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').defaultNow(),
  updatedAt:       timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  statusEndsAtIdx: index('article_view_boost_status_ends_idx').on(t.status, t.endsAt),
  articleIdx: index('article_view_boost_article_idx').on(t.articleId),
}))

// ─── Home Sections ───────────────────────────────────────────────────────────
// type: hero | stats | news | role_models | reintegration | documents | links | chatbot_cta
export const homeSections = mysqlTable('home_sections', {
  id:           int('id').autoincrement().primaryKey(),
  type:         varchar('type', { length: 32 }).notNull().unique(),
  displayOrder: int('display_order').notNull().default(0),
  config:       json('config'),  // title, subtitle, bgImage, itemCount, etc.
  isVisible:    boolean('is_visible').default(true),
  updatedAt:    timestamp('updated_at').defaultNow().onUpdateNow(),
  updatedBy:    int('updated_by').references(() => users.id),
})

// ─── Page Contents ───────────────────────────────────────────────────────────
// Static page nội dung (gioi-thieu, lien-he, ...)
export const pageContents = mysqlTable('page_contents', {
  id:         int('id').autoincrement().primaryKey(),
  slug:       varchar('slug', { length: 64 }).notNull(),
  sectionKey: varchar('section_key', { length: 64 }).notNull(),
  content:    json('content').notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().onUpdateNow(),
  updatedBy:  int('updated_by').references(() => users.id),
}, (t) => ({
  slugSectionIdx: uniqueIndex('slug_section_idx').on(t.slug, t.sectionKey),
}))

// ─── Pages ─────────────────────────────────────────────────────────────────
// Generic page container. slug: home | about | contact | <custom>.
// isSystem=true → editable meta/blocks but not deletable, and slug locked.
export const pages = mysqlTable('pages', {
  id:             int('id').autoincrement().primaryKey(),
  slug:           varchar('slug', { length: 64 }).notNull().unique(),
  title:          varchar('title', { length: 255 }).notNull(),
  isSystem:       boolean('is_system').default(false),
  seoTitle:       varchar('seo_title', { length: 255 }),
  seoDescription: text('seo_description'),
  // Published node tree (JSON). NULL = page has never been published under the
  // nested-tree model → public read falls back to the flat page_blocks table.
  // Shape: recursive [{ id, blockType, data, isVisible, colSpan?, children?[] }, ...]
  publishedBlocks: json('published_blocks').$type<BlockNode[]>(),
  // Unpublished working copy. NULL = no pending draft (published == what's live).
  // Shape: [{ id|tmpId, blockType, displayOrder, data, isVisible, colSpan?, children? }, ...]
  draftBlocks:    json('draft_blocks').$type<BlockNode[]>(),
  draftUpdatedAt: timestamp('draft_updated_at'),
  draftUpdatedBy: int('draft_updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt:      timestamp('updated_at').defaultNow().onUpdateNow(),
  updatedBy:      int('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

// ─── Page Blocks ───────────────────────────────────────────────────────────
// Ordered content blocks belonging to a page. blockType is a registry key
// (hero | stats | news | … | heading | richtext | image | …). data is the
// block-specific payload (title, html, imageUrl, maxItems, …).
export const pageBlocks = mysqlTable('page_blocks', {
  id:           int('id').autoincrement().primaryKey(),
  pageId:       int('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  blockType:    varchar('block_type', { length: 48 }).notNull(),
  displayOrder: int('display_order').notNull().default(0),
  data:         json('data').$type<BlockData>(),
  isVisible:    boolean('is_visible').default(true),
  updatedAt:    timestamp('updated_at').defaultNow().onUpdateNow(),
  updatedBy:    int('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  pageOrderIdx: index('page_blocks_page_order_idx').on(t.pageId, t.displayOrder),
}))

// ─── Page Versions ───────────────────────────────────────────────────────────
// Saved snapshots of a page's blocks for restore/backup.
//   kind = 'origin' : the locked default baseline (max 1 per page).
//   kind = 'auto'   : auto-captured before each publish, ring-buffered (max 5).
//   kind = 'manual' : user-named backups kept on purpose (max 4).
// blocks holds the full block array snapshot; label is user text for manual/origin.
export const pageVersions = mysqlTable('page_versions', {
  id:        int('id').autoincrement().primaryKey(),
  pageId:    int('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  kind:      mysqlEnum('kind', ['origin', 'auto', 'manual']).notNull().default('auto'),
  label:     varchar('label', { length: 128 }),
  blocks:    json('blocks').notNull().$type<BlockNode[]>(),
  createdAt: timestamp('created_at').defaultNow(),
  createdBy: int('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  pageKindIdx: index('page_versions_page_kind_idx').on(t.pageId, t.kind, t.id),
}))

// ─── Settings ────────────────────────────────────────────────────────────────
export const settings = mysqlTable('settings', {
  key:   varchar('key', { length: 128 }).primaryKey(),
  value: text('value'),
  type:  varchar('type', { length: 16 }).default('string'), // string | json | boolean
  group: varchar('group', { length: 32 }).default('general'), // general | media | chatbot | contact
})

// ─── Activity Logs ───────────────────────────────────────────────────────────
// ─── Rate limit counters ─────────────────────────────────────────────────────
// Shared across workers and across restarts. A `Map` in the worker process lost
// every lockout on deploy and only ever bound one replica.
export const rateLimitCounters = mysqlTable('rate_limit_counters', {
  bucketKey:       varchar('bucket_key', { length: 191 }).primaryKey(),
  hitCount:        int('hit_count').notNull().default(0),
  windowExpiresAt: datetime('window_expires_at', { mode: 'date', fsp: 3 }).notNull(),
}, (t) => ({
  expiryIdx: index('rate_limit_expiry_idx').on(t.windowExpiresAt),
}))

export const activityLogs = mysqlTable('activity_logs', {
  id:         int('id').autoincrement().primaryKey(),
  userId:     int('user_id').references(() => users.id),
  action:     varchar('action', { length: 32 }).notNull(), // create | update | delete | login | logout
  resource:   varchar('resource', { length: 64 }),
  resourceId: int('resource_id'),
  meta:       json('meta'),
  createdAt:  timestamp('created_at').defaultNow(),
}, (t) => ({
  userIdx: index('user_idx').on(t.userId),
  // Retention purges and the admin log view both filter on time.
  createdIdx: index('activity_created_idx').on(t.createdAt),
}))

// ─── Data retention state ────────────────────────────────────────────────────
// One row per purged table. Two jobs:
//
//   1. `purgedTotal` is a running counter. A purge that works is indistinguish-
//      able from a purge that never ran once the rows are gone, so the count has
//      to be banked before deletion. Lifetime volume = purgedTotal + live rows.
//   2. `lastRunAt` is how the in-process scheduler knows today's run already
//      happened, so a restart does not re-purge on every boot.
export const dataRetentionState = mysqlTable('data_retention_state', {
  scope:         varchar('scope', { length: 32 }).primaryKey(), // activity_logs | submissions
  purgedTotal:   bigint('purged_total', { mode: 'number', unsigned: true }).notNull().default(0),
  lastRunAt:     datetime('last_run_at', { mode: 'date' }),
  lastDeleted:   int('last_deleted').notNull().default(0),
  lastTrigger:   varchar('last_trigger', { length: 16 }), // scheduler | cron | manual
  lastStatus:    varchar('last_status', { length: 16 }),  // success | warning | failed
  lastMessage:   varchar('last_message', { length: 512 }),
  updatedAt:     timestamp('updated_at').defaultNow().onUpdateNow(),
})

// ─── Submissions ─────────────────────────────────────────────────────────────
export const submissions = mysqlTable('submissions', {
  id:        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  fullName:  varchar('full_name', { length: 255 }).notNull(),
  phone:     varchar('phone', { length: 30 }).notNull(),
  email:     varchar('email', { length: 255 }),
  address:   text('address'),
  message:   text('message'),
  // Free-form contact-form answers that don't map to a fixed column: [{ label, value }]
  answers:   json('answers'),
  // Title of the form/block that produced this submission.
  formTitle: varchar('form_title', { length: 255 }),
  // ─── Vòng đời xử lý ───
  // Giá trị nằm trong SUBMISSION_STATUSES (app/utils/submission-status.ts) — một
  // nguồn chân lý dùng chung cho phép kiểm máy chủ và nhãn hiển thị.
  status:    varchar('status', { length: 24 }).notNull().default('new').$type<SubmissionStatus>(),
  statusChangedBy: int('status_changed_by').references(() => users.id, { onDelete: 'set null' }),
  statusChangedAt: datetime('status_changed_at', { mode: 'date' }),
  // Ai MỞ hồ sơ này lần ĐẦU. Cột này chỉ ghi một lần; mọi lượt xem sau nằm ở
  // `activity_logs`. Nó trả lời "đơn của người dân này đã có ai nhìn tới chưa" —
  // câu hỏi mà một trạng thái đang là `new` không phân biệt được với một đơn đã
  // được đọc nhưng chưa ai bấm đổi gì.
  firstViewedBy: int('first_viewed_by').references(() => users.id, { onDelete: 'set null' }),
  firstViewedAt: datetime('first_viewed_at', { mode: 'date' }),
  // Đóng dấu khi email thông báo gửi THÀNH CÔNG. NULL nghĩa là chưa ai được báo —
  // và trước thay đổi này thì đó là **mọi** hàng, không có gì trên màn hình nói ra.
  notifiedAt: datetime('notified_at', { mode: 'date' }),
  // DATETIME (not TIMESTAMP) to match the column created by server/db/init.ts.
  // The distinction matters: MySQL converts TIMESTAMP to/from UTC but stores
  // DATETIME verbatim, and the connection pool runs with timezone '+07:00'.
  createdAt: datetime('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  createdIdx: index('submissions_created_idx').on(t.createdAt),
  // Trang quản trị lọc theo trạng thái rồi xếp theo ngày gửi. Index tổ hợp để
  // một bộ lọc trạng thái không phải quét cả bảng.
  statusCreatedIdx: index('submissions_status_created_idx').on(t.status, t.createdAt),
}))

/**
 * Nhật ký xử lý một đơn đăng ký: ai xem lần đầu, ai đổi trạng thái, ai ghi chú,
 * ai đã liên hệ người dân và bằng cách nào.
 *
 * **CỐ Ý KHÔNG phải một scope lưu trữ.** Mọi hàng treo trên `submissions` bằng FK
 * `ON DELETE CASCADE`, và `submissions` **đã là** một scope (mặc định `0` = không
 * tự xoá, vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định). Cho
 * bảng này một cửa sổ tuổi riêng là xoá nhật ký xử lý **trong khi hồ sơ còn sống**
 * — hồ sơ sẽ hiện ra như chưa ai từng chạm tới, đúng điều bảng này ra đời để phủ
 * nhận. Cùng lý do `chat_messages`, `article_comments` và `reader_notifications`
 * không phải scope.
 */
export const submissionEvents = mysqlTable('submission_events', {
  id:           bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  submissionId: bigint('submission_id', { mode: 'number', unsigned: true }).notNull()
                  .references(() => submissions.id, { onDelete: 'cascade' }),
  // SET NULL, không CASCADE: xoá một tài khoản cán bộ **không** được làm biến mất
  // dấu vết việc họ đã xử lý hồ sơ của một công dân. Đó đúng là dấu vết cần giữ
  // nhất. Tên đăng nhập lúc đó lấy qua leftJoin, hàng log vẫn còn.
  actorId:      int('actor_id').references(() => users.id, { onDelete: 'set null' }),
  // Ảnh chụp tên đăng nhập lúc xảy ra sự việc, để hàng log của một tài khoản đã
  // xoá vẫn đọc được là ai. Không phải bản sao dư: `actor_id` trả lời "còn tài
  // khoản nào không", cột này trả lời "lúc đó là ai".
  actorName:    varchar('actor_name', { length: 64 }),
  eventType:    varchar('event_type', { length: 16 }).notNull().$type<SubmissionEventType>(),
  fromStatus:   varchar('from_status', { length: 24 }).$type<SubmissionStatus>(),
  toStatus:     varchar('to_status', { length: 24 }).$type<SubmissionStatus>(),
  channel:      varchar('channel', { length: 16 }).$type<ContactChannel>(),
  note:         text('note'),
  createdAt:    datetime('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  submissionCreatedIdx: index('submission_events_submission_idx').on(t.submissionId, t.createdAt),
}))

// ─── Governed Chatbot ─────────────────────────────────────────────────────────
export const chatbotSettings = mysqlTable('chatbot_settings', {
  id:                    int('id').primaryKey().default(1),
  enabled:               boolean('enabled').notNull().default(false),
  providerPolicy:        varchar('provider_policy', { length: 64 }).notNull().default('openai-compatible'),
  baseUrl:               varchar('base_url', { length: 1024 }),
  model:                 varchar('model', { length: 128 }),
  systemPrompt:          text('system_prompt'),
  allowedHosts:          json('allowed_hosts').$type<string[]>(),
  // Answer mode & lead capture (added for AI / knowledge-only modes)
  mode:                  varchar('mode', { length: 16 }).notNull().default('knowledge'),
  outOfScopeBehavior:    varchar('out_of_scope_behavior', { length: 24 }).notNull().default('knowledge_only'),
  knowledgeGreeting:     varchar('knowledge_greeting', { length: 500 }),
  fallbackMessage:       varchar('fallback_message', { length: 1000 }),
  leadCaptureEnabled:    boolean('lead_capture_enabled').notNull().default(true),
  leadCaptureEmail:      varchar('lead_capture_email', { length: 255 }),
  // Fixed greeting/thanks/"who are you" replies when the knowledge bank matches
  // nothing. See utils/chatbot/small-talk.ts.
  smallTalkEnabled:      boolean('small_talk_enabled').notNull().default(true),
  requestTimeoutMs:      int('request_timeout_ms', { unsigned: true }).notNull().default(10000),
  maxResponseBytes:      int('max_response_bytes', { unsigned: true }).notNull().default(262144),
  maxInputChars:         int('max_input_chars', { unsigned: true }).notNull().default(2000),
  maxHistoryMessages:    int('max_history_messages', { unsigned: true }).notNull().default(8),
  retrievalTopK:         int('retrieval_top_k', { unsigned: true }).notNull().default(3),
  referenceCharBudget:   int('reference_char_budget', { unsigned: true }).notNull().default(6000),
  rateLimitRequests:     int('rate_limit_requests', { unsigned: true }).notNull().default(10),
  rateLimitWindowSeconds:int('rate_limit_window_seconds', { unsigned: true }).notNull().default(60),
  apiKeyCiphertext:      text('api_key_ciphertext'),
  apiKeyNonce:           varchar('api_key_nonce', { length: 64 }),
  apiKeyAuthTag:         varchar('api_key_auth_tag', { length: 64 }),
  apiKeyVersion:         int('api_key_version', { unsigned: true }),
  apiKeyKeyId:           varchar('api_key_key_id', { length: 64 }),
  apiKeyLastFour:        varchar('api_key_last_four', { length: 4 }),
  updatedBy:             int('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:             timestamp('created_at').defaultNow(),
  updatedAt:             timestamp('updated_at').defaultNow().onUpdateNow(),
})

export const chatbotKnowledge = mysqlTable('chatbot_knowledge', {
  id:                bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  canonicalQuestion: varchar('canonical_question', { length: 1000 }).notNull(),
  normalizedQuestion:varchar('normalized_question', { length: 191 }).notNull(),
  approvedAnswer:    longtext('approved_answer').notNull(),
  topic:             varchar('topic', { length: 128 }).notNull(),
  sourceLabel:       varchar('source_label', { length: 255 }),
  sourceUrl:         varchar('source_url', { length: 1024 }),
  sourceReference:   varchar('source_reference', { length: 512 }),
  internalNotes:     text('internal_notes'),
  status:            mysqlEnum('status', ['draft', 'published', 'archived']).notNull().default('draft'),
  priority:          int('priority').notNull().default(0),
  isQuickQuestion:   boolean('is_quick_question').notNull().default(false),
  authorId:          int('author_id').references(() => users.id, { onDelete: 'set null' }),
  reviewerId:        int('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt:        datetime('reviewed_at', { mode: 'date' }),
  publishedAt:       datetime('published_at', { mode: 'date' }),
  archivedAt:        datetime('archived_at', { mode: 'date' }),
  createdAt:         timestamp('created_at').defaultNow(),
  updatedAt:         timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  lifecycleIdx: index('chatbot_knowledge_status_priority_id_idx').on(t.status, t.priority, t.id),
  topicLifecycleIdx: index('chatbot_knowledge_topic_status_priority_id_idx').on(t.topic, t.status, t.priority, t.id),
  normalizedQuestionIdx: index('chatbot_knowledge_normalized_question_idx').on(t.normalizedQuestion),
  updatedIdx: index('chatbot_knowledge_updated_id_idx').on(t.updatedAt, t.id),
}))

export const chatbotKnowledgeTerms = mysqlTable('chatbot_knowledge_terms', {
  id:          bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  knowledgeId: bigint('knowledge_id', { mode: 'number', unsigned: true }).notNull().references(() => chatbotKnowledge.id, { onDelete: 'cascade' }),
  kind:        mysqlEnum('kind', ['alias', 'keyword']).notNull(),
  value:       varchar('value', { length: 1000 }).notNull(),
  normalizedValue: varchar('normalized_value', { length: 191 }).notNull(),
  createdAt:   timestamp('created_at').defaultNow(),
}, (t) => ({
  uniqueTermIdx: uniqueIndex('chatbot_terms_knowledge_kind_normalized_idx').on(t.knowledgeId, t.kind, t.normalizedValue),
  retrievalIdx: index('chatbot_terms_kind_normalized_knowledge_idx').on(t.kind, t.normalizedValue, t.knowledgeId),
}))

// ─── Chatbot small talk (everyday replies) ────────────────────────────────────
// A store kept fully separate from chatbot_knowledge: greetings, "who are you",
// portal navigation, emotional support, portal facts. No draft→published flow
// and no source requirement — those belong to the approved knowledge bank. The
// business bank always wins; this store is only consulted when retrieval returns
// nothing. Keeping it in its own table means public queries (quick-questions,
// sources) never risk leaking an everyday reply into the approved surface.
export const chatbotSmallTalk = mysqlTable('chatbot_small_talk', {
  id:                 bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  category:           varchar('category', { length: 32 }).notNull(),
  question:           varchar('question', { length: 500 }).notNull(),
  normalizedQuestion: varchar('normalized_question', { length: 191 }).notNull().unique(),
  answer:             text('answer').notNull(),
  patterns:           json('patterns').$type<string[]>(),
  isEnabled:          boolean('is_enabled').notNull().default(true),
  isSystem:           boolean('is_system').notNull().default(false),
  displayOrder:       int('display_order').notNull().default(0),
  createdAt:          timestamp('created_at').defaultNow(),
  updatedAt:          timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  runtimeIdx: index('chatbot_small_talk_enabled_category_id_idx').on(t.isEnabled, t.category, t.id),
}))

// ─── Chat sessions & messages (visitor conversation history) ──────────────────
// One row per browser conversation. `id` is a client-generated UUID that arrives
// on the `X-Chat-Session` header alongside an HMAC of itself; the server only
// writes a row once that signature verifies. The token is a *correlation* key,
// not an authentication credential — stripping the header costs the visitor
// nothing except their transcript, which is the intended trade-off for a portal
// that requires no login.
export const chatSessions = mysqlTable('chat_sessions', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  ip:             varchar('ip', { length: 45 }),
  userAgent:      varchar('user_agent', { length: 512 }),
  detectedPhone:  varchar('detected_phone', { length: 20 }),
  detectedName:   varchar('detected_name', { length: 128 }),
  // Set when a signed-in reader claims a conversation they held in this browser
  // before signing in — the claim endpoint verifies the session's HMAC ticket, so
  // this is never taken on the client's word.
  //
  // SET NULL on delete, deliberately not CASCADE. chat_sessions is its own
  // retention scope with its own 90-day window; reader_accounts keeps 365 days.
  // Cascading would make deleting a reader also destroy chat transcripts that the
  // delete-confirmation dialog does not count — an officer agreeing to one thing
  // and getting another. SET NULL leaves the session exactly as it was before it
  // was claimed.
  readerId:       int('reader_id').references(() => readerAccounts.id, { onDelete: 'set null' }),
  messageCount:   int('message_count', { unsigned: true }).notNull().default(0),
  startedAt:      datetime('started_at', { mode: 'date' }).notNull(),
  lastMessageAt:  datetime('last_message_at', { mode: 'date' }).notNull(),
}, (t) => ({
  // Admin list orders by recency; the detected-phone index backs the
  // "has contact info" filter and the submissions cross-link lookup.
  recentIdx: index('chat_sessions_last_message_idx').on(t.lastMessageAt),
  startedIdx: index('chat_sessions_started_idx').on(t.startedAt),
  phoneIdx: index('chat_sessions_detected_phone_idx').on(t.detectedPhone),
  readerIdx: index('chat_sessions_reader_id_idx').on(t.readerId),
}))

export const chatMessages = mysqlTable('chat_messages', {
  id:        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  sessionId: varchar('session_id', { length: 36 }).notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role:      mysqlEnum('role', ['user', 'assistant']).notNull(),
  content:   text('content').notNull(),
  // Mirrors the `kind` the public endpoint returns (knowledge | ai | small_talk |
  // rate_limited | error) so the admin transcript can show *why* a reply looked
  // the way it did without re-running retrieval.
  kind:      varchar('kind', { length: 32 }),
  createdAt: datetime('created_at', { mode: 'date' }).notNull(),
}, (t) => ({
  transcriptIdx: index('chat_messages_session_created_idx').on(t.sessionId, t.createdAt),
}))

// ─── Privacy-preserving Analytics ─────────────────────────────────────────────
export const analyticsPageViewEvents = mysqlTable('analytics_page_view_events', {
  id:             bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  occurredAt:     datetime('occurred_at', { mode: 'date' }).notNull(),
  eventDay:       date('event_day', { mode: 'string' }).notNull(),
  path:           varchar('path', { length: 512 }).notNull(),
  visitorToken:   varchar('visitor_token', { length: 64 }).notNull(),
  sourceCategory: varchar('source_category', { length: 32 }).notNull().default('direct'),
  deviceClass:    varchar('device_class', { length: 16 }).notNull().default('unknown'),
  countryCode:    varchar('country_code', { length: 2 }),
  regionCode:     varchar('region_code', { length: 16 }),
  createdAt:      timestamp('created_at').defaultNow(),
}, (t) => ({
  dayPathIdx: index('analytics_events_day_path_idx').on(t.eventDay, t.path),
  dayVisitorIdx: index('analytics_events_day_visitor_idx').on(t.eventDay, t.visitorToken),
  occurredAtIdx: index('analytics_events_occurred_at_idx').on(t.occurredAt),
}))

export const analyticsLiveMinuteBuckets = mysqlTable('analytics_live_minute_buckets', {
  id:                        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  bucketStart:               datetime('bucket_start', { mode: 'date' }).notNull(),
  scopeType:                 mysqlEnum('scope_type', ANALYTICS_LIVE_SCOPE_TYPES).notNull(),
  scopeValue:                varchar('scope_value', { length: 512 }).notNull(),
  scopeValueHash:            varchar('scope_value_hash', { length: 64 }).notNull(),
  pageViews:                 bigint('page_views', { mode: 'number', unsigned: true }).notNull().default(0),
  approximateUniqueVisitors: bigint('approximate_unique_visitors', { mode: 'number', unsigned: true }).notNull().default(0),
  updatedAt:                 timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  bucketScopeValueIdx: uniqueIndex('analytics_live_bucket_scope_value_idx').on(t.bucketStart, t.scopeType, t.scopeValueHash),
  bucketScopeViewsIdx: index('analytics_live_bucket_scope_views_idx').on(t.bucketStart, t.scopeType, t.pageViews),
}))

export const analyticsLiveDeduplication = mysqlTable('analytics_live_deduplication', {
  id:             bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  bucketStart:    datetime('bucket_start', { mode: 'date' }).notNull(),
  scopeType:      mysqlEnum('scope_type', ANALYTICS_LIVE_SCOPE_TYPES).notNull(),
  scopeValueHash: varchar('scope_value_hash', { length: 64 }).notNull(),
  visitorToken:   varchar('visitor_token', { length: 64 }).notNull(),
  createdAt:      timestamp('created_at').defaultNow(),
}, (t) => ({
  bucketScopeVisitorIdx: uniqueIndex('analytics_live_dedup_bucket_scope_visitor_idx').on(t.bucketStart, t.scopeType, t.scopeValueHash, t.visitorToken),
  bucketIdx: index('analytics_live_dedup_bucket_idx').on(t.bucketStart),
}))

export const analyticsNocMinuteAggregates = mysqlTable('analytics_noc_minute_aggregates', {
  id:              bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  bucketStart:     datetime('bucket_start', { mode: 'date' }).notNull(),
  eventType:       varchar('event_type', { length: 48 }).notNull(),
  severity:        varchar('severity', { length: 16 }).notNull(),
  component:       varchar('component', { length: 32 }).notNull(),
  status:          varchar('status', { length: 16 }).notNull(),
  errorCode:       varchar('error_code', { length: 64 }).notNull().default('none'),
  eventCount:      bigint('event_count', { mode: 'number', unsigned: true }).notNull().default(0),
  durationCount:   bigint('duration_count', { mode: 'number', unsigned: true }).notNull().default(0),
  durationTotalMs: bigint('duration_total_ms', { mode: 'number', unsigned: true }).notNull().default(0),
  durationMaxMs:   int('duration_max_ms', { unsigned: true }).notNull().default(0),
  detailsJson:     varchar('details_json', { length: 1024 }),
  updatedAt:       timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  bucketIdentityIdx: uniqueIndex('analytics_noc_bucket_identity_idx').on(t.bucketStart, t.eventType, t.severity, t.component, t.status, t.errorCode),
  bucketSeverityIdx: index('analytics_noc_bucket_severity_idx').on(t.bucketStart, t.severity),
}))

export const analyticsDailyTraffic = mysqlTable('analytics_daily_traffic', {
  day:                 date('day', { mode: 'string' }).primaryKey(),
  pageViews:           bigint('page_views', { mode: 'number', unsigned: true }).notNull().default(0),
  dailyUniqueVisitors: bigint('daily_unique_visitors', { mode: 'number', unsigned: true }).notNull().default(0),
  updatedAt:           timestamp('updated_at').defaultNow().onUpdateNow(),
})

export const analyticsDailyPages = mysqlTable('analytics_daily_pages', {
  id:                  bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  day:                 date('day', { mode: 'string' }).notNull(),
  path:                varchar('path', { length: 512 }).notNull(),
  pageViews:           bigint('page_views', { mode: 'number', unsigned: true }).notNull().default(0),
  dailyUniqueVisitors: bigint('daily_unique_visitors', { mode: 'number', unsigned: true }).notNull().default(0),
  updatedAt:           timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  dayPathIdx: uniqueIndex('analytics_daily_pages_day_path_idx').on(t.day, t.path),
  dayViewsIdx: index('analytics_daily_pages_day_views_idx').on(t.day, t.pageViews),
}))

export const analyticsDailyDimensions = mysqlTable('analytics_daily_dimensions', {
  id:                  bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  day:                 date('day', { mode: 'string' }).notNull(),
  dimension:           varchar('dimension', { length: 32 }).notNull(),
  value:               varchar('value', { length: 128 }).notNull(),
  pageViews:           bigint('page_views', { mode: 'number', unsigned: true }).notNull().default(0),
  dailyUniqueVisitors: bigint('daily_unique_visitors', { mode: 'number', unsigned: true }).notNull().default(0),
  updatedAt:           timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  dayDimensionValueIdx: uniqueIndex('analytics_dimensions_day_dimension_value_idx').on(t.day, t.dimension, t.value),
  dayDimensionViewsIdx: index('analytics_dimensions_day_dimension_views_idx').on(t.day, t.dimension, t.pageViews),
}))

export const analyticsDailyAdminUsers = mysqlTable('analytics_daily_admin_users', {
  day:         date('day', { mode: 'string' }).primaryKey(),
  totalUsers:  int('total_users', { unsigned: true }).notNull().default(0),
  activeUsers: int('active_users', { unsigned: true }).notNull().default(0),
  updatedAt:   timestamp('updated_at').defaultNow().onUpdateNow(),
})

export const analyticsMaintenanceRuns = mysqlTable('analytics_maintenance_runs', {
  day:           date('day', { mode: 'string' }).primaryKey(),
  status:        varchar('status', { length: 16 }).notNull(),
  startedAt:     datetime('started_at', { mode: 'date' }).notNull(),
  completedAt:   datetime('completed_at', { mode: 'date' }),
  eventCount:    bigint('event_count', { mode: 'number', unsigned: true }).notNull().default(0),
  errorSummary:  varchar('error_summary', { length: 512 }),
  workerToken:   varchar('worker_token', { length: 64 }),
  updatedAt:     timestamp('updated_at').defaultNow().onUpdateNow(),
}, (t) => ({
  statusDayIdx: index('analytics_maintenance_status_day_idx').on(t.status, t.day),
  completedAtIdx: index('analytics_maintenance_completed_at_idx').on(t.completedAt),
}))

// ─── Reader accounts (Google sign-in) & public comments ──────────────────────
// A reader is a member of the public who signed in with Google to comment.
// Keyed on the Google `sub` claim, never on email (reader-google-login-comments
// design.md D6: email is mutable and reassignable, sub is not). No avatar
// column: avatars are rendered locally from the display name (design.md D7) so
// no visitor request ever reaches a Google-hosted image.
export const readerAccounts = mysqlTable('reader_accounts', {
  id:            int('id').autoincrement().primaryKey(),
  googleSub:     varchar('google_sub', { length: 255 }).notNull().unique(),
  email:         varchar('email', { length: 255 }),
  displayName:   varchar('display_name', { length: 255 }),
  // The name the reader chose for themselves, kept in a column of its own so the
  // OAuth callback can keep refreshing `display_name` from Google on every
  // sign-in — which it does deliberately — without that refresh silently
  // erasing a name the reader typed. Null means "no custom name": the effective
  // name falls back to the Google one. Read only through effectiveDisplayName()
  // in server/services/readers.ts, never column-by-column at a call site.
  customDisplayName: varchar('custom_display_name', { length: 255 }),
  /**
   * Whether to email this reader when somebody answers their comment.
   *
   * Defaults ON because the notification is the whole point — a citizen asks a
   * legal question and leaves, and the in-portal bell only reaches them if they
   * happen to come back. But it MUST be switchable from the profile page:
   * emailing a citizen with no way to stop is spam, whoever is sending it.
   */
  emailNotifications: boolean('email_notifications').notNull().default(true),
  isBanned:      boolean('is_banned').notNull().default(false),
  banReason:     text('ban_reason'),
  bannedAt:      datetime('banned_at', { mode: 'date' }),
  bannedBy:      int('banned_by').references(() => users.id, { onDelete: 'set null' }),
  // Bumped on ban so an existing 30-day reader ticket stops being accepted
  // immediately — the same mechanism users.tokenVersion already provides.
  tokenVersion:  int('token_version').notNull().default(0),
  createdAt:     timestamp('created_at').defaultNow(),
  // Ages and orders the retention scope (design.md D16) — created_at would
  // delete an account that signed up long ago but commented yesterday.
  lastSeenAt:    datetime('last_seen_at', { mode: 'date' }).notNull(),
  lastIp:        varchar('last_ip', { length: 45 }),
  lastUserAgent: varchar('last_user_agent', { length: 512 }),
}, (t) => ({
  lastSeenIdx: index('reader_accounts_last_seen_at_idx').on(t.lastSeenAt),
  isBannedIdx: index('reader_accounts_is_banned_idx').on(t.isBanned),
}))

// One row per comment or administrator reply. parentId self-references for the
// single reply level. Every FK cascades except adminUserId (design.md D8): a
// staff account being deleted must not remove the portal's public replies.
export const articleComments = mysqlTable('article_comments', {
  id:          bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  articleId:   int('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  readerId:    int('reader_id').references(() => readerAccounts.id, { onDelete: 'cascade' }),
  adminUserId: int('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
  parentId:    bigint('parent_id', { mode: 'number', unsigned: true }).references((): AnyMySqlColumn => articleComments.id, { onDelete: 'cascade' }),
  body:        text('body').notNull(),
  ip:          varchar('ip', { length: 45 }),
  userAgent:   varchar('user_agent', { length: 512 }),
  createdAt:   datetime('created_at', { mode: 'date' }).notNull(),
}, (t) => ({
  articleParentCreatedIdx: index('article_comments_article_parent_created_idx').on(t.articleId, t.parentId, t.createdAt),
  readerIdx: index('article_comments_reader_id_idx').on(t.readerId),
}))

/**
 * "Somebody replied to you" — one row per reply, addressed to the author of the
 * comment it answers.
 *
 * **Both FKs cascade, and that is what keeps this table honest.** A notification
 * is a pointer to a row somebody can go and read; when the reply is deleted the
 * notification has nothing left to point at, and following it would land the
 * reader on an article with no such comment — which reads as the portal having
 * removed their words. Deleting the reader takes their notifications too, on the
 * same reasoning that already governs `article_comments`.
 *
 * **Deliberately NOT a retention scope** (`server/services/data-retention.ts`).
 * Every row here hangs off `article_comments`, which itself cascades from both
 * `articles` and `reader_accounts` — two scopes that already exist — so this
 * table is bounded before retention ever looks at it. An independent age window
 * would delete the notification while the reply is still sitting on the page
 * unread, and a row cap would drop the oldest notifications of the most active
 * readers first. Same reasoning that keeps `chat_messages` and `article_comments`
 * out of the scope list; adding a fifth scope for this is the mistake to avoid.
 *
 * `UNIQUE (reader_id, comment_id)` makes the write idempotent: one reply can
 * never announce itself twice, whatever retries happen above.
 */
export const readerNotifications = mysqlTable('reader_notifications', {
  id:        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  // Who is being told. Not "who acted" — the actor is reachable through the
  // comment, and storing it here would invite a query that filters by it.
  readerId:  int('reader_id').notNull().references(() => readerAccounts.id, { onDelete: 'cascade' }),
  // The reply itself. Everything shown in the list (excerpt, article, timestamp)
  // is read through this, so nothing here can drift out of sync with the thread.
  commentId: bigint('comment_id', { mode: 'number', unsigned: true }).notNull().references((): AnyMySqlColumn => articleComments.id, { onDelete: 'cascade' }),
  // Only 'comment_reply' today. A column rather than an implied constant so a
  // second kind (a new article in a followed topic) does not need a migration.
  type:      varchar('type', { length: 32 }).notNull().default('comment_reply'),
  isRead:    boolean('is_read').notNull().default(false),
  createdAt: datetime('created_at', { mode: 'date' }).notNull(),
}, (t) => ({
  // Serves both the unread badge and the list, which are the only two reads.
  readerUnreadIdx: index('reader_notifications_reader_read_created_idx').on(t.readerId, t.isRead, t.createdAt),
  commentIdx:      index('reader_notifications_comment_id_idx').on(t.commentId),
  readerCommentUq: uniqueIndex('reader_notifications_reader_comment_uq').on(t.readerId, t.commentId),
}))

// Address bans for sign-in and comment writes. `value` is a single IPv4/IPv6
// address or an IPv4 CIDR block, validated by server/utils/ip-ban.ts before a
// row is ever written (design.md D11) — a stored value that never matches
// produces a ban the officer believes is in force.
export const readerIpBans = mysqlTable('reader_ip_bans', {
  id:        int('id').autoincrement().primaryKey(),
  value:     varchar('value', { length: 64 }).notNull().unique(),
  reason:    text('reason'),
  createdBy: int('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
})

// Single-row Google OAuth configuration. The secret envelope columns mirror
// chatbotSettings.apiKey* exactly (design.md D3): same AES-256-GCM primitives,
// distinct context label, so a copy-pasted ciphertext from one table fails
// authentication when read as the other.
export const googleOauthSettings = mysqlTable('google_oauth_settings', {
  id:                     int('id').primaryKey().default(1),
  clientId:               varchar('client_id', { length: 255 }),
  clientSecretCiphertext: text('client_secret_ciphertext'),
  clientSecretNonce:      varchar('client_secret_nonce', { length: 64 }),
  clientSecretAuthTag:    varchar('client_secret_auth_tag', { length: 64 }),
  clientSecretVersion:    int('client_secret_version', { unsigned: true }),
  clientSecretKeyId:      varchar('client_secret_key_id', { length: 64 }),
  clientSecretLastFour:   varchar('client_secret_last_four', { length: 4 }),
  isEnabled:              boolean('is_enabled').notNull().default(false),
  defaultCommentsEnabled: boolean('default_comments_enabled').notNull().default(false),
  updatedAt:              timestamp('updated_at').defaultNow().onUpdateNow(),
  updatedBy:              int('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

// ─── Types ───────────────────────────────────────────────────────────────────
export type Role        = typeof roles.$inferSelect
export type Permission  = typeof permissions.$inferSelect
export type User        = typeof users.$inferSelect
export type UserMfaFactor = typeof userMfaFactors.$inferSelect
export type NewUserMfaFactor = typeof userMfaFactors.$inferInsert
export type UserRecoveryCode = typeof userRecoveryCodes.$inferSelect
export type Media       = typeof media.$inferSelect
export type Category    = typeof categories.$inferSelect
export type Article     = typeof articles.$inferSelect
export type ArticleViewDaily = typeof articleViewDaily.$inferSelect
export type ArticleViewBoost = typeof articleViewBoost.$inferSelect
export type NewArticleViewBoost = typeof articleViewBoost.$inferInsert
export type HomeSection = typeof homeSections.$inferSelect
export type PageContent = typeof pageContents.$inferSelect
export type Page        = typeof pages.$inferSelect
export type NewPage     = typeof pages.$inferInsert
export type PageBlock   = typeof pageBlocks.$inferSelect
export type NewPageBlock = typeof pageBlocks.$inferInsert
export type Setting     = typeof settings.$inferSelect
export type ActivityLog = typeof activityLogs.$inferSelect
export type DataRetentionState = typeof dataRetentionState.$inferSelect
export type Submission  = typeof submissions.$inferSelect
export type ChatbotSettings = typeof chatbotSettings.$inferSelect
export type NewChatbotSettings = typeof chatbotSettings.$inferInsert
export type ChatbotKnowledge = typeof chatbotKnowledge.$inferSelect
export type NewChatbotKnowledge = typeof chatbotKnowledge.$inferInsert
export type ChatbotKnowledgeTerm = typeof chatbotKnowledgeTerms.$inferSelect
export type NewChatbotKnowledgeTerm = typeof chatbotKnowledgeTerms.$inferInsert
export type ChatbotSmallTalk = typeof chatbotSmallTalk.$inferSelect
export type NewChatbotSmallTalk = typeof chatbotSmallTalk.$inferInsert
export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert
export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert
export type AnalyticsPageViewEvent = typeof analyticsPageViewEvents.$inferSelect
export type AnalyticsLiveMinuteBucket = typeof analyticsLiveMinuteBuckets.$inferSelect
export type AnalyticsLiveDeduplication = typeof analyticsLiveDeduplication.$inferSelect
export type AnalyticsNocMinuteAggregate = typeof analyticsNocMinuteAggregates.$inferSelect
export type AnalyticsDailyTraffic = typeof analyticsDailyTraffic.$inferSelect
export type AnalyticsDailyPage = typeof analyticsDailyPages.$inferSelect
export type AnalyticsDailyDimension = typeof analyticsDailyDimensions.$inferSelect
export type AnalyticsDailyAdminUser = typeof analyticsDailyAdminUsers.$inferSelect
export type AnalyticsMaintenanceRun = typeof analyticsMaintenanceRuns.$inferSelect
export type ReaderAccount = typeof readerAccounts.$inferSelect
export type NewReaderAccount = typeof readerAccounts.$inferInsert
export type ArticleComment = typeof articleComments.$inferSelect
export type NewArticleComment = typeof articleComments.$inferInsert
export type ReaderNotification = typeof readerNotifications.$inferSelect
export type NewReaderNotification = typeof readerNotifications.$inferInsert
export type ReaderIpBan = typeof readerIpBans.$inferSelect
export type NewReaderIpBan = typeof readerIpBans.$inferInsert
export type GoogleOauthSettings = typeof googleOauthSettings.$inferSelect
export type NewGoogleOauthSettings = typeof googleOauthSettings.$inferInsert
