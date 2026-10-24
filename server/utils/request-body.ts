/**
 * The one way a NEW endpoint reads its input (wave2 5.2, design D5, spec
 * request-validation). Legacy endpoints are frozen by
 * `tests/request-body-baseline.test.ts`, which also keeps a bare `readBody` out of
 * every new file.
 *
 * Why not `readBody(event).catch(() => ({}))` (101 call sites today): a truncated
 * body — a dropped connection, a client bug — turns into `{}`, the endpoint runs
 * on "nothing was sent", and a save reads as done. Without the `.catch`, h3 still
 * only parses strictly for a bare `application/json`: with
 * `application/json; charset=utf-8` the truncated text comes back as a STRING.
 *
 * Why not h3's own `readValidatedBody`/`getValidatedQuery`: on failure they put
 * the validator's error object in `data`, which goes to the client as is (zod's
 * issue list, English messages, the expected values). The refusals here carry a
 * Vietnamese `statusMessage` naming the first invalid field, and nothing else.
 * (That is also why the query helper is not called `getValidatedQuery`: Nitro
 * auto-imports both h3 and `server/utils/**`, and a second export of that name
 * would silently shadow one of them.)
 */
import { createError, getQuery, getRequestHeader, isError, readBody, type H3Error, type H3Event } from 'h3'
import { z } from 'zod'
import { finitePositive, MAX_PAGE } from './query-number'

/** The refusal for a body that is not a JSON object. Stable: clients may show it. */
export const INVALID_BODY_MESSAGE = 'Dữ liệu gửi lên không hợp lệ'

/** Longest field path echoed back. A path can contain keys from the request
 *  (a `z.record`, an unexpected key on a strict object). */
const MAX_FIELD_PATH = 80

/** `application/json` and the `+json` family (`application/vnd.api+json`). */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.!#$&^-]+\+)?json$/i

/**
 * Absent counts as JSON (h3 then parses strictly). A form (`urlencoded`,
 * `multipart`) or `text/plain` does not: those are the content types a cross-site
 * HTML form can send without a preflight, and h3 would turn the first into an
 * object of strings that passes for a JSON object.
 */
function isJsonContentType(header: string | undefined): boolean {
  if (!header) return true
  return JSON_MEDIA_TYPE.test(header.split(';', 1)[0]!.trim())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const invalidBody = (): H3Error => createError({ statusCode: 400, statusMessage: INVALID_BODY_MESSAGE })

/**
 * The request body as a JSON object, or a 400 with `INVALID_BODY_MESSAGE`: not
 * JSON (truncated, a form, text), empty, or JSON that is not an object (an array,
 * `null`, a string, a number).
 *
 * Parsed by h3 in strict mode — so a body another handler already read is not
 * parsed twice, and `__proto__`/`constructor.prototype` keys are dropped by destr.
 */
export async function readJsonBody(event: H3Event): Promise<Record<string, unknown>> {
  if (!isJsonContentType(getRequestHeader(event, 'content-type'))) throw invalidBody()
  let body: unknown
  try {
    body = await readBody(event, { strict: true })
  } catch (error) {
    // h3's own "Invalid JSON body" is a 400 in English; anything else (a 405 for a
    // GET, a broken stream) is not about the body's content and passes through.
    if (isError(error) && error.statusCode === 400) throw invalidBody()
    throw error
  }
  if (!isPlainObject(body)) throw invalidBody()
  return body
}

/**
 * The per-parse message, which zod uses only when the schema did not set its own
 * (zod 4 precedence: schema-level `error` > per-parse `error` > global > locale).
 * Seeing it means "use our generic sentence"; anything else is the schema
 * author's Vietnamese and is shown as written.
 */
const NO_SCHEMA_MESSAGE = '\u0000request-body:no-schema-message\u0000'
const PARSE_OPTIONS = { error: () => NO_SCHEMA_MESSAGE }

/** `nested.items[1].id`; for an unexpected key on a strict object, that key. */
function fieldPath(issue: z.core.$ZodIssue): string {
  const segments: PropertyKey[] = [...issue.path]
  if (issue.code === 'unrecognized_keys' && issue.keys.length) segments.push(issue.keys[0]!)
  let path = ''
  for (const segment of segments) {
    if (typeof segment === 'number') {
      path += `[${segment}]`
      continue
    }
    const name = typeof segment === 'symbol' ? (segment.description ?? '') : segment
    path += path ? `.${name}` : name
  }
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  path = path.replace(/[\u0000-\u001f\u007f]/g, '')
  return path.length > MAX_FIELD_PATH ? `${path.slice(0, MAX_FIELD_PATH)}…` : path
}

function refusal(issue: z.core.$ZodIssue | undefined): H3Error {
  if (!issue) return invalidBody()
  if (issue.message && issue.message !== NO_SCHEMA_MESSAGE) {
    return createError({ statusCode: 400, statusMessage: issue.message })
  }
  const path = fieldPath(issue)
  return path
    ? createError({ statusCode: 400, statusMessage: `Trường "${path}" không hợp lệ.` })
    : invalidBody()
}

async function validate<S extends z.ZodType>(schema: S, input: unknown): Promise<z.output<S>> {
  const result = await schema.safeParseAsync(input, PARSE_OPTIONS)
  if (result.success) return result.data
  throw refusal(result.error.issues[0])
}

/**
 * The body (`readJsonBody`), checked against `schema`. The first invalid field is
 * a 400 naming it — `Trường "nested.items[1].id" không hợp lệ.` — or carrying the
 * message the schema sets for it (`z.enum([...], { error: '…' })`). Keys the
 * schema does not declare are dropped (`z.object`) or refused (`z.strictObject`).
 */
export async function readValidated<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  return validate(schema, await readJsonBody(event))
}

/**
 * The query string (h3 `getQuery`: every value a string, or an array of strings
 * when a key repeats), checked against `schema`, refused like `readValidated`.
 * Numbers: `queryFinitePositive` for page/limit-style values that fall back
 * instead of failing, `z.coerce.number()` (+ `.int().positive()`…) for a value
 * that must be right.
 */
export async function readValidatedQuery<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  return validate(schema, getQuery(event))
}

/**
 * A page/limit-style query number with exactly `finitePositive`'s semantics
 * (`server/utils/query-number.ts`, which it calls — not a second copy): garbage,
 * `Infinity`, a repeated key or a missing key give `fallback`; anything finite is
 * floored and clamped to `[1, max]`. Never a 400 — the legacy endpoints answer
 * `?page=abc` with page 1, and a new endpoint should not disagree.
 * (Not named `finitePositive…`: `tests/query-number.test.ts` keeps the name for
 * the one definition.)
 */
export function queryFinitePositive(fallback: number, max: number = MAX_PAGE) {
  // `.optional()` before the transform: zod 4 refuses a MISSING object key whose
  // schema ends in a transform ("expected nonoptional") unless the input side is
  // optional. The transform still runs on `undefined`, so absent → `fallback`.
  return z.unknown().optional().transform(raw => finitePositive(raw, fallback, max))
}
