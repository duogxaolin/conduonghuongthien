import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * From 2026-10-23 the runner's pre-configured apt mirror (azure.archive.ubuntu.com)
 * made `apt-get install ffmpeg` take up to 20 minutes (it took 20–60 s on
 * 2026-10-14): integration jobs and the build job were cancelled at their job
 * timeout with every test green, and a merge to `main` did not deploy. These pin
 * the CI shape that keeps a slow mirror from cancelling the pipeline.
 */
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const job = (name: string) => new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n)`).exec(workflow)?.[1] ?? ''

test('integration jobs do not install FFmpeg — no integration suite runs the real binary', () => {
  assert.ok(job('integration-tests').length > 0, 'integration-tests job found')
  assert.doesNotMatch(job('integration-tests'), /apt-get[^\n]*ffmpeg/)
})

test('where FFmpeg is installed, the step is bounded, retried and trimmed', () => {
  for (const name of ['unit-tests', 'build']) {
    const body = job(name)
    const step = /- name: Install FFmpeg\n([\s\S]*?)(?=\n {6}(?:- |#))/.exec(body)?.[1] ?? ''
    assert.ok(step, `${name}: Install FFmpeg step found`)
    assert.match(step, /timeout-minutes: \d+/, `${name}: the step has its own timeout`)
    assert.match(step, /--no-install-recommends ffmpeg/, `${name}: only required packages`)
    assert.match(step, /for mirror in default archive\.ubuntu\.com/, `${name}: a second try on another mirror`)
    // ubuntu-24.04 runners name the mirror in apt-mirrors.txt (`URIs: mirror+file:…`):
    // a sed over sources.list alone changes nothing there.
    assert.match(step, /sed -i 's\|azure\\\.archive\\\.ubuntu\\\.com\|archive\.ubuntu\.com\|g' \/etc\/apt\/apt-mirrors\.txt/, `${name}: the switch edits apt-mirrors.txt`)
    // A stalled mirror hangs first in `update`: bounded too.
    assert.match(step, /timeout -k \d+ \d+ sudo -E apt-get \$APT_OPTS update/, `${name}: bounded update`)
    // Only the download is time-bounded: killing dpkg mid-install breaks every later try.
    assert.match(step, /timeout -k \d+ \d+ sudo -E apt-get \$APT_OPTS install -y -qq --download-only/, `${name}: bounded download`)
  }
})

test('the build job bounds Playwright\'s own apt step too', () => {
  assert.match(job('build'), /- name: Install Chromium\n {8}timeout-minutes: \d+/)
})

test('the build job leaves room for both bounded apt steps plus build and e2e', () => {
  // FFmpeg (12) + Chromium (8) + setup/build/e2e (~14) — 25 minutes cut green runs.
  const timeout = Number(/^ {4}timeout-minutes: (\d+)/m.exec(job('build'))?.[1])
  assert.ok(timeout >= 35, `build job timeout ${timeout}`)
})
