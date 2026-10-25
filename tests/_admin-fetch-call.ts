/**
 * What counts as "this admin view fetches data" for the directory-scanning
 * coverage gates in tests/admin-error-retry-ui.test.ts and
 * tests/skeleton-loading-ui.test.ts.
 *
 * One definition, because both gates must agree, and because the pattern has to
 * grow with the way pages fetch. The gates used to look only for `$fetch`,
 * `useFetch(` and `useAsyncData(`. A page moved to `adminFetch`/`useAdminList`
 * (design.md D-FETCH) contains none of those, so it would silently drop out of
 * both scans: still green, no longer checked. Every Wave 3 page migrated the same
 * way would have joined it. tests/admin-list-pilot-pages.test.ts asserts the pilot
 * pages still match this pattern, so a regression here fails loudly.
 */
export const ADMIN_FETCH_CALL = /\$fetch|useFetch\(|useAsyncData\(|\badminFetch[<(]|\buseAdminList[<(]/
