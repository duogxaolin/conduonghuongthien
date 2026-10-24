/**
 * Mẫu khớp DOMAIN cho lượt đổi domain R2 (`media-repoint.ts`, wave2 D-REPOINT) — tách
 * khỏi `media-sync-url-match.ts` (W6) nhưng dùng CÙNG định nghĩa ranh giới phải
 * (`RIGHT_BOUNDARY`) và cùng cách thoát chuỗi của tệp đó.
 *
 * Khớp một domain (host, có thể kèm tiền tố đường dẫn `cdn.x.vn/media`) trong mọi URL
 * trỏ tới nó:
 *   - BÊN TRÁI là đúng `scheme://` (`https://`, `http://`; cột `json` thêm dạng thoát
 *     `https:\/\/`): `https://xold.cdn/…` (host khác) và `//old.cdn/…` không khớp;
 *   - BÊN PHẢI là `/` (đầu đường dẫn) hoặc `RIGHT_BOUNDARY`: `https://old.cdn.evil/…`,
 *     `https://old.cdn:8443/…`, `https://old.cdnx/…` không khớp. `/` phải nêu riêng vì
 *     nó thuộc `CONT_CORE` — `RIGHT_BOUNDARY` một mình coi nó là đường dẫn nối tiếp;
 *   - **scheme + host KHÔNG phân biệt hoa thường** (W1): `HTTPS://OLD.CDN/…` là cùng một
 *     host — bản trước để nguyên và báo "đã đổi 0 hàng". Tiền tố đường dẫn (và mọi thứ
 *     sau nó) VẪN phân biệt hoa thường, như URL thật. Viết bằng lớp ký tự
 *     (`[oO][lL][dD]`) thay cho cờ nội tuyến `(?i:…)`: chạy giống nhau trên ICU (MySQL 8),
 *     PCRE (MariaDB) và engine JS của test, mẫu vẫn mở đầu bằng `(?-i)` để collation
 *     `_ci` không làm cả đường dẫn thành không phân biệt hoa thường.
 * Mỗi scheme một dạng, scheme mới viết thẳng trong chuỗi thay (không dùng tham chiếu
 * nhóm `$1`, khác nhau giữa ICU và PCRE). Chuỗi thay luôn là scheme chữ thường.
 *
 * Domain đầu vào phải đã chuẩn hoá (`normalizeRepointDomain`: host chữ thường /
 * punycode, không scheme, không `/` cuối).
 */
import {
  RIGHT_BOUNDARY,
  escapeRegex,
  escapeRegexReplacement,
  jsonInner,
  likeContains,
  type ReferenceKind,
} from './media-sync-url-match'

export interface DomainRepointForm {
  /**
   * Lọc thô `LIKE`, CHỮ THƯỜNG — so với `LOWER(văn bản cột)`, nên khớp mọi kiểu viết
   * hoa của scheme/host. Mẫu REGEXP mới quyết định.
   */
  like: string
  /** Mẫu REGEXP có ranh giới (MySQL 8 ICU / PCRE). */
  pattern: string
  /** Chuỗi thay thế cho REGEXP_REPLACE (đã thoát `$`, `\`). */
  replacement: string
}

const REPOINT_SCHEMES = ['https://', 'http://'] as const

/** Mẫu khớp `s` không phân biệt hoa thường, chỉ bằng lớp ký tự cho chữ ASCII. */
function caseInsensitive(s: string): string {
  return [...s].map(ch => (/[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : escapeRegex(ch))).join('')
}

/** `host[/tiền tố]` → phần host (không phân biệt hoa thường) và phần đường dẫn (có phân biệt). */
function splitDomain(domain: string): { host: string; path: string } {
  const slash = domain.indexOf('/')
  return slash === -1 ? { host: domain, path: '' } : { host: domain.slice(0, slash), path: domain.slice(slash) }
}

function domainForm(scheme: string, old: { host: string; path: string }, next: string): DomainRepointForm {
  const oldText = `${scheme}${old.host}${old.path}`
  return {
    like: likeContains(oldText.toLowerCase()),
    pattern: `(?-i)${caseInsensitive(`${scheme}${old.host}`)}${escapeRegex(old.path)}(?:(?=/)|${RIGHT_BOUNDARY})`,
    replacement: escapeRegexReplacement(next),
  }
}

/**
 * Mọi dạng văn bản của `scheme://<domain cũ>` trong một loại cột, kèm dạng mới
 * tương ứng. `oldDomain`/`newDomain` đã chuẩn hoá.
 */
export function domainRepointForms(kind: ReferenceKind, oldDomain: string, newDomain: string): DomainRepointForm[] {
  const out: DomainRepointForm[] = []
  const old = splitDomain(oldDomain)
  for (const scheme of REPOINT_SCHEMES) {
    const next = `${scheme}${newDomain}`
    if (kind === 'text') {
      out.push(domainForm(scheme, old, next))
      continue
    }
    // Trong chuỗi JSON: dạng thô (MySQL chuẩn hoá `\/` → `/` khi lưu cột JSON), và dạng
    // thoát `\/` (chuỗi JSON lưu trong cột TEXT như `settings.value` giữ nguyên văn).
    const plain = { host: jsonInner(old.host), path: jsonInner(old.path) }
    out.push(domainForm(jsonInner(scheme), plain, jsonInner(next)))
    const slashed = (s: string) => s.replace(/\//g, '\\/')
    out.push(domainForm(slashed(jsonInner(scheme)), { host: plain.host, path: slashed(plain.path) }, slashed(jsonInner(next))))
  }
  return out
}
