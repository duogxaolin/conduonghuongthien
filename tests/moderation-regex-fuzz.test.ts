/**
 * Differential fuzz of the save-time check (Layer 1) of `server/services/moderation-regex.ts`
 * against the real engine: every pattern the check ACCEPTS must finish matching each
 * adversarial 400-character input in under 100 ms.
 *
 * Why: Layer 1 is an estimate over a parse tree, and its holes are exactly the patterns it
 * misreads — a group name it did not parse (`(?<é>\s*)(?<ê>\s*)$`), a `{0}` that made a
 * width NaN (`(?:\s+){0}\s*\s*$`), letters the `iu` flag folds together that `toLowerCase`
 * keeps apart (`(s|ſ)+x`). The tables in `moderation-regex.test.ts` pin the shapes someone
 * thought of; this generates the ones nobody did, from the alphabet those three holes came
 * from: `\s`, `s`, `ſ`, `k`, `K`, KELVIN SIGN, groups, non-ASCII named groups (also as `\u`
 * escapes), alternation, `+ * ?`, `{0}`, `{1,3}`.
 *
 * Deterministic: a seeded PRNG (mulberry32), the same corpus on every machine. Group names
 * are unique within a pattern (duplicate names are legal only on newer V8), and there are no
 * modifier groups (`(?i:` — Node 22 refuses them), so the corpus is valid on every Node in
 * `engines`. Bounded: every run executes in one `vm` context with a timeout, so a pattern the
 * check wrongly accepts cannot hang the suite; a run over budget is retried twice (a loaded CI
 * runner is slow, a catastrophic pattern is slow every time), and the scan stops after a few
 * failures. Floors on the number of valid and accepted patterns keep the test from passing on
 * an empty corpus. Every valid pattern is also checked for a NaN estimate (`analysisNumbers`).
 *
 * Teeth: on the code before wave3 4.3b this corpus has 77 accepted patterns that run past
 * 250 ms on one of the inputs — every one a variant of the three holes (several are pinned by
 * name in `moderation-regex-seams-behavior.test.ts`, so they outlive changes to the generator).
 *
 * Limit of this evidence: 400 characters is far below the 2000-character window Layer 2 runs
 * on, so a cubic pattern can sit under 100 ms here (the two cubic holes above cost about
 * 150 ms at 401 characters on a developer machine — near the line). Those two are pinned by
 * name in `moderation-regex-seams-behavior.test.ts`; this test is the net for exponential
 * shapes and for everything nobody listed. Its alphabet has no character outside the sample
 * table, so it cannot see `FINDING moderation-regex-4` (`日*日*$`).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { MODERATION_REGEX_FLAGS, checkModerationPattern } from '../server/services/moderation-regex.ts'
import { analysisNumbers } from '../server/services/moderation-regex-analysis.ts'

const SEED = 0x5eed2026
const PATTERNS = 3000
const INPUT_LENGTH = 400
const BUDGET_MS = 100
/** A catastrophic run is stopped here; the budget above is what fails the test. */
const TIMEOUT_MS = 250
const MAX_FAILURES = 5

/** mulberry32: small, fast, and the same sequence everywhere. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KELVIN = 'K'
const LONG_S = 'ſ'
/** Weighted by repetition: the characters the holes came from come up most. */
const ATOMS = ['\\s', '\\s', '\\s', 's', 's', 'S', LONG_S, LONG_S, 'k', 'K', KELVIN, KELVIN, '[sſ]', '\\S', '.']
const ATOM_QUANTIFIERS = ['', '', '', '+', '*', '*', '?', '{0}', '{1,3}']
const GROUP_QUANTIFIERS = ['', '+', '+', '*', '*', '?', '{0}', '{0}', '{1,3}', '{2}']
/** Non-ASCII group names, some written as `\u` escapes; a counter keeps each unique. */
const NAMES = ['é', 'ê', 'ữ', 'π', '名', LONG_S, KELVIN, '$', '_', 'ab', '\\u00e9', '\\u{1D49C}']
/** What follows the body: something the adversarial inputs never supply, so the engine backtracks. */
const TAILS = ['$', '$', 'x', 'x', '!x', '']

/** Letters that the `iu` flag folds together in ways `toLowerCase` does not (ſ ≡ s, K ≡ k). */
const LETTERS = ['s', 'S', LONG_S, 'k', 'K', KELVIN]
/** Unbounded runs that can follow one another. */
const RUNS = ['\\s*', '\\s+', 's*', `${LONG_S}*`, '[sſ]*', 'K*', `${KELVIN}+`, '.*']

/**
 * Three families of small, ambiguous shapes — the ones that blow up — then a tail:
 *  - a loop over an alternation of short words (`(s|ſ)+`, `(?:sK|ſk){1,3}`);
 *  - unbounded runs next to each other, each perhaps inside a plain, non-capturing or named
 *    group, with zero-count parts or letters between them (`(?<é>\s*)(?:\s+){0}\s*`);
 *  - anything: one to three items, groups of one to three short branches, quantifiers on
 *    both, at most two levels of nesting.
 */
