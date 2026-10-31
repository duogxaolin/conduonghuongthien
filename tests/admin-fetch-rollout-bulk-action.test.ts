/**
 * Wave 3 D-FETCH, lot H: `useBulkAction` (app/composables/useBulkSelection.ts) — the confirm →
 * POST → report → reload sequence behind every admin bulk bar — calls `adminFetch<AdminBulkOutcome>()`
 * instead of a cast of `$fetch` to a hand-written `BulkResult`. `AdminBulkOutcome`
 * (app/types/admin-api.ts) is derived from `runBulk` (server/utils/bulk.ts), which is what every
 * URL the pages hand the composable answers — the second half of this file keeps that true.
 *
 * The composable runs for real (its source compiled by `loadBulk` of tests/_admin-page-harness.ts,
 * the way every admin page mount runs it) over REAL ofetch on a fake network. Pinned, green on the
 * base (a7f312c1) and after: the POST wire and body (`ids` beside the page's extra fields), the
 * confirm gate, which ids leave the selection, the report's tone and distinct reasons, the reload,
 * `busy`, and an error read through `errorMessage` (the server's sentence; never ofetch's line).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'

import { dropped, h3Error, installNetwork, json, loadBulk, OFETCH_LINE, settle, wire, type NetCall } from './_admin-page-harness.ts'
import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'

type Selection = { ids: Vue.Ref<number[]>, toggle: (id: number) => void, count: Vue.Ref<number> }
type Action = { busy: Vue.Ref<boolean>, run: (options: Record<string, unknown>) => Promise<void> }

function setup(answer: (call: NetCall) => Response | Error | undefined, confirmAnswer = true) {
  const calls = installNetwork(answer)
  const toasts: Array<{ type: string, message: string }> = []
  const confirms: unknown[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { toasts.push({ type, message }) }]))
  const bulk = loadBulk({
    ref: Vue.ref, computed: Vue.computed, errorMessage, adminFetch,
    useToast: () => toast,
    useConfirm: () => ({ confirm: async (request: unknown) => { confirms.push(request); return confirmAnswer } }),
  })
  const selection = bulk.useBulkSelection() as Selection
  const action = bulk.useBulkAction(selection) as Action
  let reloads = 0
  const run = (extra: Record<string, unknown> = {}) => action.run({
    url: '/api/admin/categories/bulk-delete', noun: 'danh mục', confirm: { message: 'Xoá?' }, reload: () => { reloads += 1 }, ...extra,
  })
  return { calls, toasts, confirms, selection, action, run, reloads: () => reloads }
}
const outcome = (succeededIds: number[], failed: Array<{ id: number, message: string }> = []) =>
  json({ ok: true, requested: succeededIds.length + failed.length, succeeded: succeededIds.length, succeededIds, failed })

describe('useBulkAction (composables/useBulkSelection.ts)', () => {
  it('nothing selected, or the confirm declined: nothing is sent', async () => {
    const empty = setup(() => outcome([]))
    await empty.run()
    assert.deepEqual(empty.calls.map(wire), [])
    assert.equal(empty.confirms.length, 0, 'no confirm for an empty selection')

    const declined = setup(() => outcome([1]), false)
    declined.selection.toggle(1)
    await declined.run()
    assert.equal(declined.confirms.length, 1)
    assert.deepEqual(declined.calls.map(wire), [])
    assert.deepEqual(declined.selection.ids.value, [1], 'the selection is untouched')
  })

  it('POSTs the ids beside the page\'s fields; only the accepted ids leave the selection; a partial lot is a warning with each distinct reason; the list reloads', async () => {
    const ctx = setup(() => outcome([3, 5], [{ id: 4, message: 'Danh mục còn 2 bài viết.' }, { id: 6, message: 'Danh mục còn 2 bài viết.' }]))
    for (const id of [3, 4, 5, 6]) ctx.selection.toggle(id)
    await ctx.run({ url: '/api/admin/articles/bulk-status', body: { status: 'archived' }, noun: 'bài viết' })
    assert.deepEqual(ctx.calls.map(c => ({ wire: wire(c), body: c.body })), [
      { wire: 'POST /api/admin/articles/bulk-status', body: { status: 'archived', ids: [3, 4, 5, 6] } },
    ])
    assert.deepEqual(ctx.selection.ids.value, [4, 6], 'the blocked rows stay ticked')
    assert.deepEqual(ctx.toasts, [{ type: 'warning', message: 'Đã xử lý 2 bài viết, bỏ qua 2 mục. Danh mục còn 2 bài viết.' }])
    assert.equal(ctx.reloads(), 1)
    assert.equal(ctx.action.busy.value, false)
  })

  it('a whole lot through is a success; a whole lot refused is an error — both from the answer, not from the request', async () => {
    const ok = setup(() => outcome([1, 2]))
    ok.selection.toggle(1); ok.selection.toggle(2)
    await ok.run()
    assert.deepEqual(ok.toasts, [{ type: 'success', message: 'Đã xử lý 2 danh mục.' }])
    assert.deepEqual(ok.selection.ids.value, [])

    const refused = setup(() => outcome([], [{ id: 1, message: 'Không thể xóa danh mục này.' }]))
    refused.selection.toggle(1)
    await refused.run()
    assert.deepEqual(refused.toasts, [{ type: 'error', message: 'Không xử lý được 1 danh mục. Không thể xóa danh mục này.' }])
    assert.deepEqual(refused.selection.ids.value, [1])
  })

  it('busy while the request is out; a refused request shows the server\'s sentence, a dropped one the fallback — never ofetch\'s line — and reloads nothing', async () => {
    let pending: NetCall | undefined
    const ctx = setup((call) => { pending = call; return undefined })
    ctx.selection.toggle(9)
    const running = ctx.run()
    await settle()
    assert.equal(ctx.action.busy.value, true)
    pending!.respond(h3Error(403, 'Bạn không có quyền xoá danh mục.'))
    await running
    assert.equal(ctx.action.busy.value, false)
    assert.deepEqual(ctx.toasts, [{ type: 'error', message: 'Bạn không có quyền xoá danh mục.' }])
    assert.equal(ctx.reloads(), 0)
    assert.deepEqual(ctx.selection.ids.value, [9])

    const dead = setup(() => dropped())
    dead.selection.toggle(9)
    await dead.run()
    assert.deepEqual(dead.toasts.map(t => t.type), ['error'])
    assert.equal(dead.toasts[0]!.message, 'Không thể thực hiện thao tác hàng loạt.')
    assert.doesNotMatch(dead.toasts[0]!.message, OFETCH_LINE)
  })
})

// ─── The type is right for every URL the composable is given ─────────────────

const REPO = fileURLToPath(new URL('../', import.meta.url))

type BulkScan = { urls: Array<{ file: string, url: string }>, problems: string[] }
const DEFINITION = 'app/composables/useBulkSelection.ts'

/**
 * The URLs the views hand `useBulkAction`, followed from the call itself: every `useBulkAction(` is
 * kept in a `const <name>`, and every `<name>.run(` is read. A URL the guard cannot read as one fixed
 * string — options passed as a variable, `url` a variable or a template with `${…}`, `run` destructured,
 * the composable's result not kept in a `const` — is a PROBLEM, not skipped: the type the composable
 * asserts is only checked for URLs this scan can name. Quotes `'…'`, `"…"` and a template without `${`
 * are fixed strings.
 */
