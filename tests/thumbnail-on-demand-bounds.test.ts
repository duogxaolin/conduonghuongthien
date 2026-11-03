import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import type { ProcessRunner } from '../server/services/video-processing'
import { createOnDemandThumbnailExtractor } from '../server/services/thumbnail-on-demand'

/**
 * On-demand video thumbnail fallback is bounded (spec video-thumbnails, design D19).
 *
 * `GET /api/public/media/<id>/thumb` is public and unauthenticated. When a
 * published upload had no thumbnail it spawned FFmpeg on EVERY request: no
 * sharing between concurrent requests, no time limit, no memory of failure — a
 * list page of ten cards fired ten FFmpeg runs, and a corrupt file was re-tried
 * on every view forever. Now: one run per video at a time, at most two across
 * all videos, 15 s and SIGKILL, failure remembered 10 minutes, partial output
 * removed. Driven through a fake `ProcessRunner` (the process edge).
 */

const dir = mkdtempSync(path.join(tmpdir(), 'cdkt-thumb-bounds-'))
after(() => rmSync(dir, { recursive: true, force: true }))
/** A fresh `<dir>/<name>/thumb.jpg` target whose folder exists and is empty. */
function prepare(name: string) {
  const folder = path.join(dir, name)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  return path.join(folder, 'thumb.jpg')
}

/** The last argument FFmpeg is given is the output file. */
const outputOf = (args: string[]) => args[args.length - 1]!

test('ten concurrent requests for one video start exactly one extraction', async () => {
  let spawns = 0
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  const run: ProcessRunner = async (_command, args) => {
    spawns += 1
    await gate
    writeFileSync(outputOf(args), 'jpeg')
    return { code: 0, stdout: '', stderr: '' }
  }
  const extractor = createOnDemandThumbnailExtractor({ run })
  const target = prepare('ten')
  const results = Array.from({ length: 10 }, () => extractor.extract(target, '/x/original.mp4', target))
  await new Promise(resolve => setImmediate(resolve))
  finish()
  assert.deepEqual(await Promise.all(results), Array(10).fill(true))
  assert.equal(spawns, 1, 'every concurrent request spawned its own FFmpeg')
  assert.equal(readFileSync(target, 'utf8'), 'jpeg')

  // Once settled, the slot is free again: the next miss (thumb deleted) runs anew.
  rmSync(target)
  assert.equal(await extractor.extract(target, '/x/original.mp4', target), true)
  assert.equal(spawns, 2)
})

test('a hung run is aborted at the time limit, its partial file removed, and the failure remembered', async () => {
  let signalSeen: AbortSignal | null = null
  let spawns = 0
  const run: ProcessRunner = (_command, args, { signal }) => {
    spawns += 1
    signalSeen = signal
    writeFileSync(outputOf(args), 'half a jpe')
    // Behaves like `defaultProcessRunner`: settles only when the signal kills it.
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ code: -1, stdout: '', stderr: 'killed' }), { once: true })
    })
  }
  let clock = 1_000_000
  const extractor = createOnDemandThumbnailExtractor({ run, timeoutMs: 40, now: () => clock })
  const target = prepare('hung')

  const started = Date.now()
  assert.equal(await extractor.extract(target, '/x/original.mp4', target), false)
  assert.ok(Date.now() - started < 5_000, 'the run was not cut off by the time limit')
  assert.ok(signalSeen && (signalSeen as AbortSignal).aborted, 'the runner never received the abort that kills FFmpeg')
  assert.equal(existsSync(target), false, 'a partial thumb.jpg would be served as the thumbnail next time')

  // Remembered: a minute later, no new process, placeholder for the caller.
  clock += 60_000
  assert.equal(await extractor.extract(target, '/x/original.mp4', target), false)
  assert.equal(spawns, 1, 'a failed video was retried on the next request')
})

test('a failed extraction is remembered for 10 minutes, then retried once', async () => {
  let spawns = 0
  const run: ProcessRunner = async () => {
    spawns += 1
    return { code: 1, stdout: '', stderr: 'moov atom not found' }
  }
  let clock = 5_000_000
  const extractor = createOnDemandThumbnailExtractor({ run, now: () => clock })
  const target = prepare('corrupt')

  assert.equal(await extractor.extract(target, '/x/broken.mp4', target), false)
  clock += 9 * 60_000
  assert.equal(await extractor.extract(target, '/x/broken.mp4', target), false)
  assert.equal(spawns, 1)
  clock += 60_000 + 1
  assert.equal(await extractor.extract(target, '/x/broken.mp4', target), false)
  assert.equal(spawns, 2, 'the failure was remembered forever')
})

test('at most two extractions run at once across all videos', async () => {
  let running = 0
  let peak = 0
  const releases: Array<() => void> = []
  const run: ProcessRunner = async (_command, args) => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise<void>((resolve) => { releases.push(resolve) })
    writeFileSync(outputOf(args), 'jpeg')
    running -= 1
    return { code: 0, stdout: '', stderr: '' }
  }
  const extractor = createOnDemandThumbnailExtractor({ run })
  const targets = ['a', 'b', 'c', 'd', 'e'].map(prepare)
  const results = targets.map(target => extractor.extract(target, `/x/${target}.mp4`, target))

  // Drain one at a time; never more than two in flight.
  for (let settled = 0; settled < targets.length; settled += 1) {
    while (releases.length === 0) await new Promise(resolve => setImmediate(resolve))
    assert.ok(running <= 2, `${running} FFmpeg processes ran at once`)
    releases.shift()!()
  }
  assert.deepEqual(await Promise.all(results), Array(5).fill(true))
  assert.equal(peak, 2)
})

test('the public endpoint goes through the bounded extractor, never straight to FFmpeg', () => {
  const source = readFileSync(new URL('../server/api/public/media/[shortId]/thumb.get.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(source, /onDemandThumbnails\.extract\(/)
  assert.doesNotMatch(source, /extractThumbnailOnDemand\(/)
})
