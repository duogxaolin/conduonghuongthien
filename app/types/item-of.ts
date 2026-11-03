/**
 * One element of an array type: `ItemOf<Payload<UsersHandler>['users']>` is one user row as
 * the browser holds it. `readonly` arrays and tuples count; anything that is not an array is
 * `never` — so pointing it at a field that stopped being a list fails the next typecheck
 * instead of quietly typing every row as the whole response.
 *
 * One definition for every `app/types/*` file (wave3 D-FETCH, lot H: it had been copied into
 * `admin-api.ts` and `moderation.ts`, next to `Payload`, whose copies D-DUP had already
 * folded into app/types/handler-payload.ts). `tests/item-of-single-definition.test.ts` keeps
 * it one: a second `ItemOf`, or the same conditional under another name or inline, is red.
 * A plain indexed access (`X[number]`) is a different spelling the guard leaves alone.
 */
export type ItemOf<T> = T extends readonly (infer U)[] ? U : never
