import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  PASSWORD_MIN_LENGTH,
  passwordRejectionMessage,
  validatePassword,
} from '../server/utils/password-policy'
import {
  SEED_USERNAME,
  evaluateAdminPassword,
  parseEnvFile,
} from '../scripts/check-admin-password'

/**
 * These accounts publish to a Ministry of Public Security portal, create other
 * administrators, and can read the contact details citizens submit. The portal
 * used to accept any six characters for them.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const reasons = (password: string, username = 'admin') => validatePassword(password, { username }).errors.join(' ')

// ─── Length and composition ──────────────────────────────────────────────────
test('the floor is twelve characters, not six', () => {
  assert.ok(PASSWORD_MIN_LENGTH >= 12)
  assert.equal(validatePassword('Ab1!kmqt').ok, false, 'an eight-character password was accepted')
  assert.equal(validatePassword('Ab1!kmqtvxz').ok, false, 'eleven characters was accepted')
  assert.equal(validatePassword('Ab1!kmqtvxzw').ok, true)
})

test('a single character class is refused however long the password is', () => {
  assert.match(reasons('quanlyvienbaomatnoibo'), /3 trong 4 nhóm/)
  assert.match(reasons('QUANLYVIENBAOMATNOIBO'), /3 trong 4 nhóm/)
  assert.match(reasons('183749201847362819473'), /3 trong 4 nhóm/)
})

test('two classes are still short of the bar, three clear it', () => {
  assert.equal(validatePassword('quanlyvien2026xyz').ok, false)
  assert.equal(validatePassword('QuanLyVien2026xyz').ok, true)
})

// ─── The passwords an attacker actually tries first ──────────────────────────
test('the password this project documented publicly is refused', () => {
  // It was the seed default and it is in the repository history, so it is the
  // single most likely password on any install that was never changed.
  assert.equal(validatePassword('Admin@123456').ok, false)
  assert.match(reasons('Admin@123456'), /phổ biến hoặc mặc định/)
  assert.equal(validatePassword('admin@123456').ok, false, 'the check is case-sensitive')
})

test('the .env.example placeholder cannot be used as a real password', () => {
  assert.equal(validatePassword('DoiMatKhauManhNgayLanDau!').ok, false)
  const example = read('.env.example')
  assert.match(example, /^ADMIN_PASSWORD=$/m, '.env.example ships a usable password again')
})

test('common credential-stuffing entries are refused', () => {
  for (const weak of ['password123', 'P@ssw0rd', 'Welcome123', 'letmein123', 'ChangeMe123']) {
    assert.equal(validatePassword(weak).ok, false, `accepted: ${weak}`)
  }
})

test('a password containing the username is refused', () => {
  assert.match(reasons('Admin!Conduong2026', 'admin'), /chứa tên đăng nhập/)
  assert.match(reasons('Bientap2026!Xyz', 'bientap'), /chứa tên đăng nhập/)
  // A username too short to be meaningful must not reject everything with an "a".
  assert.doesNotMatch(reasons('Xy7#mQp2Lv8Ns', 'ad'), /chứa tên đăng nhập/)
})

// ─── Patterns that make a human-chosen password guessable ────────────────────
test('runs and keyboard sequences are refused in a short password', () => {
  assert.match(reasons('Aaa!bbb2026Zq'), /3 ký tự giống nhau/)
  assert.match(reasons('Qw1!abcdEfgh'), /chuỗi ký tự liên tiếp/)
  assert.match(reasons('Zx9!87654321'), /chuỗi ký tự liên tiếp/)
})

test('a long random secret is not rejected for an accidental run', () => {
  // `openssl rand -base64 18` is what DEPLOY.md tells the operator to run; a
  // chance "aaa" inside 24 mixed-class characters must not fail the install.
  assert.equal(validatePassword('K7aaaQm2Lv8NsXy4Rt6Bw').ok, true)
  assert.equal(validatePassword('Ab1!abcdefghijklmnopq').ok, true)
})

test('surrounding whitespace is refused instead of being trimmed away', () => {
  // Trimming would store a different password than the one the person typed.
  assert.match(reasons(' Xy7#mQp2Lv8Ns'), /khoảng trắng/)
  assert.match(reasons('Xy7#mQp2Lv8Ns '), /khoảng trắng/)
})

test('non-string and empty input is refused, never treated as valid', () => {
  for (const bad of [undefined, null, 0, {}, [], '']) {
    assert.equal(validatePassword(bad as unknown).ok, false, `accepted: ${JSON.stringify(bad)}`)
  }
})

test('every failing rule is reported at once', () => {
  const { errors } = validatePassword('admin', { username: 'admin' })
  assert.ok(errors.length >= 3, `only ${errors.length} problems reported: ${errors.join(' | ')}`)
})

test('passwordRejectionMessage returns null exactly when the password passes', () => {
  assert.equal(passwordRejectionMessage('Xy7#mQp2Lv8Ns'), null)
  assert.equal(typeof passwordRejectionMessage('short'), 'string')
})

// ─── Every path that sets a password goes through the policy ─────────────────
test('creating a user enforces the policy', () => {
  const source = read('server/api/admin/users/index.post.ts')
  assert.match(source, /passwordRejectionMessage\(password, \{ username \}\)/)
  assert.doesNotMatch(source, /password\.length < 6/, 'the six-character rule is back')
})

test('changing a password enforces the policy and revokes sessions', () => {
  const source = read('server/api/admin/users/[id].put.ts')
  assert.match(source, /passwordRejectionMessage\(newPassword/)
  assert.match(source, /username: users\.username/, 'the username is not loaded, so the rule cannot apply')
  assert.match(source, /tokenVersion = sql`\$\{users\.tokenVersion\} \+ 1`/)
  // The old code skipped a short password without telling anyone.
  assert.doesNotMatch(source, /String\(body\.password\)\.trim\(\)\.length >= 6/)
})

test('the seed refuses to create the first admin with a weak password', () => {
  const source = read('server/db/seed.ts')
  assert.match(source, /passwordRejectionMessage\(adminPassword/)
  // `|| ''` is fine (it just coerces an unset variable); `|| 'something'` is a
  // hard-coded password sneaking back in.
  assert.doesNotMatch(source, /ADMIN_PASSWORD \|\| '[^']/, 'the seed fell back to a hard-coded password again')
  assert.match(source, /process\.exit\(1\)/)
})

test('production refuses to boot on a weak ADMIN_PASSWORD', () => {
  const guard = read('server/plugins/require-secrets.ts')
  assert.match(guard, /ADMIN_PASSWORD/)
  assert.match(guard, /passwordRejectionMessage/)
})

// ─── The build-time guard ────────────────────────────────────────────────────
/**
 * Both enforcement points above run *after* a build has already succeeded, so a
 * bad ADMIN_PASSWORD used to cost a full `nuxt build` before anyone found out.
 * The build guard reads the same policy and runs first.
 */
