/**
 * Kiểm mẫu luật kiểm duyệt (`server/services/moderation-regex.ts`): độ dài, regex
 * hợp lệ với đúng cờ `iu` lúc chạy, heuristic hình dạng lùi vô hạn, và biên dịch
 * KHÔNG hạ chữ mẫu (`\D` không được thành `\d`).
 *
 * Heuristic giảm chứ không loại bỏ ReDoS — bảng dưới ghim những dạng nó PHẢI bắt
 * và những mẫu thường gặp nó KHÔNG được chặn nhầm.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODERATION_PATTERN_MAX_LENGTH,
  checkModerationPattern,
  clearCompiledModerationRegexCache,
  compileModerationRegex,
  findCatastrophicShape,
  isRegexRuleType,
} from '../server/services/moderation-regex.ts'

const CATASTROPHIC = [
  '(a+)+',
  '(a*)*',
  '(a+)*b',
  '(\\w+\\s?)+$',
  '(\\d+)+x',
  '([a-z]+)*',
  '((ab)+)+',
  '(?:a+){2,}',
  '(.*a){10}',
  '(a|a)*',
  '(a|ab)+',
  '(x|)*',
  '(\\s|,)+',
  '(?<g>a+)+',
  '^(\\w?\\w)+$',
]

const ACCEPTED = [
  'abc\\d+',
  '(foo|bar)+',
  'ca\\s?độ',
  '[0-9]{9,11}',
  '\\b(tài|tai)\\s*xỉu\\b',
  '(?:đm|dm)+',
  '(ab|cd){2,5}',
  '^\\D+$',
  'https?://\\S+',
  '(\\d{3})-(\\d{4})',
  '(?:0|\\+84)\\d{9}',
  '[\\s,]+',
]

test('heuristic flags the classic catastrophic shapes', () => {
  for (const pattern of CATASTROPHIC) {
    assert.ok(findCatastrophicShape(pattern), `must flag: ${pattern}`)
    const check = checkModerationPattern(pattern, 'pattern')
    assert.equal(check.ok, false, `must refuse at save time: ${pattern}`)
    assert.match((check as { reason: string }).reason, /nguy cơ treo/)
  }
})

test('heuristic does not flag common safe patterns', () => {
  for (const pattern of ACCEPTED) {
    assert.equal(findCatastrophicShape(pattern), null, `must not flag: ${pattern}`)
    assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, `must accept: ${pattern}`)
  }
})

test('invalid regex is refused with the runtime flags (u is stricter than non-u)', () => {
  for (const pattern of ['(', 'a{', '[z-a]', '\\p{Nope}']) {
    const check = checkModerationPattern(pattern, 'regex')
    assert.equal(check.ok, false, `must refuse: ${pattern}`)
    assert.match((check as { reason: string }).reason, /không hợp lệ/)
  }
})

test('length cap applies to keywords and patterns; empty is refused', () => {
  const long = 'a'.repeat(MODERATION_PATTERN_MAX_LENGTH + 1)
  assert.equal(checkModerationPattern(long, 'keyword').ok, false)
  assert.equal(checkModerationPattern(long, 'pattern').ok, false)
  assert.equal(checkModerationPattern('a'.repeat(MODERATION_PATTERN_MAX_LENGTH), 'keyword').ok, true)
  assert.equal(checkModerationPattern('   ', 'keyword').ok, false)
})

test('keyword rules are never parsed as regex', () => {
  assert.equal(isRegexRuleType('keyword'), false)
  assert.equal(isRegexRuleType('pattern'), true)
  assert.equal(isRegexRuleType('regex'), true)
  // `(a+)+` is a harmless literal substring for a keyword rule.
  assert.deepEqual(checkModerationPattern('(a+)+', 'keyword'), { ok: true })
})

test('compile keeps the pattern case: \\D stays "non-digit", case-insensitivity comes from the i flag', () => {
  clearCompiledModerationRegexCache()
  const nonDigit = compileModerationRegex('^\\D+$')
  assert.ok(nonDigit)
  assert.equal(nonDigit.flags, 'iu')
  assert.equal(nonDigit.test('abc'), true)
  assert.equal(nonDigit.test('12345'), false, 'lower-casing the pattern would have turned \\D into \\d')
  const upper = compileModerationRegex('ABC')
  assert.equal(upper!.test('xx abc xx'), true)
})

test('compile returns null for invalid, oversized or catastrophic patterns (already stored rules are skipped at runtime)', () => {
  clearCompiledModerationRegexCache()
  assert.equal(compileModerationRegex('('), null)
  assert.equal(compileModerationRegex('(a+)+$'), null)
  assert.equal(compileModerationRegex(`${'a'.repeat(MODERATION_PATTERN_MAX_LENGTH)}b`), null)
  // Cached: same instance on the second call, until the rules cache is invalidated.
  const first = compileModerationRegex('abc\\d+')
  assert.equal(compileModerationRegex('abc\\d+'), first)
  clearCompiledModerationRegexCache()
  assert.notEqual(compileModerationRegex('abc\\d+'), first)
})

// ── Kiểm chứng 2026-10 (scratchpad verify-data/regex-probe.ts) ─────────────────
// Không khẳng định thời gian chạy — chỉ khẳng định cấu trúc: mẫu nào bị từ chối,
// mẫu nào được nhận. Thời gian đo được lúc kiểm chứng ghi ở chú thích từng dòng.

const VERIFIER_REJECT = [
  '((a|aa))+$', // 2.4 s ở 32 ký tự — bọc thêm một nhóm từng lách được
  '(?:(?:a|aa))+$',
  `${'a?'.repeat(26)}${'a'.repeat(26)}`, // 743 ms, 2^26
  '(?:x|y)*(?:x|y)*(?:x|y)*$', // 880 ms ở 121 ký tự
  '\\s*\\s*\\s*$', // 1.1 s ở 201 ký tự
  '\\s*\\s*$',
  '.*.*.*=.*$', // 727 ms ở 200 ký tự
  '(\\w+)\\1+$',
  // Đa thức qua ký tự cố định cùng khớp (tìm được khi fuzz 2000 ký tự).
  '.*a.*b',
  '\\w+.{0,20}x',
  '(a*)(a|b)a+$',
  '(\\s{1,5}){1,5}\\w*$',
]

const VERIFIER_ACCEPT = [
  '(lừa đảo|chiếm đoạt|vay nặng lãi)',
  '\\b(cờ bạc|cá độ)\\b',
  'cờ[\\s,.]+bạc',
  'đ[ụu]\\s*m[áa]',
  'ma.{0,20}túy',
  '(?:0|\\+84)\\d{9}',
  '(\\d[\\s.]?){9,10}', // số điện thoại có dấu cách — từng bị từ chối nhầm
  '(\\d{3,4}[\\s.-]?){2,3}',
  '\\p{L}+\\s+bậy',
  '(cờ|cá)\\s+(bạc|độ)+',
  '(https?://)?(www\\.)?(bet|casino)',
  '(fb88|w88|m88)+',
  '(đéo|địt|đụ)+', // nhánh chung chữ đầu nhưng không nhánh nào là đầu của nhánh khác
  'k[h]?ông\\s+(ai|người)\\s+(biết)?',
  '(mẹ|má) (mày|mi)',
  '(\\W|^)(ngu)(\\W|$)',
  '(\\s|^)ngu(\\s|$)',
  'cờ.{0,30}bạc.{0,30}online',
  '[^]',
]

test('bảng kiểm chứng: dạng nguy hiểm (kể cả bọc thêm nhóm, đa thức) bị từ chối', () => {
  for (const pattern of VERIFIER_REJECT) {
    const check = checkModerationPattern(pattern, 'pattern')
    assert.equal(check.ok, false, `must refuse: ${pattern}`)
    assert.match((check as { reason: string }).reason, /nguy cơ treo/)
  }
})

test('bảng kiểm chứng: mẫu thường dùng trong tiếng Việt được nhận', () => {
  for (const pattern of VERIFIER_ACCEPT) {
    assert.deepEqual(checkModerationPattern(pattern, 'pattern'), { ok: true }, `must accept: ${pattern}`)
  }
})

test('thông báo lỗi gợi ý đúng cách viết lại cho từng dạng', () => {
  const reason = (p: string) => (checkModerationPattern(p, 'pattern') as { reason: string }).reason
  assert.match(reason('(\\s|,)+'), /\[\\s,\]\+/)
  assert.match(reason('(a|ab)+'), /không từ nào là phần đầu/)
  assert.match(reason('\\s*\\s*$'), /\.\{0,30\}/)
  assert.match(reason('(a?)*'), /rỗng/)
})

// ── Lớp 2: chạy có giới hạn ─────────────────────────────────────────────────

test('luật chậm bị tắt tạm, ghi log một lần, bật lại sau thời gian chờ (đồng hồ giả, không đo giờ thật)', async () => {
  const { testModerationRegex, setModerationRegexTimingForTests, resetSlowModerationRules, isModerationRuleDisabled, MODERATION_RULE_WINDOW_BUDGET_MS, MODERATION_RULE_COOLDOWN_MS } =
    await import('../server/services/moderation-regex.ts')
  const { mock } = await import('node:test')
  const clock = { elapsed: 0, now: 1_000_000, stepPerCall: 0 }
  setModerationRegexTimingForTests({
    elapsed: () => (clock.elapsed += clock.stepPerCall),
    now: () => clock.now,
  })
  const lines: Array<Record<string, unknown>> = []
  const spy = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line))) } catch { /* bỏ qua */ } })
  try {
    resetSlowModerationRules()
    const re = /cấm/iu
    clock.stepPerCall = 1
    assert.equal(testModerationRegex('cấm', re, 'từ cấm ở đây'), true, 'nhanh → khớp bình thường')
    assert.equal(isModerationRuleDisabled('cấm'), false)

    clock.stepPerCall = MODERATION_RULE_WINDOW_BUDGET_MS + 1
    assert.equal(testModerationRegex('cấm', re, 'từ cấm ở đây'), true, 'lượt chậm vẫn trả kết quả của nó')
    assert.equal(isModerationRuleDisabled('cấm'), true)
    assert.equal(testModerationRegex('cấm', re, 'từ cấm ở đây'), false, 'đang tắt → không chạy')
    assert.equal(lines.filter(l => l.event === 'ai_moderation.rule_slow_disabled').length, 1, 'log đúng một lần')

    clock.now += MODERATION_RULE_COOLDOWN_MS + 1
    clock.stepPerCall = 1
    assert.equal(isModerationRuleDisabled('cấm'), false, 'hết thời gian chờ → bật lại')
    assert.equal(testModerationRegex('cấm', re, 'từ cấm ở đây'), true)
  } finally {
    spy.mock.restore()
    setModerationRegexTimingForTests(null)
    resetSlowModerationRules()
  }
})

