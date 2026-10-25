/**
 * Ranh giới của ba nhóm service đã tách (wave2-hardening 5.3 / 5.4 / 5.6).
 *
 *   • `media-portal.ts`     — barrel; mã ở `media-portal-*.ts` (+ `media-validation.ts`,
 *     `media-views.ts` mà barrel xuất lại).
 *   • `chunked-upload.ts`   — barrel; mã ở `chunked-upload-*.ts`.
 *   • `video-processing.ts` — cửa vào; mã ở `video-*.ts`.
 *
 * Ba luật, mỗi luật chặn một kiểu hỏng không có triệu chứng lúc viết:
 *
 *   1. **Tệp con không bao giờ import barrel/cửa vào của chính nhóm mình.** Barrel
 *      import mọi tệp con; một tệp con import ngược barrel là một vòng import, và
 *      vòng đó chỉ vô hại chừng nào không ai đọc tên nhập vào ở cấp module — đến
 *      ngày có người đọc, giá trị là `undefined` lúc nạp và lỗi nổ ra xa chỗ sửa.
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
 *
 * Đọc bằng TypeScript AST (`_module-references.ts` cho đường dẫn module, một lượt
 * AST nhỏ ở đây cho tên được nhập): chú thích nhắc tới `chunked-upload.ts` không
 * bị tính, còn `import type`, `export … from`, `import()` và `require()` đều bị bắt.
 * Tập tệp quét là mã chạy thật: `server/`, `scripts/`, `shared/`. `tests/` cố ý
 * không quét — test import thẳng tệp con để ghim hành vi nội bộ (vd. điểm tiêm
 * `setCpulimitAvailableForTests` ở `video-process-runner.ts`).
 *
 * Mỗi luật có một bằng chứng đột biến **trong bộ test**: cùng bộ kiểm chạy trên
 * bản sao mã nguồn đã chèn một vi phạm, và phải đỏ. Không có nó thì một bộ kiểm
 * không bao giờ thấy gì trông y hệt một bộ kiểm đang canh mã sạch.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import ts from 'typescript'
import { moduleReferences } from './_module-references.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRODUCTION_DIRS = ['server', 'scripts', 'shared']
const SOURCE_FILE = /\.[cm]?[jt]s$/
const SERVICES = 'server/services'

/** Đường dẫn tương đối (dấu `/`) → mã nguồn. Bằng chứng đột biến thay một mục. */
type Sources = ReadonlyMap<string, string>

function loadProductionSources(): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.isFile() && SOURCE_FILE.test(entry.name))
        out.set(rel, readFileSync(path.join(ROOT, rel), 'utf8'))
    }
  }
  for (const dir of PRODUCTION_DIRS) walk(dir)
  return out
}

const REPO: Sources = loadProductionSources()

function withOverrides(overrides: Record<string, string>): Sources {
  const copy = new Map(REPO)
  for (const [file, source] of Object.entries(overrides)) copy.set(file, source)
  return copy
}

/** Chèn một dòng ngay sau khối import cuối cùng — đột biến vẫn là mã hợp lệ. */
function inject(file: string, line: string): Record<string, string> {
  const source = REPO.get(file)
  assert.ok(
    source,
    `${file} không có trong tập quét — bằng chứng đột biến đang trỏ vào tệp không tồn tại`,
  )
  return { [file]: `${line}\n${source}` }
}

/** Module đích (không đuôi, không `/index`) của một specifier, hoặc null cho package. */
function resolveTarget(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('.'))
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  else if (specifier.startsWith('~~/') || specifier.startsWith('@@/')) target = specifier.slice(3)
  else if (specifier.startsWith('#server/')) target = `server/${specifier.slice('#server/'.length)}`
  else if (specifier.startsWith('#shared/')) target = `shared/${specifier.slice('#shared/'.length)}`
  else return null
  return target.replace(/\.[cm]?[jt]s$/, '').replace(/\/index$/, '')
}

const moduleOf = (file: string) => file.replace(/\.[cm]?[jt]s$/, '')

interface ImportSite {
  file: string
  line: number
  form: string
  /** Module đích đã giải, hoặc null (package / đối số không cố định). */
  target: string | null
  /** Tên được nhập/xuất lại; `'*'` = cả module (namespace, `export *`, `import()`, `require()`). */
  names: string[] | '*'
}

