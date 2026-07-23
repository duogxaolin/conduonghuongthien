import {
  mysqlTable, int, bigint, varchar, text, longtext, boolean,
  timestamp, datetime, date, json, mysqlEnum, uniqueIndex, index} from 'drizzle-orm/mysql-core'
import { ANALYTICS_LIVE_SCOPE_TYPES } from '../utils/analytics-live'

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

// ─── Categories ───────────────────────────────────────────────────────────────
// type: news | role_model | reintegration | document | faq
export const categories = mysqlTable('categories', {
  id:           int('id').autoincrement().primaryKey(),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull().unique(),
  parentId:     int('parent_id'),
  type:         varchar('type', { length: 32 }).notNull(),
  description:  text('description'),
  displayOrder: int('display_order').default(0),
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
}, (t) => ({
  typeIdx:      index('type_idx').on(t.type),
  statusIdx:    index('status_idx').on(t.status),
  categoryIdx:  index('category_idx').on(t.category),
  categoryIdIdx: index('category_id_idx').on(t.categoryId),
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

// ─── Submissions ─────────────────────────────────────────────────────────────
export const submissions = mysqlTable('submissions', {
  id:        bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  fullName:  varchar('full_name', { length: 255 }).notNull(),
  phone:     varchar('phone', { length: 30 }).notNull(),
  email:     varchar('email', { length: 255 }),
  address:   text('address'),
  message:   text('message'),
  createdAt: timestamp('created_at').defaultNow(),
})

// ─── Governed Chatbot ─────────────────────────────────────────────────────────
export const chatbotSettings = mysqlTable('chatbot_settings', {
  id:                    int('id').primaryKey().default(1),
  enabled:               boolean('enabled').notNull().default(false),
  providerPolicy:        varchar('provider_policy', { length: 64 }).notNull().default('openai-compatible'),
  baseUrl:               varchar('base_url', { length: 1024 }),
  model:                 varchar('model', { length: 128 }),
  systemPrompt:          text('system_prompt'),
  allowedHosts:          json('allowed_hosts').$type<string[]>(),
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

// ─── Types ───────────────────────────────────────────────────────────────────
export type Role        = typeof roles.$inferSelect
export type Permission  = typeof permissions.$inferSelect
export type User        = typeof users.$inferSelect
export type Media       = typeof media.$inferSelect
export type Category    = typeof categories.$inferSelect
export type Article     = typeof articles.$inferSelect
export type HomeSection = typeof homeSections.$inferSelect
export type PageContent = typeof pageContents.$inferSelect
export type Setting     = typeof settings.$inferSelect
export type ActivityLog = typeof activityLogs.$inferSelect
export type Submission  = typeof submissions.$inferSelect
export type ChatbotSettings = typeof chatbotSettings.$inferSelect
export type NewChatbotSettings = typeof chatbotSettings.$inferInsert
export type ChatbotKnowledge = typeof chatbotKnowledge.$inferSelect
export type NewChatbotKnowledge = typeof chatbotKnowledge.$inferInsert
export type ChatbotKnowledgeTerm = typeof chatbotKnowledgeTerms.$inferSelect
export type NewChatbotKnowledgeTerm = typeof chatbotKnowledgeTerms.$inferInsert
export type AnalyticsPageViewEvent = typeof analyticsPageViewEvents.$inferSelect
export type AnalyticsLiveMinuteBucket = typeof analyticsLiveMinuteBuckets.$inferSelect
export type AnalyticsLiveDeduplication = typeof analyticsLiveDeduplication.$inferSelect
export type AnalyticsNocMinuteAggregate = typeof analyticsNocMinuteAggregates.$inferSelect
export type AnalyticsDailyTraffic = typeof analyticsDailyTraffic.$inferSelect
export type AnalyticsDailyPage = typeof analyticsDailyPages.$inferSelect
export type AnalyticsDailyDimension = typeof analyticsDailyDimensions.$inferSelect
export type AnalyticsDailyAdminUser = typeof analyticsDailyAdminUsers.$inferSelect
export type AnalyticsMaintenanceRun = typeof analyticsMaintenanceRuns.$inferSelect