test('văn bản dài được quét theo cửa sổ: nội dung sau ký tự thứ N vẫn bị khớp', async () => {
  const { testModerationRegex, MODERATION_REGEX_WINDOW } = await import('../server/services/moderation-regex.ts')
  const long = `${'x'.repeat(MODERATION_REGEX_WINDOW * 3)} từ cấm`
  assert.equal(testModerationRegex('từ cấm', /từ cấm/iu, long), true)
  // Nằm vắt qua ranh giới cửa sổ đầu.
  const straddle = `${'x'.repeat(MODERATION_REGEX_WINDOW - 3)}từ cấm`
  assert.equal(testModerationRegex('từ cấm', /từ cấm/iu, straddle), true)
  assert.equal(testModerationRegex('từ cấm', /từ cấm/iu, 'x'.repeat(MODERATION_REGEX_WINDOW * 2)), false)
})

test('văn bản dài + luật rẻ: KHÔNG tắt luật (đo theo từng cửa sổ, không cộng dồn) — tin dài không là công tắc tắt luật', async () => {
  const mod = await import('../server/services/moderation-regex.ts')
  const { mock } = await import('node:test')
  const clock = { t: 0 }
  mod.setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => 5_000 })
  const lines: Array<Record<string, unknown>> = []
  const spy = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line))) } catch { /* bỏ qua */ } })
  try {
    mod.resetSlowModerationRules()
    const step = mod.MODERATION_REGEX_WINDOW - mod.MODERATION_REGEX_WINDOW_OVERLAP
    // 20 cửa sổ, mỗi cửa sổ "tốn" 10 ms: tổng 200 ms > mọi ngưỡng cộng dồn cũ (50 ms).
    const text = `${'x'.repeat(step * 19 + mod.MODERATION_REGEX_WINDOW - 3)}cấm`
    let calls = 0
    const fake = { test: (s: string) => { calls += 1; clock.t += 10; return s.includes('cấm') } } as unknown as RegExp
    assert.equal(mod.testModerationRegex('cấm', fake, text), true, 'quét tới cửa sổ cuối và khớp')
    assert.equal(calls, 20)
    assert.equal(mod.isModerationRuleDisabled('cấm'), false, 'luật rẻ không bị tắt vì văn bản dài')
    assert.ok(!lines.some(l => l.event === 'ai_moderation.rule_slow_disabled'))
  } finally {
    spy.mock.restore()
    mod.setModerationRegexTimingForTests(null)
    mod.resetSlowModerationRules()
  }
})

