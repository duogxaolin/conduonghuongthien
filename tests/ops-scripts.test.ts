import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, statSync } from 'node:fs'

/**
 * The operational scripts and the CI definition. They are not imported by the
 * app, so nothing else would notice them rotting.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ─── Backup ──────────────────────────────────────────────────────────────────
test('the backup script is executable and fails loudly', () => {
  const mode = statSync(new URL('../scripts/backup-db.sh', import.meta.url)).mode
  assert.ok(mode & 0o111, 'scripts/backup-db.sh is not executable, so cron cannot run it')
  assert.match(read('scripts/backup-db.sh'), /set -Eeuo pipefail/)
})

test('a backup is verified before it is trusted', () => {
  const script = read('scripts/backup-db.sh')
  // A dump that fails halfway leaves a plausible-looking file behind.
  assert.match(script, /Dump completed/, 'no completion marker check — a truncated dump would pass')
  assert.match(script, /gzip -t/, 'the archive is never integrity-checked')
  assert.match(script, /CREATE TABLE/, 'the table count is never checked')
  assert.match(script, /PLAIN_BYTES.*-ge/s, 'no size floor')
})

test('a rejected backup is deleted, not left looking valid', () => {
  // Found by running the script against a stubbed docker: a failed verification
  // used to leave the bad archive in the backup directory.
  assert.match(read('scripts/backup-db.sh'), /"\$1" == "verify".*rm -f "\$TARGET"/s)
})

test('the size floor is measured on the SQL, not on the compressed archive', () => {
  // Also found by running it: a highly repetitive dump compresses so well that a
  // threshold on the .gz size rejects a perfectly good backup.
  const script = read('scripts/backup-db.sh')
  assert.match(script, /PLAIN_BYTES="\$\(gzip -dc "\$TARGET" \| wc -c/)
  assert.doesNotMatch(script, /\[\[ "\$BYTES" -ge/, 'the floor is back on the compressed size')
})

test('two runs in the same second cannot collide', () => {
  assert.match(read('scripts/backup-db.sh'), /\$STAMP-\$\$\.sql\.gz/)
})

test('the database password never reaches the process list', () => {
  const script = read('scripts/backup-db.sh')
  assert.match(script, /-e MYSQL_PWD="\$MYSQL_ROOT_PASSWORD"/)
  // `-p<password>` on the command line is readable via `ps` by every local user.
  assert.doesNotMatch(script, /-p\$\{?MYSQL_ROOT_PASSWORD/)
})

test('the dump is consistent and complete', () => {
  const script = read('scripts/backup-db.sh')
  for (const flag of ['--single-transaction', '--routines', '--triggers', '--events']) {
    assert.ok(script.includes(flag), `mysqldump is missing ${flag}`)
  }
})

test('old backups are rotated rather than accumulating forever', () => {
  assert.match(read('scripts/backup-db.sh'), /-mtime "\+\$KEEP_DAYS"/)
})

test('a Media Portal archive accompanies the database dump', () => {
  const script = read('scripts/backup-media.sh')
  // The directory is a named compose volume.  Reading it through the actual
  // app container avoids guessing Docker's project-name-prefixed volume name.
  assert.match(script, /docker cp "\$CONTAINER:\/var\/lib\/cdkt\/media\/\." -/)
  assert.match(script, /gzip -t "\$TARGET"/)
  assert.match(script, /tar -tzf "\$TARGET"/)
  assert.match(script, /cdkt-media-\$STAMP-\$\$\.tar\.gz/)
  assert.match(script, /-mtime "\+\$KEEP_DAYS"/)
})

test('the combined backup gives SQL and media one explicit timestamp', () => {
  const script = read('scripts/backup.sh')
  assert.match(script, /export BACKUP_STAMP="\$STAMP"/)
  assert.match(script, /\.\/scripts\/backup-db\.sh/)
  assert.match(script, /\.\/scripts\/backup-media\.sh/)
})

test('media restore requires an explicit destructive acknowledgement', () => {
  const script = read('scripts/restore-media.sh')
  assert.match(script, /--replace/)
  assert.match(script, /docker compose stop app/)
  assert.match(script, /docker compose ps --status running -q app/)
  assert.match(script, /archive contains an unsafe path/)
  assert.match(script, /docker compose run --rm -T --no-deps/)
})

// ─── Restore verification ────────────────────────────────────────────────────
test('the restore check never touches the live database', () => {
  const script = read('scripts/verify-restore.sh')
  assert.match(script, /SCRATCH="cdkt_restore_check_\$\$"/)
  assert.match(script, /refusing to use the live database as scratch/)
  assert.match(script, /DROP DATABASE IF EXISTS/)
  assert.match(script, /trap cleanup EXIT/, 'the scratch database survives an early exit')
})

test('backups are not committed to the repository', () => {
  assert.match(read('.gitignore'), /^backups\/$/m)
})

// ─── CI ──────────────────────────────────────────────────────────────────────
test('CI runs the tests, the drift check and a real build', () => {
  const workflow = read('.github/workflows/ci.yml')
  // CI tách thành unit-tests + integration-tests + schema-drift. Cả hai job
  // test đều gọi Node test runner trực tiếp (không qua `npm test`) để có thể
  // lọc tệp. Assertion này canh Biblical: test runner phải được gọi, và phải
  // gọi cho cả hai nhóm (unit và integration).
  assert.match(workflow, /--import \.\/scripts\/ts-resolver\.mjs --test/, 'CI must invoke the Node test runner')
  assert.match(workflow, /run: npm run db:drift/)
  assert.match(workflow, /run: npm run build/)
  assert.match(workflow, /on:\s*\n\s*push:/)
})

test('the build job supplies the secret nuxt.config demands in production', () => {
  // `nuxt build` forces NODE_ENV=production, and the config throws without it.
  // Without this the build job would fail on every run.
  const workflow = read('.github/workflows/ci.yml')
  const secret = /ANALYTICS_HMAC_SECRET: (\S+)/.exec(workflow)?.[1] ?? ''
  assert.ok(secret.length >= 32, `the CI placeholder is ${secret.length} characters; the config requires 32`)
  assert.match(secret, /placeholder|not-a-real/, 'the CI value does not read as a throwaway')
})

test('the browser suite runs in CI, with a database and a browser to run against', () => {
  // Playwright skips nothing and fails nothing when it is simply never invoked:
  // the run stays green and the one check that exercises a real click quietly
  // stops happening. Three things have to hold together, and each is useless
  // alone — the invocation, the browser download, and a reachable MySQL for
  // tests/e2e/global-setup.ts to build its throwaway database in.
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /run: npm run test:e2e$/m, 'CI never invokes the browser suite')
  assert.match(workflow, /run: npm run test:e2e:install/, 'CI runs the suite without installing a browser')

  // The e2e step lives in the build job because it needs that job's bundle. So
  // that job — not just the test job — is the one that needs the MySQL service.
  const build = workflow.slice(workflow.indexOf('\n  build:'), workflow.indexOf('\n  hygiene:'))
  assert.match(build, /image: mysql:8\.0/, 'the build job has no database for the browser suite to seed')
  for (const variable of ['E2E_DB_HOST', 'E2E_DB_PORT', 'E2E_DB_USER', 'E2E_DB_PASSWORD']) {
    assert.match(build, new RegExp(`${variable}:`), `the browser suite has no ${variable}`)
  }
})

test('the unit suite runs east of UTC, where the local-day bugs live', () => {
  // Not tidiness — a gate that has already caught a real bug.
  //
  // The analytics scheduler decides "has today's pass already run?" by comparing
  // days. Its first version compared UTC days, which east of UTC skips the nightly
  // pass every night, forever, silently: at UTC+7 a 03:00 local run still falls on
  // the previous UTC day, so last night's record reads as today's.
  //
  // Measured, not argued: reintroducing that comparison fails 6 tests at UTC+7 and
  // ZERO at UTC. GitHub runners are UTC, so without this line the pipeline hands a
  // green tick to a scheduler that never runs on the servers it ships to. Any date
  // logic reading a local hour or local day shares the blind spot, which is why the
  // whole suite runs shifted rather than one file.
  //
  // Cả hai job (unit-tests và integration-tests) đều phải chạy ở UTC+7 — không
  // chỉ một. Scheduler bug sống trong integration suite (analytics-ddl), nhưng
  // bất kỳ tệp unit nào đọc ngày địa phương cũng cùng điểm mù.
  const workflow = read('.github/workflows/ci.yml')
  const unitJob = workflow.slice(workflow.indexOf('\n  unit-tests:'), workflow.indexOf('\n  integration-tests:'))
  const integrationJob = workflow.slice(workflow.indexOf('\n  integration-tests:'), workflow.indexOf('\n  schema-drift:'))

  assert.match(
    unitJob,
    /TZ: Asia\/Ho_Chi_Minh/,
    'the unit suite runs at the runner default (UTC), so local-day bugs pass CI',
  )
  assert.match(
    integrationJob,
    /TZ: Asia\/Ho_Chi_Minh/,
    'the integration suite runs at the runner default (UTC), so local-day bugs pass CI',
  )
})

test('a failing browser run keeps the evidence of what the page showed', () => {
  // A CI-only failure is otherwise a single assertion line. The trace and
  // screenshot are written only on failure, so this uploads nothing when green.
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /uses: actions\/upload-artifact@v4/)
  assert.match(workflow, /if: failure\(\)/)
})

test('CI refuses a committed .env or a known-default secret', () => {
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /git ls-files --error-unmatch \.env/)
  // The grep pattern in ci.yml brackets its final character (change_m[e]) so
  // the pattern line does not match itself; the assertion mirrors that form.
  assert.match(workflow, /cdkt_admin_secret_change_m\[e\]/)
  assert.match(workflow, /PRIVATE KEY/)
})

// ─── Deploy ──────────────────────────────────────────────────────────────────
test('nothing reaches the VPS without passing every gate first', () => {
  const workflow = read('.github/workflows/ci.yml')
  // The image job depends on every gate job, and deploy depends on the image
  // job. Drop one name here and a commit that fails a gate ships anyway.
  const imageNeeds = /image:\s*\n[\s\S]*?needs: \[([^\]]+)\]/.exec(workflow)?.[1] ?? ''
  for (const gate of ['unit-tests', 'integration-tests', 'schema-drift', 'build', 'hygiene']) {
    assert.ok(imageNeeds.includes(gate), `the image job does not wait for the ${gate} job`)
  }

  /**
   * Typecheck KHÔNG còn là một job riêng — nó là một bước trong job `unit-tests`.
   *
   * Gộp vào vì mỗi job là một runner phải xin cấp riêng, và trên tài khoản này
   * hai job nhẹ nhất liên tục bị huỷ sau ~15 phút xếp hàng mà **chưa bao giờ
   * được cấp máy** (`runner: ""`, `steps_run: 0`) — bảng CI báo đỏ cho một thứ
   * chưa từng chạy.
   *
   * Nhưng nó vẫn phải là cổng **chặn**, và đó là điều hai khẳng định dưới đây
   * canh: bước tồn tại trong job `unit-tests` (job mà `image` đã chờ), và nó
   * `exit` theo mã trạng thái thật thay vì nuốt lỗi. Bỏ `exit $status` đi là
   * biến một cổng chặn thành một dòng nhật ký, mà nhìn từ bảng CI thì hai thứ
   * đó giống hệt nhau — cùng một dấu tích xanh.
   */
  const unitJob = /\n  unit-tests:\n([\s\S]*?)(?=\n  [a-z-]+:\n)/.exec(workflow)?.[1] ?? ''
  assert.match(unitJob, /- name: Typecheck/,
    'bước Typecheck không còn trong job `unit-tests` — cổng kiểu đã biến mất khỏi CI')
  assert.match(unitJob, /exit \$status/,
    'Typecheck không thoát theo mã trạng thái thật — một lỗi kiểu sẽ hiện ra là màu xanh')
  assert.match(workflow, /deploy:\s*\n[\s\S]*?needs: image/, 'deploy does not wait for the image')
  // Deploying a pull request would push a fork's code onto the server.
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/)
})

