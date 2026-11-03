/**
 * Responses of the two taxonomy pages — `/admin/content/categories`
 * (`pages/admin/content/categories/index.vue`) and `/admin/content/content-types`
 * (`pages/admin/content/content-types.vue`) — wave3 7.1 batch D.
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts); the row types
 * (`AdminCategoryRow`, `AdminContentTypeRow`) stay in app/types/admin-api.ts. Differences from
 * the hand-written shapes these replace, none of them displayed: `ok` is `boolean` (the handlers
 * only ever send `true` — a failure is thrown), the writes answer `slug` (and a create its `id`)
 * where the pages declared `unknown`.
 */
import type { Payload } from './handler-payload'

type CategoriesHandler = typeof import('~~/server/api/admin/categories/index.get').default
type CategoryCreateHandler = typeof import('~~/server/api/admin/categories/index.post').default
type CategoryUpdateHandler = typeof import('~~/server/api/admin/categories/[id].put').default
type CategoryDeleteHandler = typeof import('~~/server/api/admin/categories/[id].delete').default
type ContentTypesHandler = typeof import('~~/server/api/admin/content-types/index.get').default
type ContentTypeCreateHandler = typeof import('~~/server/api/admin/content-types/index.post').default
type ContentTypeUpdateHandler = typeof import('~~/server/api/admin/content-types/[id].put').default
type ContentTypeDeleteHandler = typeof import('~~/server/api/admin/content-types/[id].delete').default

/** `GET /api/admin/categories` (`?type=` narrows it — the article editor). */
export type AdminCategoriesResponse = Payload<CategoriesHandler>
export type AdminCategorySaveResponse = Payload<CategoryCreateHandler> | Payload<CategoryUpdateHandler>
export type AdminCategoryDeleteResponse = Payload<CategoryDeleteHandler>

/** `GET /api/admin/content-types` — with each type's category and article counts. */
export type AdminContentTypesResponse = Payload<ContentTypesHandler>
export type AdminContentTypeSaveResponse = Payload<ContentTypeCreateHandler> | Payload<ContentTypeUpdateHandler>
export type AdminContentTypeDeleteResponse = Payload<ContentTypeDeleteHandler>

/**
 * The menu editors' picker (`components/admin/ContentTypePicker.vue`, batch F) reads the PUBLIC
 * lists, so both menu pages can use it whatever their permissions — admin-side code, typed by the
 * admin convention (the lot D precedent of `login.vue`'s `/api/public/settings`).
 */
type PublicContentTypesHandler = typeof import('~~/server/api/public/content-types.get').default
type PublicCategoriesHandler = typeof import('~~/server/api/public/categories.get').default
export type PickerContentTypesResponse = Payload<PublicContentTypesHandler>
export type PickerCategoriesResponse = Payload<PublicCategoriesHandler>
