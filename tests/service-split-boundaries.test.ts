/**
 * Ranh giới của bốn nhóm service đã tách (wave2-hardening 5.3 / 5.4 / 5.5 / 5.6).
 *
 *   • `media-portal.ts`     — barrel; mã ở `media-portal-*.ts` (+ `media-validation.ts`,
 *     `media-views.ts` mà barrel xuất lại).
 *   • `chunked-upload.ts`   — barrel; mã ở `chunked-upload-*.ts`.
 *   • `video-processing.ts` — cửa vào; mã ở `video-*.ts`.
 *   • `comments.ts`         — barrel; mã ở `comments-*.ts` (kể cả `comments-reply-email.ts`,
 *     tệp barrel cố ý không xuất lại).
 *
 * Năm luật, mỗi luật chặn một kiểu hỏng không có triệu chứng lúc viết:
 *
 *   1. **Tệp con không bao giờ import barrel/cửa vào của chính nhóm mình**, dù bằng
 *      dạng nào (`import`, `import type`, `export … from`, `import()`, `require()`,
 *      `typeof import()`). Barrel import mọi tệp con; một tệp con import ngược barrel
 *      là một vòng import, và vòng đó chỉ vô hại chừng nào không ai đọc tên nhập vào
 *      ở cấp module — đến ngày có người đọc, giá trị là `undefined` lúc nạp và lỗi nổ
 *      ra xa chỗ sửa. `import()`/`require()` với đối số không cố định trong tệp con
 *      không kiểm được đích, nên cũng đỏ.
 *   2. **`chunked-upload-core.ts` chỉ được nhóm `chunked-upload*` import.** Các tên
 *      như `NOT_FOUND`, `findOwned`, `deps` được `export` chỉ để ba tệp anh em dùng
 *      chung; barrel cố ý không xuất lại chúng. Ngoại lệ duy nhất, nêu tên:
 *      `video-disk-guard.ts` lấy **đúng** `formatBytes` — để cắt vòng import
 *      `video-disk-guard → chunked-upload → chunked-upload-completion →
 *      video-processing → video-disk-guard` có từ trước khi tách.
 *   3. **`trackProcessingClaim` / `forgetProcessingClaim` chỉ đường ống gọi.** Sổ
 *      lượt đang chạy (`activeClaims` ở `video-processing-job.ts`) là thứ để hủy
 *      một lượt chuyển mã đang chạy; ghi vào sổ từ chỗ khác là để lại một mục
 *      không ai xoá, hoặc xoá mục của một lượt còn sống — lúc đó nút hủy im lặng
 *      không làm gì. Nơi khác chỉ hủy qua `abortProcessingClaim`.
 *   4. **Trạng thái cấp module của mỗi nhóm có đúng một chủ** (`_service-split-state.ts`):
 *      không khai hai bản cùng tên trong một nhóm, và không tệp nào ngoài tệp khai báo
 *      ghi vào nó — kể cả ghi qua khoá tính toán `X[k] = …`, `delete`, `++`, phương
 *      thức đổi nội dung (`.set`/`.push`…) hay `Object.assign`, qua barrel hay namespace.
 *   5. **API công khai của barrel `comments.ts` giữ đúng 17 tên giá trị + 17 tên kiểu
 *      như trước khi tách** — bỏ, đổi tên hay đổi loại một export là đỏ; xuất thêm
 *      (helper nội bộ thành API) cũng đỏ. Hình dạng barrel (chỉ `export { … } from
 *      './comments-…'`, không mã, không `export *`) do `reader-audit-atomicity.test.ts`
 *      (`barrelProblems`) canh; luật 5 ghim TÊN.
 *
 * Đọc bằng TypeScript AST (`_module-references.ts` cho đường dẫn module, một lượt
 * AST nhỏ ở `_service-split-sources.ts` cho tên được nhập): chú thích nhắc tới
 * `chunked-upload.ts` không bị tính. Tập tệp quét là mã chạy thật: `server/`,
 * `scripts/`, `shared/` — `tests/` cố ý không quét (test import thẳng tệp con để
 * ghim hành vi nội bộ).
 *
 * Mỗi luật có bằng chứng đột biến **trong bộ test**: cùng bộ kiểm chạy trên bản sao
 * mã nguồn đã chèn một vi phạm, và phải đỏ. Không có nó thì một bộ kiểm không bao
 * giờ thấy gì trông y hệt một bộ kiểm đang canh mã sạch.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMENT_SUBFILE,
  EXPECTED_COMMENT_SERVICE_FILES,
  commentServiceFiles,
  isCommentServiceFile,
} from './_comments-service-source.ts'
import { exportedApi } from './_service-split-modules.ts'
import {
  PRODUCTION_DIRS,
  REPO,
  SERVICES,
  type Family,
  type Sources,
  familyMembers,
  importSites,
  inject,
  moduleOf,
  where,
  withOverrides,
} from './_service-split-sources.ts'
import { stateOwnerCheck } from './_service-split-state.ts'

// ─── Luật 1: tệp con không import barrel/cửa vào của nhóm mình ──────────────

const FAMILIES: Record<string, Family> = {
  'media-portal': {
    barrel: `${SERVICES}/media-portal.ts`,
    prefix: /^media-portal-[a-z0-9-]+\.ts$/,
  },
  'chunked-upload': {
    barrel: `${SERVICES}/chunked-upload.ts`,
    prefix: /^chunked-upload-[a-z0-9-]+\.ts$/,
  },
  // Mọi `video-*.ts`, kể cả `video-r2-sync.ts`: cửa vào không xuất lại nó, nhưng
  // đường ống import nó, nên nó import ngược cửa vào cũng là một vòng.
  'video-processing': {
    barrel: `${SERVICES}/video-processing.ts`,
    prefix: /^video-[a-z0-9-]+\.ts$/,
  },
  // Mọi `comments-*.ts`, kể cả `comments-reply-email.ts`: barrel không xuất lại nó,
  // nhưng `comments-posting.ts` import nó. Mẫu tệp là MỘT định nghĩa dùng chung với
  // các guard đọc mã bình luận (`_comments-service-source.ts`).
  comments: {
    barrel: `${SERVICES}/comments.ts`,
    prefix: COMMENT_SUBFILE,
  },
}

function selfImportViolations(sources: Sources): string[] {
  const violations: string[] = []
  for (const [name, family] of Object.entries(FAMILIES)) {
    const barrelModule = moduleOf(family.barrel)
    for (const member of familyMembers(sources, family)) {
      for (const site of importSites(member, sources.get(member)!)) {
        if (site.target === barrelModule)
          violations.push(`[${name}] ${where(site)} import ngược ${family.barrel}`)
        else if (site.specifier === null)
          violations.push(
            `[${name}] ${where(site)} nạp module bằng đối số không cố định — không kiểm được đích, có thể là ${family.barrel}`,
          )
      }
    }
  }
  return violations
}

// ─── Luật 2: lõi của đường tải lên chỉ nhóm `chunked-upload*` import ─────────

const UPLOAD_CORE = `${SERVICES}/chunked-upload-core`
const UPLOAD_FAMILY_FILE = /^server\/services\/chunked-upload(?:-[a-z0-9-]+)?\.ts$/
/** Tệp ngoài nhóm được import lõi → đúng những tên được phép. Không mục nào được chết. */
const UPLOAD_CORE_EXEMPTIONS: Record<string, { names: string[]; reason: string }> = {
  'server/services/video-disk-guard.ts': {
    names: ['formatBytes'],
    reason:
      'một bộ định dạng dung lượng dùng chung; lấy qua barrel thì sinh vòng import với video-processing',
  },
}

