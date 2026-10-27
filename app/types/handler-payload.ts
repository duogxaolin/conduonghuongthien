/**
 * The answer of a Nitro handler as the BROWSER holds it: `Payload<typeof handler>`.
 *
 * Derived from the handler itself (`typeof import('~~/server/api/…').default`), so a
 * changed response changes the type and every place that reads a field no longer sent
 * goes red at the next typecheck — the technique of app/types/admin-api.ts.
 *
 * After JSON, not what the handler returned: the handler returns `Date` for timestamp
 * columns, `$fetch` receives a string. Nitro's `Serialize` models that transformation
 * (`Date → string`, `Map`/`Set → {}`, `undefined` dropped), so code calling `.getTime()`
 * on what is really a string does not compile.
 *
 * Known gap: a field typed `unknown` — an untyped JSON column such as `submissions.answers`
 * — comes out of `Serialize` as `never`, so it reads as "never present" rather than "anything".
 * Give the column a `.$type<…>()` in schema.ts (as `published_blocks` has) before relying on it.
 *
 * One definition for every `app/types/*-api.ts` file (wave3 D-DUP: it had been copied
 * into eight files). `adminFetch<T>()`'s `T` is still an unchecked assertion — see
 * app/composables/adminFetch.ts — but with this it is the right one.
 */
import type { Serialize } from 'nitropack/types'

export type Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>