function generator(rand: () => number) {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  let groups = 0
  const open = (): string => {
    const kind = rand()
    return kind < 0.35 ? '(' : kind < 0.6 ? '(?:' : `(?<${pick(NAMES)}${groups++}>`
  }
  const word = (): string => pick(LETTERS) + (rand() < 0.3 ? pick(LETTERS) : '')
  const wordLoop = (): string => {
    const words = Array.from({ length: 2 + Math.floor(rand() * 2) }, word)
    return `${open()}${words.join('|')})${pick(['+', '*', '{1,3}', '{2,}'])}`
  }
  const adjacentRuns = (): string =>
    Array.from({ length: 2 + Math.floor(rand() * 2) }, () => {
      const run = pick(RUNS)
      const between = rand() < 0.3 ? `${open()}${pick(RUNS)}){0}` : rand() < 0.2 ? pick(LETTERS) : ''
      return (rand() < 0.5 ? `${open()}${run})` : run) + between
    }).join('')
  const item = (depth: number): string => {
    if (depth < 2 && rand() < 0.5) {
      const branches = rand() < 0.35 ? 1 : rand() < 0.8 ? 2 : 3
      const inner = Array.from({ length: branches }, () => (rand() < 0.05 ? '' : sequence(depth + 1, 2))).join('|')
      return `${open()}${inner})${pick(GROUP_QUANTIFIERS)}`
    }
    return pick(ATOMS) + pick(ATOM_QUANTIFIERS)
  }
  const sequence = (depth: number, most: number): string =>
    Array.from({ length: 1 + Math.floor(rand() * most) }, () => item(depth)).join('')
  return (): string => {
    groups = 0
    const family = rand()
    const body = family < 0.3 ? wordLoop() : family < 0.6 ? adjacentRuns() : sequence(0, 3)
    return `${rand() < 0.15 ? '^' : ''}${body}${pick(TAILS)}`
  }
}

/** Long runs of each character the alphabet can match, then one that nothing matches. */
const INPUTS: Array<[string, string]> = [
  ...[' ', ' ', 's', 'S', LONG_S, 'k', 'K', KELVIN, 'x'].map((c): [string, string] => [
    `${c.codePointAt(0)!.toString(16)} ×399 + !`,
    `${c.repeat(INPUT_LENGTH - 1)}!`,
  ]),
  ['(s ſ)×199 + s!', `${`s${LONG_S}`.repeat((INPUT_LENGTH - 2) / 2)}s!`],
  ['(k K)×199 + k!', `${`k${KELVIN}`.repeat((INPUT_LENGTH - 2) / 2)}k!`],
  ['(␠s)×199 + ␠!', `${' s'.repeat((INPUT_LENGTH - 2) / 2)} !`],
  ['␠×400', ' '.repeat(INPUT_LENGTH)],
]

test('fuzz: every pattern the save-time check accepts matches each 400-char adversarial input in < 100 ms', () => {
  const next = generator(prng(SEED))
  const context = vm.createContext({ pattern: '', flags: MODERATION_REGEX_FLAGS, input: '', re: null })
  const compile = new vm.Script('re = new RegExp(pattern, flags)')
  const match = new vm.Script('re.test(input)')
  const timed = (): number => {
    const start = performance.now()
    try {
      match.runInContext(context, { timeout: TIMEOUT_MS })
    } catch {
      return Number.POSITIVE_INFINITY
    }
    return performance.now() - start
  }

  const seen = new Set<string>()
  let valid = 0
  let accepted = 0
  let runs = 0
  const failures: string[] = []
  const nanPatterns: string[] = []
  for (let n = 0; n < PATTERNS && failures.length < MAX_FAILURES; n += 1) {
    const pattern = next()
    if (seen.has(pattern)) continue
    seen.add(pattern)
    try {
      new RegExp(pattern, MODERATION_REGEX_FLAGS)
    } catch {
      continue
    }
    valid += 1
    // Invariant over the whole corpus: no estimate is NaN (a NaN passes every limit).
    if (analysisNumbers(pattern).some(Number.isNaN)) nanPatterns.push(pattern)
    if (!checkModerationPattern(pattern, 'pattern').ok) continue
    accepted += 1
    context.pattern = pattern
    compile.runInContext(context)
    for (const [label, input] of INPUTS) {
      context.input = input
      runs += 1
      let best = timed()
      for (let retry = 0; retry < 2 && best > BUDGET_MS; retry += 1) best = Math.min(best, timed())
      if (best > BUDGET_MS) {
        failures.push(`${JSON.stringify(pattern)} on ${label}: ${best === Number.POSITIVE_INFINITY ? `> ${TIMEOUT_MS}` : best.toFixed(0)} ms`)
        break
      }
    }
  }
  assert.deepEqual(failures, [], `accepted at save time, yet slow on a 400-char input:\n${failures.join('\n')}`)
  assert.deepEqual(nanPatterns.slice(0, 10), [], 'a Layer-1 estimate was NaN')
  // Floors: the corpus is real (unique, valid, a fair share accepted) — not a green run on nothing.
  assert.ok(seen.size >= 2000, `only ${seen.size} distinct patterns generated`)
  assert.ok(valid >= 2000, `only ${valid} valid patterns`)
  assert.ok(accepted >= 400, `only ${accepted} accepted patterns`)
  assert.equal(runs, accepted * INPUTS.length)
})