function uploadCoreViolations(sources: Sources): string[] {
  const violations: string[] = []
  const exemptionUsed = new Map<string, Set<string>>()
  for (const [file, source] of sources) {
    for (const site of importSites(file, source)) {
      if (site.target !== UPLOAD_CORE) continue
      if (UPLOAD_FAMILY_FILE.test(file)) continue
      const exemption = UPLOAD_CORE_EXEMPTIONS[file]
      if (!exemption) {
        violations.push(
          `${where(site)} import ${UPLOAD_CORE}.ts — chỉ nhóm chunked-upload* được import lõi (dùng barrel chunked-upload.ts)`,
        )
        continue
      }
      if (site.names === '*') {
        violations.push(
          `${where(site)} nhập cả module ${UPLOAD_CORE}.ts — ngoại lệ chỉ cho ${exemption.names.join(', ')}`,
        )
        continue
      }
      const used = exemptionUsed.get(file) ?? new Set<string>()
      for (const imported of site.names) {
        if (!exemption.names.includes(imported))
          violations.push(
            `${where(site)} nhập '${imported}' từ ${UPLOAD_CORE}.ts — ngoại lệ chỉ cho ${exemption.names.join(', ')}`,
          )
        else used.add(imported)
      }
      exemptionUsed.set(file, used)
    }
  }
  for (const [file, exemption] of Object.entries(UPLOAD_CORE_EXEMPTIONS)) {
    const used = [...(exemptionUsed.get(file) ?? [])].sort()
    if (JSON.stringify(used) !== JSON.stringify([...exemption.names].sort())) {
      violations.push(
        `ngoại lệ chết: ${file} khai nhập ${JSON.stringify(exemption.names)} từ lõi nhưng thực tế nhập ${JSON.stringify(used)} — sửa hoặc bỏ mục trong UPLOAD_CORE_EXEMPTIONS`,
      )
    }
  }
  return violations
}

// ─── Luật 3: chỉ đường ống ghi/xoá sổ lượt đang chạy ─────────────────────────

