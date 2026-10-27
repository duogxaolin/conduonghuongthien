/**
 * The per-file report and the run summary of `scripts/codemod-hex-tokens.ts`
 * (wave3-long-term D-TOKENS, task 3.2; ΔE of merges: decision D-T1, task 3.7).
 *
 * Pure: results in, text out. Imports nothing from the codemod (the codemod imports this
 * module, never the reverse).
 */
import path from 'node:path'
import type { Rewrite, RewriteResult } from './codemod-hex-tokens-map.ts'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function tally<T>(items: readonly T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/**
 * `file: N replacements (#2c6e33→brand-700 ×2, …)` + `  left alone: M (#8ed694 ×1 unmapped, …)`; '' when nothing to say.
 * In a run with merges every replacement also carries its colour change: `#e2e8df→line (ΔE 1.79) ×3`, `#2c6e33→brand-700 (ΔE 0) ×2`.
 */
export function formatFileReport(file: string, result: RewriteResult): string {
  const { rewrites, leftAlone } = result
  if (!rewrites.length && !leftAlone.length) return ''
  let head = `${file}: ${plural(rewrites.length, 'replacement')}`
  if (rewrites.length) {
    const key = (r: Rewrite) => `${r.value}→${r.token}${r.dE === undefined ? '' : ` (ΔE ${r.dE})`}`
    head += ` (${tally(rewrites, key).map(([text, n]) => `${text} ×${n}`).join(', ')})`
  }
  if (!leftAlone.length) return head
  const left = tally(leftAlone, (e) => `${e.value}\u0000${e.reason}${e.via ? ` via ${e.via}` : ''}`)
    .map(([key, n]) => {
      const [value, reason] = key.split('\u0000')
      return `${value} ×${n} ${reason}`
    })
  return `${head}\n  left alone: ${leftAlone.length} (${left.join(', ')})`
}

export function formatSummary(entries: ReadonlyArray<{ file: string; result: RewriteResult }>, options: { write: boolean }): string {
  const rewrites = entries.flatMap((e) => e.result.rewrites)
  const leftAlone = entries.flatMap((e) => e.result.leftAlone)
  const lines = [
    `== hex → token codemod: ${options.write ? 'WRITTEN' : 'DRY RUN — no file written'} ==`,
    `files: ${entries.length} scanned, ${entries.filter((e) => e.result.rewrites.length).length} with replacements`,
    `replacements: ${rewrites.length}`,
    `left alone: ${leftAlone.length}${leftAlone.length ? ` (${tally(leftAlone, (e) => e.reason).map(([reason, n]) => `${reason} ${n}`).join(', ')})` : ''}`,
  ]
  const byDir = new Map<string, { rewrites: number; files: number; left: number }>()
  for (const { file, result } of entries) {
    if (!result.rewrites.length && !result.leftAlone.length) continue
    const dir = path.posix.dirname(file.split(path.sep).join('/'))
    const row = byDir.get(dir) ?? { rewrites: 0, files: 0, left: 0 }
    row.rewrites += result.rewrites.length
    row.files += result.rewrites.length ? 1 : 0
    row.left += result.leftAlone.length
    byDir.set(dir, row)
  }
  if (byDir.size) {
    lines.push('by directory:')
    for (const [dir, row] of [...byDir].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      lines.push(`  ${dir}: ${plural(row.rewrites, 'replacement')} in ${plural(row.files, 'file')} (${row.left} left alone)`)
    }
  }
  const merged = tally(leftAlone.filter((e) => e.reason === 'order-merge'), (e) => e.via ?? 'self')
  if (merged.length) lines.push(`order-merge by source: ${merged.map(([via, n]) => `${via} ${n}`).join(', ')}`)
  if (rewrites.some((r) => r.dE !== undefined)) {
    // A run with merges: how much colour the replacements change, bucketed.
    const changed = rewrites.filter((r) => (r.dE ?? 0) > 0)
    const buckets: Array<[string, (dE: number) => boolean]> = [
      ['ΔE <1', (dE) => dE < 1], ['ΔE 1–2', (dE) => dE >= 1 && dE < 2], ['ΔE 2–3', (dE) => dE >= 2 && dE < 3], ['ΔE ≥3', (dE) => dE >= 3],
    ]
    const counts = buckets.map(([label, inBucket]) => `${label} ${changed.filter((r) => inBucket(r.dE!)).length}`)
    const max = changed.reduce((m, r) => Math.max(m, r.dE!), 0)
    lines.push(`colour changes (merge table): ${changed.length} of ${rewrites.length} replacements (${counts.join(', ')}; max ΔE ${max})`)
  }
  const unmapped = tally(leftAlone.filter((e) => e.reason === 'unmapped'), (e) => e.value).slice(0, 20)
  if (unmapped.length) {
    lines.push('top unmapped values:')
    for (const [value, n] of unmapped) lines.push(`  ${value} ${n}`)
  }
  return lines.join('\n')
}
