// Fixture helper for tests/test-inventory.test.ts: a reader whose path comes from
// the caller, like tests/_render-sfc-template.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'

export function readSource(relative: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relative), 'utf8')
}