const CLAIM_REGISTRY_NAMES = ['trackProcessingClaim', 'forgetProcessingClaim']
const CLAIM_REGISTRY_MODULE = `${SERVICES}/video-processing-job`
const CLAIM_REGISTRY_OWNER = `${SERVICES}/video-transcode-pipeline.ts`

/** `{ violations, importers }` — importers để khẳng định luật không kiểm rỗng. */
function claimRegistryCheck(sources: Sources): { violations: string[]; importers: string[] } {
  const violations: string[] = []
  const importers = new Set<string>()
  for (const [file, source] of sources) {
    for (const site of importSites(file, source)) {
      const wholeJobModule = site.names === '*' && site.target === CLAIM_REGISTRY_MODULE
      const namedHit =
        site.names !== '*' && site.names.some((name) => CLAIM_REGISTRY_NAMES.includes(name))
      if (!wholeJobModule && !namedHit) continue
      if (file === CLAIM_REGISTRY_OWNER && namedHit && !wholeJobModule) {
        importers.add(file)
        continue
      }
      violations.push(
        wholeJobModule
          ? `${where(site)} nhập cả module ${CLAIM_REGISTRY_MODULE}.ts — không kiểm được tên, cấm ngoài ${CLAIM_REGISTRY_OWNER}`
          : `${where(site)} nhập/xuất lại ${CLAIM_REGISTRY_NAMES.filter((name) => (site.names as string[]).includes(name)).join(', ')} — chỉ ${CLAIM_REGISTRY_OWNER} được ghi/xoá sổ lượt đang chạy`,
      )
    }
  }
  return { violations, importers: [...importers].sort() }
}

// ─── Luật 4: trạng thái cấp module có một chủ (`_service-split-state.ts`) ────

const stateViolations = (sources: Sources) => stateOwnerCheck(sources, FAMILIES).violations

// ─── Luật 5: API công khai của barrel comments.ts giữ đúng như trước khi tách ─

const COMMENTS_BARREL = `${SERVICES}/comments.ts`

/**
 * API của `server/services/comments.ts` ngay trước khi tách (5.5): bản ở `262eee8`,
 * cha của commit tách `4975679` — không commit nào sửa tệp đó giữa hai mốc. Suy
 * bằng AST từ `git show 262eee8:server/services/comments.ts` (khai báo `export` cấp
 * đỉnh: function/const → giá trị, type → kiểu), ra 17 + 17 tên, khớp từng tên với
 * barrel lúc gộp vào `wave2/integration`.
 *
 * Chép cứng chứ không chạy `git show` lúc test: job `Unit and typecheck` của CI
 * checkout nông (depth 1), không có `262eee8`. Đổi API có chủ đích = sửa danh sách
 * này trong cùng thay đổi, kèm lý do.
 */
const PRE_SPLIT_COMMENTS_API = {
  values: [
    'ADMIN_REPLY_DISPLAY_NAME',
    'COMMENT_MAX_LENGTH',
    'COMMENT_MAX_PER_PAGE',
    'auditCommentRead',
    'checkParentEligibility',
    'countReaderCommentImpact',
    'createAdminReply',
    'createComment',
    'deleteComment',
    'deleteReaderComments',
    'initialsFrom',
    'listCommentsForAdmin',
    'loadCommentThread',
    'parseCommentSource',
    'resolveCommentTarget',
    'serializePublicComment',
    'validateBody',
  ],
  types: [
    'AdminCommentList',
    'AdminCommentRow',
    'AdminReplyResult',
    'BodyValidation',
    'CommentRow',
    'CommentSource',
    'CommentTarget',
    'CommentTargetResolution',
    'CreateCommentInput',
    'CreateCommentResult',
    'DeleteActor',
    'DeleteCommentResult',
    'ParentCandidate',
    'ParentCheck',
    'PublicComment',
    'ReaderCommentImpact',
    'ThreadPage',
  ],
}

function commentsApiViolations(sources: Sources): string[] {
  const api = exportedApi(COMMENTS_BARREL, sources.get(COMMENTS_BARREL)!)
  const violations: string[] = []
  for (const [kind, label] of [
    ['values', 'giá trị'],
    ['types', 'kiểu'],
  ] as const) {
    const expected = PRE_SPLIT_COMMENTS_API[kind]
    for (const name of expected)
      if (!api[kind].includes(name))
        violations.push(
          `${COMMENTS_BARREL} thiếu ${label} '${name}' — có trong API trước khi tách, nơi gọi import nó sẽ hỏng`,
        )
    for (const name of api[kind])
      if (!expected.includes(name))
        violations.push(
          `${COMMENTS_BARREL} xuất thêm ${label} '${name}' — không có trong API trước khi tách; đổi API có chủ đích thì sửa PRE_SPLIT_COMMENTS_API`,
        )
  }
  return violations
}

