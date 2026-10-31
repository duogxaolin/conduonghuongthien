/**
 * `scripts/codemod-hex-tokens.ts` — cascade order across places that meet on ONE element
 * (wave3-long-term D-TOKENS; the gap found in task 3.4).
 *
 * Tailwind v3 orders the rules of one utility by class name, and `[` sorts before every
 * letter: `bg-[#f8faf7]` loses to `bg-red-50` today, `bg-surface` would win. The order
 * guard used to compare classes written on one tag or one line. These tests pin the other
 * ways two classes meet on an element — a `:class` variable, a computed, a helper (imported
 * or auto-imported), a child component's root, a prop, and the conservative fallback for a
 * source that cannot be resolved — in both directions (processing the page, and processing
 * the component/module it uses). Each would-be flip is left as hex, reported `order-merge`.
 *
 * Every file lives in an in-memory project handed to `rewriteSource` as `project`, so no
 * test touches the disk.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatFileReport, rewriteSource } from '../scripts/codemod-hex-tokens.ts'
import { COLOR_MERGES } from '../shared/color-merges.ts'

const ROOT = '/v'

/** An in-memory project: `read` a file, `list` every file under a directory. */
function project(files: Record<string, string>) {
  const abs = Object.fromEntries(Object.entries(files).map(([name, text]) => [`${ROOT}/${name}`, text]))
  return {
    root: ROOT,
    fs: {
      read: (file: string) => abs[file],
      list: (dir: string) => Object.keys(abs).filter((file) => file.startsWith(`${dir}/`)).sort(),
    },
  }
}

/** Runs the codemod on `name` inside the project; `name`'s text comes from `files`. */
function run(files: Record<string, string>, name: string) {
  return rewriteSource(files[name]!, { fileName: `${ROOT}/${name}`, project: project(files) })
}
/** The same, with the approved merge table (`--merges`, decision D-T1). */
function runMerged(files: Record<string, string>, name: string) {
  return rewriteSource(files[name]!, { fileName: `${ROOT}/${name}`, project: project(files), merges: COLOR_MERGES })
}
const reasons = (result: ReturnType<typeof run>) => result.leftAlone.map((e) => `${e.text}:${e.reason}${e.via ? `/${e.via}` : ''}`)
const sfc = (template: string, script = '') => `<template>\n  ${template}\n</template>\n<script setup lang="ts">\n${script}\n</script>\n`

