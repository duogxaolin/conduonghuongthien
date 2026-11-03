import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Layer order of the runtime image, and who owns what in it.
 *
 * Every deploy pulls the layers that changed. The runtime stage used to run
 * `apk add ffmpeg …` (175 MB) and `chown -R node:node /app` (a 204 MB copy of
 * node_modules + .output + public, measured with `docker history`) AFTER the
 * app COPYs, so both layers were rebuilt — new digest, full re-pull on the VPS —
 * on every commit, docs included. The OS packages now come first, ownership is
 * set by `COPY --chown` as the files land, and only the empty mount points are
 * chowned. The entrypoint and deploy-remote.sh chown a volume only when its root
 * is not already `node`'s, instead of walking a multi-gigabyte uploads tree on
 * every start and every deploy.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** Runtime stage instructions, with `\`-continued lines joined and comments dropped. */
function runtimeInstructions(): string[] {
  const dockerfile = read('Dockerfile')
  const stage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
  return stage
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => /^[A-Z]+ /.test(line))
}

// `./shared`: server/ code imports values from it (tests/runtime-image-sources.test.ts
// proves which directories the container's TypeScript needs).
const APP_COPIES = ['./.output', './server', './shared', './scripts', './public']

test('OS packages are installed before the first app COPY, so their layers stay cached', () => {
  const lines = runtimeInstructions()
  const firstAppCopy = lines.findIndex(
    (line) => line.startsWith('COPY ') && APP_COPIES.some((dest) => line.endsWith(` ${dest}`)),
  )
  assert.ok(firstAppCopy > 0, 'no app COPY found in the runtime stage')
  for (const pkg of ['ffmpeg', 'tzdata']) {
    const at = lines.findIndex((line) => line.startsWith('RUN apk add') && line.includes(pkg))
    assert.ok(at >= 0, `${pkg} is not installed`)
    assert.ok(
      at < firstAppCopy,
      `${pkg} is installed after the app is copied — its layer is rebuilt on every commit`,
    )
  }
  // The npm install depends on package*.json only: it sits before the app COPYs too.
  const npm = lines.findIndex((line) => line.startsWith('RUN npm ci'))
  assert.ok(npm >= 0 && npm < firstAppCopy, 'npm ci runs after the app is copied')
})

test('the app files are owned by node as they are copied — no recursive chown of /app', () => {
  const lines = runtimeInstructions()
  for (const dest of APP_COPIES) {
    const copy = lines.find((line) => line.startsWith('COPY ') && line.endsWith(` ${dest}`))
    assert.ok(copy, `no COPY to ${dest}`)
    assert.match(copy, /--chown=node:node/, `${dest} is copied as root`)
  }
  const pkg = lines.find((line) => line.startsWith('COPY ') && line.includes('package*.json'))
  assert.match(pkg ?? '', /--chown=node:node/, 'package*.json is copied as root')

  for (const line of lines.filter((l) => l.startsWith('RUN '))) {
    // `chown -R … /app` (or /app/<anything>) duplicates every file under it into a
    // new layer. Only empty directories may be chowned, and never recursively.
    assert.doesNotMatch(
      line,
      /chown\s+(-[a-zA-Z]*R[a-zA-Z]*\s+|--recursive\s+)/,
      `recursive chown in the image: ${line}`,
    )
  }

  // node_modules is written by `npm ci` itself running as node — the ownership
  // the old recursive chown produced, without a second copy of it.
  const npmAt = lines.findIndex((line) => line.startsWith('RUN npm ci'))
  const userBefore = lines
    .slice(0, npmAt)
    .filter((line) => line.startsWith('USER '))
    .at(-1)
  assert.equal(userBefore, 'USER node', 'npm ci runs as root, so node_modules is root-owned')
  // …and the image still starts as root: the entrypoint must fix bind-mount
  // ownership before it drops to node with su-exec.
  assert.equal(lines.filter((line) => line.startsWith('USER ')).at(-1), 'USER root')
})

test('only the empty mount points (and /app itself, not its contents) are chowned', () => {
  const lines = runtimeInstructions()
  const chown = lines.find((line) => line.startsWith('RUN ') && /\bchown node:node /.test(line))
  assert.ok(chown, 'the mount points are never handed to node')
  const targets = chown
    .slice(chown.indexOf('chown node:node ') + 'chown node:node '.length)
    .split(/\s+/)
    .filter(Boolean)
  for (const dir of [
    '/app',
    '/app/public/uploads',
    '/app/backups',
    '/var/lib/cdkt',
    '/var/lib/cdkt/media',
  ]) {
    assert.ok(targets.includes(dir), `${dir} is not handed to node`)
  }
  const mkdirAt = lines.findIndex(
    (line) => line.startsWith('RUN mkdir') && line.includes('/var/lib/cdkt/media'),
  )
  const firstAppCopy = lines.findIndex(
    (line) => line.startsWith('COPY ') && APP_COPIES.some((dest) => line.endsWith(` ${dest}`)),
  )
  assert.ok(
    mkdirAt >= 0 && mkdirAt < firstAppCopy,
    'the mount points are created after the app files (they would not be empty)',
  )
})

test("the entrypoint chowns a mounted tree only when its root is not node's", () => {
  const entrypoint = read('docker-entrypoint.sh')
  assert.match(entrypoint, /stat -c %U "\$d"/, 'the entrypoint chowns every tree on every start')
  assert.match(entrypoint, /!= node \]/)
  // The media volume is mounted at /var/lib/cdkt/media, below the image-owned
  // /var/lib/cdkt: checking only the parent would never fix the volume itself.
  assert.match(entrypoint, /\/var\/lib\/cdkt\/media/)
  assert.match(entrypoint, /exec su-exec node "\$@"/)

  const deploy = read('scripts/deploy-remote.sh')
  const fn = /^fix_uploads_ownership\(\) \{\n([\s\S]*?)\n\}/m.exec(deploy)?.[1] ?? ''
  assert.match(
    fn,
    /stat -c %U \/app\/public\/uploads/,
    'deploy-remote.sh chowns uploads on every deploy',
  )
  assert.match(fn, /if \[ "\$owner" = node \]; then/)
  assert.doesNotMatch(fn, /compose run/, 'a one-off container per deploy just to look at an owner')
})
