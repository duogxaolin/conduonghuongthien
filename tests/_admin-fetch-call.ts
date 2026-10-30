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
export const ADMIN_FETCH_CALL = /\$fetch|useFetch\(|useAsyncData\(|\badminFetch[<(]|\bpublicFetch[<(]|\buseAdminList[<(]/

/**
 * The directory-scanning gates decide "this view fetches" on CODE, not on prose: a doc
 * comment quoting `adminFetch(…)` or `$fetch` used to make a view count as fetching after
 * its code stopped (verifier lô F, V20), and a view handing the fetcher on as a VALUE
 * (`request: adminFetch` — ChunkedUploader.vue gives it to the upload session) used to
 * count as not fetching. So comments are dropped first (`<!-- -->`, block and line
 * comments; a `//` right after `:` or inside a quoted URL is kept), and `adminFetch` counts
 * in any code position. `publicFetch` (D-FETCH lot G, the public site's typed `$fetch`) counts
 * too: an admin view that called it would otherwise drop out of both scans the same way.
 */
const ADMIN_FETCH_CODE = /\$fetch|useFetch\(|useAsyncData\(|\badminFetch\b|\bpublicFetch\b|\buseAdminList[<(]/

export function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1')
}

export function fetchesData(source: string): boolean {
  return ADMIN_FETCH_CODE.test(stripComments(source))
}