describe('a :class source in the same file', () => {
  test('a script variable: the hex in the variable is kept', () => {
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-red-50" :class="CLS"></li>`, `const CLS = 'bg-[#f8faf7]'`) }
    const result = run(files, 'app/pages/a.vue')
    assert.equal(result.output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/script'])
  })

  test('a script variable: the hex on the tag is kept', () => {
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-[#f8faf7]" :class="CLS"></li>`, `const CLS = 'bg-red-50'`) }
    const result = run(files, 'app/pages/a.vue')
    assert.equal(result.output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/script'])
  })

  test('a computed (followed through the declarations it reads)', () => {
    const script = [
      `const TONES = { on: 'bg-[#f8faf7]', off: '' }`,
      `const tone = computed(() => (active.value ? TONES.on : TONES.off))`,
    ].join('\n')
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-red-50" :class="[tone, 'p-2']"></li>`, script) }
    const result = run(files, 'app/pages/a.vue')
    assert.equal(result.output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/script'])
  })

  test('a v-bind object that binds class', () => {
    const files = { 'app/pages/a.vue': sfc(`<a class="bg-red-50" v-bind="{ class: extra }"></a>`, `const extra = 'bg-[#f8faf7]'`) }
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf7]:order-merge/script'])
  })
})

describe('a helper from a module', () => {
  const helper = `export function toneClass(on: boolean) {\n  return on ? 'bg-red-50' : 'p-0'\n}\nexport const OTHER = 'bg-[#f0f7f1]'\n`

  test('imported: the hex on the tag is kept', () => {
    const files = {
      'app/utils/tone.ts': helper,
      'app/pages/a.vue': sfc(`<li class="bg-[#f8faf7]" :class="toneClass(on)"></li>`, `import { toneClass } from '~/utils/tone'\nconst on = ref(true)`),
    }
    const result = run(files, 'app/pages/a.vue')
    assert.equal(result.output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/module'])
  })

  test('imported from #imports (Nuxt\'s auto-import barrel), the same', () => {
    const files = {
      'app/utils/tone.ts': helper,
      'app/pages/a.vue': sfc(`<li class="bg-[#f8faf7]" :class="toneClass(on)"></li>`, `import { toneClass } from '#imports'`),
    }
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf7]:order-merge/module'])
  })

  test('auto-imported (no import statement), the same', () => {
    const files = { 'app/utils/tone.ts': helper, 'app/pages/a.vue': sfc(`<li class="bg-[#f8faf7]" :class="toneClass(on)"></li>`) }
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf7]:order-merge/module'])
  })

  test('processing the module: its hex is kept where a page puts it next to a class that would lose', () => {
    const files = {
      'shared/badge.ts': `export const BADGE = 'bg-[#f8faf7] text-[#2c6e33]'\n`,
      'app/pages/a.vue': sfc(`<span class="bg-red-50" :class="BADGE"></span>`, `import { BADGE } from '~~/shared/badge'`),
    }
    const result = run(files, 'shared/badge.ts')
    assert.equal(result.output, `export const BADGE = 'bg-[#f8faf7] text-brand-700'\n`)
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/module'])
  })
})

describe('a child component\'s root element', () => {
  const card = `<template>\n  <section class="bg-red-50 p-4"><slot /></section>\n</template>\n`

  for (const tag of ['BlocksCard', 'blocks-card', 'LazyBlocksCard']) {
    test(`<${tag} class="…">: the passed hex is kept`, () => {
      const files = { 'app/components/blocks/Card.vue': card, 'app/pages/p.vue': sfc(`<${tag} class="bg-[#f8faf7]" />`) }
      const result = run(files, 'app/pages/p.vue')
      assert.equal(result.output, files['app/pages/p.vue'])
      assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/component'])
    })
  }

  test('an explicitly imported component, through a wrapper root (<Transition>)', () => {
    const files = {
      'app/components/Fade.vue': `<template>\n  <Transition name="f"><div class="bg-red-50"><slot /></div></Transition>\n</template>\n`,
      'app/pages/p.vue': sfc(`<MyFade class="bg-[#f8faf7]" />`, `import MyFade from '~/components/Fade.vue'`),
    }
    assert.deepEqual(reasons(run(files, 'app/pages/p.vue')), ['bg-[#f8faf7]:order-merge/component'])
  })

  test('processing the component: its root hex is kept where a page passes a class that would lose', () => {
    const files = {
      'app/components/blocks/Card.vue': `<template>\n  <section class="bg-[#f8faf7] text-[#2c6e33]"><slot /></section>\n</template>\n`,
      'app/pages/p.vue': sfc(`<BlocksCard class="bg-red-50" />`),
    }
    const result = run(files, 'app/components/blocks/Card.vue')
    assert.match(result.output, /class="bg-\[#f8faf7\] text-brand-700"/)
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/usage'])
  })

  test('the other file is checked in both states: as written, and as the codemod would write it', () => {
    // Page `bg-[#f8faf7]` → `bg-surface` keeps its order against the child's `bg-[#f0f7f1]`
    // as written ("[" < "s"), but not once the child becomes `bg-surface-tint`
    // ("bg-surface" < "bg-surface-tint"): the child would then win. Kept.
    const files = {
      'app/components/blocks/Card.vue': `<template>\n  <section class="bg-[#f0f7f1]"><slot /></section>\n</template>\n`,
      'app/pages/p.vue': sfc(`<BlocksCard class="bg-[#f8faf7]" />`),
    }
    assert.deepEqual(reasons(run(files, 'app/pages/p.vue')), ['bg-[#f8faf7]:order-merge/component'])
  })
})

describe('a prop that carries a class', () => {
  const child = (literal: string) => sfc(`<img class="${literal}" :class="imgClass">`, `defineProps<{ imgClass?: string }>()`)

  test('processing the page: the hex it passes through the prop is kept', () => {
    const files = { 'app/components/Pic.vue': child('bg-red-50'), 'app/pages/p.vue': sfc(`<Pic img-class="bg-[#f8faf7]" />`) }
    assert.deepEqual(reasons(run(files, 'app/pages/p.vue')), ['bg-[#f8faf7]:order-merge/component'])
  })

  test('processing the component: the hex next to the prop-bound class is kept', () => {
    const files = { 'app/components/Pic.vue': child('bg-[#f8faf7]'), 'app/pages/p.vue': sfc(`<Pic img-class="bg-red-50" />`) }
    assert.deepEqual(reasons(run(files, 'app/components/Pic.vue')), ['bg-[#f8faf7]:order-merge/prop'])
  })

  // The element is fed by ONE prop; what the parent passes in other attributes never lands on it.
  const modal = (binding: string, script: string) => sfc(`<div class="p-4"><i class="mr-2 text-[#2c6e33]" :class="${binding}"></i></div>`, script)
  const page = (attrs: string) => sfc(`<UiModal ${attrs} />`, `const label = 'text-blue-700'`)

  test('only the attribute that feeds the prop counts: another attribute of the usage does not', () => {
    const files = { 'app/components/ui/Modal.vue': modal('icon', `defineProps<{ icon?: string; title?: string }>()`), 'app/pages/p.vue': page(`icon="fa-solid fa-x" :title="label"`) }
    const result = run(files, 'app/components/ui/Modal.vue')
    assert.match(result.output, /class="mr-2 text-brand-700"/)
    assert.deepEqual(result.leftAlone, [])
  })

  for (const [how, binding, script] of [
    ['the prop by name', 'icon', `defineProps<{ icon?: string }>()`],
    ['props.icon', 'props.icon', `const props = defineProps<{ icon?: string }>()`],
    ['a computed reading props.icon', 'iconClass', `const props = defineProps<{ icon?: string }>()\nconst iconClass = computed(() => props.icon)`],
  ] as const) {
    test(`the attribute that does feed it (${how}) counts`, () => {
      const files = { 'app/components/ui/Modal.vue': modal(binding, script), 'app/pages/p.vue': page(`:icon="label"`) }
      assert.deepEqual(reasons(run(files, 'app/components/ui/Modal.vue')), ['text-[#2c6e33]:order-merge/prop'])
    })
  }

  test('the props object used whole feeds from every attribute', () => {
    const files = {
      'app/components/ui/Modal.vue': modal('pick(props)', `const props = defineProps<{ icon?: string; title?: string }>()\nconst pick = (p: object) => Object.values(p).join(' ')`),
      'app/pages/p.vue': page(`icon="fa-solid fa-x" :title="label"`),
    }
    assert.deepEqual(reasons(run(files, 'app/components/ui/Modal.vue')), ['text-[#2c6e33]:order-merge/prop'])
  })
})

describe('a source that cannot be resolved falls back to every class string of the script', () => {
  test('`$attrs.extra`: a hex anywhere in the script is kept', () => {
    const script = `const unrelated = 'bg-[#f8faf7]'\nconst fine = 'text-[#2c6e33]'`
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-red-50" :class="$attrs.extra"></li>`, script) }
    const result = run(files, 'app/pages/a.vue')
    assert.match(result.output, /const unrelated = 'bg-\[#f8faf7\]'\nconst fine = 'text-brand-700'/)
    assert.deepEqual(reasons(result), ['bg-[#f8faf7]:order-merge/fallback'])
  })

  test('a value read through inject(): unknown, so every class string of the script', () => {
    const script = `const theme = inject('theme', { tone: '' })\nconst toneClass = computed(() => theme.tone)\nconst other = 'bg-red-50'`
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-[#f8faf7]" :class="toneClass"></li>`, script) }
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf7]:order-merge/fallback'])
  })

  test('a slot prop: the classes of the component that renders the slot', () => {
    const files = {
      'app/components/ListBox.vue': sfc(`<ul><slot :cls="'bg-red-50'" /></ul>`),
      'app/pages/a.vue': sfc(`<ListBox v-slot="{ cls }"><li class="bg-[#f8faf7]" :class="cls"></li></ListBox>`),
    }
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf7]:order-merge/fallback'])
  })
})

describe('what does not interact', () => {
  test('a merge that keeps its order is rewritten; other variants and other utilities do not interact', () => {
    const files = {
      'app/pages/a.vue': sfc(`<li class="bg-white hover:bg-red-50 text-red-50" :class="CLS"></li>`, `const CLS = 'bg-[#f8faf7] text-[#2c6e33]/30'`),
    }
    const result = run(files, 'app/pages/a.vue')
    // bg-white: "[" < "w" and "s" < "w" — same order. hover:bg-red-50: other variant.
    // text-red-50 vs text-[#2c6e33]/30: "[" < "r" and "b" < "r" — same order.
    assert.match(result.output, /const CLS = 'bg-surface text-brand-700\/30'/)
    assert.deepEqual(result.leftAlone, [])
  })

  test('a class from elsewhere never makes the codemod emit an interpolation', () => {
    const files = { 'app/pages/a.vue': sfc(`<li :class="[CLS, \`bg-[#2c6e33] \${x}\`]"></li>`, `const CLS = 'text-[#667768]'`) }
    const output = run(files, 'app/pages/a.vue').output
    assert.equal(output.split('${').length, files['app/pages/a.vue'].split('${').length)
    assert.match(output, /bg-brand-700 \$\{x\}/)
  })

  test('project: false turns the merge analysis off (same tag/line only)', () => {
    const source = sfc(`<li class="bg-red-50" :class="CLS"></li>`, `const CLS = 'bg-[#f8faf7]'`)
    assert.match(rewriteSource(source, { fileName: `${ROOT}/app/pages/a.vue`, project: false }).output, /const CLS = 'bg-surface'/)
  })
})

test('the per-file report names how the class meets the other one', () => {
  const files = { 'app/pages/a.vue': sfc(`<li class="bg-red-50" :class="CLS"></li>`, `const CLS = 'bg-[#f8faf7] text-[#2c6e33]'`) }
  assert.equal(
    formatFileReport('app/pages/a.vue', run(files, 'app/pages/a.vue')),
    'app/pages/a.vue: 1 replacement (#2c6e33→brand-700 ×1)\n  left alone: 1 (#f8faf7 ×1 order-merge via script)',
  )
})

/**
 * `--merges` (decision D-T1): a hex that folds into a token although it differs obeys the same
 * cross-place guard — and a class in ANOTHER file is checked in the state the merge table
 * would give it, not only in the state an exact-only run would.
 */
describe('merged values (--merges) meet the same guard', () => {
  test('a script variable: the merged hex is kept (and without merges it is simply unmapped)', () => {
    const files = { 'app/pages/a.vue': sfc(`<li class="bg-red-50" :class="CLS"></li>`, `const CLS = 'bg-[#f8faf8]'`) }
    assert.deepEqual(reasons(runMerged(files, 'app/pages/a.vue')), ['bg-[#f8faf8]:order-merge/script'])
    assert.equal(runMerged(files, 'app/pages/a.vue').output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(run(files, 'app/pages/a.vue')), ['bg-[#f8faf8]:unmapped'])
  })

  test('processing a module: its merged hex is kept where a page puts it next to a class that would lose', () => {
    const files = {
      'shared/badge.ts': `export const BADGE = 'bg-[#f8faf8] text-[#e2e8df]'\n`,
      'app/pages/a.vue': sfc(`<span class="bg-red-50" :class="BADGE"></span>`, `import { BADGE } from '~~/shared/badge'`),
    }
    const result = runMerged(files, 'shared/badge.ts')
    assert.equal(result.output, `export const BADGE = 'bg-[#f8faf8] text-line'\n`)
    assert.deepEqual(reasons(result), ['bg-[#f8faf8]:order-merge/module'])
  })

  test('a child component\'s root: the passed merged hex is kept', () => {
    const files = {
      'app/components/blocks/Card.vue': `<template>\n  <section class="bg-red-50 p-4"><slot /></section>\n</template>\n`,
      'app/pages/p.vue': sfc(`<BlocksCard class="bg-[#f4f7f4]" />`),
    }
    assert.deepEqual(reasons(runMerged(files, 'app/pages/p.vue')), ['bg-[#f4f7f4]:order-merge/component'])
  })

  test('the other file is checked as the merge table would rewrite it, too', () => {
    // Page `bg-[#f0f7f1]` (exact → surface-tint) meets the module's `bg-[#eef2ec]` (a merge into
    // surface-tint). Exact-only, the module keeps its hex and the order holds; with merges the
    // module would become the same class, so the page keeps its hex as well.
    const files = {
      'shared/badge.ts': `export const BADGE = 'bg-[#eef2ec]'\n`,
      'app/pages/a.vue': sfc(`<span class="bg-[#f0f7f1]" :class="BADGE"></span>`, `import { BADGE } from '~~/shared/badge'`),
    }
    assert.match(run(files, 'app/pages/a.vue').output, /class="bg-surface-tint"/)
    const merged = runMerged(files, 'app/pages/a.vue')
    assert.equal(merged.output, files['app/pages/a.vue'])
    assert.deepEqual(reasons(merged), ['bg-[#f0f7f1]:order-merge/module'])
  })
})
