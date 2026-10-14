import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECRET, cleanup, lines, makeSandbox, repoFile } from './_ops-sandbox'

/**
 * BEHAVIOUR tests for manage.sh Migrate's destructive-SQL scanner, run through the
 * real menu in the throwaway sandbox (fake docker; nothing reaches a database).
 *
 * The old scanner was a line grep anchored at a statement start, so it missed
 * every form below — and a missed file imports after a single "y". The bar is:
 * over-flagging only costs typing the file name, under-flagging loses tables.
 */

function migrate(files: Record<string, string | Buffer>) {
  const sb = makeSandbox(`MYSQL_ROOT_PASSWORD=${SECRET}\nMYSQL_DATABASE=custom_db\n`)
  mkdirSync(sb.path('production/migrations'))
  for (const [name, body] of Object.entries(files)) writeFileSync(sb.path('production/migrations', name), body)
  return sb
}
const imported = (sb: ReturnType<typeof migrate>, name: string) => existsSync(sb.path(`production/migrations/.imported-${name}`))

// Each must be flagged: the import needs the typed file name, a bare "y" is not enough.
const DESTRUCTIVE: Record<string, string> = {
  'newline.sql': 'DROP\nTABLE articles;\n',
  'comment-between.sql': 'DROP/**/TABLE articles;\n',
  'backtick-no-space.sql': 'TRUNCATE`articles`;\n',
  'truncate-without-table.sql': 'truncate users;\n',
  'procedure.sql': 'DELIMITER $$\nCREATE PROCEDURE wipe() BEGIN DROP TABLE articles; END$$\nDELIMITER ;\nCALL wipe();\n',
  'dynamic.sql': "SET @q = CONCAT('DR', 'OP TABLE articles');\nPREPARE s FROM @q;\nEXECUTE s;\n",
  'bom.sql': '﻿DROP TABLE articles;\n',
  'versioned.sql': '/*!50001 DROP VIEW IF EXISTS v */;\n',
  'mariadb-versioned.sql': '/*M!100100 DROP TABLE articles */;\n',
  'string-then-drop.sql': "INSERT INTO t VALUES ('--'); DROP TABLE articles;\n",
  'string-comment-opener.sql': "INSERT INTO t VALUES ('/*'); DROP TABLE articles; -- */\n",
  'alter-drop.sql': 'ALTER TABLE articles DROP content;\n',
  'delete-no-where.sql': 'DELETE FROM articles;\n',
  'delete-with-where.sql': 'DELETE FROM articles WHERE 1=1;\n',
  'update-no-where.sql': "UPDATE articles SET content = '';\n",
  'no-backslash-escapes.sql': "SET sql_mode = 'NO_BACKSLASH_ESCAPES';\nINSERT INTO t VALUES ('a\\'); DROP TABLE articles; -- ');\n",
  'unterminated.sql': "INSERT INTO t VALUES ('never closed);\nDROP TABLE articles;\n",
}

// Content migrations the README documents (INSERT-only) must import with one "y".
const CLEAN: Record<string, string> = {
  'comments.sql': '-- DROP TABLE a;\n# TRUNCATE b;\n/* DROP TABLE c; */\nINSERT INTO t VALUES (1);\n',
  'words-in-data.sql': "INSERT INTO articles (title, body) VALUES ('Drop-in', 'Truncate the list; execute the plan; delete nothing');\n",
  'fk-cascade.sql': 'CREATE TABLE child (id int, pid int, FOREIGN KEY (pid) REFERENCES parent(id) ON DELETE CASCADE ON UPDATE CASCADE);\n',
  'upsert.sql': 'INSERT INTO t (id, a) VALUES (1, 2) ON DUPLICATE KEY UPDATE a = 2;\n',
  'update-with-where.sql': 'UPDATE articles SET views = views + 1 WHERE id = 3;\n',
  'arithmetic.sql': 'SELECT 1--1;\n',
}

test('each evasive destructive form is flagged and needs the file name typed', () => {
  for (const [name, body] of Object.entries(DESTRUCTIVE)) {
    // Bare "y": a flagged file is skipped.
    const sb = migrate({ [name]: body })
    try {
      const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y', '') })
      assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`)
      assert.match(r.stdout, /⚠ \d+ lệnh/, `${name}: the listing does not flag it`)
      assert.match(r.stdout, /Gõ đúng tên file/, `${name}: no typed confirmation was asked for`)
      assert.ok(!imported(sb, name), `${name} imported without its name being typed`)
      assert.ok(!readdirSync(sb.dir).some((f) => f.startsWith('mysql.stdin.')), `${name} reached mysql`)
    } finally {
      cleanup(sb)
    }
  }
})

test('typing the name still imports a flagged file (the scanner warns, it does not forbid)', () => {
  const sb = migrate({ 'newline.sql': DESTRUCTIVE['newline.sql']! })
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y', 'newline.sql') })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /1:DROP TABLE articles/, 'the statement is shown with the line it starts on')
    assert.ok(imported(sb, 'newline.sql'))
  } finally {
    cleanup(sb)
  }
})

test('comments, words inside strings, FK ON DELETE, upserts and arithmetic are not flagged', () => {
  for (const [name, body] of Object.entries(CLEAN)) {
    const sb = migrate({ [name]: body })
    try {
      const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y') })
      assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`)
      assert.doesNotMatch(r.stdout, /Gõ đúng tên file/, `${name} was flagged`)
      assert.ok(imported(sb, name), `${name} did not import`)
    } finally {
      cleanup(sb)
    }
  }
})

