/**
 * `npm run test:mutations` — chạy danh mục "làm hỏng có chủ đích" (`scripts/mutation-proofs-catalog.ts`).
 *
 * Với mỗi mục: gỡ bất biến khỏi mã, chạy đúng các tệp test ghi kèm, và đòi chúng ĐỎ vì một test THẬT SỰ thất bại.
 * Đột biến "sống sót" (test vẫn xanh) nghĩa là bất biến không còn được bộ test canh — script thoát 1.
 *
 * "Bị bắt" chỉ khi: tiến trình test kết thúc bình thường với mã 1 (không timeout, không bị kill), SỐ TEST chạy
 * bằng đúng mốc chưa đột biến (không tệp nào nạp hỏng), và có ít nhất một test fail. Đột biến làm hỏng cú pháp
 * bị báo `INVALID` trước khi chạy. Mọi kết cục khác (`SURVIVED`, `STALE`, `INVALID`, `LOAD-ERROR`, `TIMEOUT`) đều
 * làm script thoát 1.
 *
 * Không bao giờ sửa cây làm việc của người chạy: dựng một git worktree tạm (HEAD) trong thư mục tạm của hệ
 * thống, áp lên đó mọi thay đổi so với HEAD hiện có (đã sửa, đã `git add`, đã xoá, chưa track — để chạy được cả
 * trước khi commit), nối `node_modules` bằng symlink, rồi làm hỏng ở đó. Xoá worktree khi xong, kể cả khi lỗi
 * hay bị Ctrl+C (dừng cả lượt). SIGKILL thì không dọn kịp — `git worktree prune` ở lượt sau gỡ đăng ký thừa.
 *
 *   npm run test:mutations                 # cả danh mục
 *   npm run test:mutations -- <id> [<id>]  # chỉ vài mục
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { MUTATION_PROOFS } from './mutation-proofs-catalog.ts'

/**
 * Đột biến làm mã HỎNG CÚ PHÁP thì test đỏ vì không nạp được module — không chứng minh gì về bất biến. Bắt
 * trước khi chạy và báo `INVALID`.
 */
function syntaxErrors(file: string, text: string): string[] {
  const out = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext } })
  return (out.diagnostics ?? []).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

const repo = path.resolve(import.meta.dirname, '..')
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' })

const wanted = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
const proofs = wanted.length ? MUTATION_PROOFS.filter(proof => wanted.includes(proof.id)) : MUTATION_PROOFS
const unknown = wanted.filter(id => !MUTATION_PROOFS.some(proof => proof.id === id))
if (unknown.length) {
  console.error(`unknown mutation id(s): ${unknown.join(', ')}`)
  process.exit(2)
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cdkt-mutations-'))
const tree = path.join(scratch, 'tree')
let failed = false

function cleanup(): void {
  try { git(['worktree', 'remove', '--force', tree]) } catch { /* đã gỡ hoặc chưa kịp tạo */ }
  rmSync(scratch, { recursive: true, force: true })
  // Lượt trước bị ngắt (máy tắt) có thể để lại đăng ký worktree trỏ vào thư mục tạm đã mất.
  try { git(['worktree', 'prune']) } catch { /* không quan trọng */ }
}
/**
 * Ctrl+C trong lúc `spawnSync` tới tiến trình test (cùng nhóm tiến trình) chứ không tới handler của script — script
 * đồng bộ, handler không bao giờ được gọi kịp. Nên: tiến trình test chết vì SIGINT/SIGTERM ⇒ ném lỗi này, dừng cả
 * lượt, `finally` dọn worktree.
 */
class Interrupted extends Error {}
let exitCode = 0
// Handler rỗng có chủ đích: không có nó, SIGINT/SIGTERM GIẾT luôn script (mặc định của Node) trước khi `finally` kịp
// dọn worktree. Có nó, chỉ tiến trình test con chết; `runTests` thấy `result.signal` và dừng cả lượt (đã thử bằng
// `kill -INT -<nhóm>` giữa lượt chạy: thoát 130, không còn worktree).
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {})

type Outcome = 'killed' | 'SURVIVED' | 'STALE' | 'INVALID' | 'LOAD-ERROR' | 'TIMEOUT'
interface Run { status: number | null, timedOut: boolean, tests: number | null, failures: number | null, output: string }