test('văn bản cực dài: dừng quét khi luật dùng quá tổng thời gian cho một văn bản, không tắt luật, log một lần', async () => {
  const mod = await import('../server/services/moderation-regex.ts')
  const { mock } = await import('node:test')
  const clock = { t: 0 }
  mod.setModerationRegexTimingForTests({ elapsed: () => clock.t, now: () => 5_000 })
  const lines: Array<Record<string, unknown>> = []
  const spy = mock.method(console, 'error', (line: unknown) => { try { lines.push(JSON.parse(String(line))) } catch { /* bỏ qua */ } })
  try {
    mod.resetSlowModerationRules()
    const step = mod.MODERATION_REGEX_WINDOW - mod.MODERATION_REGEX_WINDOW_OVERLAP
    const text = 'x'.repeat(step * 300)
    let calls = 0
    const fake = { test: () => { calls += 1; clock.t += 10; return false } } as unknown as RegExp
    assert.equal(mod.testModerationRegex('cấm', fake, text), false)
    assert.ok(calls < 300 && calls <= mod.MODERATION_RULE_CALL_BUDGET_MS / 10 + 1, `dừng sớm, đã chạy ${calls} cửa sổ`)
    assert.equal(mod.isModerationRuleDisabled('cấm'), false)
    mod.testModerationRegex('cấm', fake, text)
    assert.equal(lines.filter(l => l.event === 'ai_moderation.rule_scan_truncated').length, 1, 'log tối đa một lần mỗi khoảng chờ')
  } finally {
    spy.mock.restore()
    mod.setModerationRegexTimingForTests(null)
    mod.resetSlowModerationRules()
  }
})
