import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * `server/services/backup.ts` was ONE 733-line file until 2026-10-25; it is now a
 * barrel that re-exports from six parts. Source guards that used to read that one file
 * (the trigger literals, the single `backupsDir()` default, its audited writes) read
 * the WHOLE family through here — moving code between the parts can never take it out
 * of a guard's sight.
 *
 * The family is derived, not listed by hand: the barrel plus every `./<file>` it
 * re-exports from. Two checks keep that derivation honest:
 *  - it must equal `EXPECTED_BACKUP_FAMILY` — a parse that finds nothing, or a part that
 *    was renamed, is a red test rather than a guard silently reading nothing;
 *  - every OTHER `server/services/backup*.ts` must be a named sibling that never was part
 *    of `backup.ts` — a new part that the barrel does not re-export cannot hide.
 */
const SERVICES = 'server/services'
export const BACKUP_BARREL = `${SERVICES}/backup.ts`
export const EXPECTED_BACKUP_FAMILY: readonly string[] = [
  'backup.ts', 'backup-catalog.ts', 'backup-locks.ts', 'backup-names.ts', 'backup-rotation.ts', 'backup-run.ts', 'backup-sweep.ts',
]
/** Files that share the prefix but were their own modules before the split. */
const BACKUP_SIBLINGS: readonly string[] = [
  'backup-drive.ts', 'backup-drive-oauth.ts', 'backup-drive-oauth-config.ts', 'backup-offsite.ts', 'backup-registry.ts',
  'backup-restore.ts', 'backup-restore-guards.ts', 'backup-restore-recovery.ts', 'backup-scheduler.ts', 'backup-sql.ts',
]

const repoUrl = (relative: string) => new URL(`../${relative}`, import.meta.url)

/** Every module specifier the barrel names, whatever its form (`export {…}`, `export type {…}`, `export *`, `import`). */
function barrelSpecifiers(barrel: string): { reExports: string[], all: string[] } {
  const reExports = [...barrel.matchAll(/^export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm)].map(match => match[1]!)
  const all = [...barrel.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)].map(match => (match[1] ?? match[2])!)
  return { reExports, all }
}

/** Repo-relative paths (`server/services/…`) of the barrel and every part, sorted. */
export function backupServiceFiles(): string[] {
  const barrel = readFileSync(repoUrl(BACKUP_BARREL), 'utf8')
  // The barrel re-exports from its own parts and nothing else: a source outside
  // `./backup-*` (`../utils/backup-x`, a sibling like `./media`) would never be read by
  // the guards below — the family is derived from these specifiers.
  const { reExports, all } = barrelSpecifiers(barrel)
  assert.ok(reExports.length > 0, 'no re-export found in the backup barrel — the parser no longer matches it')
  assert.deepEqual(all.filter(source => !reExports.includes(source)), [], 'the backup barrel imports something — it may only re-export')
  assert.deepEqual(reExports.filter(source => !/^\.\/backup-[\w-]+$/.test(source)), [], 'the backup barrel re-exports from outside its own parts (every source must be ./backup-*)')
  const parts = reExports.map(source => `${source.slice(2)}.ts`)
  const family = [...new Set(['backup.ts', ...parts])].sort()
  assert.deepEqual(family, [...EXPECTED_BACKUP_FAMILY].sort(), 'the backup barrel re-exports from a different set of files — update EXPECTED_BACKUP_FAMILY (and check every guard that reads the family)')
  const onDisk = readdirSync(repoUrl(SERVICES)).filter(name => /^backup(-[\w-]+)?\.ts$/.test(name)).sort()
  for (const name of family) assert.ok(onDisk.includes(name), `${name} is re-exported by the barrel but does not exist`)
  const unclassified = onDisk.filter(name => !family.includes(name) && !BACKUP_SIBLINGS.includes(name))
  assert.deepEqual(unclassified, [], 'a server/services/backup*.ts file is neither re-exported by the backup.ts barrel nor a named sibling — classify it in tests/_backup-service-family.ts')
  return family.map(name => `${SERVICES}/${name}`)
}

/** Absolute path of a repo-relative file (for guards that walk `server/` by absolute path). */
export const absoluteRepoPath = (relative: string): string => repoUrl(relative).pathname

/** The text of the whole family — what used to be the single `backup.ts`. */
export function backupServiceSource(): string {
  return backupServiceFiles().map(file => readFileSync(repoUrl(file), 'utf8')).join('\n')
}
