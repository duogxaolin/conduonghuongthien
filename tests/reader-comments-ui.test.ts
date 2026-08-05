/**
 * Structural contract for the public comment UI.
 *
 * These assertions read SFC source text through @vue/compiler-sfc and never mount
 * a component. That limit is the same one tests/skeleton-loading-ui.test.ts and
 * tests/admin-error-retry-ui.test.ts state about themselves, and it is worth
 * restating: this file proves the guards are still WRITTEN. It proves nothing
 * about whether they paint, whether a click wires up, or whether a reader ever
 * sees the right thing. What it does catch is a refactor deleting one of them,
 * which is the failure mode these particular guards actually have.
 *
 * Comments are STRIPPED before asserting on forbidden strings. Without that, the
 * comment in ArticleComments.vue explaining *why* `v-html` must never appear
 * would itself fail the `v-html` guard — and the lesson someone would draw is
 * "delete the explanation", not "keep the guard". The same trap already bit
 * tests/public-qa-documents-page.test.ts.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = (relative: string) => readFile(new URL(`../app/${relative}`, import.meta.url), 'utf8')

/** HTML comments out of the template, JS comments out of the script. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

async function sfcOf(file: string) {
  const source = await read(file)
  const parsed = parse(source, { filename: file })
  return {
    source,
    stripped: stripComments(source),
    template: parsed.descriptor.template?.content ?? '',
    script: parsed.descriptor.scriptSetup?.content ?? parsed.descriptor.script?.content ?? '',
  }
}

const PUBLIC_COMMENT_FILES = [
  'components/ArticleComments.vue',
  'components/ReaderAvatar.vue',
]

describe('comment bodies are text, never markup', () => {
  it('no public comment component uses v-html', async () => {
    for (const file of PUBLIC_COMMENT_FILES) {
      const { stripped } = await sfcOf(file)
      assert.ok(
        !/v-html/.test(stripped),
        `${file} renders with v-html — a comment body is supplied by an anonymous member of the public and is stored verbatim precisely because the template cannot interpret it`,
      )
    }
  })

  it('bodies are rendered with whitespace-pre-line and break-words', async () => {
    const { template } = await sfcOf('components/ArticleComments.vue')
    // Without pre-line every paragraph break a citizen typed collapses into one
    // run of text; without break-words a pasted URL widens the page on a phone.
    assert.match(template, /whitespace-pre-line/)
    assert.match(template, /break-words/)
  })
})

describe('no visitor request reaches a third-party image host', () => {
  it('the avatar renders initials rather than an img', async () => {
    const { stripped } = await sfcOf('components/ReaderAvatar.vue')
    // design.md D7. Hotlinking lh3.googleusercontent.com would send every
    // visitor's address and referrer to Google on the pages citizens read — the
    // same reason this project self-hosts its webfont.
    assert.ok(!/<img\b/.test(stripped), 'ReaderAvatar renders an <img> — avatars must be drawn locally')
    assert.ok(!/googleusercontent|lh3\.google/.test(stripped), 'ReaderAvatar references a Google image host')
  })

  it('no comment component interpolates a Tailwind class name', async () => {
    for (const file of PUBLIC_COMMENT_FILES) {
      const { stripped } = await sfcOf(file)
      // Tailwind v3 scans source TEXT at build time, so `bg-[${tone}]` produces
      // no CSS at all and the element silently loses its styling with no error.
      assert.ok(
        !/(bg|text|w|h|grid-cols|border)-\[?\$\{/.test(stripped),
        `${file} builds a class name by interpolation — Tailwind v3 will never generate that CSS`,
      )
    }
  })
})

describe('the loading state is announced and respects reduced motion', () => {
  it('the skeleton container carries role=status, aria-busy and a Vietnamese sr-only label', async () => {
    const { template } = await sfcOf('components/ArticleComments.vue')
    assert.match(template, /role="status"/)
    assert.match(template, /aria-busy="true"/)
    // Without the label a screen reader reads out a run of empty boxes instead of
    // "đang tải bình luận".
    assert.match(template, /class="sr-only">Đang tải bình luận/)
  })

  it('every animate-pulse element also carries motion-reduce:animate-none', async () => {
    for (const file of PUBLIC_COMMENT_FILES) {
      const { template } = await sfcOf(file)
      // Per TAG, not per file: a file with two placeholders where only one is
      // guarded would pass a file-wide search.
      for (const tag of template.match(/<[^>]*animate-pulse[^>]*>/g) ?? []) {
        assert.ok(
          tag.includes('motion-reduce:animate-none'),
          `${file} animates a placeholder that ignores prefers-reduced-motion — that setting exists for people with vestibular disorders`,
        )
      }
    }
  })

  it('the grey placeholder blocks are hidden from assistive technology', async () => {
    const { template } = await sfcOf('components/ArticleComments.vue')
    assert.match(template, /aria-hidden="true"/)
  })
})

describe('the error branch is persistent, announced, and retries the failed fetch', () => {
  it('holds a rejection in a ref and renders it with role=alert', async () => {
    const { script, template } = await sfcOf('components/ArticleComments.vue')
    assert.match(script, /const errorMessage\s*=\s*ref\(/)
    assert.match(template, /v-else-if="errorMessage"/)
    // A failed fetch and an empty thread otherwise look identical, and a reader
    // would conclude nobody has written anything.
    assert.match(template, /role="alert"/)
  })

  it('the retry calls a function declared in the same file, not a page reload', async () => {
    const { script, template, stripped } = await sfcOf('components/ArticleComments.vue')
    assert.match(template, /@click="loadThread(\(|")/)
    assert.match(script, /(async\s+)?function loadThread\s*\(/)
    assert.ok(
      !/location\s*\.\s*reload\s*\(/.test(stripped),
      'the comment thread reloads the page to retry — the article above is still readable and there is no reason to lose it',
    )
  })
})

describe('nothing reader-specific can enter a cached page', () => {
  it('the thread and the identity are both fetched after mount', async () => {
    const { script } = await sfcOf('components/ArticleComments.vue')
    // Article routes are served with swr: 60, so a thread rendered on the server
    // would be handed to the next visitor from cache — including the canDelete
    // flags saying which comments are the CURRENT reader's to remove.
    assert.match(script, /onMounted\(/)
    assert.ok(
      !/useFetch\(|useAsyncData\(/.test(script),
      'the comment thread uses useFetch/useAsyncData, which runs during SSR — its response is reader-specific and must never be cached',
    )
  })

  it('the header renders reader state inside client-only', async () => {
    const { template } = await sfcOf('layouts/default.vue')
    assert.match(template, /<client-only>/)
    assert.match(template, /readerLoaded/)
  })

  it('the composable fetches identity only from its own load function', async () => {
    const source = await read('composables/useReaderAuth.ts')
    assert.match(source, /\/api\/public\/reader\/me/)
    assert.ok(
      !/useFetch\(|useAsyncData\(/.test(stripComments(source)),
      'useReaderAuth uses useFetch/useAsyncData — identity would be resolved during SSR and cached',
    )
  })
})

describe('a lapsed session is a screen the reader can act on', () => {
  it('a 401 on a write drops the cached identity', async () => {
    const { script } = await sfcOf('components/ArticleComments.vue')
    // A reader ticket lives 30 days and a ban bumps tokenVersion, so the server
    // can start refusing writes while the page sits open. Without this, stale
    // `isSignedIn` keeps the compose box rendered with "Chưa đăng nhập" beneath it
    // and no sign-in button anywhere — a dead end whose only exit is a reload.
    assert.match(script, /status === 401/)
    assert.match(script, /forgetReader\(\)/)
  })

  it('a 403 does not offer a pointless sign-in', async () => {
    const { script } = await sfcOf('components/ArticleComments.vue')
    // 403 is a ban: the reader IS signed in, and signing in again would succeed
    // and change nothing, which reads as a broken portal rather than a decision.
    assert.ok(
      !/status === 403[\s\S]{0,120}forgetReader/.test(script),
      'a ban must not clear the identity — that would invite a sign-in that fixes nothing',
    )
  })

  it('the reason is rendered on the signed-out block, not only inside the form', async () => {
    const { template } = await sfcOf('components/ArticleComments.vue')
    // `submitError` lives inside the compose form, so it is unmounted by the very
    // state change it needs to explain. The message has to sit on the block that
    // replaces it.
    const signedOut = template.slice(template.indexOf('v-if="!isSignedIn"'))
    assert.match(signedOut.slice(0, 900), /sessionLapsed/)
    assert.match(signedOut.slice(0, 900), /role="alert"/)
  })

  it('the typed text is persisted before the identity is dropped', async () => {
    const { script } = await sfcOf('components/ArticleComments.vue')
    // signIn() is a real top-level navigation (window.location.href), so every ref
    // in this component dies. Promising "nội dung vẫn được giữ" without writing it
    // somewhere that survives that navigation would be a lie told at exactly the
    // moment the reader is relying on it.
    assert.match(script, /sessionStorage/)
    const branch = script.slice(script.indexOf('status === 401'))
    const saveAt = branch.indexOf('saveDraft()')
    const forgetAt = branch.indexOf('forgetReader()')
    assert.ok(saveAt !== -1 && forgetAt !== -1, 'the 401 branch no longer saves the draft')
    assert.ok(saveAt < forgetAt, 'the draft must be saved BEFORE the identity is dropped')
  })

  it('the draft is session-scoped and cleared once used', async () => {
    const { script, stripped } = await sfcOf('components/ArticleComments.vue')
    // localStorage would resurrect an abandoned half-question months later on a
    // shared machine — somebody else's words in the current reader's box.
    //
    // Asserted on the COMMENT-STRIPPED source: the code carries a comment naming
    // localStorage to explain why it is not used, and matching raw source would
    // fail on that explanation. This is the trap this file's header warns about,
    // and it caught this very assertion on the first run.
    assert.ok(
      !/localStorage/.test(stripped),
      'a comment draft must not outlive the browsing session',
    )
    assert.match(script, /removeItem/)
    // And cleared on a successful post, or the next page load refills the box with
    // the comment that was already sent.
    const submit = script.slice(script.indexOf('async function submit'))
    assert.match(submit.slice(0, 900), /clearDraft\(\)/)
  })
})

describe('the compose form does not lose what a citizen typed', () => {
  it('the submit control is disabled while a request is in flight', async () => {
    const { template } = await sfcOf('components/ArticleComments.vue')
    assert.match(template, /:disabled="submitting/)
  })

  it('the body is cleared only after the write is known to have landed', async () => {
    const { script } = await sfcOf('components/ArticleComments.vue')
    // The clear must sit AFTER the awaited $fetch inside submit(); clearing first
    // would discard three paragraphs when the write hits a rate limit.
    const submit = script.slice(script.indexOf('async function submit'))
    const fetchAt = submit.indexOf('$fetch')
    const clearAt = submit.indexOf("body.value = ''")
    assert.ok(fetchAt !== -1 && clearAt !== -1, 'submit() no longer posts and clears the body')
    assert.ok(
      clearAt > fetchAt,
      'submit() clears the typed body before the write is confirmed — a failed post would silently discard it',
    )
  })
})
