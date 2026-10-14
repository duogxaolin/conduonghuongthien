/**
 * Dựng HTML (SSR) từ `<template>` của một SFC, không cần Nuxt/jsdom: biên dịch
 * template bằng `@vue/compiler-sfc`, chạy render function với một "setup" giả do
 * test cung cấp, rồi `renderToString`. Dùng để kiểm thuộc tính/ARIA thật sự được
 * render (HTML ra sao ở trạng thái đóng/mở), thay vì chỉ grep mã nguồn.
 *
 * Giới hạn: không có JS phía client (focus, transition, hydration), không resolve
 * component Nuxt (`NuxtImg`, `nuxt-link`…) — chúng render thành thẻ tuỳ biến.
 */
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createSSRApp, defineComponent } from 'vue'
import * as Vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import { compileTemplate, parse } from '@vue/compiler-sfc'

type RenderFn = (ctx: unknown, cache: unknown[], props: unknown, setup: unknown, data: unknown, options: unknown) => unknown

export async function renderSfcTemplate(file: string, state: Record<string, unknown>): Promise<string> {
  const source = readFileSync(file, 'utf8')
  const { descriptor } = parse(source, { filename: file })
  if (!descriptor.template) throw new Error(`${file} không có <template>`)
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: 'render-sfc-template',
    compilerOptions: { expressionPlugins: ['typescript'], comments: false },
  })
  if (compiled.errors.length) throw new Error(`${file}: ${compiled.errors.map(String).join('; ')}`)

  // `import { a as _a } from "vue"` → `const { a: _a } = Vue`
  // Biểu thức TS trong template (`$event.target as HTMLInputElement`) còn nguyên sau
  // khi biên dịch; gỡ kiểu trước khi chạy.
  const code = stripTypeScriptTypes(compiled.code)
    .replace(/import \{([^}]*)\} from "vue"/, (_m, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace('export function render', 'function render')
  const render = new Function('Vue', `${code}\nreturn render`)(Vue) as RenderFn

  const component = defineComponent({
    setup: () => state,
    render(this: Record<string, unknown>) {
      return render(this, [], {}, state, {}, {})
    },
  })
  const app = createSSRApp(component)
  // Component Nuxt không resolve được là chủ đích; tắt cảnh báo cho test ồn.
  app.config.warnHandler = () => {}
  return renderToString(app)
}
