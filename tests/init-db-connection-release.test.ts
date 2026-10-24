import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `initDb()` now also runs inside the server process — a database restore brings the
 * schema up to date with it (`backup-restore.ts` `convergeSchemaAfterRestore`). When a
 * step failed, the `db.end()` after the steps was skipped: every failed restore left a
 * MySQL connection open in the running server (the re-verification repro hung until
 * its timeout). Both connections are released on every exit, success or throw.
 */

const opened: Array<{ database: string | undefined, ended: boolean }> = []
const failures = { createDatabase: false, schemaStep: false, end: false }

mock.module('mysql2/promise', {
  defaultExport: {
    createConnection: async (options: { database?: string }) => {
      const record = { database: options.database, ended: false }
      opened.push(record)
      return {
        query: async (sqlText: string) => {
          if (failures.createDatabase && /^CREATE DATABASE/.test(sqlText)) throw new Error('fixture: access denied for CREATE DATABASE')
          return [[], []]
        },
        execute: async () => {
          if (failures.schemaStep) throw new Error('fixture: ALTER TABLE failed (orphan row blocks the FK)')
          return [[], []]
        },
        end: async () => {
          record.ended = true
          if (failures.end) throw new Error('fixture: connection already lost')
        },
      }
    },
  },
})

const { initDb } = await import('../server/db/init')

beforeEach(() => {
  opened.length = 0
  failures.createDatabase = false
  failures.schemaStep = false
  failures.end = false
})

test('a connection that cannot be closed cleanly does not hide the error of the step that failed', async () => {
  failures.schemaStep = true
  failures.end = true
  await assert.rejects(initDb(), /ALTER TABLE failed/)
})

test('a failing schema step still releases the connection it opened', async () => {
  failures.schemaStep = true
  await assert.rejects(initDb(), /ALTER TABLE failed/)
  assert.ok(opened.length >= 1)
  assert.deepEqual(opened.filter(conn => !conn.ended), [], `left open: ${JSON.stringify(opened)}`)
})

test('a failing CREATE DATABASE releases its connection too', async () => {
  failures.createDatabase = true
  await assert.rejects(initDb(), /CREATE DATABASE/)
  assert.equal(opened.length, 1)
  assert.equal(opened[0]!.ended, true)
})