try {
  git(['worktree', 'add', '--detach', '--quiet', tree, 'HEAD'])
  // Mọi thay đổi so với HEAD: đã sửa và đã `git add` (diff HEAD), đã xoá, và chưa track (trừ thứ bị ignore).
  // `--no-renames`: một lượt đổi tên đã `git add` phải hiện cả đường dẫn cũ (để xoá) lẫn mới (để chép).
  const changed = git(['diff', '--name-only', '--no-renames', '-z', 'HEAD']).split('\0').filter(Boolean)
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  for (const rel of [...changed, ...untracked]) {
    const from = path.join(repo, rel)
    const to = path.join(tree, rel)
    if (!existsSync(from)) {
      rmSync(to, { force: true })
      continue
    }
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  symlinkSync(path.join(repo, 'node_modules'), path.join(tree, 'node_modules'), 'dir')

  const runTests = (files: string[]): Run => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', '--experimental-test-module-mocks',
      '--import', './scripts/ts-resolver.mjs',
      '--test', '--test-reporter=tap', ...files,
    ], { cwd: tree, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const count = (label: string) => {
      const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(result.stdout ?? '')
      return match ? Number(match[1]) : null
    }
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
    // Bị ngắt: test runner của Node nhận SIGINT thì thoát mã 1 KHÔNG in dòng tổng kết TAP (đo 2026-11-06), hoặc
    // chết vì signal. Không phân biệt được với "bị bắt" nếu không xét điều này — và một lượt mốc bị ngắt sẽ làm
    // các mục sau báo sai.
    if (!timedOut && (result.signal === 'SIGINT' || result.signal === 'SIGTERM' || (result.status !== 0 && count('tests') === null))) {
      throw new Interrupted(result.signal ?? `exit ${result.status} without a test summary`)
    }
    return {
      status: result.status,
      timedOut: timedOut || result.signal !== null,
      tests: count('tests'),
      failures: count('fail'),
      output,
    }
  }

  // Mốc: chính các test này phải XANH trên mã chưa bị làm hỏng — nếu không, "đỏ sau đột biến" không chứng minh gì.
  const baselineFiles = [...new Set(proofs.flatMap(proof => proof.tests))]
  const baseline = runTests(baselineFiles)
  if (baseline.status !== 0 || baseline.timedOut) {
    console.log(`BASELINE RED — these test files fail without any mutation, so no proof below would mean anything:\n  ${baselineFiles.join('\n  ')}`)
    console.log(baseline.output.slice(-3000))
    failed = true
    throw new Error('baseline red')
  }
  console.log(`baseline green (${baselineFiles.length} test files, ${baseline.tests} tests)`)
  // Số test mốc của TỪNG bộ tệp: đột biến làm một tệp không nạp được sẽ chạy ít test hơn — đó không phải "bị bắt".
  const baselineTests = new Map<string, number | null>()
  const testsFor = (files: string[]) => {
    const key = files.join('\0')
    if (!baselineTests.has(key)) baselineTests.set(key, runTests(files).tests)
    return baselineTests.get(key) ?? null
  }

  const results: Array<{ id: string, outcome: Outcome }> = []
  for (const proof of proofs) {
    const target = path.join(tree, proof.file)
    const original = readFileSync(target, 'utf8')
    const occurrences = original.split(proof.find).length - 1
    if (occurrences !== 1) {
      results.push({ id: proof.id, outcome: 'STALE' })
      console.log(`STALE      ${proof.id}: "find" occurs ${occurrences} times in ${proof.file}`)
      continue
    }
    const mutated = original.replace(proof.find, proof.replace)
    const broken = syntaxErrors(proof.file, mutated)
    if (broken.length) {
      results.push({ id: proof.id, outcome: 'INVALID' })
      console.log(`INVALID    ${proof.id}: the mutation does not parse (${broken[0]}) — a load error would prove nothing`)
      continue
    }
    const expectedTests = testsFor(proof.tests)
    writeFileSync(target, mutated)
    let outcome: Outcome
    try {
      const run = runTests(proof.tests)
      if (run.timedOut) outcome = 'TIMEOUT'
      else if (run.status === 0) outcome = 'SURVIVED'
      else if (run.status === 1 && run.tests !== null && run.tests === expectedTests && (run.failures ?? 0) > 0) outcome = 'killed'
      else outcome = 'LOAD-ERROR'
      if (outcome === 'LOAD-ERROR') console.log(run.output.slice(-1500))
    } finally {
      writeFileSync(target, original)
    }
    results.push({ id: proof.id, outcome })
    console.log(`${outcome.padEnd(10)} ${proof.id} (${proof.tests.join(', ')})${outcome === 'killed' ? '' : ` — ${proof.why}`}`)
  }

  const bad = results.filter(result => result.outcome !== 'killed')
  console.log(`\n${results.length - bad.length}/${results.length} mutations killed`)
  failed = bad.length > 0
} catch (error) {
  if (error instanceof Interrupted) {
    console.log(`\ninterrupted (${error.message}) — worktree cleaned up, no result`)
    exitCode = 130
  } else if (!(error instanceof Error && error.message === 'baseline red')) {
    throw error
  }
} finally {
  cleanup()
}

process.exit(exitCode || (failed ? 1 : 0))
