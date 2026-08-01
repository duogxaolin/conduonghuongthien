/**
 * The boundaries that keep the article view count honest.
 *
 * Two properties are load-bearing and neither is visible by reading a single
 * function:
 *
 *   • Nothing arriving from a public request can land in a fabrication row. That
 *     depends on `'boost'` being absent from the public allowlist *and* on
 *     `normalizeViewSource` rejecting rather than passing through anything it
 *     does not recognise. Either one alone is enough today; the pair is what
 *     survives a future edit to the other.
 *   • Inflation input is fully validated before any write happens, so a rejected
 *     request cannot leave a partially applied count behind. That is only true
 *     if the validator is pure, which is why it is tested as a value rather than
 *     through the endpoint.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BOOST_MAX_AMOUNT,
  BOOST_MAX_MINUTES,
  BOOST_SOURCE_CATEGORY,
  VIEW_DEDUPE_KEY_MAX_LENGTH,
  VIEW_DEDUPE_WINDOW_SECONDS,
  buildViewDedupeKey,
  normalizeViewSource,
  validateBoostInput,
  viewDay,
} from '../server/services/article-views.ts'
import { SOURCE_CATEGORIES } from '../server/utils/analytics-collection.ts'

describe('the fabrication category is not a public traffic source', () => {
  it('is absent from the allowlist', () => {
    // The separation the whole feature rests on. If this ever passes by
    // accident, a crafted request could write into `fabricated_views`.
    assert.ok(!(SOURCE_CATEGORIES as readonly string[]).includes(BOOST_SOURCE_CATEGORY))
  })

  it('is rejected when a request declares it', () => {
    assert.equal(normalizeViewSource('boost'), 'other')
    assert.equal(normalizeViewSource('BOOST'), 'other')
    assert.equal(normalizeViewSource('  boost  '), 'other')
  })
})

describe('normalizeViewSource', () => {
  it('passes every allowlisted category through unchanged', () => {
    for (const category of SOURCE_CATEGORIES) {
      assert.equal(normalizeViewSource(category), category)
    }
  })

  it('normalises case and surrounding whitespace', () => {
    assert.equal(normalizeViewSource(' Search '), 'search')
    assert.equal(normalizeViewSource('SOCIAL'), 'social')
  })

  it('falls back to other for anything unrecognised, without guessing', () => {
    // Deliberately not inferred: a value we already decided not to trust must
    // not be turned into a more specific claim than "unknown".
    assert.equal(normalizeViewSource('google'), 'other')
    assert.equal(normalizeViewSource('referral-ish'), 'other')
    assert.equal(normalizeViewSource(''), 'other')
  })

  it('falls back to other for non-string input', () => {
    for (const value of [null, undefined, 42, true, {}, [], ['search']]) {
      assert.equal(normalizeViewSource(value), 'other')
    }
  })
})

describe('buildViewDedupeKey', () => {
  const TOKEN = 'a'.repeat(64)

  it('uses the first 32 characters of the token', () => {
    assert.equal(buildViewDedupeKey(12, TOKEN), `av:12:${'a'.repeat(32)}`)
  })

  it('stays well inside the bucket_key column at any plausible article id', () => {
    // `rate_limit_counters.bucket_key` is VARCHAR(191) and is the primary key: a
    // silently truncated key would merge two visitors into one bucket and
    // suppress a genuine view.
    for (const id of [1, 999, 2_147_483_647]) {
      assert.ok(buildViewDedupeKey(id, TOKEN).length <= VIEW_DEDUPE_KEY_MAX_LENGTH)
    }
  })

  it('gives different articles different keys for the same visitor', () => {
    assert.notEqual(buildViewDedupeKey(1, TOKEN), buildViewDedupeKey(2, TOKEN))
  })

  it('gives different visitors different keys for the same article', () => {
    assert.notEqual(buildViewDedupeKey(1, 'a'.repeat(64)), buildViewDedupeKey(1, 'b'.repeat(64)))
  })

  it('takes the whole token when it is shorter than the slice bound', () => {
    assert.equal(buildViewDedupeKey(1, 'x'), 'av:1:x')
  })

  it('holds a 30-minute dedupe window', () => {
    assert.equal(VIEW_DEDUPE_WINDOW_SECONDS, 1800)
  })
})

describe('viewDay', () => {
  it('is the UTC day, matching the day the visitor token is derived under', () => {
    // Local-day would put the token and the row on different days for part of
    // every evening in UTC+7, splitting one visit into two.
    assert.equal(viewDay(new Date('2026-08-01T23:30:00Z')), '2026-08-01')
    assert.equal(viewDay(new Date('2026-08-02T00:30:00Z')), '2026-08-02')
  })
})

describe('validateBoostInput — mode', () => {
  it('accepts exactly the two documented modes', () => {
    assert.deepEqual(validateBoostInput({ mode: 'instant', amount: 10 }), { ok: true, mode: 'instant', amount: 10 })
    assert.deepEqual(
      validateBoostInput({ mode: 'gradual', amount: 10, minutes: 60 }),
      { ok: true, mode: 'gradual', amount: 10, minutes: 60 },
    )
  })

  it('rejects an unknown mode instead of coercing it', () => {
    // Reading an unrecognised mode as "instant" would apply an inflation the
    // operator did not authorise, immediately and irreversibly.
    for (const mode of ['immediate', 'INSTANT ', 'slow', '', null, 1]) {
      const result = validateBoostInput({ mode, amount: 10, minutes: 60 })
      assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} must be rejected`)
    }
  })

  it('rejects a body that is not an object', () => {
    for (const body of [null, undefined, 'instant', 42, ['instant'], []]) {
      assert.equal(validateBoostInput(body).ok, false)
    }
  })
})

describe('validateBoostInput — amount boundaries', () => {
  it('rejects 0 and accepts 1', () => {
    assert.equal(validateBoostInput({ mode: 'instant', amount: 0 }).ok, false)
    assert.equal(validateBoostInput({ mode: 'instant', amount: 1 }).ok, true)
  })

  it('accepts the maximum and rejects one above it', () => {
    assert.equal(BOOST_MAX_AMOUNT, 1_000_000)
    assert.equal(validateBoostInput({ mode: 'instant', amount: BOOST_MAX_AMOUNT }).ok, true)
    assert.equal(validateBoostInput({ mode: 'instant', amount: BOOST_MAX_AMOUNT + 1 }).ok, false)
  })

  it('rejects negatives, fractions and non-numbers', () => {
    for (const amount of [-1, 1.5, NaN, Infinity, '10', null, undefined, {}]) {
      assert.equal(validateBoostInput({ mode: 'instant', amount }).ok, false, `amount ${String(amount)} must be rejected`)
    }
  })
})

describe('validateBoostInput — minutes boundaries', () => {
  it('is required for gradual mode', () => {
    assert.equal(validateBoostInput({ mode: 'gradual', amount: 10 }).ok, false)
  })

  it('rejects 0 and accepts 1', () => {
    assert.equal(validateBoostInput({ mode: 'gradual', amount: 10, minutes: 0 }).ok, false)
    assert.equal(validateBoostInput({ mode: 'gradual', amount: 10, minutes: 1 }).ok, true)
  })

  it('accepts seven days and rejects one minute more', () => {
    assert.equal(BOOST_MAX_MINUTES, 10_080)
    assert.equal(validateBoostInput({ mode: 'gradual', amount: 10, minutes: BOOST_MAX_MINUTES }).ok, true)
    assert.equal(validateBoostInput({ mode: 'gradual', amount: 10, minutes: BOOST_MAX_MINUTES + 1 }).ok, false)
  })

  it('rejects fractions and non-numbers', () => {
    for (const minutes of [1.5, -60, NaN, '60', null, {}]) {
      assert.equal(
        validateBoostInput({ mode: 'gradual', amount: 10, minutes }).ok,
        false,
        `minutes ${String(minutes)} must be rejected`,
      )
    }
  })

  it('ignores minutes in instant mode rather than failing on it', () => {
    // The UI hides the field for instant mode; a stale value left in the form
    // state is not a reason to refuse an otherwise valid request.
    assert.deepEqual(validateBoostInput({ mode: 'instant', amount: 10, minutes: 999_999 }), { ok: true, mode: 'instant', amount: 10 })
  })

  it('reports every rejection in Vietnamese, the language of the admin panel', () => {
    const result = validateBoostInput({ mode: 'gradual', amount: 10 })
    assert.equal(result.ok, false)
    assert.match((result as { message: string }).message, /Thời lượng/)
  })
})

describe('the recording endpoint contract', () => {
  const source = readFileSync(new URL('../server/api/public/articles/[slug]/view.post.ts', import.meta.url), 'utf8')
  /**
   * Comments stripped: this file explains at length why it does *not* consult
   * the collection switch, and a plain substring search would trip on the
   * explanation rather than on a use.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('never reads the client address directly', () => {
    // `getRequestIP` behind nginx returns the docker bridge gateway for every
    // visitor, which would collapse the whole internet into one dedupe bucket.
    assert.ok(!code.includes('getRequestIP'), 'must use getClientIp(event)')
    assert.ok(code.includes('getClientIp(event)'))
  })

  it('answers 202 and never throws a status at the visitor', () => {
    assert.ok(code.includes('setResponseStatus(event, 202)'))
    assert.ok(!code.includes('createError'), 'a view counter must not fail a visitor request')
  })

  it('is not gated on the analytics collection switch', () => {
    // D13: that switch is a privacy decision about measuring visitors; this is
    // the portal's own editorial statistic about its own content.
    assert.ok(!code.includes('collectionEnabled'))
  })
})