// ─── The scanner itself (the awk program from manage.sh, run directly) ──────
/** The awk program as manage.sh prints it, run with `LC_ALL=C awk -v raw=0 [-v window=N]`. */
function scan(body: string | Buffer, window?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'cdkt-scan-'))
  try {
    writeFileSync(join(dir, 'f.sql'), body)
    const script = readFileSync(repoFile('production/manage.sh'), 'utf8')
    const program = /^sql_scan_awk\(\) \{\n {2}cat <<'AWK'\n([\s\S]*?)\nAWK\n\}/m.exec(script)?.[1]
    assert.ok(program, 'sql_scan_awk not found in manage.sh')
    writeFileSync(join(dir, 'prog.awk'), program)
    const args = ['-v', 'raw=0', ...(window ? ['-v', `window=${window}`] : []), '-f', join(dir, 'prog.awk'), join(dir, 'f.sql')]
    const started = Date.now()
    const r = spawnSync('awk', args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
    assert.equal(r.status, 0, r.stderr)
    return { out: r.stdout, ms: Date.now() - started }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the result does not depend on where the reading window splits a line', () => {
  // Long lines are read through a small window; a keyword, an escape, a `/*`, a
  // doubled quote or a version number cut in half by a window edge must not change
  // anything. Window sizes down to 1 byte force every possible split.
  for (const [name, body] of Object.entries({ ...DESTRUCTIVE, ...CLEAN })) {
    const reference = scan(body).out
    for (const window of [1, 2, 3, 4, 5, 7, 13]) {
      assert.equal(scan(body, window).out, reference, `${name}, window ${window}`)
    }
  }
})

test('scanning is linear: an 8 MB extended-INSERT line of escaped HTML scans in about a second, not minutes', () => {
  // The first version copied the rest of the line for every quote and escape —
  // quadratic: 20 s for a 16 MB dump, ~35 s for one 8 MB line. Real migrations are
  // exactly this shape. Linear, this is well under a second here.
  const html = '<p style=\\"color: red;\\">Người hoàn lương &nbsp;tái hòa nhập\\r\\n<a href=\\"https://x.vn/?a=1&b=2\\">liên kết</a> -- /* not a comment */ it\\\'s; use</p>\\n'
  const rows: string[] = []
  let size = 0
  while (size < 8 * 1024 * 1024) {
    const row = `(${rows.length},'Tiêu đề','${html.repeat(4)}',NULL,'2026-10-14 00:00:00')`
    rows.push(row)
    size += row.length
  }
  const body = `/*!40101 SET NAMES utf8mb4 */;\nLOCK TABLES \`articles\` WRITE;\nINSERT INTO \`articles\` VALUES ${rows.join(',')};\nUNLOCK TABLES;\n`
  const { out, ms } = scan(body)
  assert.equal(out, '', 'an INSERT-only dump is not flagged')
  assert.ok(ms < 10_000, `took ${ms} ms`)
})

test('a file with thousands of flagged statements does not kill Migrate with SIGPIPE before the prompt', () => {
  // `printf "$danger" | head -n 8` under pipefail + set -e: once the list outgrows
  // a pipe buffer, printf dies of SIGPIPE and takes the whole script with it.
  const body = Array.from({ length: 4000 }, (_, i) => `DROP TABLE IF EXISTS \`table_number_${i}\`;`).join('\n') + '\n'
  const sb = migrate({ 'big-dump.sql': body })
  try {
    const r = sb.run('production/manage.sh', ['migrate'], { input: lines('1', 'y', 'big-dump.sql') })
    assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr)
    assert.match(r.stdout, /4000 lệnh/)
    assert.match(r.stdout, /… \(còn nữa\)/)
    assert.ok(imported(sb, 'big-dump.sql'))
    const stdin = readdirSync(sb.dir).find((f) => f.startsWith('mysql.stdin.'))!
    assert.equal(readFileSync(sb.path(stdin), 'utf8'), body, 'the file reached mysql whole')
  } finally {
    cleanup(sb)
  }
})
