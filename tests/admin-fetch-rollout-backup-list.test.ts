/**
 * Wave 3 D-FETCH, batch F: the backup list of `pages/admin/settings/backup.vue` — a pending item
 * of D-FETCH ("backup.vue → useAdminList"). NOT moved to `useAdminList`: tests/admin-fetch-rollout-settings.test.ts
 * drives `filterType`/`loadBackups`/`totalPages` through the page's setup, tests/admin-error-retry-ui.test.ts
 * pins `loadBackups` as the retry, and the list is also reloaded by the 4 s poll while a backup or a
 * restore runs and after every action — the ticket pattern instead (docs/decisions/fetch-rollout-d-fetch.md).
 *
 * The REAL page is mounted over REAL ofetch on a fake network. Pinned, green before and after: the
 * list's query for a type filter; a failed load in `role="alert"` with "thử lại" (the server's sentence).
 *
 * FINDINGS, RED on the base (551651c7): pick "CSDL", then "File" before the first answer — the older
 * answer landing last showed database dumps under "File"; its failure put an error over the newer
 * list; its `finally` ended the skeleton while the newer request was still out.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fire, findAll, textOf } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, Stub, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'
import { formatWhen } from '../app/utils/backup-format.ts'

afterEach(unmountAll)

const PAGE = 'pages/admin/settings/backup.vue'
const LIST = '/api/admin/backup'
const IDLE = { running: false, phase: '', message: '', startedAt: null }
const row = (id: number, filename: string, type: string) => ({ id, filename, type, bytes: 2048, stamp: '20261020T020000Z', status: 'done', driveUploaded: null, offsiteStatus: 'none', createdAt: null })
const SQL = row(1, 'cdkt-db.sql.gz', 'sql')
const MEDIA = row(2, 'cdkt-uploads.tar.gz', 'media')
const answer = (items: unknown[]) => json({ ok: true, items, total: items.length, page: 1, pageSize: 20, totalPages: 1 })

function open(list: (call: NetCall) => Response | Error | undefined) {
  return mountAdminPage(PAGE, routes({
    [`GET ${LIST}`]: list,
    'GET /api/admin/backup/status': () => json({ ok: true, pid: 1, uptime: 9, backup: IDLE, restore: IDLE }),
  }), {
    modules: {
      '~/components/admin/backup/BackupSettingsPanel.vue': { default: Stub },
      '~/components/admin/backup/BackupOffsiteBadge.vue': { default: Stub },
    },
    auto: { formatWhen }, // a Nuxt auto-import from app/utils/backup-format.ts
  })
}
const files = (opened: MountedAdminPage) =>
  findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr')).map(tr => textOf(findAll(tr, el => el.tag === 'td')[2] ?? []))
const loadingShown = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'SkeletonTable').length > 0
async function pick(opened: MountedAdminPage, type: string) {
  const select = findAll(opened.page.root, el => el.tag === 'select' && el.props.id === 'backup-filter-type')[0]
  assert.ok(select, `the type filter is rendered (${opened.page.errors.map(String).join('; ')})`)
  await fire(select, 'update:modelValue', type)
  void fire(select, 'change')
  await settle()
}
/** The mount's list answer at once; every later one held for the test. */
function held() {
  const pending: NetCall[] = []
  let first = true
  return { pending, list: (call: NetCall) => { if (first) { first = false; return answer([SQL, MEDIA]) } pending.push(call); return undefined } }
}

describe(PAGE, () => {
  it('a type filter asks for page 1 of that type; a failed load shows the server\'s sentence with "thử lại"', async () => {
    const opened = await open(call => answer(call.url.searchParams.get('type') === 'sql' ? [SQL] : [SQL, MEDIA]))
    await pick(opened, 'sql')
    assert.equal(wire(opened.calls.filter(call => call.url.pathname === LIST).at(-1)!), `GET ${LIST}?page=1&pageSize=20&type=sql`)
    assert.deepEqual(files(opened), ['cdkt-db.sql.gz'])
    const refused = await open(() => h3Error(403, 'Bạn không có quyền xem backup.'))
    assert.match(alertText(refused.page), /Bạn không có quyền xem backup\. Vui lòng thử lại\./)
    assert.doesNotMatch(alertText(refused.page), OFETCH_LINE)
  })

  it('FINDING: the older filter\'s answer landing last does not replace the newer filter\'s list', async () => {
    const { pending, list } = held()
    const opened = await open(list)
    await pick(opened, 'sql')
    await pick(opened, 'media')
    pending[1]!.respond(answer([MEDIA]))
    await settle()
    pending[0]!.respond(answer([SQL]))
    await settle()
    assert.deepEqual(files(opened), ['cdkt-uploads.tar.gz'])
  })

  it('FINDING: the older filter failing last puts no error over the newer list', async () => {
    const { pending, list } = held()
    const opened = await open(list)
    await pick(opened, 'sql')
    await pick(opened, 'media')
    pending[1]!.respond(answer([MEDIA]))
    await settle()
    pending[0]!.respond(h3Error(403, 'Lỗi cũ.'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(files(opened), ['cdkt-uploads.tar.gz'])
  })

  it('FINDING: the older filter settling first keeps the skeleton until the newer one is back', async () => {
    const { pending, list } = held()
    const opened = await open(list)
    await pick(opened, 'sql')
    await pick(opened, 'media')
    pending[0]!.respond(answer([SQL]))
    await settle()
    assert.ok(loadingShown(opened))
    pending[1]!.respond(answer([MEDIA]))
    await settle()
    assert.ok(!loadingShown(opened))
    assert.deepEqual(files(opened), ['cdkt-uploads.tar.gz'])
  })
})
