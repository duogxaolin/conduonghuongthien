import {
  mysqlTable, int, varchar, text, longtext, boolean,
  timestamp, json, uniqueIndex, index
} from 'drizzle-orm/mysql-core'

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
  createdAt:    timestamp('created_at').defaultNow(),
  lastLoginAt:  timestamp('last_login_at'),
})

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

// ─── Articles ─────────────────────────────────────────────────────────────────
// type: news | role_model | reintegration | document | faq
export const articles = mysqlTable('articles', {
  id:          int('id').autoincrement().primaryKey(),
  type:        varchar('type', { length: 32 }).notNull(),
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
}, (t) => ({
  typeIdx:   index('type_idx').on(t.type),
  statusIdx: index('status_idx').on(t.status),
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

// ─── Settings ────────────────────────────────────────────────────────────────
export const settings = mysqlTable('settings', {
  key:   varchar('key', { length: 128 }).primaryKey(),
  value: text('value'),
  type:  varchar('type', { length: 16 }).default('string'), // string | json | boolean
  group: varchar('group', { length: 32 }).default('general'), // general | media | chatbot | contact
})

// ─── Activity Logs ───────────────────────────────────────────────────────────
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
}))

// ─── Types ───────────────────────────────────────────────────────────────────
export type Role        = typeof roles.$inferSelect
export type Permission  = typeof permissions.$inferSelect
export type User        = typeof users.$inferSelect
export type Media       = typeof media.$inferSelect
export type Article     = typeof articles.$inferSelect
export type HomeSection = typeof homeSections.$inferSelect
export type PageContent = typeof pageContents.$inferSelect
export type Setting     = typeof settings.$inferSelect
export type ActivityLog = typeof activityLogs.$inferSelect