test('the deployed image is pinned to a commit, not to a moving tag', () => {
  const workflow = read('.github/workflows/ci.yml')
  // `latest` can move between the image job finishing and the deploy starting,
  // and it is useless for rolling back.
  assert.match(workflow, /image=ghcr\.io\/\$repo:sha-\$\{\{ github\.sha \}\}/)
  assert.match(workflow, /IMAGE: \$\{\{ needs\.image\.outputs\.image \}\}/)
})

test('the SSH host key is pinned rather than accepted on sight', () => {
  const workflow = read('.github/workflows/ci.yml')
  // ssh-keyscan at run time trusts whoever answers, on every run — which is the
  // one party that must not be trusted, since they would receive the session.
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  // Only as a command — the comment above it names ssh-keyscan to explain why
  // the key is pinned instead.
  assert.doesNotMatch(workflow, /^(?!\s*#).*ssh-keyscan/m, 'the host key is discovered instead of pinned')
  assert.match(workflow, /SSH_KNOWN_HOSTS: \$\{\{ secrets\.VPS_SSH_KNOWN_HOSTS \}\}/)
})

test('a deploy run is never cancelled halfway through', () => {
  const workflow = read('.github/workflows/ci.yml')
  // The workflow-level group sets cancel-in-progress, which is right for tests
  // and wrong here: a cancelled deploy leaves .env pointing at an image the
  // running container is not using.
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'))
  assert.match(deploy, /group: deploy-production/)
  assert.match(deploy, /cancel-in-progress: false/)
})

test('the remote deploy script is executable and fails loudly', () => {
  const mode = statSync(new URL('../scripts/deploy-remote.sh', import.meta.url)).mode
  assert.ok(mode & 0o111, 'scripts/deploy-remote.sh is not executable')
  assert.match(read('scripts/deploy-remote.sh'), /set -euo pipefail/)
})

test('the deploy verifies the new container instead of assuming it started', () => {
  const script = read('scripts/deploy-remote.sh')
  // `docker compose up -d` returns as soon as the container is created, long
  // before the app has connected to MySQL or answered a request.
  assert.match(script, /State\.Health\.Status/)
  assert.match(script, /wait_healthy/)
  // A missing HEALTHCHECK means we are looking at the wrong image; it must not
  // read as success.
  assert.match(script, /none\)[\s\S]*?return 1/, 'a container without a healthcheck passes silently')
})

test('a failed deploy rolls back to the image that was running', () => {
  const script = read('scripts/deploy-remote.sh')
  assert.match(script, /PREVIOUS=\$\(current_image\)/)
  assert.match(script, /set_image "\$PREVIOUS"/)
  // The first deploy has nothing to roll back to; saying so beats a confusing
  // failure inside the rollback path.
  assert.match(script, /không có image trước đó để lùi về/)
  // Every exit from the failure path is non-zero, including the one where the
  // rollback succeeded — the commit did not ship.
  assert.match(script, /exit 1\s*$/m)
})

test('the deploy pulls before it touches .env', () => {
  const script = read('scripts/deploy-remote.sh')
  // A bad tag or an unreachable registry must leave the running deployment
  // untouched, so the pull has to come first.
  assert.ok(
    script.indexOf('docker pull') < script.indexOf('set_image "$IMAGE"'),
    'the image reference is written before the image is known to exist',
  )
})

test('rewriting .env cannot truncate it or widen its permissions', () => {
  const script = read('scripts/deploy-remote.sh')
  // .env holds JWT_SECRET and the database password. An interrupted rewrite
  // that leaves a half-file takes the site down and loses secrets.
  assert.match(script, /mktemp/)
  assert.match(script, /mv "\$TMP_ENV" \.env/)
  // A fresh temp file is world-readable by default; the copy carries the
  // original owner and mode across.
  assert.match(script, /cp -p \.env "\$TMP_ENV"/)
})

test('compose can pull a prebuilt image and still build locally', () => {
  const compose = read('docker-compose.yml')
  // `docker compose pull` does nothing for a service that only declares build:.
  assert.match(compose, /image: \$\{CDKT_IMAGE:-cdkt\/app:local\}/)
  // The local default keeps `docker compose build` working for development.
  assert.match(compose, /build:\s*\n\s*context: \./)
})

// ─── Media Portal deployment ─────────────────────────────────────────────────

test('the memory limits default to no limit, and the default is what makes compose readable', () => {
  // `${VAR:-0}` is not a style choice. `0` means "no limit" to Docker, so an
  // unset variable resolves to `limits: {}` — which keeps the deliberate
  // decision of b27be51 ("no RAM/CPU cap — the VPS has however much it has")
  // intact while still letting an operator set a cap.
  //
  // Written bare, `memory: ${APP_MEM_LIMIT}`, an unset variable makes
  // `docker compose config` EXIT NON-ZERO: `invalid size: ''`. Measured, not
  // assumed. A compose file that cannot be read is a compose file that cannot
  // be deployed — and it fails at the worst moment, on the server.
  const compose = read('docker-compose.yml')
  // Comments are stripped before the negative assertion, and that is not
  // tidiness: the comment above each limit explains WHY the `:-0` is required
  // by naming the broken form. Without this, the explanation would fail the
  // test it is explaining, and the lesson drawn would be to delete the
  // explanation rather than to keep the guard. Same rule the QA-documents
  // guard follows.
  const config = compose
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
  for (const variable of ['APP_MEM_LIMIT', 'MYSQL_MEM_LIMIT']) {
    assert.match(
      config,
      new RegExp(`memory: \\$\\{${variable}:-0\\}`),
      `${variable} has no ":-0" fallback, so an unset variable breaks \`docker compose config\``,
    )
    assert.doesNotMatch(
      config,
      new RegExp(`memory: \\$\\{${variable}\\}`),
      `${variable} is interpolated bare — unset makes compose unreadable`,
    )
  }
  // Both services, not just the app: the neighbour-aware reasoning in
  // check-resources.sh treats them as a pair.
  assert.strictEqual(
    (config.match(/deploy:\n\s+resources:\n\s+limits:\n\s+memory:/g) ?? []).length,
    2,
    'the memory limit is not declared on exactly the two services',
  )
})

test('the media work directory is a volume of its own, not the media library', () => {
  // The transcode scratch space holds multi-gigabyte parts of an upload in
  // flight. Sharing `uploads_data` with the media library would put a
  // half-processed video next to published files, where a library cleanup
  // would delete work in progress.
  const compose = read('docker-compose.yml')
  assert.match(compose, /media_work:\/var\/lib\/cdkt\/media/)
  assert.match(compose, /^volumes:\n(?:.*\n)*?\s+media_work:/m, 'the media_work volume is not declared')
  // The mount point must match the image's own default, or the app writes to
  // the container filesystem and loses every video on the next restart.
  assert.match(compose, /CDKT_MEDIA_WORKDIR: \$\{CDKT_MEDIA_WORKDIR:-\/var\/lib\/cdkt\/media\}/)
  assert.match(read('Dockerfile'), /ENV CDKT_MEDIA_WORKDIR=\/var\/lib\/cdkt\/media/)
})

test('every variable media-config reads is listed in compose', () => {
  // compose does not use env_file: a variable set in .env that is not listed
  // under `environment:` never reaches the container. `./manage.sh
  // media-tuning` writes MEDIA_UPLOAD_ENABLED into .env — without this the
  // command is a button that does nothing, and nothing says so.
  //
  // The list is derived from the source rather than typed here, so adding a
  // variable to media-config.ts without wiring it fails this test instead of
  // producing a setting that silently has no effect.
  const compose = read('docker-compose.yml')
  const config = read('server/utils/media-config.ts')
  const names = [...config.matchAll(/parseMedia(?:Boolean|Integer)\(\s*'([A-Z0-9_]+)'/g)].map((m) => m[1])
  assert.ok(names.length >= 7, `only ${names.length} media variables found in media-config.ts`)
  for (const name of [...names, 'CDKT_MEDIA_WORKDIR']) {
    assert.match(
      compose,
      new RegExp(`^\\s+${name}: \\$\\{${name}:-`, 'm'),
      `${name} is read by the app but not passed through by compose`,
    )
  }
})

test('compose never supplies a second default for a media variable', () => {
  // `parseMediaBoolean` / `parseMediaInteger` treat an empty string as "use the
  // default", and those defaults are decisions with reasons written next to
  // them. Restating a value here would create a second source of truth at the
  // infrastructure layer, where nobody looks when editing the code.
  //
  // MEDIA_UPLOAD_ENABLED is the one that matters: the code defaults it to
  // FALSE on purpose (a host without FFmpeg, or under the RAM floor, accepts a
  // video and can never process it). `:-true` here would override a safe
  // default with a more dangerous value.
  const compose = read('docker-compose.yml')
  for (const name of [
    'MEDIA_UPLOAD_ENABLED', 'MEDIA_UPLOAD_MAX_SIZE', 'MEDIA_UPLOAD_CHUNK_SIZE',
    'MEDIA_UPLOAD_SESSION_HOURS', 'MEDIA_DISK_FLOOR_BYTES',
    'MEDIA_PROCESSING_HEARTBEAT_SECONDS', 'MEDIA_PROCESSING_STALE_MINUTES',
  ]) {
    assert.match(
      compose,
      new RegExp(`^\\s+${name}: \\$\\{${name}:-\\}$`, 'm'),
      `${name} carries a value in compose instead of deferring to the app's default`,
    )
  }
})

test('the replica guard keeps its unset default, which is the point of the guard', () => {
  // server/plugins/livestream-replica-guard.ts reads `=== '1'` and its docstring
  // records why it deliberately does NOT default to '1': a variable with a
  // correct default never warns anyone, and this warning exists precisely
  // because the correct default is the thing nobody checks.
  const compose = read('docker-compose.yml')
  assert.match(compose, /CDKT_SSE_REPLICA_GUARD: \$\{CDKT_SSE_REPLICA_GUARD:-\}/)
  assert.doesNotMatch(compose, /CDKT_SSE_REPLICA_GUARD[=:]\s*1\s*$/m, 'the guard is hardcoded on, so it can never warn')
})

test('ffmpeg is installed in the runtime stage, where it is actually needed', () => {
  // `nuxi build` never invokes ffmpeg. Installing it in the builder stage would
  // add ~100 MB to a layer that never reaches the image serving traffic.
  const dockerfile = read('Dockerfile')
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('# ─── Stage 2'))
  assert.match(runtimeStage, /RUN apk add --no-cache ffmpeg/, 'ffmpeg is not installed in the runtime stage')
  assert.doesNotMatch(
    dockerfile.slice(0, dockerfile.indexOf('# ─── Stage 2')),
    /apk add[^\n]*ffmpeg/,
    'ffmpeg is installed in the builder stage, where it is dead weight',
  )
})

test('the media volume is writable by the unprivileged user', () => {
  // A freshly created named volume inherits the ownership of the directory it
  // is mounted over. If that directory is created by root at first use, the
  // `node` user can never write to it — every upload fails with EACCES and
  // nothing says why.
  const dockerfile = read('Dockerfile')
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('# ─── Stage 2'))
  const chownIndex = runtimeStage.indexOf('chown -R node:node')
  assert.ok(chownIndex > -1, 'the runtime stage never chowns the app directory')

  // Match the mkdir COMMAND, not the bare path: `ENV CDKT_MEDIA_WORKDIR=...`
  // also contains `/var/lib/cdkt`, and it sits above the chown — so asserting
  // on the path alone passes even when the directory is created after the
  // chown that was supposed to give it away. Verified by swapping the two
  // commands: the path-only form stayed green.
  const mkdirMatch = /RUN mkdir[^\n]*\/var\/lib\/cdkt[^\n]*/.exec(runtimeStage)
  assert.ok(mkdirMatch, 'the runtime stage never creates the media work directory')
  assert.ok(
    (mkdirMatch.index ?? -1) < chownIndex,
    'the media directory is created after the chown, so it stays owned by root',
  )
  // And privileges must actually be dropped AFTER the chown, not before.
  // Two accepted shapes:
  //   (a) a `USER node` directive after the chown — the legacy form;
  //   (b) an `ENTRYPOINT` / `su-exec` drop at runtime, which lets the entrypoint
  //       fix bind-mount ownership (root-owned on the host) via chown on every
  //       boot BEFORE switching to `node`. This is the only shape that can
  //       make a bind-mounted `./backups` writable.
  // Both drop the unprivileged user after the chown that gives it the dirs.
  // The bug this catches is "the chown runs as the wrong user", which both
  // (a) and (b) avoid. Asserting on the literal `USER node` text would lock us
  // to the legacy form and forbid the entrypoint fix that the backups bind
  // mount actually needs.
  const userDirectiveIndex = runtimeStage.indexOf('USER node')
  const entrypointDropIndex = runtimeStage.indexOf('su-exec')
  const hasUserDrop = userDirectiveIndex > chownIndex
  const hasEntrypointDrop = entrypointDropIndex > -1
  assert.ok(
    hasUserDrop || hasEntrypointDrop,
    'privileges are never dropped after the chown — the runtime stage has neither USER node nor an su-exec entrypoint after the chown, so the media dir stays root-owned (USER node form) or bind mounts stay root-owned (entrypoint form)',
  )
})