/** Bộ đệm theo tệp: mỗi bằng chứng đột biến quét lại cả repo, chỉ một tệp đổi. */
const siteCache = new Map<string, { source: string; sites: ImportSite[] }>()

/** Mọi lượt nhập/xuất-lại của một tệp, kèm tên. Đường dẫn: `_module-references.ts`. */
function importSites(file: string, source: string): ImportSite[] {
  const cached = siteCache.get(file)
  if (cached && cached.source === source) return cached.sites
  const sites = parseImportSites(file, source)
  siteCache.set(file, { source, sites })
  return sites
}

function parseImportSites(file: string, source: string): ImportSite[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const named = new Map<number, string[] | '*'>()
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const record = (node: ts.Node, names: string[] | '*') => {
    const line = lineOf(node)
    const prior = named.get(line)
    named.set(line, prior === '*' || names === '*' ? '*' : [...(prior ?? []), ...names])
  }
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const names: string[] = []
      let whole = false
      if (clause?.name) names.push('default')
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) whole = true
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements)
          names.push((element.propertyName ?? element.name).text)
      }
      record(statement, whole ? '*' : names)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const clause = statement.exportClause
      if (!clause || ts.isNamespaceExport(clause)) record(statement, '*')
      else
        record(
          statement,
          clause.elements.map((element) => (element.propertyName ?? element.name).text),
        )
    }
  }
  return moduleReferences(file, source).map((ref) => ({
    file,
    line: ref.line,
    form: ref.form,
    target: ref.specifier === null ? null : resolveTarget(file, ref.specifier),
    // `import()` / `require()` / `import()` kiểu không có danh sách tên → cả module.
    names:
      ref.form === 'import' || ref.form === 'export … from' ? (named.get(ref.line) ?? '*') : '*',
  }))
}

const where = (site: ImportSite) => `${site.file}:${site.line} (${site.form})`

// ─── Luật 1: tệp con không import barrel/cửa vào của nhóm mình ──────────────

interface Family {
  barrel: string
  /** Tên tệp (trong `server/services/`) thuộc nhóm theo tiền tố. */
  prefix: RegExp
}

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
}

/** Thành viên của nhóm = tệp theo tiền tố ∪ đích mà barrel xuất lại (suy ra, không chép tay). */
function familyMembers(sources: Sources, family: Family): string[] {
  const members = new Set<string>()
  for (const file of sources.keys()) {
    if (
      path.posix.dirname(file) === SERVICES &&
      family.prefix.test(path.posix.basename(file)) &&
      file !== family.barrel
    ) {
      members.add(file)
    }
  }
  const barrelSource = sources.get(family.barrel)
  assert.ok(barrelSource, `${family.barrel} không tồn tại`)
  for (const site of importSites(family.barrel, barrelSource)) {
    if (site.form !== 'export … from' || !site.target) continue
    const file = `${site.target}.ts`
    if (sources.has(file)) members.add(file)
  }
  return [...members].sort()
}

function selfImportViolations(sources: Sources): string[] {
  const violations: string[] = []
  for (const [name, family] of Object.entries(FAMILIES)) {
    const barrelModule = moduleOf(family.barrel)
    for (const member of familyMembers(sources, family)) {
      for (const site of importSites(member, sources.get(member)!)) {
        if (site.target === barrelModule)
          violations.push(`[${name}] ${where(site)} import ngược ${family.barrel}`)
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

// ─── Test trên mã thật ───────────────────────────────────────────────────────

describe('ranh giới nhóm service đã tách — mã thật', () => {
  it('tập quét là mã chạy thật và đủ lớn', () => {
    assert.ok(REPO.size >= 400, `chỉ thấy ${REPO.size} tệp trong ${PRODUCTION_DIRS.join(', ')}`)
    for (const file of [
      'server/services/media-portal.ts',
      'server/services/chunked-upload.ts',
      'server/services/video-processing.ts',
    ]) {
      assert.ok(REPO.has(file), `${file} vắng khỏi tập quét`)
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
    }
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
})

// ─── Bằng chứng đột biến: mỗi luật đỏ khi có vi phạm ──────────────────────────

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
})
