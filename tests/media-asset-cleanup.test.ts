import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { mediaAssetCleanup, mediaItems } from '../server/db/schema.ts'
import { cleanupRetryAt, processMediaAssetCleanup } from '../server/services/media-asset-cleanup.ts'

type Task = { id: string, assetRoot: string, attempts: number, nextAttemptAt: Date | null, createdAt: Date }

/**
 * Only emulate the two query shapes the cleanup worker owns.  The test uses a
 * real temporary directory for the destructive part: a mock `fs.rm` would not
 * establish that the containment check and the selected root agree.
 */
function cleanupDb(tasks: Task[], candidates: Array<{ slug: string, storagePath: string | null }> = []) {
  const deleted: string[] = []
  const updates: Array<Record<string, unknown>> = []
  return {
    deleted,
    updates,
    select() {
      return {
        from(table: unknown) {
          if (table === mediaAssetCleanup) {
            return { where: () => ({ orderBy: () => ({ limit: async () => tasks }) }) }
          }
          assert.equal(table, mediaItems)
          return { where: async () => candidates }
        },
      }
    },
    delete() {
      return { where: async () => { deleted.push(tasks[deleted.length]?.id ?? '') } }
    },
    update() {
      return { set(values: Record<string, unknown>) { updates.push(values); return { where: async () => undefined } } }
    },
  }
}

test('asset cleanup removes only the deleted upload root', async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'cdkt-asset-cleanup-'))
  const task: Task = { id: 'cleanup-1', assetRoot: 'media/deleted', attempts: 0, nextAttemptAt: null, createdAt: new Date() }
  const db = cleanupDb([task])
  try {
    await writeFile(path.join(workdir, '.keep'), 'outside the media tree')
    await writeFile(await makeAsset(workdir, 'deleted'), 'remove me')
    await writeFile(await makeAsset(workdir, 'kept'), 'keep me')

    const result = await processMediaAssetCleanup({ db: db as never, config: { workdir } as never })

    assert.deepEqual(result, { removed: 1, retried: 0, protected: 0 })
    await assert.rejects(() => writeFile(path.join(workdir, 'media', 'deleted', 'file'), 'x'))
    assert.equal(await readAsset(workdir, 'kept'), 'keep me')
    assert.equal(db.deleted[0], task.id)
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
})

test('asset cleanup keeps a root newly referenced by an upload row', async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'cdkt-asset-cleanup-'))
  const task: Task = { id: 'cleanup-2', assetRoot: 'media/still-live', attempts: 0, nextAttemptAt: null, createdAt: new Date() }
  const db = cleanupDb([task], [{ slug: 'still-live', storagePath: 'media/still-live/generations/current' }])
  try {
    await writeFile(await makeAsset(workdir, 'still-live'), 'must survive')
    const result = await processMediaAssetCleanup({ db: db as never, config: { workdir } as never })
    assert.deepEqual(result, { removed: 0, retried: 0, protected: 1 })
    assert.equal(await readAsset(workdir, 'still-live'), 'must survive')
    assert.equal(db.deleted[0], task.id)
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
})

test('asset cleanup rejects an escaping root and records exponential retry state', async () => {
  const task: Task = { id: 'cleanup-3', assetRoot: '../outside', attempts: 2, nextAttemptAt: null, createdAt: new Date() }
  const db = cleanupDb([task])
  const now = new Date('2026-09-20T09:00:00.000Z')
  const result = await processMediaAssetCleanup({ db: db as never, config: { workdir: '/tmp/cdkt-cleanup' } as never, now })
  assert.deepEqual(result, { removed: 0, retried: 1, protected: 0 })
  assert.equal(db.updates[0]?.attempts, 3)
  assert.equal((db.updates[0]?.nextAttemptAt as Date).toISOString(), cleanupRetryAt(3, now).toISOString())
})

async function makeAsset(workdir: string, slug: string) {
  const filename = path.join(workdir, 'media', slug, 'original.txt')
  await (await import('node:fs/promises')).mkdir(path.dirname(filename), { recursive: true })
  return filename
}

async function readAsset(workdir: string, slug: string) {
  return (await import('node:fs/promises')).readFile(path.join(workdir, 'media', slug, 'original.txt'), 'utf8')
}
