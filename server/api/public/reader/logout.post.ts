/**
 * Signs the reader out by clearing only `cdkt_reader`.
 *
 * Deliberately touches no other cookie. An officer who is signed into the admin
 * panel in the same browser and also signed in as a reader to check how a thread
 * looks must not be logged out of the admin panel by clicking "Đăng xuất" in the
 * public header.
 *
 * POST, not GET: a sign-out reachable by navigation can be triggered by an image
 * tag on any other site.
 */
import { clearReaderCookie } from '../../../utils/reader-auth'

export default defineEventHandler((event) => {
  clearReaderCookie(event)
  return { ok: true }
})
