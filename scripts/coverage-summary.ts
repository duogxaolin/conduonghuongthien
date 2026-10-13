/**
 * Tóm tắt báo cáo độ phủ của `node --test --experimental-test-coverage`.
 *
 * Node in độ phủ thành một bảng thụt lề ở cuối log (~3000 dòng). CI đọc log đó, gọi
 * script này và ghi vài dòng markdown vào trang kết quả, để thấy độ phủ tụt mà không
 * phải mở log. CHỈ báo cáo, không chặn: chưa có ngưỡng nào, vì một con số chọn trước
 * khi ai đó thấy mức nền chỉ là cách mới để CI đỏ.
 *
 *   node --experimental-strip-types scripts/coverage-summary.ts < unit-test.log
 */

export type CoverageFile = { path: string, line: number, branch: number, funcs: number }
export type CoverageReport = { overall: { line: number, branch: number, funcs: number } | null, files: CoverageFile[] }

const ROW = /^ℹ( *)(.+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|/

export function parseCoverageReport(text: string): CoverageReport {
  const report: CoverageReport = { overall: null, files: [] }
  const trail: string[] = []
  let inside = false
  for (const raw of text.split('\n')) {
    if (raw.includes('start of coverage report')) { inside = true; continue }
    if (raw.includes('end of coverage report')) break
    if (!inside) continue
    const match = ROW.exec(raw.trimEnd())
    if (!match) continue
    const [, indent, name, line, branch, funcs] = match as unknown as [string, string, string, string, string, string]
    if (name === 'file' || /^-+$/.test(name)) continue
    if (name === 'all files') {
      report.overall = { line: Number(line), branch: Number(branch), funcs: Number(funcs) }
      continue
    }
    // `ℹ ` is followed by one separator space before the tree indentation starts.
    const depth = Math.max(0, indent.length - 1)
    trail.length = depth
    trail[depth] = name
    // A directory row has empty percentages; a file row has numbers.
    if (line === '') continue
    report.files.push({ path: trail.slice(0, depth + 1).join('/'), line: Number(line), branch: Number(branch), funcs: Number(funcs) })
  }
  return report
}

/**
 * DDL chỉ chạy trong bộ integration (cần MySQL), nên ở bộ unit chúng luôn gần 0% và
 * chiếm đầu danh sách "ít được phủ nhất" mà không nói gì hữu ích.
 */
const NOT_MEASURED_BY_UNIT_SUITE = ['server/db/schema-tables/']

export function lowestCovered(files: CoverageFile[], options: { prefix?: string, limit?: number } = {}): CoverageFile[] {
  return files
    .filter(file => !NOT_MEASURED_BY_UNIT_SUITE.some(excluded => file.path.startsWith(excluded)))
    .filter(file => !options.prefix || file.path.startsWith(options.prefix))
    .sort((a, b) => a.line - b.line || a.path.localeCompare(b.path))
    .slice(0, options.limit ?? 15)
}

export function renderCoverageSummary(report: CoverageReport, options: { limit?: number } = {}): string {
  if (!report.overall) return '### Test coverage\n\nNo coverage table found in the log (report only — nothing is enforced).\n'
  const { line, branch, funcs } = report.overall
  const rows = lowestCovered(report.files, { limit: options.limit ?? 15 })
    .map(file => `| \`${file.path}\` | ${file.line.toFixed(2)} | ${file.branch.toFixed(2)} | ${file.funcs.toFixed(2)} |`)
  return [
    '### Test coverage',
    '',
    `**${line.toFixed(2)}% lines** · ${branch.toFixed(2)}% branches · ${funcs.toFixed(2)}% functions (unit suite; the MySQL integration suites are not included).`,
    '',
    '_Report only — no threshold is enforced._',
    '',
    `<details><summary>${rows.length} least-covered files</summary>`,
    '',
    '| file | lines % | branches % | functions % |',
    '|---|---|---|---|',
    ...rows,
    '',
    '</details>',
    '',
  ].join('\n')
}

// CLI: read the log on stdin, print markdown. Never fails the job.
if (import.meta.main) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  process.stdout.write(renderCoverageSummary(parseCoverageReport(input)))
}