// ─── Test trên mã thật ───────────────────────────────────────────────────────

describe('ranh giới nhóm service đã tách — mã thật', () => {
  it('tập quét là mã chạy thật và đủ lớn', () => {
    assert.ok(REPO.size >= 400, `chỉ thấy ${REPO.size} tệp trong ${PRODUCTION_DIRS.join(', ')}`)
    for (const family of Object.values(FAMILIES)) {
      assert.ok(REPO.has(family.barrel), `${family.barrel} vắng khỏi tập quét`)
    }
  })

  it('mỗi nhóm suy ra đủ các tệp đang mang mã của nó (không thu hẹp âm thầm)', () => {
    const expected: Record<string, string[]> = {
      'media-portal': [
        'media-portal-admin-read.ts',
        'media-portal-admin-write.ts',
        'media-portal-assets.ts',
        'media-portal-constants.ts',
        'media-portal-public.ts',
        'media-portal-stream.ts',
        'media-portal-thumbnail-override.ts',
        'media-portal-thumbnail.ts',
        'media-validation.ts',
        'media-views.ts',
      ],
      'chunked-upload': [
        'chunked-upload-completion.ts',
        'chunked-upload-core.ts',
        'chunked-upload-receipt.ts',
        'chunked-upload-session.ts',
      ],
      'video-processing': [
        'video-disk-guard.ts',
        'video-process-runner.ts',
        'video-processing-job.ts',
        'video-r2-sync.ts',
        'video-renditions.ts',
        'video-thumbnail-frame.ts',
        'video-transcode-pipeline.ts',
      ],
      // Cùng danh sách mà các guard đọc mã dịch vụ bình luận dùng — một nguồn.
      comments: EXPECTED_COMMENT_SERVICE_FILES.filter((file) => file !== 'comments.ts'),
    }
    assert.equal(expected.comments!.length, 7)
    for (const [name, family] of Object.entries(FAMILIES)) {
      const members = familyMembers(REPO, family)
      for (const file of expected[name]!) {
        assert.ok(
          members.includes(`${SERVICES}/${file}`),
          `[${name}] ${file} vắng khỏi nhóm ${JSON.stringify(members)}`,
        )
      }
    }
  })

  it('nhóm comments và các guard đọc mã bình luận quét cùng một tập tệp', () => {
    // Một mẫu, không hai bản chép: tệp lọt khỏi một bên là tệp không guard audit nào hỏi.
    assert.equal(FAMILIES.comments!.prefix, COMMENT_SUBFILE)
    for (const name of ['comments.ts', 'comments-rules.ts', 'comments-v2.ts', 'comments-a-b2.ts'])
      assert.ok(isCommentServiceFile(name), `${name} phải thuộc dịch vụ bình luận`)
    for (const name of ['comments.js', 'comments-.ts', 'commentsv2.ts', 'comment-rules.ts'])
      assert.ok(!isCommentServiceFile(name), `${name} không thuộc dịch vụ bình luận`)
    const scanned = commentServiceFiles()
    for (const member of familyMembers(REPO, FAMILIES.comments!))
      assert.ok(
        scanned.includes(member),
        `${member} thuộc nhóm comments nhưng vắng khỏi tập quét của guard audit`,
      )
  })

  it('luật 1: không tệp con nào import barrel/cửa vào của chính nhóm mình', () => {
    assert.deepEqual(selfImportViolations(REPO), [])
  })

  it('luật 2: chunked-upload-core.ts chỉ nhóm chunked-upload* import (+ video-disk-guard.ts lấy đúng formatBytes)', () => {
    assert.deepEqual(uploadCoreViolations(REPO), [])
  })

  it('luật 3: trackProcessingClaim/forgetProcessingClaim chỉ video-transcode-pipeline.ts import', () => {
    const { violations, importers } = claimRegistryCheck(REPO)
    assert.deepEqual(violations, [])
    assert.deepEqual(
      importers,
      [CLAIM_REGISTRY_OWNER],
      'luật kiểm rỗng: đường ống phải là nơi nhập hai tên này',
    )
  })

  it('luật 4: trạng thái cấp module của mọi nhóm có một chủ — một bản, chỉ chủ ghi', () => {
    const { violations, inventory, stateImports } = stateOwnerCheck(REPO, FAMILIES)
    assert.deepEqual(violations, [])
    // Không kiểm rỗng: kho có trạng thái thật của từng nhóm…
    for (const state of [
      'server/services/video-processing-job.ts#activeClaims',
      'server/services/video-process-runner.ts#cpulimitAvailable',
      'server/services/chunked-upload-core.ts#NOT_FOUND',
      'server/services/media-portal-constants.ts#MEDIA_VIEW_DEDUPE_RULE',
      'server/services/comments-posting.ts#COMMENT_READER_RULE',
    ])
      assert.ok(inventory.includes(state), `${state} vắng khỏi kho ${JSON.stringify(inventory)}`)
    // …và phép giải tên thật sự đi tới trạng thái, cả thẳng lẫn qua barrel. Nhóm
    // comments chưa xuất trạng thái nào (hai luật giới hạn là `const` riêng của
    // `comments-posting.ts`, `MODERATION_FAILED` là Symbol), nên chưa có lượt nhập nào.
    for (const edge of [
      'server/services/chunked-upload-session.ts ← server/services/chunked-upload-core.ts#NOT_FOUND',
      'server/api/admin/media-portal/[id]/process.post.ts ← server/services/video-renditions.ts#RENDITIONS',
    ])
      assert.ok(stateImports.includes(edge), `${edge} vắng khỏi ${JSON.stringify(stateImports)}`)
  })

  it('luật 5: comments.ts xuất đúng 17 giá trị + 17 kiểu của API trước khi tách', () => {
    assert.equal(PRE_SPLIT_COMMENTS_API.values.length, 17)
    assert.equal(PRE_SPLIT_COMMENTS_API.types.length, 17)
    assert.deepEqual(commentsApiViolations(REPO), [])
  })

  it('luật 5: tên giá trị lúc chạy của comments.ts khớp danh sách (phép đọc AST không lệch)', async () => {
    const surface = await import('../server/services/comments.ts')
    assert.deepEqual(Object.keys(surface).sort(), [...PRE_SPLIT_COMMENTS_API.values].sort())
  })
})