test('an invalid password stops the build, a valid one lets it through', () => {
  const bad = evaluateAdminPassword({ processValue: 'Admin@conduonghuongthien2026' })
  assert.equal(bad.status, 'invalid', 'the value that broke the production deploy was accepted')
  assert.ok(bad.status === 'invalid' && bad.errors.some(e => /chứa tên đăng nhập/.test(e)))

  assert.equal(evaluateAdminPassword({ processValue: 'Xy7#mQp2Lv8Ns' }).status, 'ok')
})

test('the policy is applied against the account the seed actually creates', () => {
  // Checking against some other username would let "Admin@..." through here and
  // fail later in the seed — the exact split this guard exists to close.
  assert.equal(SEED_USERNAME, 'admin')
  const source = read('server/db/seed.ts')
  assert.match(source, /username: 'admin'/, 'the seed no longer creates "admin"; the guard checks the wrong name')
})

test('an absent password warns instead of failing the build', () => {
  // CI and the Docker builder stage have no .env at all (.dockerignore excludes
  // it). Seed is insert-only, so an existing deployment has no reason to keep the
  // password around either. Failing those builds would be noise, not safety.
  assert.equal(evaluateAdminPassword({ processValue: '', envFileText: null }).status, 'absent')
  assert.equal(evaluateAdminPassword({ processValue: '   ', envFileText: '' }).status, 'absent')
  assert.equal(evaluateAdminPassword({ envFileText: 'PORT=3000\n' }).status, 'absent')
})

test('the value is read from .env, since a plain build has no env var set', () => {
  const verdict = evaluateAdminPassword({
    envFileText: '# comment\nPORT=3000\nADMIN_PASSWORD=Admin@conduonghuongthien2026\n',
  })
  assert.equal(verdict.status, 'invalid', '.env was not consulted, so the guard would miss the real mistake')
})