test('the resource script prints decimals the same way in every locale', () => {
  // Measured on this project's own development machine, whose LC_NUMERIC is
  // vi_VN: `printf '%.1f'` fed the output of `awk` exits 1 with "invalid
  // number", and `set -Eeuo pipefail` turns that into the script's documented
  // "missing tools" exit code — on a host where docker is installed and
  // working. The printed value was wrong too (`15,0 GB` for 15.4 GB).
  //
  // awk always prints a dot regardless of locale; bash's printf reads according
  // to LC_NUMERIC. So a float format applied directly to an awk value is the
  // broken shape, and it lives on the exact line — source text is enough here.
  const script = read('scripts/check-resources.sh')
  assert.doesNotMatch(
    script,
    /printf[^\n]*%\.\d*f[^\n]*\$\{?\(?awk/,
    'a float format is applied directly to an awk value, which breaks under a comma-decimal locale',
  )
  assert.doesNotMatch(script, /printf[^\n]*%\.\d+f[^\n]*\$\(awk/)
  // The locale-safe path stays, and stays the only one.
  assert.match(script, /to_g\(\) \{ awk "BEGIN\{printf \\"%\.10g\\"/)
  assert.strictEqual((script.match(/^to_g\(\)/gm) ?? []).length, 1, 'to_g is defined more than once')
})

test('the RAM figure is printed through to_g, not through printf', () => {
  const script = read('scripts/check-resources.sh')
  const ramLine = script.split('\n').find((line) => line.includes('RAM:') && line.includes('printf'))
  assert.ok(ramLine, 'the RAM line no longer prints at all')
  assert.ok(
    ramLine.includes('to_g'),
    `the RAM line formats a float itself: ${ramLine.trim()}`,
  )
})

test('to_g is defined before the first line that calls it', () => {
  // bash resolves a function at call time, so this would still run — but a
  // definition sitting below its first use reads as though it is in the wrong
  // place, and the next person to move code will move the wrong one.
  const script = read('scripts/check-resources.sh')
  const definition = script.indexOf('\nto_g()')
  const firstUse = script.indexOf('$(to_g ')
  assert.ok(definition > -1 && firstUse > -1, 'to_g or its call site is gone')
  assert.ok(definition < firstUse, 'to_g is defined after the line that calls it')
})

test('media-tuning asks check-resources for the memory figures instead of recomputing them', () => {
  // A second copy of the formula is a second place to get it wrong, and it was
  // wrong: the first version suggested app=6000m/mysql=1000m where
  // check-resources.sh says mysql=4096m/app=2048m — three times off, and it
  // gave MySQL the SMALLER share. That inverts the exact bug
  // check-resources.sh exists to fix: MySQL reads its cgroup limit, not the
  // host's RAM, to size the InnoDB buffer pool, so too low a cap is slower
  // forever with nothing to report it.
  const script = read('production/manage.sh')
  const command = script.slice(script.indexOf('cmd_media_tuning()'), script.indexOf('# ── Entry ──'))
  assert.ok(command.length > 0, 'cmd_media_tuning is gone')
  assert.match(command, /check-resources\.sh/, 'media-tuning does not call check-resources.sh')
  assert.doesNotMatch(
    command,
    /host_ram_mb - \d+/,
    'media-tuning computes a memory figure from host RAM instead of asking the script',
  )
})

test('media-tuning only reads and writes .env', () => {
  // It must not restart containers: an operator runs it, reads the result, and
  // decides when to apply it. Restarting a portal that is serving citizens
  // because a value was just written — before anyone has looked at it — is a
  // worse failure than the one the command fixes.
  const script = read('production/manage.sh')
  const command = script.slice(script.indexOf('cmd_media_tuning()'), script.indexOf('# ── Entry ──'))
  // Only executable lines: the command legitimately PRINTS the `docker compose
  // up -d` an operator should run next, and a check that cannot tell an
  // instruction from an action would fail on that helpful line.
  const executed = command
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#') && !line.startsWith('echo'))
  for (const verb of ['up -d', 'restart', 'stop', 'down', 'pull']) {
    const offender = executed.find((line) => line.includes(`docker compose ${verb}`))
    assert.strictEqual(
      offender,
      undefined,
      `media-tuning runs \`docker compose ${verb}\`; it must only touch .env`,
    )
  }
  // The floor is real, not rounded: three concurrent FFmpeg renditions on a
  // small VPS make the OOM-killer take a DIFFERENT container.
  assert.match(command, /RAM_FLOOR_MB=4000/)
})

test('set_env is idempotent, so re-running a command cannot duplicate a key', () => {
  // compose reads .env as a mapping; two lines with the same key make the
  // effective value depend on parse order rather than on intent.
  const script = read('production/manage.sh')
  const helper = script.slice(script.indexOf('set_env()'), script.indexOf('# ── Menu chính'))
  assert.ok(helper.length > 0, 'set_env is gone')
  // Replace in place when the key exists, append only when it does not.
  assert.ok(helper.includes('grep -qE "^${key}="'), 'set_env does not detect an existing key')
  assert.ok(helper.includes('sed -i "s|^${key}=.*|${key}=${value}|"'), 'set_env does not replace in place')
  assert.ok(helper.includes('>> "$file"'), 'set_env never appends a key that is absent')
  assert.ok(helper.includes('${3:-$ROOT/.env}'), 'set_env cannot be pointed at another file')
})

test('nginx is told about the large uploads and the unbuffered stream', () => {
  // Two different shapes in two files, and both are needed: DEPLOY.md is a
  // complete `server { }` block, CI-CD.md is the aaPanel fragment.
  for (const [path, label] of [['DEPLOY.md', 'DEPLOY.md'], ['CI-CD.md', 'CI-CD.md']] as const) {
    const doc = read(path)
    const nginx = doc.slice(doc.indexOf('```nginx'))
    assert.match(nginx, /location \/api\/admin\/media-portal\//, `${label} has no large-upload location`)
    assert.match(nginx, /client_max_body_size 12g;/, `${label} caps uploads below the app's own limit`)
    assert.match(nginx, /location \/api\/public\/livestream\/chat\/stream/, `${label} has no stream location`)
    const stream = nginx.slice(nginx.indexOf('location /api/public/livestream/chat/stream'))
    assert.match(stream, /proxy_buffering off;/, `${label} buffers the stream, which delays every message`)
    assert.match(stream, /proxy_cache off;/, `${label} would serve one reader's conversation from cache`)
    assert.match(stream, /proxy_read_timeout 86400s;/, `${label} closes a long-lived stream on the default timeout`)
  }
})

test('the stream location names a route that exists', () => {
  // A proxy rule for a path the app does not serve is a rule that silently
  // does nothing; the feature looks configured and is not.
  const route = read('server/api/public/livestream/chat/stream.get.ts')
  assert.ok(route.length > 0)
  assert.ok(
    read('DEPLOY.md').includes('/api/public/livestream/chat/stream'),
    'the documented proxy path does not match the route',
  )
})
