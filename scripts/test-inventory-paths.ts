/**
 * Đường dẫn cho `scripts/test-inventory.ts` (docs/decisions/test-strategy.md).
 *
 * Văn bản suy tĩnh từ đối số của một lời gọi đọc được chuẩn hoá (bỏ `../`, `./`, tiền tố
 * `file://` hay `HEAD:` của `git show`) rồi tách thành tệp nguồn dưới `app/` `server/`
 * `scripts/` `shared/` và tệp khác của repo (CI, Dockerfile, compose, `production/`…).
 * Thư mục và tên tệp tương đối thấy trong cùng một lời gọi được ghép: `new URL(p, appRoot)`
 * với `appRoot = '../app/'` và `p` lấy từ mảng `['pages/x.vue', …]` cho `app/pages/x.vue`.
 * Một lời gọi dựng trên gốc sandbox (`mkdtemp`, `tmpdir`) không đọc gì của repo, kể cả khi
 * thư mục tạm có tên trùng `app/`.
 */

/** Dấu đánh trong tập văn bản khi đường dẫn dựng trên một thư mục tạm. */
export const SANDBOX = '\0sandbox'

const SOURCE_PATH = /^(app|server|scripts|shared)(\/|$)/
const OTHER_PATH = /^(\.github\/|\.dockerignore|\.env\.example|\.gitignore|Dockerfile|docker-compose|nuxt\.config|production(\/|$)|package(-lock)?\.json|tsconfig|eslint\.config|playwright\.config|tailwind\.config|CLAUDE\.md|CI-CD\.md|README\.md|docs\/|migrations\/|public\/|tests\/)/
const OTHER_FILE = /^(Dockerfile|\.dockerignore|\.env\.example|\.gitignore)/
const FILE_EXT = /\.(vue|[cm]?[jt]s|sh|sql|json|ya?ml|css|html|md)$/

export function normalizeText(text: string): string {
  let s = text.replace(/\\/g, '/').replace(/^file:\/\//, '').replace(/^(HEAD|[0-9a-f]{7,40})[^:\s]*:/, '')
  for (let prev = ''; prev !== s;) {
    prev = s
    s = s.replace(/^(\.\.?|\*)\//, '').replace(/^\/+/, '')
  }
  return s
}

const trimDir = (t: string) => t.replace(/\*$/, '').replace(/\/+$/, '')

/** Văn bản thô → đường dẫn nguồn / tệp khác của repo, sắp xếp, thư mục đã có tệp con thì bỏ. */
export function resolvePaths(texts: Iterable<string>): { source: string[], other: string[] } {
  const all = [...texts]
  if (all.includes(SANDBOX)) return { source: [], other: [] }
  const source = new Set<string>()
  const other = new Set<string>()
  const dirs: string[] = []
  const otherDirs: string[] = []
  const rels: string[] = []
  for (const raw of all) {
    const t = normalizeText(raw)
    if (!t || t === '*' || /\s/.test(t)) continue
    const isFile = FILE_EXT.test(t)
    if (SOURCE_PATH.test(t)) {
      if (isFile) source.add(t)
      else dirs.push(trimDir(t))
    } else if (OTHER_PATH.test(t)) {
      if (isFile || OTHER_FILE.test(t)) other.add(t)
      else otherDirs.push(trimDir(t))
    } else if (isFile && !t.startsWith('*')) rels.push(t)
  }
  const join = (list: string[], into: Set<string>) => {
    for (const dir of list) {
      if (rels.length === 0) into.add(`${dir}/`)
      for (const rel of rels) into.add(`${dir}/${rel}`)
    }
  }
  join(dirs, source)
  join(otherDirs, other)
  const prune = (set: Set<string>) => [...set].sort().filter((p, _, list) => !p.endsWith('/') || !list.some(q => q !== p && q.startsWith(p)))
  return { source: prune(source), other: prune(other) }
}