function bulkRunUrls(sources: Map<string, string>): BulkScan {
  const scan: BulkScan = { urls: [], problems: [] }
  for (const [file, source] of sources) {
    if (file === DEFINITION || !source.includes('useBulkAction(')) continue
    const receivers: string[] = []
    const kept = [...source.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*useBulkAction\(/g)]
    for (const [, binding] of kept) {
      if (binding!.startsWith('{')) scan.problems.push(`${file}: useBulkAction destructured (${binding}) — keep it as \`const bulk = useBulkAction(…)\``)
      else receivers.push(binding!)
    }
    if (source.split('useBulkAction(').length - 1 !== kept.length)
      scan.problems.push(`${file}: a useBulkAction(…) result not kept in a const — the guard cannot follow its run(…)`)
    for (const name of receivers) {
      for (const call of source.matchAll(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\.run\\(`, 'g'))) {
        const rest = source.slice(call.index! + call[0].length)
        if (!/^\s*\{/.test(rest)) { scan.problems.push(`${file}: ${name}.run(…) given its options indirectly — write them inline`); continue }
        const options = rest.slice(0, rest.indexOf('})') + 1)
        const quoted = /\burl:\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`)/.exec(options)
        const url = quoted && (quoted[1] ?? quoted[2] ?? quoted[3])
        if (url === null || url === undefined || url.includes('${')) scan.problems.push(`${file}: ${name}.run(…) has a url that is not one fixed string`)
        else scan.urls.push({ file, url })
      }
    }
  }
  return scan
}
/** The URLs whose handler does not answer `runBulk(…)` — the one shape `AdminBulkOutcome` describes. */
function notRunBulk(urls: Array<{ file: string, url: string }>): string[] {
  return urls.flatMap(({ file, url }) => {
    const handler = `server${url}.post.ts`
    if (!existsSync(`${REPO}${handler}`)) return [`${file}: ${url} has no handler ${handler}`]
    return /\breturn runBulk\(/.test(readFileSync(`${REPO}${handler}`, 'utf8')) ? [] : [`${file}: ${url} — ${handler} does not return runBulk(…)`]
  })
}
const appSources = () => new Map(execFileSync('git', ['ls-files', '-z', '--', 'app'], { cwd: REPO, encoding: 'utf8' })
  .split('\0').filter(file => /\.(?:ts|vue)$/.test(file)).map(file => [file, readFileSync(`${REPO}${file}`, 'utf8')]))

describe('AdminBulkOutcome covers every URL given to useBulkAction', () => {
  it('every URL the views hand `bulk.run` (16 today, all fixed strings) answers runBulk(…)', () => {
    const { urls, problems } = bulkRunUrls(appSources())
    assert.deepEqual(problems, [])
    // The scan is not empty and reaches pages AND components (a broken regex would find nothing and pass).
    for (const url of ['/api/admin/articles/bulk-delete', '/api/admin/chatbot/small-talk/bulk-enabled'])
      assert.ok(urls.some(u => u.url === url), `the scan finds ${url}: ${JSON.stringify(urls)}`)
    assert.deepEqual(notRunBulk(urls), [])
  })

  const page = (body: string) => new Map([['app/pages/admin/x.vue', `const selection = useBulkSelection()\n${body}`]])

  it('proof: a bulk action pointed at a route with another answer goes red — in quotes, double quotes or a plain template', () => {
    for (const url of ["'/api/admin/chatbot/sessions/bulk-delete'", '"/api/admin/chatbot/sessions/bulk-delete"', '`/api/admin/chatbot/sessions/bulk-delete`']) {
      const scan = bulkRunUrls(page(`const bulk = useBulkAction(selection)\nconst bulkDelete = () => bulk.run({\n  url: ${url},\n  noun: 'phiên',\n})`))
      assert.deepEqual(scan.problems, [])
      assert.deepEqual(notRunBulk(scan.urls), [
        'app/pages/admin/x.vue: /api/admin/chatbot/sessions/bulk-delete — server/api/admin/chatbot/sessions/bulk-delete.post.ts does not return runBulk(…)',
      ])
    }
  })

  it('proof: a URL the guard cannot read as one fixed string is a problem, never skipped', () => {
    const cases: Array<[string, RegExp]> = [
      ['const bulk = useBulkAction(selection)\nbulk.run({ url: `/api/admin/${kind}/bulk-delete`, noun: \'x\' })', /url that is not one fixed string/],
      ['const bulk = useBulkAction(selection)\nconst URL_X = \'/api/admin/pages/bulk-delete\'\nbulk.run({ url: URL_X, noun: \'x\' })', /url that is not one fixed string/],
      ['const bulk = useBulkAction(selection)\nconst options = { url: \'/api/admin/pages/bulk-delete\' }\nbulk.run(options)', /given its options indirectly/],
      ['const { run } = useBulkAction(selection)\nrun({ url: \'/api/admin/pages/bulk-delete\' })', /useBulkAction destructured/],
      ['useBulkAction(selection).run({ url: \'/api/admin/pages/bulk-delete\' })', /not kept in a const/],
    ]
    for (const [body, problem] of cases) {
      const scan = bulkRunUrls(page(body))
      assert.ok(scan.problems.some(p => problem.test(p)), `${body}\n→ ${JSON.stringify(scan)}`)
    }
  })
})
