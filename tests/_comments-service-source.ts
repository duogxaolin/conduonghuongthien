/**
 * Source text of the comment service, for guards that read code as text.
 *
 * `server/services/comments.ts` was one 1208-line file and several guards read
 * it whole. Since wave2 D-SPLIT it is a barrel and the code lives in
 * `comments-*.ts` sub-files. A guard that kept reading `comments.ts` would read
 * an export list and go green on nothing; a guard rewritten to read a hand list
 * of sub-files would silently stop scanning any code moved to a file nobody
 * added. So the set is DERIVED from the directory — every
 * `server/services/comments*.ts`, including sub-files added later — and checked
 * against the files that carry code today: renaming or removing one of them
 * turns the guard red instead of quietly shrinking what it scans.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SERVICES_DIR = new URL('../server/services/', import.meta.url)

/** The comment-service barrel. */
export const COMMENT_SERVICE_BARREL = 'comments.ts'

/**
 * A comment-service sub-file, `comments-<seam>.ts` — digits allowed (`comments-v2.ts`).
 * The ONE definition: the audit/source guards here and the `comments` family of
 * `tests/service-split-boundaries.test.ts` both use it, so a file cannot be inside
 * one scan and outside the other. (An earlier `[a-z-]+` copy here let a
 * `comments-v2.ts` skip every guard below while the boundary guard saw it.)
 */
export const COMMENT_SUBFILE = /^comments-[a-z0-9-]+\.ts$/

/** The comment service family: the barrel plus every sub-file. */
export const isCommentServiceFile = (name: string): boolean =>
  name === COMMENT_SERVICE_BARREL || COMMENT_SUBFILE.test(name)

/** Files that carry the service's code today. A subset check — new sub-files join the scan automatically. */
export const EXPECTED_COMMENT_SERVICE_FILES = [
  'comments.ts',
  'comments-admin-reply.ts',
  'comments-deletion.ts',
  'comments-moderation.ts',
  'comments-posting.ts',
  'comments-reply-email.ts',
  'comments-rules.ts',
  'comments-thread.ts',
]

/** Repo-relative paths (`server/services/…`) of every comment-service file. */
export function commentServiceFiles(): string[] {
  const found = readdirSync(SERVICES_DIR).filter(isCommentServiceFile).sort()
  for (const expected of EXPECTED_COMMENT_SERVICE_FILES) {
    assert.ok(
      found.includes(expected),
      `${expected} vắng khỏi tập quét ${JSON.stringify(found)} — đổi tên/di chuyển tệp của dịch vụ bình luận phải cập nhật guard, không âm thầm thu hẹp tập quét`,
    )
  }
  return found.map(name => `server/services/${name}`)
}

export function readServiceFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

/**
 * The ONE comment-service file that declares `function <name>` (exported or
 * not, async or not), with its source. Asserting exactly one match keeps a guard
 * from reading a stale copy or from going green because the name vanished.
 */
export function fileDeclaring(name: string): { file: string, source: string } {
  const declaration = new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\b`)
  const matches = commentServiceFiles()
    .map(file => ({ file, source: readServiceFile(file) }))
    .filter(({ source }) => declaration.test(source))
  assert.equal(
    matches.length,
    1,
    `${name} phải được khai báo ở đúng một tệp comments*.ts, thấy: ${JSON.stringify(matches.map(match => match.file))}`,
  )
  return matches[0]!
}
