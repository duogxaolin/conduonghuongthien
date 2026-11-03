/**
 * Structural contract for the public comment UI.
 *
 * These assertions read SFC source text through @vue/compiler-sfc and never mount
 * a component. That limit is the same one tests/skeleton-loading-ui.test.ts and
 * tests/admin-error-retry-ui.test.ts state about themselves, and it is worth
 * restating: this file proves the guards are still WRITTEN. It proves nothing
 * about whether they paint, whether a click wires up, or whether a reader ever
 * sees the right thing. What it does catch is a refactor deleting one of them,
 * which is the failure mode these particular guards actually have. (What the
 * thread DOES is pinned by tests/article-comments-thread.test.ts, which mounts it.)
 *
 * Comments are STRIPPED before asserting on forbidden strings. Without that, the
 * comment in ArticleComments.vue explaining *why* `v-html` must never appear
 * would itself fail the `v-html` guard — and the lesson someone would draw is
 * "delete the explanation", not "keep the guard". The same trap already bit
 * tests/public-qa-documents-page.test.ts.
 *
 * Since wave3 4.2 the thread is a FAMILY: ArticleComments.vue (state, load, error +
 * retry, skeleton — pinned on that file itself), the display parts in
 * `components/comments/`, `useCommentWrites`/`useCommentAnchor` and
 * `utils/comment-thread.ts` (tests/_component-family.ts, parts derived from the
 * directory). Every "must never appear" check and every check on what moved reads
 * the whole family; the last block proves each one still bites when the violation is
 * planted in a part rather than in the parent.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { ARTICLE_COMMENTS_FAMILY as THREAD, familyScript, familyTemplate, familyVueFiles, readAppFile } from './_component-family.ts'

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

/** Every public comment component: the thread family's `.vue` files + the avatar. */
const publicCommentFiles = (overrides?: Record<string, string>) => [
  ...familyVueFiles(THREAD, overrides),
  { file: 'components/ReaderAvatar.vue', source: readAppFile('components/ReaderAvatar.vue') },
]
const templateOf = (source: string, file: string) => parse(source, { filename: file }).descriptor.template?.content ?? ''

// ─── Predicates, shared by the guards below and their injection proofs ────────

const vHtmlOffenders = (files: Array<{ file: string, source: string }>) =>
  files.filter(f => /v-html/.test(stripComments(f.source))).map(f => f.file)