test('an env var wins over .env, matching what the app will see at runtime', () => {
  // Reporting a verdict on a value the deployment will not use is worse than not
  // checking: it says "ok" about the wrong password.
  const verdict = evaluateAdminPassword({
    processValue: 'Xy7#mQp2Lv8Ns',
    envFileText: 'ADMIN_PASSWORD=admin\n',
  })
  assert.equal(verdict.status, 'ok')
})

test('a secret file is read, because the Docker build has no .env', () => {
  const verdict = evaluateAdminPassword({ secretValue: 'Admin@conduonghuongthien2026\n' })
  assert.equal(verdict.status, 'invalid', 'the BuildKit secret path skips the check entirely')
  // Secret files almost always end in a newline; it is not part of the password.
  assert.equal(evaluateAdminPassword({ secretValue: 'Xy7#mQp2Lv8Ns\n' }).status, 'ok')
})

test('the .env reader handles quoting the way a password needs it', () => {
  // A generated password can contain '#'. Stripping it as a comment would check a
  // different string than the one the seed will hash.
  assert.equal(parseEnvFile('ADMIN_PASSWORD="Xy7#mQp2 Lv8Ns"').ADMIN_PASSWORD, 'Xy7#mQp2 Lv8Ns')
  assert.equal(parseEnvFile("ADMIN_PASSWORD='Xy7#mQp2Lv8Ns'").ADMIN_PASSWORD, 'Xy7#mQp2Lv8Ns')
  // A '#' only starts a comment when whitespace precedes it, so an unquoted
  // password keeps its '#' — the common case, and the one that matters.
  assert.equal(parseEnvFile('ADMIN_PASSWORD=Xy7#mQp2Lv8Ns').ADMIN_PASSWORD, 'Xy7#mQp2Lv8Ns')
  assert.equal(parseEnvFile('ADMIN_PASSWORD=Xy7mQp2Lv8Ns  # note').ADMIN_PASSWORD, 'Xy7mQp2Lv8Ns')
  assert.equal(parseEnvFile('export ADMIN_PASSWORD=Xy7#mQp2Lv8Ns').ADMIN_PASSWORD, 'Xy7#mQp2Lv8Ns')
  // Base64 output from `openssl rand -base64 18` ends in '=' and must survive.
  assert.equal(parseEnvFile('ADMIN_PASSWORD=c24Y0E3MBfywyQuR/ZPw=').ADMIN_PASSWORD, 'c24Y0E3MBfywyQuR/ZPw=')
})

test('the guard is wired into npm run build, not merely available', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.scripts.build, /check:admin-password/, 'npm run build skips the guard')
  assert.match(pkg.scripts.build, /check:admin-password.*&&.*nuxt build/, 'the guard must run BEFORE the build')
  assert.ok(pkg.scripts['check:admin-password'], 'no way to run the check on its own')
})

test('the Docker build runs the guard, and via a secret rather than a build arg', () => {
  const dockerfile = read('Dockerfile')
  assert.match(dockerfile, /--mount=type=secret,id=admin_password/, 'the Docker build skips the guard')
  assert.match(dockerfile, /ADMIN_PASSWORD_FILE=\/run\/secrets\/admin_password npm run check:admin-password/)
  // A build ARG is recorded in `docker history` for the life of the image.
  assert.doesNotMatch(dockerfile, /ARG ADMIN_PASSWORD/, 'the password is baked into the image history')
  // The guard is worthless if it runs after the expensive step.
  const guardAt = dockerfile.indexOf('check:admin-password')
  const buildAt = dockerfile.indexOf('nuxi build')
  assert.ok(guardAt !== -1 && buildAt !== -1 && guardAt < buildAt, 'the guard runs after nuxi build')
})

test('compose passes ADMIN_PASSWORD to the build as a secret', () => {
  const compose = read('docker-compose.yml')
  // Comment lines sit between these keys, so match the declaration, not a layout.
  assert.match(compose, /^secrets:$/m, 'no top-level secrets block')
  assert.match(compose, /^ {2}admin_password:$/m, 'the admin_password secret is not declared')
  assert.match(compose, /^ {4}environment: ADMIN_PASSWORD$/m, 'the secret is not sourced from ADMIN_PASSWORD')
  // Nested under app.build, so eight spaces — not under app itself (six), which
  // would mount it at RUNTIME and leave the build unchecked.
  assert.match(compose, /^ {8}- admin_password$/m, 'the app build never receives the secret')
})