// ─── Bằng chứng đột biến: mỗi luật đỏ khi có vi phạm ──────────────────────────

/** Nối thêm mã vào cuối tệp (sau mọi khai báo) — đột biến vẫn là mã hợp lệ. */
function append(file: string, code: string): Record<string, string> {
  const source = REPO.get(file)
  assert.ok(source, `${file} không có trong tập quét`)
  return { [file]: `${source}\n${code}\n` }
}

/** Thay đúng một đoạn trong tệp thật; đoạn không có thì bằng chứng hỏng, không xanh. */
function replaceIn(file: string, from: string, to: string): Record<string, string> {
  const source = REPO.get(file)!
  assert.ok(source.includes(from), `${file} không còn đoạn ${JSON.stringify(from)} để đột biến`)
  return { [file]: source.replace(from, to) }
}

describe('ranh giới nhóm service đã tách — bằng chứng đột biến', () => {
  it('luật 1 đỏ khi tệp con media-portal-* import barrel', () => {
    const violations = selfImportViolations(
      withOverrides(
        inject(
          'server/services/media-portal-stream.ts',
          "import { coerceResolutionsReady as _c } from './media-portal'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[media-portal\] server\/services\/media-portal-stream\.ts:1 \(import\)/,
    )
  })

  it('luật 1 đỏ khi tệp mà barrel xuất lại (media-validation.ts) import barrel, kể cả có đuôi .ts', () => {
    const violations = selfImportViolations(
      withOverrides(
        inject(
          'server/services/media-validation.ts',
          "export { MEDIA_SOURCES } from './media-portal.ts'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(violations[0]!, /media-validation\.ts:1 \(export … from\)/)
  })

  it('luật 1 đỏ khi tệp con chunked-upload-* import barrel, kể cả chỉ `import type`', () => {
    const violations = selfImportViolations(
      withOverrides(
        inject(
          'server/services/chunked-upload-session.ts',
          "import type { UploadDeps as _D } from './chunked-upload'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[chunked-upload\] server\/services\/chunked-upload-session\.ts:1/,
    )
  })

  it('luật 1 đỏ khi tệp video-* nạp cửa vào bằng `import()` động', () => {
    const violations = selfImportViolations(
      withOverrides({
        'server/services/video-renditions.ts': `${REPO.get('server/services/video-renditions.ts')}\nexport const _lazy = () => import('./video-processing')\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[video-processing\] server\/services\/video-renditions\.ts:\d+ \(import\(\)\)/,
    )
  })

  it('luật 1 KHÔNG nhầm `./media-portal-assets` với barrel `./media-portal`', () => {
    // Cùng tiền tố chữ: so chuỗi thô `'./media-portal'` sẽ khớp nhầm.
    assert.deepEqual(
      selfImportViolations(
        withOverrides(
          inject(
            'server/services/media-portal-thumbnail.ts',
            "import { resolveMediaDirectory as _r } from './media-portal-assets'",
          ),
        ),
      ),
      [],
    )
  })

  it('luật 1 đỏ khi tệp con comments-* import barrel ./comments, ở mọi dạng import', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import',
        inject(
          'server/services/comments-thread.ts',
          "import { createComment as _c } from './comments'",
        ),
        /^\[comments\] server\/services\/comments-thread\.ts:1 \(import\) import ngược server\/services\/comments\.ts$/,
      ],
      [
        'import type, có đuôi .ts',
        inject(
          'server/services/comments-moderation.ts',
          "import type { ThreadPage as _T } from './comments.ts'",
        ),
        /^\[comments\] server\/services\/comments-moderation\.ts:1 \(import\)/,
      ],
      [
        'export … from',
        inject('server/services/comments-posting.ts', "export { validateBody } from './comments'"),
        /^\[comments\] server\/services\/comments-posting\.ts:1 \(export … from\)/,
      ],
      [
        'import() động trong hàm',
        append(
          'server/services/comments-deletion.ts',
          "export async function _lazy() { return (await import('./comments')).createComment }",
        ),
        /^\[comments\] server\/services\/comments-deletion\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'require()',
        append(
          'server/services/comments-rules.ts',
          "export const _req = () => require('./comments')",
        ),
        /^\[comments\] server\/services\/comments-rules\.ts:\d+ \(require\(\)\)/,
      ],
      [
        'typeof import() qua alias #server',
        append(
          'server/services/comments-admin-reply.ts',
          "export type _Api = typeof import('#server/services/comments')",
        ),
        /^\[comments\] server\/services\/comments-admin-reply\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp barrel không xuất lại (comments-reply-email.ts)',
        inject(
          'server/services/comments-reply-email.ts',
          "import { createComment as _c } from './comments'",
        ),
        /^\[comments\] server\/services\/comments-reply-email\.ts:1 \(import\)/,
      ],
      [
        'import() với đối số không cố định',
        append(
          'server/services/comments-thread.ts',
          'export const _dyn = (seam: string) => import(`./comments${seam}`)',
        ),
        /^\[comments\] server\/services\/comments-thread\.ts:\d+ \(import\(\)\) nạp module bằng đối số không cố định/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./comments-rules` với barrel `./comments`', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides(
          inject(
            'server/services/comments-thread.ts',
            "import { validateBody as _v } from './comments-rules'",
          ),
        ),
      ),
      [],
    )
  })

  it('luật 2 đỏ khi một endpoint import thẳng lõi thay vì barrel', () => {
    const violations = uploadCoreViolations(
      withOverrides(
        inject(
          'server/api/admin/media-portal/upload/init.post.ts',
          "import { NOT_FOUND as _n } from '../../../../services/chunked-upload-core'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /init\.post\.ts:1 \(import\) import server\/services\/chunked-upload-core\.ts/,
    )
  })

  it('luật 2 đỏ khi ngoại lệ video-disk-guard.ts nhập thêm tên khác formatBytes', () => {
    const file = 'server/services/video-disk-guard.ts'
    const source = REPO.get(file)!
    const mutated = source.replace(
      "import { formatBytes } from './chunked-upload-core'",
      "import { formatBytes, findOwned } from './chunked-upload-core'",
    )
    assert.notEqual(mutated, source, 'không tìm thấy dòng import formatBytes để đột biến')
    const violations = uploadCoreViolations(withOverrides({ [file]: mutated }))
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(violations[0]!, /nhập 'findOwned'/)
  })

  it('luật 2 đỏ khi ngoại lệ chết (video-disk-guard.ts quay lại lấy formatBytes qua barrel)', () => {
    const file = 'server/services/video-disk-guard.ts'
    const source = REPO.get(file)!
    const mutated = source.replace("from './chunked-upload-core'", "from './chunked-upload'")
    assert.notEqual(mutated, source)
    const violations = uploadCoreViolations(withOverrides({ [file]: mutated }))
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(violations[0]!, /^ngoại lệ chết: server\/services\/video-disk-guard\.ts/)
    // …và chính lượt đó tái tạo vòng import với cửa vào — luật 1 không bắt (khác
    // nhóm), nên luật 2 là nơi canh nó.
  })

  it('luật 3 đỏ khi bộ thu hồi nhập forgetProcessingClaim', () => {
    const { violations } = claimRegistryCheck(
      withOverrides(
        inject(
          'server/services/media-processing-reaper.ts',
          "import { forgetProcessingClaim as _f } from './video-processing-job'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /media-processing-reaper\.ts:1 \(import\) nhập\/xuất lại forgetProcessingClaim/,
    )
  })

  it('luật 3 đỏ khi cửa vào xuất lại trackProcessingClaim (mở đường cho mọi nơi gọi)', () => {
    const { violations } = claimRegistryCheck(
      withOverrides(
        inject(
          'server/services/video-processing.ts',
          "export { trackProcessingClaim } from './video-processing-job'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(violations[0]!, /video-processing\.ts:1 \(export … from\)/)
  })

  it('luật 3 đỏ khi nhập cả module video-processing-job (namespace) ngoài đường ống', () => {
    const { violations } = claimRegistryCheck(
      withOverrides(
        inject(
          'server/services/media-portal-admin-write.ts',
          "import * as _job from './video-processing-job'",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(violations[0]!, /media-portal-admin-write\.ts:1 \(import\) nhập cả module/)
  })

  it('luật 3 kiểm rỗng thì đỏ: đường ống thôi nhập hai tên này', () => {
    const file = CLAIM_REGISTRY_OWNER
    const mutated = REPO.get(file)!.replace(
      /\b(track|forget)ProcessingClaim\b/g,
      '$1ProcessingClaimRenamed',
    )
    const { importers } = claimRegistryCheck(withOverrides({ [file]: mutated }))
    assert.deepEqual(importers, [])
  })

  it('luật 4 đỏ khi tệp con ghi vào trạng thái của tệp anh em bằng `X.p = …`', () => {
    const violations = stateViolations(
      withOverrides(
        append(
          'server/services/chunked-upload-receipt.ts',
          "export function _poke() { NOT_FOUND.message = 'x' }",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[chunked-upload\] server\/services\/chunked-upload-receipt\.ts:\d+ \(gán\) ghi vào 'NOT_FOUND' của server\/services\/chunked-upload-core\.ts/,
    )
  })

  it('luật 4 đỏ khi ghi qua khoá tính toán `X[k] = …` (kể cả bọc `as`)', () => {
    const violations = stateViolations(
      withOverrides(
        append(
          'server/services/chunked-upload-receipt.ts',
          "export function _poke(key: string) { (NOT_FOUND as Record<string, unknown>)[key] = 'x' }",
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /chunked-upload-receipt\.ts:\d+ \(gán, khoá tính toán\) ghi vào 'NOT_FOUND' của server\/services\/chunked-upload-core\.ts/,
    )
  })

  it('luật 4 đỏ với mọi dạng ghi khác: delete, ++, Object.assign, destructure, .set()', () => {
    const violations = stateViolations(
      withOverrides(
        append(
          'server/services/chunked-upload-session.ts',
          [
            'export function _mutate(key: string, src: { a: unknown }) {',
            '  delete (NOT_FOUND as Record<string, unknown>)[key]',
            '  ;(NOT_FOUND as unknown as { n: number }).n++',
            '  Object.assign(NOT_FOUND, {})',
            '  ;({ a: (NOT_FOUND as Record<string, unknown>).b } = src)',
            '  ;(NOT_FOUND as unknown as Map<string, number>)["set"](key, 1)',
            '}',
          ].join('\n'),
        ),
      ),
    )
    assert.equal(violations.length, 5, JSON.stringify(violations))
    for (const form of [
      /\(delete, khoá tính toán\)/,
      /\(\+\+\/--\)/,
      /\(Object\.assign\(\)\)/,
      /\(gán\) ghi vào 'NOT_FOUND'/,
      /\(\.set\(\)\)/,
    ])
      assert.ok(
        violations.some((v) => form.test(v)),
        `${form} vắng: ${JSON.stringify(violations)}`,
      )
  })

  it('luật 4 đỏ khi ghi qua namespace: `ns["X"][k] = …` và `ns[k] = …`', () => {
    const file = 'server/services/chunked-upload-completion.ts'
    const violations = stateViolations(
      withOverrides({
        [file]: [
          "import * as core from './chunked-upload-core'",
          REPO.get(file),
          'export function _ns(key: string) {',
          "  ;(core['NOT_FOUND'] as Record<string, unknown>)[key] = 1",
          '  ;(core as Record<string, unknown>)[key] = 1',
          '}',
        ].join('\n'),
      }),
    )
    assert.equal(violations.length, 2, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /\(gán, khoá tính toán\) ghi vào 'NOT_FOUND' của server\/services\/chunked-upload-core\.ts/,
    )
    assert.match(violations[1]!, /ghi qua khoá tính toán trên namespace của/)
  })

  it('luật 4 đỏ khi endpoint gọi phương thức đổi nội dung trên trạng thái nhập qua barrel', () => {
    const violations = stateViolations(
      withOverrides(
        append(
          'server/api/admin/media-portal/[id]/process.post.ts',
          'export function _grow(extra: never) { (RENDITIONS as unknown as unknown[]).push(extra) }',
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[video-processing\] server\/api\/admin\/media-portal\/\[id\]\/process\.post\.ts:\d+ \(\.push\(\)\) ghi vào 'RENDITIONS' của server\/services\/video-renditions\.ts/,
    )
  })

  it('luật 4 đỏ khi ghi qua `await import()` và `import().then(({ X }) => …)`', () => {
    const violations = stateViolations(
      withOverrides(
        append(
          'server/api/admin/media-portal/upload/init.post.ts',
          [
            'export async function _dyn(key: string) {',
            "  const upload = await import('../../../../services/chunked-upload')",
            '  ;(upload.UPLOAD_STATUSES as unknown as string[]).push(key)',
            "  await import('../../../../services/chunked-upload').then(({ UPLOAD_STATUSES: statuses }) => {",
            '    ;(statuses as unknown as string[])[0] = key',
            '  })',
            '}',
          ].join('\n'),
        ),
      ),
    )
    assert.equal(violations.length, 2, JSON.stringify(violations))
    for (const violation of violations)
      assert.match(
        violation,
        /init\.post\.ts:\d+ .* ghi vào 'UPLOAD_STATUSES' của server\/services\/chunked-upload-core\.ts/,
      )
  })

  it('luật 4 đỏ trong nhóm comments: tệp con ghi vào giới hạn của comments-posting qua khoá tính toán', () => {
    // Hôm nay nhóm này không xuất trạng thái nào; đột biến mở đường (export) rồi ghi.
    const violations = stateViolations(
      withOverrides({
        ...replaceIn(
          'server/services/comments-posting.ts',
          'const COMMENT_READER_RULE',
          'export const COMMENT_READER_RULE',
        ),
        'server/services/comments-deletion.ts': `import { COMMENT_READER_RULE } from './comments-posting'\n${REPO.get('server/services/comments-deletion.ts')}\nexport function _loosen(key: 'limit') { COMMENT_READER_RULE[key] = 0 }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[comments\] server\/services\/comments-deletion\.ts:\d+ \(gán, khoá tính toán\) ghi vào 'COMMENT_READER_RULE' của server\/services\/comments-posting\.ts/,
    )
  })

  it('luật 4 đỏ khi lúc tách trạng thái bị chép sang tệp thứ hai thay vì import', () => {
    const violations = stateViolations(
      withOverrides(
        inject(
          'server/services/video-transcode-pipeline.ts',
          'const activeClaims = new Map<string, AbortController>()',
        ),
      ),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[video-processing\] 'activeClaims' khai ở 2 tệp \(server\/services\/video-processing-job\.ts:\d+, server\/services\/video-transcode-pipeline\.ts:1\)/,
    )
  })

  it('luật 4 KHÔNG đỏ: chủ tự ghi, tên cục bộ che tên đã nhập, chuỗi đi qua lời gọi', () => {
    const core = 'server/services/chunked-upload-core.ts'
    assert.deepEqual(
      stateViolations(
        withOverrides({
          // Chủ ghi trạng thái của chính mình — thẳng, và qua một bí danh nhập lại
          // chính tệp đó (vẫn là chủ, nên không phải lượt ghi thứ hai).
          [core]: [
            "import { NOT_FOUND as _self } from './chunked-upload-core'",
            REPO.get(core),
            "export function _own(key: string) { (NOT_FOUND as Record<string, unknown>)[key] = 'x' }",
            "export function _ownAlias(key: string) { (_self as Record<string, unknown>)[key] = 'x' }",
          ].join('\n'),
          ...append(
            'server/services/chunked-upload-session.ts',
            'export function _shadow(NOT_FOUND: Record<string, number>) { NOT_FOUND.x = 1; NOT_FOUND["y"] = 2 }',
          ),
          ...append(
            'server/api/admin/media-portal/[id]/process.post.ts',
            'export const _sorted = () => RENDITIONS.slice().sort()',
          ),
        }),
      ),
      [],
    )
  })

  it('luật 5 đỏ khi barrel comments.ts bỏ, đổi tên, đổi loại hay xuất thêm một tên', () => {
    const barrel = COMMENTS_BARREL
    const cases: Array<[string, Record<string, string>, string[]]> = [
      [
        'bỏ initialsFrom',
        replaceIn(barrel, '  initialsFrom,\n', ''),
        [`${barrel} thiếu giá trị 'initialsFrom'`],
      ],
      [
        'đổi tên ThreadPage',
        replaceIn(barrel, 'ThreadPage }', 'ThreadPage as CommentThreadPage }'),
        [`${barrel} thiếu kiểu 'ThreadPage'`, `${barrel} xuất thêm kiểu 'CommentThreadPage'`],
      ],
      [
        'giá trị thành kiểu',
        replaceIn(
          barrel,
          "export { createComment } from './comments-posting'",
          "export type { createComment } from './comments-posting'",
        ),
        [`${barrel} thiếu giá trị 'createComment'`, `${barrel} xuất thêm kiểu 'createComment'`],
      ],
      [
        'lộ helper nội bộ',
        append(barrel, "export { MODERATION_FAILED } from './comments-reply-email'"),
        [`${barrel} xuất thêm giá trị 'MODERATION_FAILED'`],
      ],
      [
        'export *',
        append(barrel, "export * from './comments-rules'"),
        [`${barrel} xuất thêm giá trị '* from './comments-rules''`],
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = commentsApiViolations(withOverrides(override))
      assert.deepEqual(
        violations.map((violation) => violation.split(' — ')[0]),
        expected,
        label,
      )
    }
  })
})