const interpolatedClassOffenders = (files: Array<{ file: string, source: string }>) =>
  files.filter(f => /(bg|text|w|h|grid-cols|border)-\[?\$\{/.test(stripComments(f.source))).map(f => f.file)

const unguardedPulses = (files: Array<{ file: string, source: string }>) =>
  files.flatMap(f => (templateOf(f.source, f.file).match(/<[^>]*animate-pulse[^>]*>/g) ?? [])
    .filter(tag => !tag.includes('motion-reduce:animate-none'))
    .map(tag => `${f.file}: ${tag.slice(0, 100)}`))

/**
 * Every element that prints a comment body (`{{ <x>.body }}` — a comment, a reply, an
 * optimistic entry) carries both classes. Per element, not "somewhere in the file": a body
 * that loses `break-words` widens the page on a phone whatever the other bodies do.
 */
function bodyClassProblems(template: string): string[] {
  const bodies = [...template.matchAll(/<(\w+)\s[^>]*?class="([^"]*)"[^>]*>\{\{\s*\w+\.body\s*\}\}<\/\1>/g)]
  if (bodies.length < 3) return [`expected the comment, reply and optimistic bodies (3), found ${bodies.length}`]
  return bodies.filter(([, , cls]) => !/\bwhitespace-pre-line\b/.test(cls!) || !/\bbreak-words\b/.test(cls!)).map(([tag]) => tag)
}

/** The 401 branch writes the draft BEFORE dropping the identity. */
function draftSavedBeforeForget(script: string): boolean {
  const branch = script.slice(script.indexOf('status === 401'))
  const saveAt = branch.indexOf('saveDraft()')
  const forgetAt = branch.indexOf('forgetReader()')
  return script.includes('status === 401') && saveAt !== -1 && forgetAt !== -1 && saveAt < forgetAt
}

/** In `submit`, the box is cleared only after the awaited write. */
function clearedAfterWrite(script: string): boolean {
  const submit = script.slice(script.indexOf('async function submit'))
  // The write is `$fetch` (before the split) or the component's `api.post` (after it).
  const fetchAt = submit.search(/\$fetch|api\.post\(/)
  const clearAt = submit.indexOf("body.value = ''")
  return script.includes('async function submit') && fetchAt !== -1 && clearAt !== -1 && clearAt > fetchAt
}

/** The reason for a lapsed session is on the signed-out block, announced. */
function lapsedReasonOnSignedOutBlock(template: string): boolean {
  const at = template.indexOf('v-if="!isSignedIn"')
  if (at === -1) return false
  const signedOut = template.slice(at, at + 900)
  return /sessionLapsed/.test(signedOut) && /role="alert"/.test(signedOut)
}

describe('comment bodies are text, never markup', () => {
  it('no public comment component uses v-html', () => {
    // A comment body is supplied by an anonymous member of the public and is stored
    // verbatim precisely because the template cannot interpret it.
    assert.deepEqual(vHtmlOffenders(publicCommentFiles()), [], 'a public comment component renders with v-html')
  })

  it('bodies are rendered with whitespace-pre-line and break-words', () => {
    // Without pre-line every paragraph break a citizen typed collapses into one
    // run of text; without break-words a pasted URL widens the page on a phone.
    assert.deepEqual(bodyClassProblems(familyTemplate(THREAD)), [])
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

  it('no comment component interpolates a Tailwind class name', () => {
    // Tailwind v3 scans source TEXT at build time, so `bg-[${tone}]` produces
    // no CSS at all and the element silently loses its styling with no error.
    assert.deepEqual(interpolatedClassOffenders(publicCommentFiles()), [], 'Tailwind v3 will never generate CSS for an interpolated class name')
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

  it('every animate-pulse element also carries motion-reduce:animate-none', () => {
    // Per TAG, not per file: a file with two placeholders where only one is
    // guarded would pass a file-wide search. That setting exists for people with
    // vestibular disorders.
    assert.deepEqual(unguardedPulses(publicCommentFiles()), [])
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
    const { script, template } = await sfcOf('components/ArticleComments.vue')
    assert.match(template, /@click="loadThread(\(|")/)
    assert.match(script, /(async\s+)?function loadThread\s*\(/)
    assert.ok(
      !/location\s*\.\s*reload\s*\(/.test(stripComments(familyScript(THREAD) + familyTemplate(THREAD))),
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
      !/useFetch\(|useAsyncData\(/.test(familyScript(THREAD)),
      'the comment thread uses useFetch/useAsyncData, which runs during SSR — its response is reader-specific and must never be cached',
    )
  })

  it('the header renders reader state inside client-only', async () => {
    // Sau tách template, khối danh tính người đọc nằm ở DefaultHeader.vue.
    const { template } = await sfcOf('components/layout/DefaultHeader.vue')
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
  it('a 401 on a write drops the cached identity', () => {
    const script = familyScript(THREAD)
    // A reader ticket lives 30 days and a ban bumps tokenVersion, so the server
    // can start refusing writes while the page sits open. Without this, stale
    // `isSignedIn` keeps the compose box rendered with "Chưa đăng nhập" beneath it
    // and no sign-in button anywhere — a dead end whose only exit is a reload.
    assert.match(script, /status === 401/)
    assert.match(script, /forgetReader\(\)/)
  })

  it('a 403 does not offer a pointless sign-in', () => {
    // 403 is a ban: the reader IS signed in, and signing in again would succeed
    // and change nothing, which reads as a broken portal rather than a decision.
    assert.ok(
      !/status === 403[\s\S]{0,120}forgetReader/.test(familyScript(THREAD)),
      'a ban must not clear the identity — that would invite a sign-in that fixes nothing',
    )
  })

  it('the reason is rendered on the signed-out block, not only inside the form', () => {
    // `submitError` lives inside the compose form, so it is unmounted by the very
    // state change it needs to explain. The message has to sit on the block that
    // replaces it.
    assert.ok(lapsedReasonOnSignedOutBlock(familyTemplate(THREAD)))
  })

  it('the typed text is persisted before the identity is dropped', () => {
    // signIn() is a real top-level navigation (window.location.href), so every ref
    // in this component dies. Promising "nội dung vẫn được giữ" without writing it
    // somewhere that survives that navigation would be a lie told at exactly the
    // moment the reader is relying on it.
    const script = familyScript(THREAD)
    assert.match(script, /sessionStorage/)
    assert.ok(draftSavedBeforeForget(script), 'the draft must be saved BEFORE the identity is dropped')
  })

  it('the draft is session-scoped and cleared once used', () => {
    const script = familyScript(THREAD)
    // localStorage would resurrect an abandoned half-question months later on a
    // shared machine — somebody else's words in the current reader's box.
    //
    // Asserted on the COMMENT-STRIPPED source: the code carries a comment naming
    // localStorage to explain why it is not used, and matching raw source would
    // fail on that explanation. This is the trap this file's header warns about,
    // and it caught this very assertion on the first run.
    assert.ok(!/localStorage/.test(stripComments(script)), 'a comment draft must not outlive the browsing session')
    assert.match(script, /removeItem/)
    // And cleared on a successful post, or the next page load refills the box with
    // the comment that was already sent.
    const submit = script.slice(script.indexOf('async function submit'))
    assert.match(submit.slice(0, 900), /clearDraft\(\)/)
  })
})

describe('the compose form does not lose what a citizen typed', () => {
  it('the submit control is disabled while a request is in flight', () => {
    assert.match(familyTemplate(THREAD), /:disabled="submitting/)
  })

  it('the body is cleared only after the write is known to have landed', () => {
    // The clear must sit AFTER the awaited write inside submit(); clearing first
    // would discard three paragraphs when the write hits a rate limit.
    assert.ok(
      clearedAfterWrite(familyScript(THREAD)),
      'submit() clears the typed body before the write is confirmed — a failed post would silently discard it',
    )
  })
})

// ─── Injection proofs: each guard above still bites when the violation is in a part ──

describe('the family guards bite in every part of the thread (wave3 4.2)', () => {
  const PLANTED = 'components/comments/PlantedPart.vue'
  const part = (template: string) => `<template>${template}</template>\n<script setup lang="ts">\n</script>\n`
  const writes = readAppFile('composables/useCommentWrites.ts')
  const item = readAppFile('components/comments/CommentThreadItem.vue')
  const composer = readAppFile('components/comments/CommentComposer.vue')

  it('the scan includes a part added to components/comments/', () => {
    assert.ok(familyVueFiles(THREAD, { [PLANTED]: part('<p>x</p>') }).some(f => f.file === PLANTED))
    // …but not a file outside the family (a proof cannot hand the guard what the real scan never reads).
    assert.ok(!familyVueFiles(THREAD, { 'components/Elsewhere.vue': part('<p>x</p>') }).some(f => f.file === 'components/Elsewhere.vue'))
  })

  it('v-html planted in a new part / in CommentThreadItem is caught', () => {
    assert.deepEqual(vHtmlOffenders(publicCommentFiles({ [PLANTED]: part('<div v-html="c.body"></div>') })), [PLANTED])
    const planted = item.replace('{{ comment.body }}</p>', '</p><div v-html="comment.body"></div>')
    assert.deepEqual(vHtmlOffenders(publicCommentFiles({ 'components/comments/CommentThreadItem.vue': planted })), ['components/comments/CommentThreadItem.vue'])
  })

  it('an interpolated class and an unguarded pulse in a part are caught', () => {
    assert.deepEqual(interpolatedClassOffenders(publicCommentFiles({ [PLANTED]: part('<div :class="`bg-[${tone}]`"></div>') })), [PLANTED])
    assert.equal(unguardedPulses(publicCommentFiles({ [PLANTED]: part('<div class="animate-pulse"></div>') })).length, 1)
  })

  it('a body losing break-words in CommentThreadItem is caught', () => {
    const planted = item.replace('text-[#2C3529] whitespace-pre-line break-words">{{ reply.body }}', 'text-[#2C3529] whitespace-pre-line">{{ reply.body }}')
    assert.notEqual(planted, item)
    assert.equal(bodyClassProblems(familyTemplate(THREAD, { 'components/comments/CommentThreadItem.vue': planted })).length, 1)
  })

  it('identity dropped before the draft is saved (in useCommentWrites) is caught', () => {
    const planted = writes.replace('saveDraft()\n      forgetReader()', 'forgetReader()\n      saveDraft()')
    assert.notEqual(planted, writes)
    assert.equal(draftSavedBeforeForget(familyScript(THREAD, { 'composables/useCommentWrites.ts': planted })), false)
  })

  it('the box cleared before the awaited write (in useCommentWrites) is caught', () => {
    const planted = writes.replace("    try {\n      const res = await api.post(", "    if (parentId === null) body.value = ''\n    try {\n      const res = await api.post(")
    assert.notEqual(planted, writes)
    assert.equal(clearedAfterWrite(familyScript(THREAD, { 'composables/useCommentWrites.ts': planted })), false)
  })

  it('a module is inside the scanned script: localStorage / useAsyncData / location.reload planted there would be caught', () => {
    for (const plant of ['window.localStorage.setItem(k, v)', 'useAsyncData(() => 1)', 'location.reload()']) {
      const script = familyScript(THREAD, { 'composables/useCommentWrites.ts': `${writes}\n${plant}\n` })
      assert.ok(/localStorage|useAsyncData\(|location\s*\.\s*reload\s*\(/.test(stripComments(script)), plant)
    }
  })

  it('the lapsed-session reason moved off the signed-out block (in CommentComposer) is caught', () => {
    const planted = composer.replace('<p v-if="sessionLapsed" role="alert"', '<p v-if="sessionLapsed"')
    assert.notEqual(planted, composer)
    assert.equal(lapsedReasonOnSignedOutBlock(familyTemplate(THREAD, { 'components/comments/CommentComposer.vue': planted })), false)
  })
})
