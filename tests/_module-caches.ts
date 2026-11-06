/**
 * Dò các BỘ ĐỆM cấp module trong `server/**` — biến `let`/`const` ở đầu tệp giữ dữ liệu đọc từ
 * CSDL/cấu hình để dùng lại giữa các request. Dùng bởi `tests/in-process-cache-registry.test.ts`.
 *
 * Một biến là bộ đệm khi (a) tên có "cache" (không phân biệt hoa thường), hoặc (b) kiểu/giá trị đầu
 * mang trường thời hạn (`expires`, `expiresAt`, `loadedAt`, `at`) — dạng `{ data, at }` của
 * `publishedEntries`. Hằng số cấu hình (`const X = new Set([...])` với giá trị cố định) không tính:
 * chỉ `new Map()`/`new Set()` RỖNG, hoặc `let`, mới là trạng thái thay đổi theo thời gian.
 *
 * Vì sao cần: lỗi 2026-11-06 — bộ đệm 60 s của kho kiến thức và của gateway AI không biết phiên bản
 * cache câu trả lời, nên câu dựng từ dữ liệu cũ được ghi dưới khoá mới. Không ai phải nhớ "bộ đệm này
 * bị làm mới bằng gì": sổ đăng ký buộc trả lời câu đó lúc thêm bộ đệm.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const ROOT = path.resolve(import.meta.dirname, '..')

const TIMESTAMP_FIELD = /\b(?:expires|expiresAt|loadedAt|fetchedAt|cachedAt|storedAt|refreshedAt|validUntil|at)\s*[:?]/
/**
 * Bộ đệm mà tên lẫn hình dạng đều không lộ ra (heuristic không thể thấy) — có tên ở đây để vẫn phải vào sổ.
 * Giới hạn nói rõ: một bộ đệm mới đặt tên kiểu `snapshot`, không mang trường thời hạn, vẫn lọt bộ dò; người
 * review phải thêm nó vào đây.
 */
const KNOWN_UNNAMED_CACHES = new Set(['server/services/moderation-regex-check.ts#compiled'])

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

function isEmptyCollection(node: ts.Expression | undefined): boolean {
  return Boolean(node && ts.isNewExpression(node) && ts.isIdentifier(node.expression)
    && ['Map', 'Set', 'WeakMap'].includes(node.expression.text) && (node.arguments?.length ?? 0) === 0)
}

export interface ModuleCache {
  /** `server/…/file.ts#name` */
  id: string
  line: number
}

/** Mọi bộ đệm cấp module trong `server/` (đã sắp xếp theo id). */
export function moduleCaches(sourceOverrides?: ReadonlyMap<string, string>): ModuleCache[] {
  const found: ModuleCache[] = []
  const all = files(path.join(ROOT, 'server'))
  for (const extra of sourceOverrides?.keys() ?? []) if (!all.includes(extra)) all.push(extra)
  for (const file of all) {
    const text = sourceOverrides?.get(file) ?? readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const mutable = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const name = declaration.name.text
        const collection = isEmptyCollection(declaration.initializer)
        const rel = path.relative(ROOT, file).split(path.sep).join('/')
        const named = /cache/i.test(name)
        if (KNOWN_UNNAMED_CACHES.has(`${rel}#${name}`)) {
          found.push({ id: `${rel}#${name}`, line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1 })
          continue
        }
        // `const` có tên "cache" là bộ đệm dù khởi tạo thế nào (`{}`, `[]`, `new Map([...])`); `const` khác chỉ tính
        // khi là collection RỖNG (trạng thái lớn dần) — hằng số cấu hình có giá trị cố định thì không.
        const containerInit = Boolean(declaration.initializer && (ts.isObjectLiteralExpression(declaration.initializer)
          || ts.isArrayLiteralExpression(declaration.initializer) || ts.isNewExpression(declaration.initializer)))
        const constant = /^[A-Z0-9_]+$/.test(name)
        if (!mutable && !collection && !(named && containerInit && !constant)) continue
        if (!mutable && !collection && constant) continue
        const typeText = declaration.type?.getText(source) ?? ''
        const timed = TIMESTAMP_FIELD.test(typeText)
          || Boolean(declaration.initializer && TIMESTAMP_FIELD.test(declaration.initializer.getText(source)))
        if (!named && !timed) continue
        found.push({ id: `${rel}#${name}`, line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1 })
      }
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id))
}
