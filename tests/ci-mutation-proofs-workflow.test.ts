import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

/**
 * `npm run test:mutations` proves the critical-invariant tests can still fail. Nothing ran it
 * on its own, so a weakened test could stay green indefinitely. It runs weekly in
 * `.github/workflows/mutation-proofs.yml` — and deliberately NOT on push/pull_request, where it
 * would lengthen every merge-to-main deploy. This pins both halves: it is scheduled and runs
 * the real command, and it is never wired to the events that would put it in the deploy path.
 */

interface Workflow {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  jobs: Record<string, { steps: Array<{ run?: string }> }>
}

const workflow = yaml.load(readFileSync('.github/workflows/mutation-proofs.yml', 'utf8')) as Workflow

test('the mutation catalog runs on a weekly schedule and by hand', () => {
  const schedule = workflow.on.schedule as Array<{ cron: string }> | undefined
  assert.ok(schedule?.length === 1, 'exactly one schedule')
  const fields = schedule[0]!.cron.split(' ')
  assert.equal(fields.length, 5)
  assert.match(fields[4]!, /^[0-6]$/, 'a single weekday — weekly, not daily')
  assert.ok('workflow_dispatch' in workflow.on, 'can be started by hand')
})

test('it is not on push or pull_request: a merge to main is a deploy, and this would slow every one', () => {
  for (const event of ['push', 'pull_request', 'pull_request_target', 'workflow_run']) {
    assert.ok(!(event in workflow.on), `${event} must not trigger the mutation workflow`)
  }
})

test('it runs the real command, read-only', () => {
  const runs = Object.values(workflow.jobs).flatMap(job => job.steps.map(step => step.run ?? ''))
  assert.ok(runs.some(run => run.trim() === 'npm run test:mutations'), 'a step runs `npm run test:mutations` as is')
  assert.deepEqual(workflow.permissions, { contents: 'read' }, 'no write permission: it never deploys or commits')
})
