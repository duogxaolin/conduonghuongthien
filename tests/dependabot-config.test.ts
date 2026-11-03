import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * .github/dependabot.yml — weekly, grouped, capped update PRs for the three
 * ecosystems this repository pins: npm (package-lock.json), the GitHub Actions in
 * the workflows, and the base image of the app Dockerfile.
 *
 * Every merge to `main` deploys, so the configuration keeps the PR count low
 * (minor + patch grouped per ecosystem, at most 5 open) and CI-CD.md tells the
 * operator to merge them in one batch. A file GitHub cannot parse disables
 * Dependabot silently, so it is read here as YAML.
 */

type Update = {
  'package-ecosystem'?: string
  directory?: string
  schedule?: { interval?: string }
  'open-pull-requests-limit'?: number
  groups?: Record<string, { 'update-types'?: string[] }>
  ignore?: Array<{ 'dependency-name'?: string; 'update-types'?: string[] }>
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('dependabot covers npm, github-actions and docker weekly, grouped, at most 5 open PRs each', async () => {
  const { default: yaml } = await import('js-yaml')
  const config = yaml.load(read('.github/dependabot.yml')) as {
    version?: number
    updates?: Update[]
  }
  assert.equal(config.version, 2)
  const updates = config.updates ?? []
  assert.deepEqual(updates.map((u) => u['package-ecosystem']).sort(), [
    'docker',
    'github-actions',
    'npm',
  ])
  for (const update of updates) {
    const name = update['package-ecosystem']
    assert.equal(update.directory, '/', `${name}: directory`)
    assert.equal(update.schedule?.interval, 'weekly', `${name}: not weekly`)
    assert.equal(update['open-pull-requests-limit'], 5, `${name}: PR limit`)
    const groups = Object.values(update.groups ?? {})
    assert.ok(
      groups.some(
        (group) =>
          JSON.stringify([...(group['update-types'] ?? [])].sort()) === '["minor","patch"]',
      ),
      `${name}: minor and patch updates are not grouped into one PR`,
    )
  }
  // The runtime base is `node:<LTS>-alpine`; a major bump is a Node upgrade
  // (engines, CI NODE_VERSION) a human decides, not a weekly PR.
  const docker = updates.find((u) => u['package-ecosystem'] === 'docker')!
  assert.ok(
    docker.ignore?.some(
      (rule) =>
        rule['dependency-name'] === 'node' &&
        rule['update-types']?.includes('version-update:semver-major'),
    ),
    'docker: node major updates are not ignored',
  )
})

test('CI-CD.md tells the operator to merge Dependabot PRs in one batch', () => {
  const doc = read('CI-CD.md')
  assert.match(doc, /Dependabot/)
  assert.match(doc, /\.github\/dependabot\.yml/)
  assert.match(doc, /một lượt|gộp|cùng lúc/i)
})
