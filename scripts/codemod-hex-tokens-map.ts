/**
 * The mapping tables of `scripts/codemod-hex-tokens.ts` and the shapes of its result
 * (wave3-long-term D-TOKENS; merges: decision D-T1, task 3.7): which hex becomes which token,
 * exactly (`shared/color-tokens.ts`) or by an approved merge (`shared/color-merges.ts`), and
 * which tokens may never colour a focus indicator.
 *
 * Imports nothing from the codemod: the codemod imports this module, never the reverse.
 */
import { DECORATIVE_ONLY_TOKENS } from '../shared/color-tokens.ts'
import type { SourceKind } from './codemod-hex-tokens-reach.ts'

export type LeaveReason = 'unmapped' | 'indicator' | 'alpha' | 'invalid' | 'suffix' | 'style' | 'type-hint' | 'no-colour-prefix' | 'order' | 'order-merge'
/** One approved merge (shared/color-merges.ts): the token a differing hex folds into, and by how much it changes. */
export interface MergeEntry { readonly token: string; readonly dE: number; readonly rule?: string }
/**
 * `dE` is set on every rewrite of a run with merges: the entry's ΔE for a merged hex (with
 * its `rule`), 0 for an exact match. A run without merges leaves both unset.
 */
export interface Rewrite { index: number; from: string; to: string; value: string; token: string; dE?: number; rule?: string }
/** `via` / `partner` (order-merge only): how the other class reaches the element, and its text. */
export interface LeftAlone { index: number; text: string; value: string; reason: LeaveReason; via?: SourceKind; partner?: string }
export interface RewriteResult { output: string; rewrites: Rewrite[]; leftAlone: LeftAlone[] }

/** Token table → `#rrggbb` (lowercase) → token. Refuses anything the codemod could not map exactly. */
export function buildHexMap(tokens: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [token, value] of Object.entries(tokens)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`token ${token}: ${value} is not a 6-digit hex`)
    const key = value.toLowerCase()
    const other = map.get(key)
    if (other) throw new Error(`tokens ${other} and ${token} share ${key} — the codemod cannot choose a name`)
    map.set(key, token)
  }
  return map
}

/**
 * Merge table → `#rrggbb` → entry. Refuses an entry the codemod could not apply as reviewed:
 * a key that is not lowercase 6-digit hex, a target that is not a token, a hex that is
 * already a token's exact value, or a ΔE that is not a positive number.
 */
export function buildMergeMap(tokens: Readonly<Record<string, string>>, merges: Readonly<Record<string, MergeEntry>>): Map<string, MergeEntry> {
  const exact = buildHexMap(tokens)
  const map = new Map<string, MergeEntry>()
  for (const [hex, entry] of Object.entries(merges)) {
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`merge ${hex}: not a lowercase 6-digit hex`)
    if (!Object.hasOwn(tokens, entry.token)) throw new Error(`merge ${hex}: ${entry.token} is not a token`)
    const own = exact.get(hex)
    if (own) throw new Error(`merge ${hex}: already the exact value of ${own}`)
    if (!(typeof entry.dE === 'number' && entry.dE > 0 && Number.isFinite(entry.dE))) throw new Error(`merge ${hex}: ΔE ${entry.dE} is not a positive number`)
    map.set(hex, entry)
  }
  return map
}

const DECORATIVE_ONLY: ReadonlySet<string> = new Set(DECORATIVE_ONLY_TOKENS)

/**
 * Whether `token` may not be written here: a decorative-only token (DECORATIVE_ONLY_TOKENS,
 * under 3:1 on white) as a focus indicator's colour — any ring or outline, or any colour
 * under a focus variant (`focus:`, `focus-visible:`, `group-focus-within/x:`…), the same set
 * tests/focus-ring-no-secondary-green.test.ts forbids.
 */
export const isForbiddenIndicator = (token: string, prefix: string, variants: string) =>
  DECORATIVE_ONLY.has(token) && (prefix === 'ring' || prefix === 'outline' || /focus/.test(variants))
