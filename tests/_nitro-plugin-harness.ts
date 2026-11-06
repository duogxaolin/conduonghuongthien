/**
 * Khung chạy plugin Nitro THẬT trong test (không đọc văn bản mã nguồn).
 *
 * `defineNitroPlugin` là auto-import lúc build, nhưng tệp plugin chỉ tham chiếu nó như một
 * định danh tự do — gán `globalThis.defineNitroPlugin` trước `import()` là đủ để nạp tệp và
 * lấy hàm plugin ra (cùng mẹo `tests/error-no-store.test.ts`, `tests/livestream-plugins.test.ts`).
 *
 * Mỗi tệp test chạy trong một tiến trình riêng nên module plugin chỉ nạp một lần; cổng bằng
 * biến môi trường nằm TRONG thân hàm plugin, nên gọi lại hàm đó dưới môi trường khác là đủ.
 */

export type HookHandler = (...args: never[]) => unknown
export type NitroApp = { hooks: { hook: (name: string, handler: HookHandler) => void } }
export type NitroPlugin = (nitroApp: NitroApp) => unknown

let captured: NitroPlugin | null = null
;(globalThis as { defineNitroPlugin?: (fn: NitroPlugin) => void }).defineNitroPlugin = (fn) => {
  captured = fn
}

/** Nạp một tệp plugin và trả hàm nó đăng ký (không chạy). */
export async function loadPlugin(relative: string): Promise<NitroPlugin> {
  captured = null
  await import(`../${relative}`)
  if (!captured) throw new Error(`${relative} không gọi defineNitroPlugin`)
  return captured
}

/** Một `nitroApp` giả ghi lại hook đã đăng ký; `fire` gọi lần lượt mọi handler của một hook. */
export function fakeNitroApp() {
  const hooks = new Map<string, HookHandler[]>()
  const app: NitroApp = {
    hooks: { hook: (name, handler) => { hooks.set(name, [...(hooks.get(name) ?? []), handler]) } },
  }
  return {
    app,
    hooks,
    names: () => [...hooks.keys()],
    async fire(name: string, ...args: unknown[]) {
      for (const handler of hooks.get(name) ?? []) await (handler as (...a: unknown[]) => unknown)(...args)
    },
  }
}

/** Đặt biến môi trường trong lúc chạy `fn`, rồi trả về ĐÚNG trạng thái trước đó. */
export async function withEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) previous.set(key, process.env[key])
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
