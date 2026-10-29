/**
 * Responses of the two menu editors (`/admin/content/navigation/navbar` and `…/mobile`,
 * wave3 7.1 batch F).
 *
 * DERIVED FROM THE HANDLERS (`Payload<…>`, app/types/handler-payload.ts). One named gap: the
 * GET handlers answer the stored JSON as `JSON.parse(raw)` — `any` — and Nitro's `Serialize`
 * drops an `any` key, so `Payload<GET>` has no `menu` at all. A menu stored by these editors is
 * exactly what their PUT handler stored (it sanitises and answers the same items), so the
 * GET's `menu` is typed as the PUT's; `null` = nothing stored yet (the editor shows its
 * default). The navbar GET may also return the legacy `nav_menu` row, which predates the PUT —
 * the page normalises `children`/`openNewTab` whatever came back.
 */
import type { Payload } from './handler-payload'

type NavbarGetHandler = typeof import('~~/server/api/admin/settings/navigation/navbar.get').default
type NavbarPutHandler = typeof import('~~/server/api/admin/settings/navigation/navbar.put').default
type MobileGetHandler = typeof import('~~/server/api/admin/settings/navigation/mobile.get').default
type MobilePutHandler = typeof import('~~/server/api/admin/settings/navigation/mobile.put').default

/** `PUT /api/admin/settings/navigation/navbar` — the menu as stored. */
export type AdminNavbarSaveResponse = Payload<NavbarPutHandler>
export type AdminNavbarStoredItem = AdminNavbarSaveResponse['menu'][number]
/** `GET /api/admin/settings/navigation/navbar`. */
export type AdminNavbarMenuResponse = Omit<Payload<NavbarGetHandler>, 'menu'> & { menu: AdminNavbarStoredItem[] | null }

/** `PUT /api/admin/settings/navigation/mobile` — the tab bar as stored. */
export type AdminMobileNavSaveResponse = Payload<MobilePutHandler>
export type AdminMobileNavStoredItem = AdminMobileNavSaveResponse['menu'][number]
/** `GET /api/admin/settings/navigation/mobile`. */
export type AdminMobileNavMenuResponse = Omit<Payload<MobileGetHandler>, 'menu'> & { menu: AdminMobileNavStoredItem[] | null }
