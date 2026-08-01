/**
 * Reduce a raw user-agent string to a short, readable label.
 *
 * Deliberately crude. The goal is "cán bộ nhìn một cái là biết khách dùng gì" —
 * not device fingerprinting. A precise parser would need a maintained pattern
 * database, and being wrong about Chrome 131 vs 132 changes nothing about the
 * only question this column answers: is this a normal browser or something odd?
 *
 * The raw string stays in the database, so nothing is lost by summarising here.
 */

const BROWSERS: Array<[pattern: RegExp, label: string]> = [
  // Order matters: every Chromium browser also claims "Chrome", and Chrome
  // itself claims "Safari". Most specific first.
  [/\bEdg(?:e|A|iOS)?\//i, 'Edge'],
  [/\bOPR\/|\bOpera\//i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bCriOS\//i, 'Chrome (iOS)'],
  [/\bFxiOS\//i, 'Firefox (iOS)'],
  [/\bFirefox\//i, 'Firefox'],
  [/\bChrome\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
  [/\bcurl\/|\bwget\/|\bpython-requests\/|\bGo-http-client\/|\bokhttp\//i, 'Công cụ dòng lệnh'],
  [/\bbot\b|\bspider\b|\bcrawler\b/i, 'Bot'],
]

const PLATFORMS: Array<[pattern: RegExp, label: string]> = [
  [/\bAndroid\b/i, 'Android'],
  [/\biPhone\b/i, 'iPhone'],
  [/\biPad\b/i, 'iPad'],
  [/\bWindows NT\b/i, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
]

function firstMatch(list: Array<[RegExp, string]>, value: string): string | null {
  for (const [pattern, label] of list) {
    if (pattern.test(value)) return label
  }
  return null
}

/**
 * @returns e.g. `"Chrome · Windows"`, `"Safari · iPhone"`, `"Bot"`, or
 *          `"Không rõ"` when the header was absent or unrecognisable.
 */
export function summarizeUserAgent(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return 'Không rõ'

  const browser = firstMatch(BROWSERS, value)
  const platform = firstMatch(PLATFORMS, value)

  if (browser && platform) return `${browser} · ${platform}`
  if (browser) return browser
  if (platform) return platform

  // Unknown agent: show a clipped prefix instead of hiding it. An unrecognised
  // string is the interesting case, and "Không rõ" would erase the only clue.
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}
