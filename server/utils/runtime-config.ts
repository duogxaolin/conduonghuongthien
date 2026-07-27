/**
 * `useRuntimeConfig` is a Nitro auto-import: present on the global object when
 * the code runs inside the server bundle, absent when the same module is
 * imported by the maintenance scripts or the test suite under plain `node`.
 *
 * Every caller used to inline `typeof globalThis.useRuntimeConfig === 'function'
 * ? globalThis.useRuntimeConfig() : undefined`, which reads as noise and, more
 * to the point, is untyped — `globalThis` has no such property as far as the
 * compiler is concerned. One helper, cast once, in a file whose name says why.
 *
 * Returns undefined outside Nitro so callers keep falling back to process.env.
 */
export function tryRuntimeConfig(): Record<string, any> | undefined {
  const candidate = (globalThis as Record<string, unknown>).useRuntimeConfig
  return typeof candidate === 'function'
    ? (candidate as () => Record<string, any>)()
    : undefined
}
