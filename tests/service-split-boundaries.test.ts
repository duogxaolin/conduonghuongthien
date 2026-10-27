/**
 * Ranh giới của chín nhóm tệp đã tách (wave2-hardening 5.3 / 5.4 / 5.5 / 5.6 + `backup.ts`,
 * wave3-long-term 4.3 `moderation-worker.ts`, `server/utils/chatbot/chat-policy.ts`,
 * `ai-gateway.ts` và `moderation-regex.ts`).
 *
 *   • `media-portal.ts`     — barrel; mã ở `media-portal-*.ts` (+ `media-validation.ts`,
 *     `media-views.ts` mà barrel xuất lại).
 *   • `chunked-upload.ts`   — barrel; mã ở `chunked-upload-*.ts`.
 *   • `video-processing.ts` — cửa vào; mã ở `video-*.ts`.
 *   • `comments.ts`         — barrel; mã ở `comments-*.ts` (kể cả `comments-reply-email.ts`,
 *     tệp barrel cố ý không xuất lại).
 *   • `backup.ts`           — barrel; mã ở `backup-{names,locks,run,rotation,sweep,catalog}.ts`.
 *     `backup-*.ts` có từ trước khi tách (`backup-restore.ts`, `backup-scheduler.ts`,
 *     `backup-sql.ts`…) là ANH EM, không thuộc nhóm: chúng import barrel đúng chủ đích.
 *     Mẫu tệp `BACKUP_PART` dựng từ danh sách anh em ở `_backup-service-family.ts` — một
 *     nguồn với các guard đọc mã sao lưu.
 *   • `moderation-worker.ts` — barrel; mã ở `moderation-worker-*.ts` + ba tệp tách từ
 *     trước (`moderation-instant.ts`, `moderation-rules-cache.ts`, `moderation-stats.ts`).
 *     `moderation-regex.ts` (cùng mọi `moderation-regex-*.ts`) và `moderation-rescan-job.ts`
 *     là ANH EM (rescan-job import barrel đúng chủ đích). Mẫu `MODERATION_WORKER_PART` ở
 *     `_moderation-worker-family.ts` — một nguồn với guard đọc mã kiểm duyệt
 *     (`moderation-always-scan`); nó loại cả nhóm regex bằng chính `MODERATION_REGEX_PART`.
 *   • `moderation-regex.ts` — barrel; mã ở `moderation-regex-{limits,check,runtime,parser,
 *     analysis}.ts` (tách nguyên văn: 55 khai báo cấp đỉnh giống từng byte, 5 khai báo thêm
 *     `export`; lớp 2 viết lại ở 4.3c — ngắt cứng bằng `node:vm`). `moderation-regex-parser.ts`
 *     barrel không xuất lại. Trạng thái quyết định luật có chạy không — đồng hồ, sổ luật bị
 *     tắt 10 phút, sổ log cắt quét, ngữ cảnh `vm` — một chủ
 *     (`moderation-regex-runtime.ts`), cache biên dịch một chủ (`moderation-regex-check.ts`),
 *     không `export`. Mẫu `MODERATION_REGEX_PART` ở `_moderation-regex-family.ts`.
 *   • `server/utils/chatbot/chat-policy.ts` — barrel ở đường cũ; mã ở
 *     `server/services/chat-policy-*.ts` (thư mục KHÁC barrel, `Family.dir`): Nitro tự import mọi
 *     export của `server/utils/**`, nên tệp con cạnh barrel sẽ xuất mỗi tên của API lần thứ hai
 *     (`server-utils-unique-exports`). `chat.ts`, `chat-turns.ts`, `input-length.ts` là hàng xóm
 *     của barrel, không thuộc nhóm (`chat.ts`/`input-length.ts` import barrel đúng chủ đích).
 *     Mẫu `CHAT_POLICY_PART` + thư mục ở `_chat-policy-family.ts` — một nguồn với ba guard an
 *     ninh đọc mã chính sách chat (SQL thô, khoá rate limit, hạn mức AI).
 *   • `ai-gateway.ts` — barrel; mã ở `ai-gateway-{call,config,types}.ts` + ba tệp tách từ trước
 *     (`ai-sse.ts`, `ai-text-cleaner.ts`, `ai-response-parse.ts` — `ai-sse.ts` import thẳng
 *     `ai-text-cleaner.ts`, nên nó phải thuộc nhóm thì luật 6 mới đúng). `callAi` dời nguyên
 *     khối sang `ai-gateway-call.ts` (giữ từng byte; trần dòng ghi ở ratchet). Mẫu
 *     `AI_GATEWAY_PART` ở `_ai-gateway-family.ts` — một nguồn với guard một-đầu-đọc-SSE và
 *     guard `fetch` trần.
 *
 * Sáu luật, mỗi luật chặn một kiểu hỏng không có triệu chứng lúc viết:
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
 *      MỘT ngoại lệ nêu tên, có từ trước khi tách (`SHARED_STATE_WRITERS`): bộ đếm
 *      `workerStats` của `moderation-stats.ts` do đúng bốn tệp kiểm duyệt cùng ghi.
 *      Tệp khác ghi vẫn đỏ; tệp nêu tên thôi ghi cũng đỏ (mục chết). Nhóm `chat-policy`:
 *      hai luật hạn mức AI (`AI_QUOTA_RULE`, `AI_IP_CEILING_RULE`) là object literal — một
 *      chủ (`chat-policy-rate-limit.ts`); nơi khác nới `limit` là đỏ. Nhóm `ai-gateway`: hai
 *      cache 60 s (`configCache`, `providerCache`) và bảng `PROVIDER_POLICY` — một chủ
 *      (`ai-gateway-config.ts`, không `export`). Nhóm `moderation-regex`: `timing`,
 *      `disabledUntil`, `truncationLoggedUntil`, ngữ cảnh + script `vm` của ngắt cứng
 *      (`scanContext`, `scanScript`, 4.3c) — một chủ (`moderation-regex-runtime.ts`);
 *      `compiled` (`moderation-regex-check.ts`); bảng mẫu `SAMPLE_CHARS` (mảng dựng bằng
 *      IIFE, đóng băng lúc chạy từ 4.3c) chỉ được đọc ngoài chủ (`moderation-regex-parser.ts`).
 *      Vì luật 4 không lần được đối tượng do hàm trả về, trạng thái xuất ra của nhóm này cũng
 *      bị ghim (`exportedFamilyState`: chỉ bảng mẫu) — cùng MỘT phép phân loại "trạng thái"
 *      với luật 4 (`moduleStateBindings`, đóng khi nghi ngờ: lời gọi/IIFE/bí danh/lớp có
 *      `static` là trạng thái), không phải bản chép thứ hai. Lượt ghi được lần cả qua bí danh
 *      (`const a = X`, `const t = ns.X`, `const { X: s } = ns`).
 *   5. **API công khai của barrel `comments.ts` giữ đúng 17 tên giá trị + 17 tên kiểu
 *      như trước khi tách** — bỏ, đổi tên hay đổi loại một export là đỏ; xuất thêm
 *      (helper nội bộ thành API) cũng đỏ. Hình dạng barrel (chỉ `export { … } from
 *      './comments-…'`, không mã, không `export *`) do `reader-audit-atomicity.test.ts`
 *      (`barrelProblems`) canh; luật 5 ghim TÊN. API của barrel `backup.ts` KHÔNG ghim ở
 *      đây mà ở `tests/backup-service-api.test.ts` (viết trước khi tách, xanh trên tệp gốc):
 *      `Object.keys` lúc chạy + TS type checker (giá trị/kiểu qua alias) — mạnh hơn phép
 *      đọc AST của luật 5, nên không chép danh sách thứ hai. Hình dạng barrel `backup.ts`
 *      (chỉ re-export từ `./backup-*`, không import) do `_backup-service-family.ts` canh.
 *      Barrel `moderation-worker.ts`: cùng luật 5, 9 giá trị + 11 kiểu (ghim từ `9905d0d`);
 *      hình dạng (chỉ `export { … } from` tệp con của nhóm) do
 *      `moderationWorkerBarrelProblems` canh ngay ở đây. Barrel `chat-policy.ts`: 15 giá trị
 *      + 5 kiểu (ghim từ `0eb97bd`), hình dạng do `chatPolicyBarrelProblems`. Barrel
 *      `ai-gateway.ts`: 5 giá trị + 4 kiểu (ghim từ `25bc314`), hình dạng do
 *      `aiGatewayBarrelProblems`. Barrel `moderation-regex.ts`: 16 giá trị + 1 kiểu (ghim từ
 *      `597af6a`) cộng `testModerationRegexes` + `ModerationRegexRule` thêm có chủ đích ở 4.3c,
 *      hình dạng do `moderationRegexBarrelProblems`.
 *   6. **Ngoài nhóm `moderation-worker` / `chat-policy` / `ai-gateway` / `moderation-regex`, mã
 *      chỉ tới các tệp của nhóm qua barrel.** Nhóm `moderation-regex`: không test nào mock
 *      barrel, nhưng tệp con xuất phần ruột (`Parser`, `analyzePattern`, bảng mẫu) để tệp con
 *      khác dùng — nơi gọi nhập thẳng tệp con là dựa vào phần không thuộc API mà luật 5 ghim.
 *      Bảy tệp test `mock.module('…/moderation-worker')` thay lớp kiểm duyệt cho
 *      endpoint chatbot, bình luận, chat livestream; bốn tệp test `mock.module('…/chat-policy')`
 *      thay rate limit + trần độ dài cho hai endpoint chat (`input-length.ts` đọc `CHAT_LIMITS`
 *      qua barrel); mười tệp test `mock.module('…/ai-gateway')` thay `callAi` cho dịch bài/khoá
 *      giao diện, biên tập AI, chatbot, kiểm duyệt. Một nơi gọi import thẳng tệp con thì lọt
 *      khỏi mock đó: test chạy mã thật và hoặc đỏ vì lý do khác, hoặc xanh mà không còn kiểm
 *      điều nó định kiểm.
 *
 * Luật 2, 3 và 6 không lặp theo mọi nhóm: chúng canh một tệp/một sổ/một đường mock cụ thể
 * của nhóm `chunked-upload`/`video-processing`/`moderation-worker`/`chat-policy`/`ai-gateway`/
 * `moderation-regex`.
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
  AI_GATEWAY_BARREL,
  AI_GATEWAY_PART,
  EXPECTED_AI_GATEWAY_FAMILY,
  aiGatewayBarrelProblems,
  aiGatewayFiles,
  isAiGatewayFile,
} from './_ai-gateway-family.ts'
import {
  CHAT_POLICY_BARREL,
  CHAT_POLICY_PART,
  CHAT_POLICY_PARTS_DIR,
  EXPECTED_CHAT_POLICY_PARTS,
  chatPolicyBarrelProblems,
  chatPolicyFiles,
  chatPolicyPart,
  isChatPolicyFile,
  strayChatPolicyParts,
} from './_chat-policy-family.ts'
import {
  BACKUP_BARREL,
  BACKUP_PART,
  BACKUP_SIBLINGS,
  EXPECTED_BACKUP_FAMILY,
  backupServiceFiles,
} from './_backup-service-family.ts'
import {
  COMMENT_SUBFILE,
  EXPECTED_COMMENT_SERVICE_FILES,
  commentServiceFiles,
  isCommentServiceFile,
} from './_comments-service-source.ts'
import {
  EXPECTED_MODERATION_REGEX_FAMILY,
  EXPORTED_STATE_ALLOWED,
  MODERATION_REGEX_BARREL,
  MODERATION_REGEX_PART,
  exportedFamilyState,
  isModerationRegexFile,
  moderationRegexBarrelProblems,
  moderationRegexFiles,
  moderationRegexSourcesWith,
  strayModerationRegexFiles,
} from './_moderation-regex-family.ts'
import {
  EXPECTED_MODERATION_WORKER_FAMILY,
  MODERATION_SIBLINGS,
  MODERATION_WORKER_BARREL,
  MODERATION_WORKER_PART,
  isModerationWorkerFile,
  moderationWorkerBarrelProblems,
  moderationWorkerFiles,
} from './_moderation-worker-family.ts'
import { exportedApi } from './_service-split-modules.ts'
import {
  PRODUCTION_DIRS,
  REPO,
  SERVICES,
  type Family,
  type Sources,
  familyHome,
  familyMembers,
  importSites,
  inject,
  moduleOf,
  sourceFileOf,
  where,
  withOverrides,
} from './_service-split-sources.ts'
import { type SharedStateWriters, stateOwnerCheck } from './_service-split-state.ts'

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
  // `backup-*.ts` TRỪ anh em có từ trước khi tách (`BACKUP_SIBLINGS`): `backup-restore.ts`,
  // `backup-restore-recovery.ts`, `backup-scheduler.ts` import barrel đúng chủ đích — barrel
  // không import chúng, nên không có vòng. Tệp con mới mà barrel chưa xuất lại vẫn thuộc nhóm.
  backup: {
    barrel: BACKUP_BARREL,
    prefix: BACKUP_PART,
  },
  // `moderation-*.ts` TRỪ anh em (`MODERATION_SIBLINGS`): `moderation-rescan-job.ts` import
  // barrel đúng chủ đích, `moderation-regex.ts` là module riêng. Gồm cả ba tệp tách từ
  // trước wave3 (barrel xuất lại chúng) và `moderation-worker-persist.ts` (không xuất lại).
  'moderation-worker': {
    barrel: MODERATION_WORKER_BARREL,
    prefix: MODERATION_WORKER_PART,
  },
  // Barrel ở `server/utils/chatbot/`, tệp con `chat-policy-*.ts` ở `server/services/` (`dir`).
  // Hàng xóm của barrel `chat.ts`/`input-length.ts` là nơi gọi (import barrel), `chat-turns.ts`
  // là module riêng mà nhóm import — không tệp nào khớp mẫu.
  'chat-policy': {
    barrel: CHAT_POLICY_BARREL,
    prefix: CHAT_POLICY_PART,
    dir: CHAT_POLICY_PARTS_DIR,
  },
  // `ai-gateway-*.ts` + ba tệp tách từ trước (`ai-sse.ts`, `ai-text-cleaner.ts`,
  // `ai-response-parse.ts`): barrel xuất lại hai trong số đó, và `ai-sse.ts` import thẳng
  // `ai-text-cleaner.ts` — để `ai-sse.ts` ngoài nhóm thì luật 6 đỏ trên mã đúng.
  'ai-gateway': {
    barrel: AI_GATEWAY_BARREL,
    prefix: AI_GATEWAY_PART,
  },
  // `moderation-regex-*.ts` cạnh barrel, gồm `moderation-regex-parser.ts` mà barrel không
  // xuất lại (tệp phân tích import nó). Nhóm moderation-worker loại cả nhóm này.
  'moderation-regex': {
    barrel: MODERATION_REGEX_BARREL,
    prefix: MODERATION_REGEX_PART,
  },
}

function selfImportViolations(
  sources: Sources,
  families: Record<string, Family> = FAMILIES,
): string[] {
  const violations: string[] = []
  for (const [name, family] of Object.entries(families)) {
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

/**
 * Nhóm `backup` của guard này và tập tệp các guard đọc mã sao lưu dùng (`backupServiceFiles()`:
 * barrel + đích re-export, mọi `backup*.ts` khác phải là anh em có tên) — chênh nhau ở đâu.
 * Một tệp chỉ nằm ở một bên là tệp mà nửa kia của các guard không hỏi tới.
 */
function backupFamilyDrift(sources: Sources, family: Family): string[] {
  const guarded = backupServiceFiles()
  const members = [family.barrel, ...familyMembers(sources, family)]
  return [
    ...members
      .filter((file) => !guarded.includes(file))
      .map(
        (file) =>
          `${file} thuộc nhóm backup nhưng vắng khỏi backupServiceFiles() — guard đọc mã sao lưu không đọc nó`,
      ),
    ...guarded
      .filter((file) => !members.includes(file))
      .map((file) => `${file} có trong backupServiceFiles() nhưng vắng khỏi nhóm backup`),
  ]
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

/**
 * Trạng thái nhiều tệp cùng ghi có chủ đích — đúng một mục, có từ trước khi tách.
 *
 * `workerStats` là bộ đếm của worker kiểm duyệt (`moderation-stats.ts`, xuất ra để
 * `fastPreModerate`, `checkAndModerateContent`, `recordInstantBlock` cùng cộng vào MỘT
 * đối tượng — chú thích đầu tệp đó). Lần tách trước (`moderation-instant.ts`) đã ghi
 * nó từ ngoài chủ; wave3 4.3 chuyển nguyên văn các lượt ghi của `moderation-worker.ts`
 * sang ba tệp con. Gói lượt ghi vào hàm của chủ là đổi khai báo — ngoài phạm vi một lần
 * tách giữ nguyên từng byte, nên để lại làm việc tiếp theo. Tới lúc đó: đúng những tệp
 * dưới đây được ghi; tệp khác (lượt quét lại, endpoint) ghi là đỏ, bản khai thứ hai là đỏ.
 */
const SHARED_STATE_WRITERS: SharedStateWriters = {
  'server/services/moderation-stats.ts#workerStats': {
    writers: [
      'server/services/moderation-instant.ts',
      'server/services/moderation-worker-check.ts',
      'server/services/moderation-worker-persist.ts',
      'server/services/moderation-worker-prescreen.ts',
    ],
    reason:
      'bộ đếm dùng chung của worker kiểm duyệt, có từ trước khi tách; gói vào hàm của chủ là việc tiếp theo',
  },
}

const stateViolations = (sources: Sources, shared: SharedStateWriters = SHARED_STATE_WRITERS) =>
  stateOwnerCheck(sources, FAMILIES, shared).violations

// ─── Luật 5: API công khai của barrel comments.ts giữ đúng như trước khi tách ─
//
// Barrel `backup.ts`: API (23 giá trị + 7 kiểu — 21 + 7 lúc tách `4c1ad54`, `09e8dcd` thêm
// `BackupRestoreStateUnknownError`, `refuseIfRestoreInProgress`) ghim ở
// `tests/backup-service-api.test.ts` bằng `Object.keys` + TS checker. Không import test đó
// ở đây (nó `mock.module` CSDL/khoá — rò sang tiến trình này, và test của nó chạy lần hai).

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

/** Barrel `barrel` xuất đúng `expected` (tên + loại) — chung cho comments và moderation-worker. */
function apiPinViolations(
  sources: Sources,
  barrel: string,
  expected: { values: string[]; types: string[] },
  listName: string,
): string[] {
  const api = exportedApi(barrel, sources.get(barrel)!)
  const violations: string[] = []
  for (const [kind, label] of [
    ['values', 'giá trị'],
    ['types', 'kiểu'],
  ] as const) {
    for (const name of expected[kind])
      if (!api[kind].includes(name))
        violations.push(
          `${barrel} thiếu ${label} '${name}' — có trong API trước khi tách, nơi gọi import nó sẽ hỏng`,
        )
    for (const name of api[kind])
      if (!expected[kind].includes(name))
        violations.push(
          `${barrel} xuất thêm ${label} '${name}' — không có trong API trước khi tách; đổi API có chủ đích thì sửa ${listName}`,
        )
  }
  return violations
}

const commentsApiViolations = (sources: Sources) =>
  apiPinViolations(sources, COMMENTS_BARREL, PRE_SPLIT_COMMENTS_API, 'PRE_SPLIT_COMMENTS_API')

/**
 * API của `server/services/moderation-worker.ts` ngay trước khi tách (wave3 4.3): bản ở
 * `9905d0d` (`wave3/integration`). Suy bằng `exportedApi` (cùng phép đọc AST của luật 5)
 * từ `git show 9905d0d:server/services/moderation-worker.ts`: 9 giá trị + 11 kiểu, gồm
 * cả các tên xuất lại từ `moderation-rules-cache`/`-stats`/`-instant` có từ trước. Chép
 * cứng vì CI checkout nông (xem `PRE_SPLIT_COMMENTS_API`).
 */
const PRE_SPLIT_MODERATION_WORKER_API = {
  values: [
    'MODERATION_RESCAN_LIMITS',
    'checkAndModerateContent',
    'fastPreModerate',
    'getActiveModerationRules',
    'getWorkerStats',
    'invalidateModerationRulesCache',
    'matchInstantRule',
    'rescanExistingContent',
    'resetWorkerStats',
  ],
  types: [
    'FastPreModerateResult',
    'InstantRuleMatch',
    'ModerationCheckInput',
    'ModerationCheckOptions',
    'ModerationCheckOutput',
    'ModerationPersistFailure',
    'RescanCounts',
    'RescanCursor',
    'RescanOptions',
    'RescanProgress',
    'RescanSummary',
  ],
}

const moderationApiViolations = (sources: Sources) =>
  apiPinViolations(
    sources,
    MODERATION_WORKER_BARREL,
    PRE_SPLIT_MODERATION_WORKER_API,
    'PRE_SPLIT_MODERATION_WORKER_API',
  )

/**
 * API của `server/utils/chatbot/chat-policy.ts` ngay trước khi tách (wave3 4.3): bản ở
 * `0eb97bd` (`wave3/integration`). Suy bằng `exportedApi` (cùng phép đọc AST của luật 5)
 * từ `git show 0eb97bd:server/utils/chatbot/chat-policy.ts`: 15 giá trị + 5 kiểu. Chép
 * cứng vì CI checkout nông (xem `PRE_SPLIT_COMMENTS_API`).
 */
const PRE_SPLIT_CHAT_POLICY_API = {
  values: [
    'AI_IP_CEILING_RULE',
    'AI_QUOTA_RULE',
    'CHAT_LIMITS',
    'CHAT_RATE_LIMITED_MESSAGE',
    'HOTLINE',
    'answerGroundedChat',
    'approvedFallback',
    'buildChatHistory',
    'buildChatMessages',
    'buildGroundedSystemPrompt',
    'chargeChatRateLimit',
    'enforceAiQuota',
    'enforceChatRateLimit',
    'validateChatMessages',
    'validateChatRequestBody',
  ],
  types: ['ChatDependencies', 'ChatEvent', 'ChatMessage', 'ChatResult', 'ChatToolCall'],
}

const chatPolicyApiViolations = (sources: Sources) =>
  apiPinViolations(sources, CHAT_POLICY_BARREL, PRE_SPLIT_CHAT_POLICY_API, 'PRE_SPLIT_CHAT_POLICY_API')

/**
 * API của `server/services/ai-gateway.ts` ngay trước khi tách (wave3 4.3): bản ở `25bc314`
 * (`wave3/integration`). Suy bằng `exportedApi` (cùng phép đọc AST của luật 5) từ
 * `git show 25bc314:server/services/ai-gateway.ts`: 5 giá trị + 4 kiểu, gồm ba tên xuất lại
 * từ `ai-text-cleaner`/`ai-response-parse` có từ trước. Chép cứng vì CI checkout nông.
 */
const PRE_SPLIT_AI_GATEWAY_API = {
  values: ['callAi', 'createStreamingCleaner', 'extractToolCallsFromMessage', 'parseToolArguments', 'substituteVariables'],
  types: ['AiCallInput', 'AiCallResult', 'AiToolDefinition', 'AiTransportOverrides'],
}

const aiGatewayApiViolations = (sources: Sources) =>
  apiPinViolations(sources, AI_GATEWAY_BARREL, PRE_SPLIT_AI_GATEWAY_API, 'PRE_SPLIT_AI_GATEWAY_API')

/**
 * API của `server/services/moderation-regex.ts` ngay trước khi tách (wave3 4.3): bản ở
 * `597af6a` (`wave3/integration`). Suy bằng `exportedApi` (cùng phép đọc AST của luật 5) từ
 * `git show 597af6a:server/services/moderation-regex.ts`: 16 giá trị + 1 kiểu. Chép cứng vì
 * CI checkout nông. Đổi API có chủ đích một lần, sau khi tách (wave3 4.3c, ngắt cứng lớp 2):
 * thêm `testModerationRegexes` + kiểu `ModerationRegexRule` — mọi luật của một văn bản trong
 * MỘT lượt `vm` có hạn giờ (một lượt mỗi luật tốn ~0,8–1,6 ms mỗi tin ở 30 luật). Nay 17 + 2.
 */
const PRE_SPLIT_MODERATION_REGEX_API = {
  values: [
    'MODERATION_PATTERN_MAX_LENGTH',
    'MODERATION_REGEX_FLAGS',
    'MODERATION_REGEX_WINDOW',
    'MODERATION_REGEX_WINDOW_OVERLAP',
    'MODERATION_RULE_CALL_BUDGET_MS',
    'MODERATION_RULE_COOLDOWN_MS',
    'MODERATION_RULE_WINDOW_BUDGET_MS',
    'checkModerationPattern',
    'clearCompiledModerationRegexCache',
    'compileModerationRegex',
    'findCatastrophicShape',
    'isModerationRuleDisabled',
    'isRegexRuleType',
    'resetSlowModerationRules',
    'setModerationRegexTimingForTests',
    'testModerationRegex',
    'testModerationRegexes',
  ],
  types: ['ModerationPatternCheck', 'ModerationRegexRule'],
}

const moderationRegexApiViolations = (sources: Sources) =>
  apiPinViolations(sources, MODERATION_REGEX_BARREL, PRE_SPLIT_MODERATION_REGEX_API, 'PRE_SPLIT_MODERATION_REGEX_API')

// ─── Luật 6: ngoài nhóm moderation-worker / chat-policy / ai-gateway / moderation-regex, chỉ barrel được import ─

/** Vì sao đường qua barrel là phần chịu lực — vào thông báo của luật 6. */
const MOCKED_BARREL_NOTE: Record<string, string> = {
  'moderation-worker': 'bảy tệp test mock.module đúng đường đó',
  'chat-policy': 'bốn tệp test mock.module đúng đường đó',
  'ai-gateway': 'mười tệp test mock.module đúng đường đó',
  'moderation-regex': 'tệp con xuất phần ruột không thuộc API mà luật 5 ghim',
}

/**
 * `{ violations, barrelImporters }` — mọi tệp chạy thật NGOÀI nhóm import một tệp của nhóm
 * (tệp con mới, hay tệp tách từ trước) thay vì barrel thì đỏ, ở mọi dạng import (kể cả
 * `import type`: một quy tắc, không có ngoại lệ để mục). `barrelImporters` để khẳng định
 * luật không kiểm rỗng: các nơi gọi mà các tệp test mock phải đang đi qua barrel.
 */
function consumerCheck(
  sources: Sources,
  name: 'moderation-worker' | 'chat-policy' | 'ai-gateway' | 'moderation-regex',
  families: Record<string, Family> = FAMILIES,
): {
  violations: string[]
  barrelImporters: string[]
} {
  const family = families[name]!
  const members = familyMembers(sources, family)
  const memberModules = new Set(members.map(moduleOf))
  const barrelModule = moduleOf(family.barrel)
  const inside = new Set([family.barrel, ...members])
  const violations: string[] = []
  const barrelImporters = new Set<string>()
  for (const [file, source] of sources) {
    if (inside.has(file)) continue
    for (const site of importSites(file, source)) {
      if (site.target === barrelModule) barrelImporters.add(file)
      else if (site.target && memberModules.has(site.target))
        violations.push(
          `[${name}] ${where(site)} import ${site.target}.ts — ngoài nhóm chỉ đi qua barrel ${family.barrel} (${MOCKED_BARREL_NOTE[name]})`,
        )
    }
  }
  return { violations, barrelImporters: [...barrelImporters].sort() }
}

const moderationConsumerCheck = (sources: Sources) => consumerCheck(sources, 'moderation-worker')
const chatPolicyConsumerCheck = (sources: Sources) => consumerCheck(sources, 'chat-policy')
const aiGatewayConsumerCheck = (sources: Sources) => consumerCheck(sources, 'ai-gateway')
const moderationRegexConsumerCheck = (sources: Sources) => consumerCheck(sources, 'moderation-regex')

/**
 * Vòng import tĩnh (`import`, `import type`, `export … from`) đi qua một tệp của nhóm,
 * dò từ barrel. Luật 1 chỉ thấy tệp con nhập ngược barrel; vòng qua một anh em mà nhóm
 * import (`moderation-regex.ts` nhập barrel → barrel → prescreen → regex) thì không —
 * phép dò này thấy. `import()` / `require()` không tính: nạp lười là cách cắt vòng.
 */
function familyImportCycles(sources: Sources, family: Family): string[] {
  const inFamily = new Set([family.barrel, ...familyMembers(sources, family)])
  const state = new Map<string, 'open' | 'done'>()
  const stack: string[] = []
  const cycles: string[] = []
  const visit = (file: string) => {
    state.set(file, 'open')
    stack.push(file)
    for (const site of importSites(file, sources.get(file)!)) {
      if (site.form !== 'import' && site.form !== 'export … from') continue
      const next = site.target && sourceFileOf(sources, site.target)
      if (!next) continue
      if (state.get(next) === 'open') {
        const cycle = [...stack.slice(stack.indexOf(next)), next]
        if (cycle.some((member) => inFamily.has(member))) cycles.push(cycle.join(' → '))
      } else if (!state.has(next)) visit(next)
    }
    stack.pop()
    state.set(file, 'done')
  }
  visit(family.barrel)
  return cycles
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
      // Cùng danh sách mà các guard đọc mã sao lưu dùng (`_backup-service-family.ts`).
      backup: EXPECTED_BACKUP_FAMILY.filter((file) => file !== 'backup.ts'),
      // Cùng danh sách mà guard đọc mã kiểm duyệt dùng (`_moderation-worker-family.ts`).
      'moderation-worker': EXPECTED_MODERATION_WORKER_FAMILY.filter(
        (file) => file !== 'moderation-worker.ts',
      ),
      // Cùng danh sách mà ba guard đọc mã chính sách chat dùng (`_chat-policy-family.ts`).
      'chat-policy': [...EXPECTED_CHAT_POLICY_PARTS],
      // Cùng danh sách mà guard một-đầu-đọc-SSE và guard `fetch` trần dùng (`_ai-gateway-family.ts`).
      'ai-gateway': EXPECTED_AI_GATEWAY_FAMILY.filter((file) => file !== 'ai-gateway.ts'),
      // Cùng danh sách mà `_moderation-regex-family.ts` dùng.
      'moderation-regex': EXPECTED_MODERATION_REGEX_FAMILY.filter((file) => file !== 'moderation-regex.ts'),
    }
    assert.equal(expected.comments!.length, 7)
    assert.equal(expected.backup!.length, 6)
    assert.equal(expected['moderation-worker']!.length, 8)
    assert.equal(expected['chat-policy']!.length, 7)
    assert.equal(expected['ai-gateway']!.length, 6)
    assert.equal(expected['moderation-regex']!.length, 5)
    for (const [name, family] of Object.entries(FAMILIES)) {
      const members = familyMembers(REPO, family)
      // Tệp con nằm ở `familyHome` — thư mục của barrel, hoặc `Family.dir` (chat-policy).
      const home = familyHome(family)
      for (const file of expected[name]!) {
        assert.ok(
          members.includes(`${home}/${file}`),
          `[${name}] ${file} vắng khỏi nhóm ${JSON.stringify(members)}`,
        )
      }
    }
  })

  it('nhóm chat-policy và ba guard đọc mã chính sách chat là cùng một tập tệp; hàng xóm không thuộc nhóm', () => {
    // Một mẫu, không hai bản chép.
    assert.equal(FAMILIES['chat-policy']!.prefix, CHAT_POLICY_PART)
    assert.equal(FAMILIES['chat-policy']!.barrel, CHAT_POLICY_BARREL)
    assert.equal(FAMILIES['chat-policy']!.dir, CHAT_POLICY_PARTS_DIR)
    for (const file of EXPECTED_CHAT_POLICY_PARTS)
      assert.ok(CHAT_POLICY_PART.test(file), `${file} phải là tệp con của nhóm chat-policy`)
    assert.ok(isChatPolicyFile(chatPolicyPart('extra')), 'tệp con mới (chưa xuất lại) vẫn thuộc nhóm')
    for (const name of ['chat-policy.ts', 'chat.ts', 'chat-turns.ts', 'input-length.ts', 'chat-policy-.ts', 'chat-policy-x.js', 'chatpolicy-x.ts'])
      assert.ok(!CHAT_POLICY_PART.test(name), `${name} không phải tệp con của nhóm chat-policy`)
    assert.ok(isChatPolicyFile(CHAT_POLICY_BARREL))
    // Tệp dạng tệp con ở thư mục của barrel KHÔNG thuộc nhóm — và là lỗi (ngoài mọi tập quét).
    assert.ok(!isChatPolicyFile('server/utils/chatbot/chat-policy-extra.ts'))
    assert.deepEqual(strayChatPolicyParts(['chat.ts', 'chat-policy.ts', 'chat-policy-extra.ts']), ['chat-policy-extra.ts'])
    // Tập của guard này (barrel + tiền tố ∪ đích barrel xuất lại) = tập ba guard đọc mã quét.
    assert.deepEqual(
      [CHAT_POLICY_BARREL, ...familyMembers(REPO, FAMILIES['chat-policy']!)].sort(),
      chatPolicyFiles(),
    )
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

  it('nhóm backup và các guard đọc mã sao lưu là cùng một tập tệp; anh em không thuộc nhóm', () => {
    // Một mẫu dựng từ một danh sách anh em, không hai bản chép.
    assert.equal(FAMILIES.backup!.prefix, BACKUP_PART)
    assert.equal(FAMILIES.backup!.barrel, BACKUP_BARREL)
    for (const file of EXPECTED_BACKUP_FAMILY.filter((name) => name !== 'backup.ts'))
      assert.ok(BACKUP_PART.test(file), `${file} phải là tệp con của nhóm backup`)
    assert.ok(BACKUP_PART.test('backup-extra.ts'), 'tệp con mới (chưa xuất lại) vẫn thuộc nhóm')
    assert.ok(BACKUP_SIBLINGS.length >= 11, `chỉ thấy ${BACKUP_SIBLINGS.length} anh em`)
    for (const name of [...BACKUP_SIBLINGS, 'backup.ts', 'backup-.ts', 'backup-x.js'])
      assert.ok(!BACKUP_PART.test(name), `${name} không phải tệp con của nhóm backup`)
    assert.deepEqual(backupFamilyDrift(REPO, FAMILIES.backup!), [])
  })

  it('nhóm moderation-worker và guard đọc mã kiểm duyệt là cùng một tập tệp; anh em không thuộc nhóm', () => {
    // Một mẫu, không hai bản chép.
    assert.equal(FAMILIES['moderation-worker']!.prefix, MODERATION_WORKER_PART)
    assert.equal(FAMILIES['moderation-worker']!.barrel, MODERATION_WORKER_BARREL)
    for (const file of EXPECTED_MODERATION_WORKER_FAMILY.filter((name) => name !== 'moderation-worker.ts'))
      assert.ok(MODERATION_WORKER_PART.test(file), `${file} phải là tệp con của nhóm moderation-worker`)
    for (const file of ['moderation-worker-extra.ts', 'moderation-v2.ts'])
      assert.ok(MODERATION_WORKER_PART.test(file), `${file}: tệp con mới (chưa xuất lại) vẫn thuộc nhóm`)
    for (const name of [...MODERATION_SIBLINGS, 'moderation-worker.ts', 'moderation-.ts', 'moderation-x.js', 'moderationx.ts'])
      assert.ok(!MODERATION_WORKER_PART.test(name), `${name} không phải tệp con của nhóm moderation-worker`)
    assert.ok(isModerationWorkerFile('moderation-worker.ts'))
    // Tập của guard này (barrel + tiền tố ∪ đích barrel xuất lại) = tập guard đọc mã quét.
    assert.deepEqual(
      [MODERATION_WORKER_BARREL, ...familyMembers(REPO, FAMILIES['moderation-worker']!)].sort(),
      moderationWorkerFiles(),
    )
  })

  it('nhóm ai-gateway và các guard đọc mã gateway là cùng một tập tệp; ai-* khác không thuộc nhóm', () => {
    // Một mẫu, không hai bản chép.
    assert.equal(FAMILIES['ai-gateway']!.prefix, AI_GATEWAY_PART)
    assert.equal(FAMILIES['ai-gateway']!.barrel, AI_GATEWAY_BARREL)
    for (const file of EXPECTED_AI_GATEWAY_FAMILY.filter((name) => name !== 'ai-gateway.ts'))
      assert.ok(AI_GATEWAY_PART.test(file), `${file} phải là tệp con của nhóm ai-gateway`)
    assert.ok(AI_GATEWAY_PART.test('ai-gateway-extra.ts'), 'tệp con mới (chưa xuất lại) vẫn thuộc nhóm')
    for (const name of ['ai-gateway.ts', 'ai-gateway-.ts', 'ai-gateway-x.js', 'ai-gatewayx.ts', 'ai-sse-v2.ts', 'ai-budget.ts', 'ai-cost.ts'])
      assert.ok(!AI_GATEWAY_PART.test(name), `${name} không phải tệp con của nhóm ai-gateway`)
    assert.ok(isAiGatewayFile('ai-gateway.ts'))
    // Tập của guard này (barrel + tiền tố ∪ đích barrel xuất lại) = tập hai guard đọc mã quét.
    assert.deepEqual([AI_GATEWAY_BARREL, ...familyMembers(REPO, FAMILIES['ai-gateway']!)].sort(), aiGatewayFiles())
  })

  it('nhóm moderation-regex và tập quét của nó là một; không tệp nào vừa thuộc nhóm này vừa thuộc moderation-worker', () => {
    // Một mẫu, không hai bản chép.
    assert.equal(FAMILIES['moderation-regex']!.prefix, MODERATION_REGEX_PART)
    assert.equal(FAMILIES['moderation-regex']!.barrel, MODERATION_REGEX_BARREL)
    for (const file of EXPECTED_MODERATION_REGEX_FAMILY.filter((name) => name !== 'moderation-regex.ts'))
      assert.ok(MODERATION_REGEX_PART.test(file), `${file} phải là tệp con của nhóm moderation-regex`)
    assert.ok(MODERATION_REGEX_PART.test('moderation-regex-extra.ts'), 'tệp con mới (chưa xuất lại) vẫn thuộc nhóm')
    for (const name of ['moderation-regex.ts', 'moderation-regex-.ts', 'moderation-regex-x.js', 'moderation-regexx.ts', 'moderation-worker-regex.ts'])
      assert.ok(!MODERATION_REGEX_PART.test(name), `${name} không phải tệp con của nhóm moderation-regex`)
    assert.ok(isModerationRegexFile('moderation-regex.ts'))
    assert.deepEqual(
      [MODERATION_REGEX_BARREL, ...familyMembers(REPO, FAMILIES['moderation-regex']!)].sort(),
      moderationRegexFiles(),
    )
    // Hai nhóm cùng tiền tố `moderation-`: rời nhau, và nhóm worker không đọc tệp nào của nhóm regex.
    const worker = new Set([MODERATION_WORKER_BARREL, ...familyMembers(REPO, FAMILIES['moderation-worker']!)])
    for (const file of moderationRegexFiles())
      assert.ok(!worker.has(file), `${file} lọt vào nhóm moderation-worker`)
    for (const name of [...EXPECTED_MODERATION_REGEX_FAMILY, 'moderation-regex-extra.ts'])
      assert.ok(!MODERATION_WORKER_PART.test(name) && !isModerationWorkerFile(name), `${name} không phải tệp của moderation-worker`)
  })

  it('luật 1: không vòng import tĩnh nào đi qua nhóm moderation-regex (dò từ barrel)', () => {
    assert.deepEqual(familyImportCycles(REPO, FAMILIES['moderation-regex']!), [])
  })

  it('trạng thái xuất ra của nhóm moderation-regex chỉ là bảng mẫu đóng băng (đồng hồ, sổ luật tắt, cache, ngữ cảnh vm không export)', () => {
    assert.deepEqual(EXPORTED_STATE_ALLOWED, [
      'server/services/moderation-regex-parser.ts#SAMPLE_CHARS',
    ])
    assert.deepEqual(exportedFamilyState(moderationRegexSourcesWith()), [...EXPORTED_STATE_ALLOWED])
  })

  it('tệp mang tên nhóm moderation-regex nằm ngoài server/services/ là lỗi (bản chép dưới server/utils/**, tệp con dời vào thư mục con)', () => {
    // Cây thật: không có (REPO đọc từ đĩa lúc nạp; `moderationRegexFiles()` kiểm thêm trên đĩa).
    assert.deepEqual(strayModerationRegexFiles(REPO.keys()), [])
    assert.equal(moderationRegexFiles().length, EXPECTED_MODERATION_REGEX_FAMILY.length)
    const strays = [
      'server/utils/moderation-regex-parser.ts',
      'server/utils/chatbot/moderation-regex.ts',
      'server/utils/moderation-regex-parser.js',
      'server/services/regex/moderation-regex-analysis.ts',
      'shared/moderation-regex-limits.ts',
      'scripts/moderation-regex-probe.mjs',
    ]
    assert.deepEqual(strayModerationRegexFiles([...REPO.keys(), ...strays]), [...strays].sort())
    // Tệp của nhóm (kể cả tệp con mới) và tên chỉ giống một phần thì không phải bản lạc.
    assert.deepEqual(
      strayModerationRegexFiles([
        'server/services/moderation-regex.ts',
        'server/services/moderation-regex-extra.ts',
        'server/utils/moderation.ts',
        'server/utils/moderation-regexp.json',
        'server/utils/regex-moderation.ts',
      ]),
      [],
    )
  })

  it('luật 1: không tệp con nào import barrel/cửa vào của chính nhóm mình', () => {
    assert.deepEqual(selfImportViolations(REPO), [])
  })

  it('luật 1: không vòng import tĩnh nào đi qua nhóm ai-gateway (dò từ barrel, kể cả qua util mà callAi import)', () => {
    assert.deepEqual(familyImportCycles(REPO, FAMILIES['ai-gateway']!), [])
  })

  it('luật 1: không vòng import tĩnh nào đi qua nhóm moderation-worker (dò từ barrel, kể cả qua anh em)', () => {
    assert.deepEqual(familyImportCycles(REPO, FAMILIES['moderation-worker']!), [])
  })

  it('luật 1: không vòng import tĩnh nào đi qua nhóm chat-policy (dò từ barrel, kể cả qua hàng xóm)', () => {
    assert.deepEqual(familyImportCycles(REPO, FAMILIES['chat-policy']!), [])
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
    const { violations, inventory, stateImports, sharedWrites } = stateOwnerCheck(
      REPO,
      FAMILIES,
      SHARED_STATE_WRITERS,
    )
    assert.deepEqual(violations, [])
    // Ngoại lệ duy nhất còn sống, đúng bốn người ghi — không hơn (đỏ ở trên), không kém (mục chết).
    assert.deepEqual(
      sharedWrites,
      SHARED_STATE_WRITERS['server/services/moderation-stats.ts#workerStats']!.writers.map(
        (file) => `server/services/moderation-stats.ts#workerStats ← ${file}`,
      ),
    )
    // Không có ngoại lệ thì chính mã thật đỏ, đúng ở bốn tệp đó — ngoại lệ là phần chịu lực.
    const bare = stateOwnerCheck(REPO, FAMILIES).violations
    assert.deepEqual(
      [...new Set(bare.map((v) => /^\[moderation-worker\] (\S+):\d+ .* ghi vào 'workerStats'/.exec(v)?.[1]))].sort(),
      [...SHARED_STATE_WRITERS['server/services/moderation-stats.ts#workerStats']!.writers].sort(),
    )
    // Không kiểm rỗng: kho có trạng thái thật của từng nhóm…
    for (const state of [
      'server/services/video-processing-job.ts#activeClaims',
      'server/services/video-process-runner.ts#cpulimitAvailable',
      'server/services/chunked-upload-core.ts#NOT_FOUND',
      'server/services/media-portal-constants.ts#MEDIA_VIEW_DEDUPE_RULE',
      'server/services/comments-posting.ts#COMMENT_READER_RULE',
      // Trạng thái chạy của sao lưu (`getBackupStatus` trả bản sao) và sổ tệp đang khôi phục
      // (chỉ `holdRestoreTarget` ghi): mỗi thứ một chủ, không `export`. Tên khoá
      // (`LOCK_RUN`/`LOCK_RESTORE`) là `const` chuỗi — không ghi được, nên không phải trạng thái.
      'server/services/backup-run.ts#currentBackupStatus',
      'server/services/backup-locks.ts#activeRestoreTargets',
      // Nhóm moderation-worker: bộ đếm, cache luật, cột hàng chờ (không `export`).
      'server/services/moderation-stats.ts#workerStats',
      'server/services/moderation-rules-cache.ts#cachedRules',
      'server/services/moderation-worker-persist.ts#QUEUE_COLUMNS',
      // Nhóm chat-policy: hai luật hạn mức AI (object literal). `CHAT_LIMITS` là
      // `Object.freeze(…)` — không ghi được, nên không phải trạng thái.
      'server/services/chat-policy-rate-limit.ts#AI_QUOTA_RULE',
      'server/services/chat-policy-rate-limit.ts#AI_IP_CEILING_RULE',
      // Nhóm ai-gateway: hai cache 60 s và bảng provider → định dạng (không `export`).
      // `CACHE_TTL_MS`/`TOOL_STEP_*` là số — không ghi được, nên không phải trạng thái.
      'server/services/ai-gateway-config.ts#configCache',
      'server/services/ai-gateway-config.ts#providerCache',
      'server/services/ai-gateway-config.ts#PROVIDER_POLICY',
      // Nhóm moderation-regex: đồng hồ + sổ luật tắt 10 phút + sổ log cắt quét (chủ: tệp chạy),
      // cache biên dịch (chủ: tệp kiểm), cache lớp ký tự và hai bảng mẫu (chỉ đọc ngoài chủ) —
      // `SAMPLE_CHARS` dựng bằng IIFE: lời gọi là trạng thái (đóng khi nghi ngờ).
      'server/services/moderation-regex-runtime.ts#timing',
      'server/services/moderation-regex-runtime.ts#defaultTiming',
      'server/services/moderation-regex-runtime.ts#disabledUntil',
      'server/services/moderation-regex-runtime.ts#truncationLoggedUntil',
      // Ngắt cứng (4.3c): ngữ cảnh `vm` + script dựng một lần — bản thứ hai ở tệp khác là hai
      // ngữ cảnh, mỗi nửa mã ghi `job` vào một cái.
      'server/services/moderation-regex-runtime.ts#scanContext',
      'server/services/moderation-regex-runtime.ts#scanScript',
      'server/services/moderation-regex-check.ts#compiled',
      'server/services/moderation-regex-analysis.ts#charsetCache',
      // `Object.freeze(IIFE())`: freeze chỉ khoá được literal mà guard đọc được — vẫn là trạng thái.
      'server/services/moderation-regex-parser.ts#SAMPLE_CHARS',
    ])
      assert.ok(inventory.includes(state), `${state} vắng khỏi kho ${JSON.stringify(inventory)}`)
    // …và phép giải tên thật sự đi tới trạng thái, cả thẳng lẫn qua barrel. Nhóm
    // comments chưa xuất trạng thái nào (hai luật giới hạn là `const` riêng của
    // `comments-posting.ts`, `MODERATION_FAILED` là Symbol), nên chưa có lượt nhập nào.
    for (const edge of [
      'server/services/chunked-upload-session.ts ← server/services/chunked-upload-core.ts#NOT_FOUND',
      'server/api/admin/media-portal/[id]/process.post.ts ← server/services/video-renditions.ts#RENDITIONS',
      'server/services/backup-sweep.ts ← server/services/backup-names.ts#STALE_PARTIAL',
      'server/services/moderation-worker-prescreen.ts ← server/services/moderation-stats.ts#workerStats',
      'server/services/moderation-regex-analysis.ts ← server/services/moderation-regex-parser.ts#SAMPLE_CHARS',
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

  it('luật 5: moderation-worker.ts xuất đúng 9 giá trị + 11 kiểu của API trước khi tách', () => {
    assert.equal(PRE_SPLIT_MODERATION_WORKER_API.values.length, 9)
    assert.equal(PRE_SPLIT_MODERATION_WORKER_API.types.length, 11)
    assert.deepEqual(moderationApiViolations(REPO), [])
  })

  it('luật 5: tên giá trị lúc chạy của moderation-worker.ts khớp danh sách (phép đọc AST không lệch)', async () => {
    const surface = await import('../server/services/moderation-worker.ts')
    assert.deepEqual(Object.keys(surface).sort(), [...PRE_SPLIT_MODERATION_WORKER_API.values].sort())
  })

  it('luật 5: barrel moderation-worker.ts chỉ gồm `export { … } from` tệp con của nhóm', () => {
    assert.deepEqual(moderationWorkerBarrelProblems(REPO.get(MODERATION_WORKER_BARREL)!), [])
  })

  it('luật 5: chat-policy.ts xuất đúng 15 giá trị + 5 kiểu của API trước khi tách', () => {
    assert.equal(PRE_SPLIT_CHAT_POLICY_API.values.length, 15)
    assert.equal(PRE_SPLIT_CHAT_POLICY_API.types.length, 5)
    assert.deepEqual(chatPolicyApiViolations(REPO), [])
  })

  it('luật 5: tên giá trị lúc chạy của chat-policy.ts khớp danh sách (phép đọc AST không lệch)', async () => {
    const surface = await import('../server/utils/chatbot/chat-policy.ts')
    assert.deepEqual(Object.keys(surface).sort(), [...PRE_SPLIT_CHAT_POLICY_API.values].sort())
  })

  it('luật 5: barrel chat-policy.ts chỉ gồm `export { … } from` tệp con của nhóm', () => {
    assert.deepEqual(chatPolicyBarrelProblems(REPO.get(CHAT_POLICY_BARREL)!), [])
  })

  it('luật 5: ai-gateway.ts xuất đúng 5 giá trị + 4 kiểu của API trước khi tách', () => {
    assert.equal(PRE_SPLIT_AI_GATEWAY_API.values.length, 5)
    assert.equal(PRE_SPLIT_AI_GATEWAY_API.types.length, 4)
    assert.deepEqual(aiGatewayApiViolations(REPO), [])
  })

  it('luật 5: tên giá trị lúc chạy của ai-gateway.ts khớp danh sách (phép đọc AST không lệch)', async () => {
    const surface = await import('../server/services/ai-gateway.ts')
    assert.deepEqual(Object.keys(surface).sort(), [...PRE_SPLIT_AI_GATEWAY_API.values].sort())
  })

  it('luật 5: barrel ai-gateway.ts chỉ gồm `export { … } from` tệp con của nhóm', () => {
    assert.deepEqual(aiGatewayBarrelProblems(REPO.get(AI_GATEWAY_BARREL)!), [])
  })

  it('luật 5: moderation-regex.ts xuất đúng 16 giá trị + 1 kiểu của API trước khi tách, cộng testModerationRegexes + ModerationRegexRule (4.3c)', () => {
    assert.equal(PRE_SPLIT_MODERATION_REGEX_API.values.length, 17)
    assert.equal(PRE_SPLIT_MODERATION_REGEX_API.types.length, 2)
    assert.deepEqual(moderationRegexApiViolations(REPO), [])
  })

  it('luật 5: tên giá trị lúc chạy của moderation-regex.ts khớp danh sách (phép đọc AST không lệch)', async () => {
    const surface = await import('../server/services/moderation-regex.ts')
    assert.deepEqual(Object.keys(surface).sort(), [...PRE_SPLIT_MODERATION_REGEX_API.values].sort())
  })

  it('luật 5: barrel moderation-regex.ts chỉ gồm `export { … } from` tệp con của nhóm', () => {
    assert.deepEqual(moderationRegexBarrelProblems(REPO.get(MODERATION_REGEX_BARREL)!), [])
  })

  it('luật 6: ngoài nhóm moderation-worker, mã chỉ tới nhóm qua barrel (đường mà các test mock)', () => {
    const { violations, barrelImporters } = moderationConsumerCheck(REPO)
    assert.deepEqual(violations, [])
    // Không kiểm rỗng: các nơi gọi mà bảy tệp test thay bằng mock đang đi qua barrel.
    for (const file of [
      'server/api/chat.post.ts',
      'server/api/public/chatbot/index.post.ts',
      'server/services/comments-posting.ts',
      'server/services/comments-reply-email.ts',
      'server/services/livestream-chat.ts',
      'server/services/moderation-rescan-job.ts',
    ])
      assert.ok(barrelImporters.includes(file), `${file} vắng khỏi ${JSON.stringify(barrelImporters)}`)
  })

  it('luật 6: ngoài nhóm chat-policy, mã chỉ tới nhóm qua barrel (đường mà bốn test mock)', () => {
    const { violations, barrelImporters } = chatPolicyConsumerCheck(REPO)
    assert.deepEqual(violations, [])
    // Không kiểm rỗng: bốn nơi gọi mà bốn tệp test mock barrel dựa vào phải đang đi qua
    // barrel (nơi gọi mới đi qua barrel cũng đúng — kiểm tập con, không ghim đúng bốn).
    // `input-length.ts` là nơi dễ lọt nhất: nó đọc `CHAT_LIMITS`, mà các test mock barrel
    // cấp hằng đó cho nó — lọt ra tệp con thì bốn test vẫn xanh (cùng giá trị) mà không ai biết.
    for (const file of [
      'server/api/chat.post.ts',
      'server/api/public/chatbot/index.post.ts',
      'server/utils/chatbot/chat.ts',
      'server/utils/chatbot/input-length.ts',
    ])
      assert.ok(barrelImporters.includes(file), `${file} vắng khỏi ${JSON.stringify(barrelImporters)}`)
  })

  it('luật 6: ngoài nhóm ai-gateway, mã chỉ tới nhóm qua barrel (đường mà mười test mock)', () => {
    const { violations, barrelImporters } = aiGatewayConsumerCheck(REPO)
    assert.deepEqual(violations, [])
    // Không kiểm rỗng: nơi gọi mà mười tệp test thay `callAi` bằng mock phải đang đi qua
    // barrel — dịch bài (article-translation-worker-behavior), chatbot (chat-policy-seams),
    // dịch ngôn ngữ (language-translations-write-behavior: ba endpoint), dịch danh mục
    // (model-translations), kiểm duyệt (năm tệp moderation-*/reader-flows), biên tập AI
    // (security-ai-editorial-html). Kiểm tập con, không ghim đúng danh sách.
    for (const file of [
      'server/services/article-translation-worker.ts',
      'server/services/chat-policy-provider.ts',
      'server/api/admin/languages/ai-translate.post.ts',
      'server/api/admin/languages/ai-translate-chunk.post.ts',
      'server/api/admin/languages/ai-translate-key.post.ts',
      'server/services/i18n-auto-translate.ts',
      'server/services/moderation-worker-check.ts',
      'server/api/admin/ai/editorial.post.ts',
    ])
      assert.ok(barrelImporters.includes(file), `${file} vắng khỏi ${JSON.stringify(barrelImporters)}`)
  })

  it('luật 6: ngoài nhóm moderation-regex, mã chỉ tới nhóm qua barrel (hai endpoint luật, cache luật, hai lượt kiểm duyệt)', () => {
    const { violations, barrelImporters } = moderationRegexConsumerCheck(REPO)
    assert.deepEqual(violations, [])
    // Không kiểm rỗng: năm nơi gọi có từ trước khi tách phải đang đi qua barrel.
    for (const file of [
      'server/api/admin/ai/moderation/rules.post.ts',
      'server/api/admin/ai/moderation/rules/[id].put.ts',
      'server/services/moderation-rules-cache.ts',
      'server/services/moderation-worker-check.ts',
      'server/services/moderation-worker-prescreen.ts',
    ])
      assert.ok(barrelImporters.includes(file), `${file} vắng khỏi ${JSON.stringify(barrelImporters)}`)
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

  // ─── Nhóm backup ───────────────────────────────────────────────────────────

  it('luật 1 đỏ khi tệp con backup-* nạp barrel ./backup, ở mọi dạng import — kể cả tệp con barrel chưa xuất lại', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import',
        inject('server/services/backup-sweep.ts', "import { runBackup as _r } from './backup'"),
        /^\[backup\] server\/services\/backup-sweep\.ts:1 \(import\) import ngược server\/services\/backup\.ts$/,
      ],
      [
        'import type, có đuôi .ts',
        inject('server/services/backup-locks.ts', "import type { RunStatus as _S } from './backup.ts'"),
        /^\[backup\] server\/services\/backup-locks\.ts:1 \(import\)/,
      ],
      [
        'export … from',
        inject('server/services/backup-catalog.ts', "export { backupsDir as _dir } from './backup'"),
        /^\[backup\] server\/services\/backup-catalog\.ts:1 \(export … from\)/,
      ],
      [
        'import() động trong hàm',
        append(
          'server/services/backup-rotation.ts',
          "export async function _lazy() { return (await import('./backup')).runBackup }",
        ),
        /^\[backup\] server\/services\/backup-rotation\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'typeof import() qua alias #server',
        append(
          'server/services/backup-run.ts',
          "export type _Api = typeof import('#server/services/backup')",
        ),
        /^\[backup\] server\/services\/backup-run\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp con mới mà barrel chưa xuất lại (thuộc nhóm nhờ mẫu tệp, không nhờ re-export)',
        {
          'server/services/backup-extra.ts':
            "import { runBackup } from './backup'\nexport const _run = runBackup\n",
        },
        /^\[backup\] server\/services\/backup-extra\.ts:1 \(import\) import ngược server\/services\/backup\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./backup-names` với barrel `./backup`, và anh em import barrel thì không đỏ', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides({
          ...inject(
            'server/services/backup-catalog.ts',
            "import { timestampStamp as _t } from './backup-names'",
          ),
          // Anh em (không phải tệp con của lần tách): import barrel là đúng chủ đích.
          ...inject(
            'server/services/backup-scheduler-busy.ts',
            "import { runBackup as _r } from './backup'",
          ),
        }),
      ),
      [],
    )
  })

  it('bỏ phần loại anh em khỏi mẫu nhóm backup thì chính mã thật đỏ — ranh giới anh em là phần chịu lực', () => {
    const naive: Family = { barrel: BACKUP_BARREL, prefix: /^backup-[\w-]+\.ts$/ }
    const flagged = selfImportViolations(REPO, { ...FAMILIES, backup: naive })
      .map((violation) => /^\[backup\] (\S+):/.exec(violation)?.[1])
      .sort()
    assert.deepEqual(flagged, [
      'server/services/backup-restore-recovery.ts',
      'server/services/backup-restore.ts',
      'server/services/backup-scheduler.ts',
    ])
    // …và nhóm lệch khỏi tập tệp các guard đọc mã sao lưu, đúng một dòng mỗi anh em.
    const drift = backupFamilyDrift(REPO, naive)
    assert.deepEqual(
      drift.map((line) => line.split(' ')[0]).sort(),
      BACKUP_SIBLINGS.map((name) => `${SERVICES}/${name}`).sort(),
    )
  })

  it('nhóm backup lệch backupServiceFiles() thì đỏ: tệp con mới chưa được barrel xuất lại', () => {
    const drift = backupFamilyDrift(
      withOverrides({ 'server/services/backup-extra.ts': 'export const _extra = 1\n' }),
      FAMILIES.backup!,
    )
    assert.equal(drift.length, 1, JSON.stringify(drift))
    assert.match(
      drift[0]!,
      /^server\/services\/backup-extra\.ts thuộc nhóm backup nhưng vắng khỏi backupServiceFiles\(\)/,
    )
  })

  it('luật 4 đỏ khi sổ tệp đang khôi phục hay trạng thái chạy bị chép sang tệp con thứ hai', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'sổ tệp đang khôi phục chép sang xoay vòng',
        inject(
          'server/services/backup-rotation.ts',
          'const activeRestoreTargets = new Map<string, number>()',
        ),
        /^\[backup\] 'activeRestoreTargets' khai ở 2 tệp \(server\/services\/backup-locks\.ts:\d+, server\/services\/backup-rotation\.ts:1\)/,
      ],
      [
        'trạng thái chạy chép sang lượt dọn',
        inject('server/services/backup-sweep.ts', 'let currentBackupStatus: unknown = null'),
        /^\[backup\] 'currentBackupStatus' khai ở 2 tệp \(server\/services\/backup-run\.ts:\d+, server\/services\/backup-sweep\.ts:1\)/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 4 đỏ khi tệp con khác ghi vào sổ tệp đang khôi phục (mở export rồi `.clear()`)', () => {
    const violations = stateViolations(
      withOverrides({
        ...replaceIn(
          'server/services/backup-locks.ts',
          'const activeRestoreTargets = new Map',
          'export const activeRestoreTargets = new Map',
        ),
        'server/services/backup-rotation.ts': `import { activeRestoreTargets } from './backup-locks'\n${REPO.get('server/services/backup-rotation.ts')}\nexport function _forgetAll() { activeRestoreTargets.clear() }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[backup\] server\/services\/backup-rotation\.ts:\d+ \(\.clear\(\)\) ghi vào 'activeRestoreTargets' của server\/services\/backup-locks\.ts/,
    )
  })

  it('luật 4 đỏ khi endpoint ghi trạng thái chạy nhập qua barrel backup.ts', () => {
    const endpoint = 'server/api/admin/backup/status.get.ts'
    const violations = stateViolations(
      withOverrides({
        ...replaceIn(
          'server/services/backup-run.ts',
          'let currentBackupStatus: RunStatus',
          'export let currentBackupStatus: RunStatus',
        ),
        ...append(BACKUP_BARREL, "export { currentBackupStatus } from './backup-run'"),
        [endpoint]: `import { currentBackupStatus } from '../../../services/backup'\n${REPO.get(endpoint)}\nexport function _reset() { currentBackupStatus.running = false }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[backup\] server\/api\/admin\/backup\/status\.get\.ts:\d+ \(gán\) ghi vào 'currentBackupStatus' của server\/services\/backup-run\.ts/,
    )
  })

  it('luật 4 đỏ khi anh em ngoài nhóm (backup-restore.ts) đổi BACKUP_TRIGGERS nhập qua barrel', () => {
    // Anh em không thuộc nhóm, nhưng lượt ghi được dò trên MỌI tệp chạy thật.
    const file = 'server/services/backup-restore.ts'
    const violations = stateViolations(
      withOverrides({
        [file]: `import { BACKUP_TRIGGERS as _triggers } from './backup'\n${REPO.get(file)}\nexport function _extend() { (_triggers as unknown as string[]).push('pre-x') }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[backup\] server\/services\/backup-restore\.ts:\d+ \(\.push\(\)\) ghi vào 'BACKUP_TRIGGERS' của server\/services\/backup-names\.ts/,
    )
  })

  // ─── Nhóm moderation-worker ────────────────────────────────────────────────

  it('luật 1 đỏ khi tệp của nhóm moderation-worker nạp barrel, ở mọi dạng — kể cả tệp tách từ trước và tệp barrel không xuất lại', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import',
        inject(
          'server/services/moderation-worker-check.ts',
          "import { fastPreModerate as _f } from './moderation-worker'",
        ),
        /^\[moderation-worker\] server\/services\/moderation-worker-check\.ts:1 \(import\) import ngược server\/services\/moderation-worker\.ts$/,
      ],
      [
        'import type, có đuôi .ts',
        inject(
          'server/services/moderation-worker-rescan.ts',
          "import type { ModerationCheckOutput as _O } from './moderation-worker.ts'",
        ),
        /^\[moderation-worker\] server\/services\/moderation-worker-rescan\.ts:1 \(import\)/,
      ],
      [
        'export … from',
        inject(
          'server/services/moderation-worker-prescreen.ts',
          "export { checkAndModerateContent as _c } from './moderation-worker'",
        ),
        /^\[moderation-worker\] server\/services\/moderation-worker-prescreen\.ts:1 \(export … from\)/,
      ],
      [
        'import() động, trong tệp barrel không xuất lại (đường ghi)',
        append(
          'server/services/moderation-worker-persist.ts',
          "export async function _lazy() { return (await import('./moderation-worker')).fastPreModerate }",
        ),
        /^\[moderation-worker\] server\/services\/moderation-worker-persist\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'tệp tách từ trước wave3 (moderation-instant.ts)',
        inject(
          'server/services/moderation-instant.ts',
          "import { getWorkerStats as _g } from './moderation-worker'",
        ),
        /^\[moderation-worker\] server\/services\/moderation-instant\.ts:1 \(import\)/,
      ],
      [
        'typeof import() qua alias #server',
        append(
          'server/services/moderation-stats.ts',
          "export type _Api = typeof import('#server/services/moderation-worker')",
        ),
        /^\[moderation-worker\] server\/services\/moderation-stats\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp con mới mà barrel chưa xuất lại (thuộc nhóm nhờ mẫu tệp)',
        {
          'server/services/moderation-worker-extra.ts':
            "import { fastPreModerate } from './moderation-worker'\nexport const _f = fastPreModerate\n",
        },
        /^\[moderation-worker\] server\/services\/moderation-worker-extra\.ts:1 \(import\) import ngược server\/services\/moderation-worker\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./moderation-worker-check` với barrel, và anh em import barrel thì không đỏ', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides({
          ...inject(
            'server/services/moderation-worker-rescan.ts',
            "import { checkAndModerateContent as _c } from './moderation-worker-check'",
          ),
          // Anh em (nơi gọi): import barrel là đúng chủ đích — chính `rescanExistingContent` đi đường này.
          ...inject(
            'server/services/moderation-rescan-job.ts',
            "import { fastPreModerate as _f } from './moderation-worker'",
          ),
        }),
      ),
      [],
    )
  })

  it('bỏ phần loại anh em khỏi mẫu nhóm moderation-worker thì chính mã thật đỏ — ranh giới anh em là phần chịu lực', () => {
    const naive: Family = { barrel: MODERATION_WORKER_BARREL, prefix: /^moderation-[\w-]+\.ts$/ }
    const flagged = selfImportViolations(REPO, { ...FAMILIES, 'moderation-worker': naive })
      .map((violation) => /^\[moderation-worker\] (\S+):/.exec(violation)?.[1])
      .sort()
    assert.deepEqual(flagged, ['server/services/moderation-rescan-job.ts'])
  })

  it('vòng import qua anh em mà nhóm import thì đỏ — luật 1 không thấy, phép dò vòng thấy', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'barrel anh em moderation-regex',
        inject('server/services/moderation-regex.ts', "import { getWorkerStats as _g } from './moderation-worker'"),
        /^server\/services\/moderation-worker\.ts → .*server\/services\/moderation-regex\.ts → server\/services\/moderation-worker\.ts$/,
      ],
      // Từ wave3 4.3 mã regex ở tệp con: vòng qua một tệp con của nhóm anh em cũng phải thấy.
      [
        'tệp con moderation-regex-runtime',
        inject('server/services/moderation-regex-runtime.ts', "import { getWorkerStats as _g } from './moderation-worker'"),
        /^server\/services\/moderation-worker\.ts → .*server\/services\/moderation-regex-runtime\.ts → server\/services\/moderation-worker\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      // Anh em không thuộc nhóm: luật 1 im lặng…
      assert.deepEqual(selfImportViolations(withOverrides(override)), [], label)
      // …nhưng barrel → tệp con → moderation-regex → barrel là một vòng.
      const cycles = familyImportCycles(withOverrides(override), FAMILIES['moderation-worker']!)
      assert.ok(cycles.length > 0, `${label}: không thấy vòng`)
      for (const cycle of cycles) assert.match(cycle, expected, label)
    }
  })

  it('bỏ phần loại nhóm regex khỏi mẫu nhóm moderation-worker thì chính mã thật đỏ — ranh giới hai nhóm là phần chịu lực', () => {
    // Mẫu trước khi tách regex: chỉ loại đúng tên `moderation-regex.ts`, nên mọi
    // `moderation-regex-*.ts` thành "tệp con của worker" và barrel regex thành "nơi gọi đi tắt".
    const naive: Family = {
      barrel: MODERATION_WORKER_BARREL,
      prefix: /^(?!(?:moderation-worker\.ts|moderation-regex\.ts|moderation-rescan-job\.ts)$)moderation-[a-z0-9-]+\.ts$/,
    }
    const flagged = consumerCheck(REPO, 'moderation-worker', { ...FAMILIES, 'moderation-worker': naive }).violations
    assert.ok(flagged.length >= 4, JSON.stringify(flagged))
    assert.deepEqual([...new Set(flagged.map((violation) => /^\[moderation-worker\] (\S+):/.exec(violation)?.[1]))], ['server/services/moderation-regex.ts'])
    assert.deepEqual(consumerCheck(REPO, 'moderation-worker').violations, [])
  })

  it('luật 4 đỏ khi bộ đếm workerStats hay cột hàng chờ bị chép sang tệp con thứ hai', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'bộ đếm chép sang lượt quét lại',
        inject('server/services/moderation-worker-rescan.ts', 'const workerStats = { errorCount: 0 }'),
        /^\[moderation-worker\] 'workerStats' khai ở 2 tệp \(server\/services\/moderation-stats\.ts:\d+, server\/services\/moderation-worker-rescan\.ts:1\)/,
      ],
      [
        'cột hàng chờ chép sang lượt kiểm',
        inject('server/services/moderation-worker-check.ts', "const QUEUE_COLUMNS = ['target_type'] as const"),
        /^\[moderation-worker\] 'QUEUE_COLUMNS' khai ở 2 tệp \(server\/services\/moderation-worker-check\.ts:1, server\/services\/moderation-worker-persist\.ts:\d+\)/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 4 đỏ khi tệp KHÔNG nêu tên ghi bộ đếm — ngoại lệ chỉ cho đúng bốn tệp', () => {
    const rescan = 'server/services/moderation-worker-rescan.ts'
    const endpoint = 'server/api/admin/ai/moderation/worker-status.get.ts'
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'lượt quét lại (thuộc nhóm, không nêu tên)',
        {
          [rescan]: `import { workerStats } from './moderation-stats'\n${REPO.get(rescan)}\nexport function _zero() { workerStats.errorCount = 0 }\n`,
        },
        /^\[moderation-worker\] server\/services\/moderation-worker-rescan\.ts:\d+ \(gán\) ghi vào 'workerStats' của server\/services\/moderation-stats\.ts/,
      ],
      [
        'endpoint (ngoài nhóm), khoá tính toán',
        {
          [endpoint]: `import { workerStats } from '../../../../services/moderation-stats'\n${REPO.get(endpoint)}\nexport function _reset(key: 'errorCount') { workerStats[key] = 0 }\n`,
        },
        /^\[moderation-worker\] server\/api\/admin\/ai\/moderation\/worker-status\.get\.ts:\d+ \(gán, khoá tính toán\) ghi vào 'workerStats'/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 4 đỏ khi lượt kiểm ghi vào QUEUE_COLUMNS của đường ghi (mở export rồi `.push()`)', () => {
    const check = 'server/services/moderation-worker-check.ts'
    const violations = stateViolations(
      withOverrides({
        ...replaceIn(
          'server/services/moderation-worker-persist.ts',
          'const QUEUE_COLUMNS = [',
          'export const QUEUE_COLUMNS = [',
        ),
        [check]: `import { QUEUE_COLUMNS } from './moderation-worker-persist'\n${REPO.get(check)}\nexport function _grow() { (QUEUE_COLUMNS as unknown as string[]).push('x') }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[moderation-worker\] server\/services\/moderation-worker-check\.ts:\d+ \(\.push\(\)\) ghi vào 'QUEUE_COLUMNS' của server\/services\/moderation-worker-persist\.ts/,
    )
  })

  it('ngoại lệ người ghi chung chết thì đỏ: tệp nêu tên thôi ghi, hoặc tên không còn là trạng thái', () => {
    const stopped = stateViolations(
      withOverrides(replaceIn('server/services/moderation-instant.ts', '  workerStats.blockedInstant++\n', '')),
    )
    assert.equal(stopped.length, 1, JSON.stringify(stopped))
    assert.match(
      stopped[0]!,
      /^ngoại lệ chết: server\/services\/moderation-stats\.ts#workerStats khai người ghi .*moderation-instant\.ts.* nhưng thực tế ghi \[(?!.*moderation-instant)/,
    )
    const gone = stateViolations(REPO, {
      ...SHARED_STATE_WRITERS,
      'server/services/moderation-stats.ts#lastSeen': { writers: [], reason: 'không tồn tại' },
    })
    assert.equal(gone.length, 1, JSON.stringify(gone))
    assert.match(gone[0]!, /^ngoại lệ chết: server\/services\/moderation-stats\.ts#lastSeen không còn là trạng thái/)
  })

  it('luật 5 đỏ khi barrel moderation-worker.ts bỏ, đổi tên, đổi loại hay xuất thêm một tên', () => {
    const barrel = MODERATION_WORKER_BARREL
    const cases: Array<[string, Record<string, string>, string[]]> = [
      [
        'bỏ matchInstantRule',
        replaceIn(barrel, 'export { matchInstantRule, fastPreModerate }', 'export { fastPreModerate }'),
        [`${barrel} thiếu giá trị 'matchInstantRule'`],
      ],
      [
        'đổi tên RescanSummary',
        replaceIn(barrel, '  RescanSummary,\n', '  RescanSummary as ModerationRescanSummary,\n'),
        [`${barrel} thiếu kiểu 'RescanSummary'`, `${barrel} xuất thêm kiểu 'ModerationRescanSummary'`],
      ],
      [
        'giá trị thành kiểu',
        replaceIn(
          barrel,
          "export { checkAndModerateContent } from './moderation-worker-check'",
          "export type { checkAndModerateContent } from './moderation-worker-check'",
        ),
        [
          `${barrel} thiếu giá trị 'checkAndModerateContent'`,
          `${barrel} xuất thêm kiểu 'checkAndModerateContent'`,
        ],
      ],
      [
        'lộ helper nội bộ của đường ghi',
        append(barrel, "export { applyAutoHide } from './moderation-worker-persist'"),
        [`${barrel} xuất thêm giá trị 'applyAutoHide'`],
      ],
      [
        'export *',
        append(barrel, "export * from './moderation-worker-check'"),
        [`${barrel} xuất thêm giá trị '* from './moderation-worker-check''`],
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = moderationApiViolations(withOverrides(override))
      assert.deepEqual(
        violations.map((violation) => violation.split(' — ')[0]),
        expected,
        label,
      )
    }
  })

  it('hình dạng barrel moderation-worker.ts đỏ khi có mã, import, export *, hay nguồn ngoài nhóm', () => {
    const base = REPO.get(MODERATION_WORKER_BARREL)!
    const swap = (from: string, to: string) => {
      assert.ok(base.includes(from), `barrel không còn đoạn ${JSON.stringify(from)} để đột biến`)
      return base.replace(from, to)
    }
    const cases: Array<[string, string, RegExp]> = [
      // Luật 5 vẫn xanh với ca này (cùng tên, cùng loại) — chỉ phép kiểm hình dạng bắt.
      [
        'mã cùng tên dời về barrel',
        swap(
          "export { checkAndModerateContent } from './moderation-worker-check'",
          'export async function checkAndModerateContent() { return null }',
        ),
        /^not a re-export: export async function checkAndModerateContent/,
      ],
      ['import', `import { workerStats } from './moderation-stats'\n${base}`, /^not a re-export: import/],
      ['export *', `${base}\nexport * from './moderation-worker-check'\n`, /^not a named re-export/],
      ['export * as', `${base}\nexport * as check from './moderation-worker-check'\n`, /^not a named re-export/],
      [
        'anh em moderation-regex',
        `${base}\nexport { checkModerationPattern } from './moderation-regex'\n`,
        /^not re-exported from a part of the family/,
      ],
      [
        'ngoài server/services',
        `${base}\nexport { logInfo } from '../utils/logger'\n`,
        /^not re-exported from a part of the family/,
      ],
      ['export { … } không có module', `${base}\nexport { getWorkerStats as _g }\n`, /^a re-export without a module/],
      ['rỗng', '', /^the barrel exports nothing$/],
    ]
    for (const [label, source, expected] of cases) {
      const problems = moderationWorkerBarrelProblems(source)
      assert.equal(problems.length, 1, `${label}: ${JSON.stringify(problems)}`)
      assert.match(problems[0]!, expected, label)
    }
    // Ca đầu: luật 5 đúng là không thấy gì.
    assert.deepEqual(
      moderationApiViolations(withOverrides({ [MODERATION_WORKER_BARREL]: cases[0]![1] })),
      [],
    )
  })

  it('luật 6 đỏ khi nơi gọi ngoài nhóm import thẳng một tệp của nhóm, ở mọi dạng', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'endpoint chat nhập tệp con thay vì barrel (lọt khỏi mock của test chatbot)',
        replaceIn(
          'server/api/chat.post.ts',
          "from '../services/moderation-worker'",
          "from '../services/moderation-worker-prescreen'",
        ),
        /^\[moderation-worker\] server\/api\/chat\.post\.ts:\d+ \(import\) import server\/services\/moderation-worker-prescreen\.ts/,
      ],
      [
        'import type từ tệp kiểu',
        replaceIn(
          'server/services/comments-reply-email.ts',
          "import type { ModerationCheckOutput } from './moderation-worker'",
          "import type { ModerationCheckOutput } from './moderation-worker-types'",
        ),
        /^\[moderation-worker\] server\/services\/comments-reply-email\.ts:\d+ \(import\) import server\/services\/moderation-worker-types\.ts/,
      ],
      [
        'job quét lại nhập thẳng lượt quét',
        inject(
          'server/services/moderation-rescan-job.ts',
          "import { rescanExistingContent as _r } from './moderation-worker-rescan'",
        ),
        /^\[moderation-worker\] server\/services\/moderation-rescan-job\.ts:1 \(import\) import server\/services\/moderation-worker-rescan\.ts/,
      ],
      [
        'tệp tách từ trước (moderation-stats) qua namespace',
        inject(
          'server/api/admin/ai/moderation/worker-status.get.ts',
          "import * as _stats from '../../../../services/moderation-stats'",
        ),
        /^\[moderation-worker\] server\/api\/admin\/ai\/moderation\/worker-status\.get\.ts:1 \(import\) import server\/services\/moderation-stats\.ts/,
      ],
      [
        'import() động',
        append('server/services/livestream-chat.ts', "export const _lazy = () => import('./moderation-worker-check')"),
        /^\[moderation-worker\] server\/services\/livestream-chat\.ts:\d+ \(import\(\)\) import server\/services\/moderation-worker-check\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const { violations } = moderationConsumerCheck(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 6 KHÔNG đỏ: tệp con nhập tệp con, nơi gọi nhập barrel hay anh em moderation-regex', () => {
    assert.deepEqual(
      moderationConsumerCheck(
        withOverrides({
          ...inject(
            'server/services/moderation-worker-rescan.ts',
            "import { matchInstantRule as _m } from './moderation-worker-prescreen'",
          ),
          ...inject(
            'server/api/admin/ai/moderation/worker-status.get.ts',
            "import { checkModerationPattern as _c } from '../../../../services/moderation-regex'",
          ),
        }),
      ).violations,
      [],
    )
  })

  // ─── Nhóm chat-policy (barrel server/utils/chatbot/, tệp con server/services/) ─

  it('thành viên nhóm ở đúng thư mục tệp con (`familyHome`): tệp cùng tiền tố ở thư mục khác không lọt vào', () => {
    const sources = withOverrides({
      'server/services/chat-policy-extra.ts': 'export const _x = 1\n',
      'server/utils/chatbot/chat-policy-extra.ts': 'export const _z = 1\n',
      'server/utils/chatbot/media-portal-extra.ts': 'export const _y = 1\n',
    })
    const chatPolicy = familyMembers(sources, FAMILIES['chat-policy']!)
    assert.ok(chatPolicy.includes('server/services/chat-policy-extra.ts'), 'tệp con mới ở server/services thuộc nhóm')
    assert.ok(!chatPolicy.includes('server/utils/chatbot/chat-policy-extra.ts'), 'cùng tiền tố cạnh barrel không thuộc nhóm (và chatPolicyFiles() đỏ vì nó)')
    assert.ok(chatPolicy.every((file) => file.startsWith('server/services/chat-policy-')), JSON.stringify(chatPolicy))
    // Nhóm không khai `dir` vẫn ở thư mục của barrel: không lọt sang thư mục khác.
    assert.ok(!familyMembers(sources, FAMILIES['media-portal']!).includes('server/utils/chatbot/media-portal-extra.ts'))
  })

  it('luật 1 đỏ khi tệp con chat-policy-* nạp barrel ../utils/chatbot/chat-policy, ở mọi dạng — kể cả tệp con chưa ai liệt kê', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import',
        inject(chatPolicyPart('answer'), "import { HOTLINE as _h } from '../utils/chatbot/chat-policy'"),
        /^\[chat-policy\] server\/services\/chat-policy-answer\.ts:1 \(import\) import ngược server\/utils\/chatbot\/chat-policy\.ts$/,
      ],
      [
        'import type, có đuôi .ts',
        inject(chatPolicyPart('provider'), "import type { ChatResult as _R } from '../utils/chatbot/chat-policy.ts'"),
        /^\[chat-policy\] server\/services\/chat-policy-provider\.ts:1 \(import\)/,
      ],
      [
        'export … from',
        inject(chatPolicyPart('prompt'), "export { HOTLINE as _H } from '../utils/chatbot/chat-policy'"),
        /^\[chat-policy\] server\/services\/chat-policy-prompt\.ts:1 \(export … from\)/,
      ],
      [
        'import() động trong hàm',
        append(
          chatPolicyPart('fallbacks'),
          "export async function _lazy() { return (await import('../utils/chatbot/chat-policy')).HOTLINE }",
        ),
        /^\[chat-policy\] server\/services\/chat-policy-fallbacks\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'typeof import() qua alias #server',
        append(chatPolicyPart('contract'), "export type _Api = typeof import('#server/utils/chatbot/chat-policy')"),
        /^\[chat-policy\] server\/services\/chat-policy-contract\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp con mới mà barrel chưa xuất lại (thuộc nhóm nhờ mẫu tệp)',
        { [chatPolicyPart('extra')]: "import { HOTLINE } from '../utils/chatbot/chat-policy'\nexport const _h = HOTLINE\n" },
        /^\[chat-policy\] server\/services\/chat-policy-extra\.ts:1 \(import\) import ngược server\/utils\/chatbot\/chat-policy\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./chat-policy-contract` với barrel, và hàng xóm import barrel thì không đỏ', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides({
          ...inject(chatPolicyPart('answer'), "import { HOTLINE as _h } from './chat-policy-contract'"),
          // Hàng xóm (không thuộc nhóm): `input-length.ts`/`chat.ts` import barrel đúng chủ đích —
          // cạnh barrel, và cạnh tệp con ở server/services.
          ...inject('server/utils/chatbot/session-limit.ts', "import { HOTLINE as _h } from './chat-policy'"),
          ...inject('server/services/chatbot-settings.ts', "import { HOTLINE as _h } from '../utils/chatbot/chat-policy'"),
        }),
      ),
      [],
    )
  })

  it('vòng import qua hàng xóm thì đỏ — luật 1 không thấy, phép dò vòng thấy', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        // Tệp con nhập một nơi gọi của barrel: barrel → answer → input-length → barrel.
        'tệp con nhập input-length.ts',
        inject(chatPolicyPart('answer'), "import { chatInputCharLimit as _c } from '../utils/chatbot/input-length'"),
        /^server\/utils\/chatbot\/chat-policy\.ts → .*server\/utils\/chatbot\/input-length\.ts → server\/utils\/chatbot\/chat-policy\.ts$/,
      ],
      [
        // Module riêng mà nhóm import quay lại nhập barrel: barrel → … → chat-turns → barrel.
        'chat-turns.ts nhập barrel',
        inject('server/utils/chatbot/chat-turns.ts', "import { HOTLINE as _h } from './chat-policy'"),
        /^server\/utils\/chatbot\/chat-policy\.ts → .*server\/utils\/chatbot\/chat-turns\.ts → server\/utils\/chatbot\/chat-policy\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      assert.deepEqual(selfImportViolations(withOverrides(override)), [], `${label}: luật 1 im lặng`)
      const cycles = familyImportCycles(withOverrides(override), FAMILIES['chat-policy']!)
      assert.ok(cycles.length > 0, `${label}: không thấy vòng`)
      for (const cycle of cycles) assert.match(cycle, expected, label)
    }
  })

  it('luật 4 đỏ khi luật hạn mức AI bị chép sang tệp thứ hai, hay bị nới từ ngoài chủ', () => {
    const answer = chatPolicyPart('answer')
    const endpoint = 'server/api/public/chatbot/index.post.ts'
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'trần theo địa chỉ chép sang đường định tuyến',
        inject(answer, 'const AI_IP_CEILING_RULE = { limit: 1_000_000, windowSeconds: 1 }'),
        /^\[chat-policy\] 'AI_IP_CEILING_RULE' khai ở 2 tệp \(server\/services\/chat-policy-answer\.ts:1, server\/services\/chat-policy-rate-limit\.ts:\d+\)/,
      ],
      [
        'tệp con nới trần theo địa chỉ',
        {
          [answer]: `import { AI_IP_CEILING_RULE } from './chat-policy-rate-limit'\n${REPO.get(answer)}\nexport function _loosen() { AI_IP_CEILING_RULE.limit = Number.MAX_SAFE_INTEGER }\n`,
        },
        /^\[chat-policy\] server\/services\/chat-policy-answer\.ts:\d+ \(gán\) ghi vào 'AI_IP_CEILING_RULE' của server\/services\/chat-policy-rate-limit\.ts/,
      ],
      [
        'endpoint nới hạn mức phiên qua barrel',
        {
          [endpoint]: `import { AI_QUOTA_RULE } from '../../../utils/chatbot/chat-policy'\n${REPO.get(endpoint)}\nexport function _loosen() { Object.assign(AI_QUOTA_RULE, { limit: 1e9 }) }\n`,
        },
        /^\[chat-policy\] server\/api\/public\/chatbot\/index\.post\.ts:\d+ \(Object\.assign\(\)\) ghi vào 'AI_QUOTA_RULE' của server\/services\/chat-policy-rate-limit\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 5 đỏ khi barrel chat-policy.ts bỏ, đổi tên, đổi loại hay xuất thêm một tên', () => {
    const barrel = CHAT_POLICY_BARREL
    const cases: Array<[string, Record<string, string>, string[]]> = [
      [
        'bỏ approvedFallback',
        replaceIn(barrel, "export { approvedFallback } from '../../services/chat-policy-fallbacks'\n", ''),
        [`${barrel} thiếu giá trị 'approvedFallback'`],
      ],
      [
        'đổi tên ChatEvent',
        replaceIn(barrel, 'ChatEvent, ChatDependencies }', 'ChatEvent as ChatH3Event, ChatDependencies }'),
        [`${barrel} thiếu kiểu 'ChatEvent'`, `${barrel} xuất thêm kiểu 'ChatH3Event'`],
      ],
      [
        'giá trị thành kiểu',
        replaceIn(
          barrel,
          "export { answerGroundedChat } from '../../services/chat-policy-answer'",
          "export type { answerGroundedChat } from '../../services/chat-policy-answer'",
        ),
        [`${barrel} thiếu giá trị 'answerGroundedChat'`, `${barrel} xuất thêm kiểu 'answerGroundedChat'`],
      ],
      [
        'lộ helper nội bộ của đường gọi AI',
        append(barrel, "export { callProvider } from '../../services/chat-policy-provider'"),
        [`${barrel} xuất thêm giá trị 'callProvider'`],
      ],
      [
        'export *',
        append(barrel, "export * from '../../services/chat-policy-request'"),
        [`${barrel} xuất thêm giá trị '* from '../../services/chat-policy-request''`],
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = chatPolicyApiViolations(withOverrides(override))
      assert.deepEqual(
        violations.map((violation) => violation.split(' — ')[0]),
        expected,
        label,
      )
    }
  })

  it('hình dạng barrel chat-policy.ts đỏ khi có mã, import, export *, hay nguồn ngoài nhóm', () => {
    const base = REPO.get(CHAT_POLICY_BARREL)!
    const swap = (from: string, to: string) => {
      assert.ok(base.includes(from), `barrel không còn đoạn ${JSON.stringify(from)} để đột biến`)
      return base.replace(from, to)
    }
    const cases: Array<[string, string, RegExp]> = [
      // Luật 5 vẫn xanh với ca này (cùng tên, cùng loại) — chỉ phép kiểm hình dạng bắt.
      [
        'mã cùng tên dời về barrel',
        swap(
          "export { answerGroundedChat } from '../../services/chat-policy-answer'",
          'export async function answerGroundedChat() { return null }',
        ),
        /^not a re-export: export async function answerGroundedChat/,
      ],
      ['import', `import { HOTLINE } from '../../services/chat-policy-contract'\n${base}`, /^not a re-export: import/],
      ['export *', `${base}\nexport * from '../../services/chat-policy-request'\n`, /^not a named re-export/],
      ['export * as', `${base}\nexport * as request from '../../services/chat-policy-request'\n`, /^not a named re-export/],
      ['hàng xóm chat-turns', `${base}\nexport { chatTurnText } from './chat-turns'\n`, /^not re-exported from a part of the family/],
      // Một "tệp con" đặt lại cạnh barrel: ngoài tập quét, Nitro tự import nó.
      ['tệp con cạnh barrel', `${base}\nexport { HOTLINE as _h } from './chat-policy-contract'\n`, /^not re-exported from a part of the family/],
      ['service khác', `${base}\nexport { fastPreModerate } from '../../services/moderation-worker'\n`, /^not re-exported from a part of the family/],
      ['ngoài thư mục', `${base}\nexport { logWarn } from '../logger'\n`, /^not re-exported from a part of the family/],
      ['export { … } không có module', `${base}\nexport { HOTLINE as _h }\n`, /^a re-export without a module/],
      ['rỗng', '', /^the barrel exports nothing$/],
    ]
    for (const [label, source, expected] of cases) {
      const problems = chatPolicyBarrelProblems(source)
      assert.equal(problems.length, 1, `${label}: ${JSON.stringify(problems)}`)
      assert.match(problems[0]!, expected, label)
    }
    // Ca đầu: luật 5 đúng là không thấy gì.
    assert.deepEqual(chatPolicyApiViolations(withOverrides({ [CHAT_POLICY_BARREL]: cases[0]![1] })), [])
  })

  it('luật 6 đỏ khi nơi gọi ngoài nhóm chat-policy import thẳng một tệp con, ở mọi dạng', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'input-length.ts lấy CHAT_LIMITS từ tệp hợp đồng (lọt khỏi mock của bốn test)',
        replaceIn('server/utils/chatbot/input-length.ts', "from './chat-policy'", "from '../../services/chat-policy-contract'"),
        /^\[chat-policy\] server\/utils\/chatbot\/input-length\.ts:\d+ \(import\) import server\/services\/chat-policy-contract\.ts — .*bốn tệp test mock\.module/,
      ],
      [
        'endpoint chat nhập rate limit thẳng từ tệp con',
        replaceIn('server/api/chat.post.ts', "from '../utils/chatbot/chat-policy'", "from '../services/chat-policy-rate-limit'"),
        /^\[chat-policy\] server\/api\/chat\.post\.ts:\d+ \(import\) import server\/services\/chat-policy-rate-limit\.ts/,
      ],
      [
        'import type từ tệp hợp đồng',
        inject('server/api/public/chatbot/index.post.ts', "import type { ChatEvent as _E } from '../../../services/chat-policy-contract'"),
        /^\[chat-policy\] server\/api\/public\/chatbot\/index\.post\.ts:1 \(import\) import server\/services\/chat-policy-contract\.ts/,
      ],
      [
        'import() động',
        append('server/utils/chatbot/chat.ts', "export const _lazy = () => import('../../services/chat-policy-answer')"),
        /^\[chat-policy\] server\/utils\/chatbot\/chat\.ts:\d+ \(import\(\)\) import server\/services\/chat-policy-answer\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const { violations } = chatPolicyConsumerCheck(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 6 KHÔNG đỏ (chat-policy): tệp con nhập tệp con, nơi gọi mới nhập barrel', () => {
    assert.deepEqual(
      chatPolicyConsumerCheck(
        withOverrides({
          ...inject(chatPolicyPart('answer'), "import { HOTLINE as _h } from './chat-policy-contract'"),
          ...inject('server/api/public/chatbot/session.post.ts', "import { HOTLINE as _h } from '../../../utils/chatbot/chat-policy'"),
        }),
      ).violations,
      [],
    )
  })

  // ─── Nhóm ai-gateway (barrel + ai-gateway-*.ts + ba tệp tách từ trước) ───────

  it('luật 1 đỏ khi tệp của nhóm ai-gateway nạp barrel, ở mọi dạng — kể cả tệp tách từ trước và tệp con barrel chưa xuất lại', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import',
        inject('server/services/ai-gateway-call.ts', "import { substituteVariables as _s } from './ai-gateway'"),
        /^\[ai-gateway\] server\/services\/ai-gateway-call\.ts:1 \(import\) import ngược server\/services\/ai-gateway\.ts$/,
      ],
      [
        'import type, có đuôi .ts',
        inject('server/services/ai-gateway-types.ts', "import type { AiCallResult as _R } from './ai-gateway.ts'"),
        /^\[ai-gateway\] server\/services\/ai-gateway-types\.ts:1 \(import\)/,
      ],
      [
        'export … from',
        inject('server/services/ai-gateway-config.ts', "export { callAi as _c } from './ai-gateway'"),
        /^\[ai-gateway\] server\/services\/ai-gateway-config\.ts:1 \(export … from\)/,
      ],
      [
        'tệp tách từ trước (ai-sse.ts, đầu đọc SSE)',
        inject('server/services/ai-sse.ts', "import { callAi as _c } from './ai-gateway'"),
        /^\[ai-gateway\] server\/services\/ai-sse\.ts:1 \(import\) import ngược server\/services\/ai-gateway\.ts$/,
      ],
      [
        'import() động trong tệp tách từ trước',
        append('server/services/ai-text-cleaner.ts', "export async function _lazy() { return (await import('./ai-gateway')).callAi }"),
        /^\[ai-gateway\] server\/services\/ai-text-cleaner\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'typeof import() qua alias #server',
        append('server/services/ai-response-parse.ts', "export type _Api = typeof import('#server/services/ai-gateway')"),
        /^\[ai-gateway\] server\/services\/ai-response-parse\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp con mới mà barrel chưa xuất lại (thuộc nhóm nhờ mẫu tệp)',
        { 'server/services/ai-gateway-extra.ts': "import { callAi } from './ai-gateway'\nexport const _c = callAi\n" },
        /^\[ai-gateway\] server\/services\/ai-gateway-extra\.ts:1 \(import\) import ngược server\/services\/ai-gateway\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./ai-gateway-types` với barrel ai-gateway', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides(inject('server/services/ai-gateway-config.ts', "import type { AiCallInput as _I } from './ai-gateway-types'")),
      ),
      [],
    )
  })

  it('vòng import qua util mà callAi import thì đỏ (ai-gateway) — luật 1 không thấy, phép dò vòng thấy', () => {
    const override = inject('server/utils/ai-budget.ts', "import { callAi as _c } from '../services/ai-gateway'")
    // ai-budget.ts không thuộc nhóm: luật 1 im lặng…
    assert.deepEqual(selfImportViolations(withOverrides(override)), [])
    // …nhưng barrel → ai-gateway-call → ai-budget → barrel là một vòng.
    const cycles = familyImportCycles(withOverrides(override), FAMILIES['ai-gateway']!)
    assert.ok(cycles.length > 0, 'không thấy vòng')
    for (const cycle of cycles)
      assert.match(cycle, /^server\/services\/ai-gateway\.ts → .*server\/utils\/ai-budget\.ts → server\/services\/ai-gateway\.ts$/)
  })

  it('luật 4 đỏ khi cache của gateway bị chép sang tệp con thứ hai (hai sổ cache, mỗi nửa thấy một nửa)', () => {
    const violations = stateViolations(
      withOverrides(inject('server/services/ai-gateway-call.ts', 'const configCache = new Map<string, unknown>()')),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[ai-gateway\] 'configCache' khai ở 2 tệp \(server\/services\/ai-gateway-call\.ts:1, server\/services\/ai-gateway-config\.ts:\d+\)/,
    )
  })

  it('luật 4 đỏ khi tệp con khác xoá cache của chủ (mở export rồi `.clear()`)', () => {
    const call = 'server/services/ai-gateway-call.ts'
    const violations = stateViolations(
      withOverrides({
        ...replaceIn('server/services/ai-gateway-config.ts', 'const providerCache = new Map', 'export const providerCache = new Map'),
        [call]: `import { providerCache } from './ai-gateway-config'\n${REPO.get(call)}\nexport function _flush() { providerCache.clear() }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[ai-gateway\] server\/services\/ai-gateway-call\.ts:\d+ \(\.clear\(\)\) ghi vào 'providerCache' của server\/services\/ai-gateway-config\.ts/,
    )
  })

  it('luật 4 đỏ khi endpoint đổi bảng provider → định dạng nhập qua barrel', () => {
    const editorial = 'server/api/admin/ai/editorial.post.ts'
    const from = "import { callAi } from '../../../services/ai-gateway'"
    const source = REPO.get(editorial)!
    assert.ok(source.includes(from), `${editorial} không còn đoạn ${JSON.stringify(from)} để đột biến`)
    const violations = stateViolations(
      withOverrides({
        ...replaceIn('server/services/ai-gateway-config.ts', 'const PROVIDER_POLICY:', 'export const PROVIDER_POLICY:'),
        ...append(AI_GATEWAY_BARREL, "export { PROVIDER_POLICY } from './ai-gateway-config'"),
        [editorial]: `${source.replace(from, "import { callAi, PROVIDER_POLICY } from '../../../services/ai-gateway'")}\nexport function _loosen() { PROVIDER_POLICY.anthropic = 'openai-compatible' }\n`,
      }),
    )
    assert.equal(violations.length, 1, JSON.stringify(violations))
    assert.match(
      violations[0]!,
      /^\[ai-gateway\] server\/api\/admin\/ai\/editorial\.post\.ts:\d+ \(gán\) ghi vào 'PROVIDER_POLICY' của server\/services\/ai-gateway-config\.ts/,
    )
  })

  it('luật 5 đỏ khi barrel ai-gateway.ts bỏ, đổi tên, đổi loại hay xuất thêm một tên', () => {
    const barrel = AI_GATEWAY_BARREL
    const cases: Array<[string, Record<string, string>, string[]]> = [
      [
        'bỏ parseToolArguments',
        replaceIn(barrel, 'export { extractToolCallsFromMessage, parseToolArguments }', 'export { extractToolCallsFromMessage }'),
        [`${barrel} thiếu giá trị 'parseToolArguments'`],
      ],
      [
        'đổi tên AiCallResult',
        replaceIn(barrel, 'AiTransportOverrides, AiCallResult }', 'AiTransportOverrides, AiCallResult as AiGatewayResult }'),
        [`${barrel} thiếu kiểu 'AiCallResult'`, `${barrel} xuất thêm kiểu 'AiGatewayResult'`],
      ],
      [
        'giá trị thành kiểu',
        replaceIn(barrel, "export { callAi } from './ai-gateway-call'", "export type { callAi } from './ai-gateway-call'"),
        [`${barrel} thiếu giá trị 'callAi'`, `${barrel} xuất thêm kiểu 'callAi'`],
      ],
      [
        'lộ bộ đọc cache nội bộ',
        append(barrel, "export { loadProvider } from './ai-gateway-config'"),
        [`${barrel} xuất thêm giá trị 'loadProvider'`],
      ],
      ['export *', append(barrel, "export * from './ai-gateway-config'"), [`${barrel} xuất thêm giá trị '* from './ai-gateway-config''`]],
    ]
    for (const [label, override, expected] of cases) {
      const violations = aiGatewayApiViolations(withOverrides(override))
      assert.deepEqual(violations.map((violation) => violation.split(' — ')[0]), expected, label)
    }
  })

  it('hình dạng barrel ai-gateway.ts đỏ khi có mã, import, export *, hay nguồn ngoài nhóm', () => {
    const base = REPO.get(AI_GATEWAY_BARREL)!
    const swap = (from: string, to: string) => {
      assert.ok(base.includes(from), `barrel không còn đoạn ${JSON.stringify(from)} để đột biến`)
      return base.replace(from, to)
    }
    const cases: Array<[string, string, RegExp]> = [
      // Luật 5 vẫn xanh với ca này (cùng tên, cùng loại) — chỉ phép kiểm hình dạng bắt.
      [
        'mã cùng tên dời về barrel',
        swap("export { callAi } from './ai-gateway-call'", 'export async function callAi() { return { ok: false } }'),
        /^not a re-export: export async function callAi/,
      ],
      ['import', `import { loadProvider } from './ai-gateway-config'\n${base}`, /^not a re-export: import/],
      ['export *', `${base}\nexport * from './ai-gateway-config'\n`, /^not a named re-export/],
      ['export * as', `${base}\nexport * as config from './ai-gateway-config'\n`, /^not a named re-export/],
      ['util ngoài nhóm (ngân sách AI)', `${base}\nexport { checkBudget } from '../utils/ai-budget'\n`, /^not re-exported from a part of the family/],
      ['service khác trong server/services', `${base}\nexport { HOTLINE } from './chat-policy-contract'\n`, /^not re-exported from a part of the family/],
      ['export { … } không có module', `${base}\nexport { callAi as _c }\n`, /^a re-export without a module/],
      ['rỗng', '', /^the barrel exports nothing$/],
    ]
    for (const [label, source, expected] of cases) {
      const problems = aiGatewayBarrelProblems(source)
      assert.equal(problems.length, 1, `${label}: ${JSON.stringify(problems)}`)
      assert.match(problems[0]!, expected, label)
    }
    // Ca đầu: luật 5 đúng là không thấy gì.
    assert.deepEqual(aiGatewayApiViolations(withOverrides({ [AI_GATEWAY_BARREL]: cases[0]![1] })), [])
  })

  it('luật 6 đỏ khi nơi gọi ngoài nhóm ai-gateway import thẳng một tệp của nhóm, ở mọi dạng', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'endpoint biên tập AI nhập callAi thẳng từ tệp con (lọt khỏi mock của security-ai-editorial-html)',
        replaceIn('server/api/admin/ai/editorial.post.ts', "from '../../../services/ai-gateway'", "from '../../../services/ai-gateway-call'"),
        /^\[ai-gateway\] server\/api\/admin\/ai\/editorial\.post\.ts:\d+ \(import\) import server\/services\/ai-gateway-call\.ts — .*mười tệp test mock\.module/,
      ],
      [
        'lượt kiểm duyệt nhập thẳng tệp con (lọt khỏi mock của năm test kiểm duyệt)',
        replaceIn('server/services/moderation-worker-check.ts', "from './ai-gateway'", "from './ai-gateway-call'"),
        /^\[ai-gateway\] server\/services\/moderation-worker-check\.ts:\d+ \(import\) import server\/services\/ai-gateway-call\.ts/,
      ],
      [
        'import type từ tệp kiểu',
        inject('server/services/universal-translation.ts', "import type { AiCallResult as _R } from './ai-gateway-types'"),
        /^\[ai-gateway\] server\/services\/universal-translation\.ts:1 \(import\) import server\/services\/ai-gateway-types\.ts/,
      ],
      [
        'tệp tách từ trước (ai-text-cleaner) nhập thẳng',
        inject('server/services/chat-policy-provider.ts', "import { cleanAiContent as _c } from './ai-text-cleaner'"),
        /^\[ai-gateway\] server\/services\/chat-policy-provider\.ts:1 \(import\) import server\/services\/ai-text-cleaner\.ts/,
      ],
      [
        'import() động',
        append('server/services/article-translation-worker.ts', "export const _lazy = () => import('./ai-gateway-config')"),
        /^\[ai-gateway\] server\/services\/article-translation-worker\.ts:\d+ \(import\(\)\) import server\/services\/ai-gateway-config\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const { violations } = aiGatewayConsumerCheck(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 6 KHÔNG đỏ (ai-gateway): tệp con nhập tệp con, nơi gọi mới nhập barrel', () => {
    assert.deepEqual(
      aiGatewayConsumerCheck(
        withOverrides({
          ...inject('server/services/ai-gateway-call.ts', "import type { AiToolDefinition as _T } from './ai-gateway-types'"),
          ...inject('server/services/ai-sse.ts', "import { cleanAiContent as _c } from './ai-text-cleaner'"),
          ...inject(chatPolicyPart('answer'), "import { substituteVariables as _s } from './ai-gateway'"),
        }),
      ).violations,
      [],
    )
  })

  // ─── Nhóm moderation-regex (barrel + moderation-regex-*.ts) ──────────────────

  it('luật 1 đỏ khi tệp của nhóm moderation-regex nạp barrel, ở mọi dạng — ở cả năm tệp con và tệp con mới', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'import (tệp chạy)',
        inject('server/services/moderation-regex-runtime.ts', "import { compileModerationRegex as _c } from './moderation-regex'"),
        /^\[moderation-regex\] server\/services\/moderation-regex-runtime\.ts:1 \(import\) import ngược server\/services\/moderation-regex\.ts$/,
      ],
      [
        'import type, có đuôi .ts (tệp kiểm)',
        inject('server/services/moderation-regex-check.ts', "import type { ModerationPatternCheck as _M } from './moderation-regex.ts'"),
        /^\[moderation-regex\] server\/services\/moderation-regex-check\.ts:1 \(import\)/,
      ],
      [
        'export … from (tệp hằng số)',
        inject('server/services/moderation-regex-limits.ts', "export { testModerationRegex as _t } from './moderation-regex'"),
        /^\[moderation-regex\] server\/services\/moderation-regex-limits\.ts:1 \(export … from\)/,
      ],
      [
        'import() động trong tệp barrel không xuất lại (bộ phân tích cú pháp)',
        append('server/services/moderation-regex-parser.ts', "export async function _lazy() { return (await import('./moderation-regex')).findCatastrophicShape }"),
        /^\[moderation-regex\] server\/services\/moderation-regex-parser\.ts:\d+ \(import\(\)\)/,
      ],
      [
        'typeof import() qua alias #server (tệp phân tích)',
        append('server/services/moderation-regex-analysis.ts', "export type _Api = typeof import('#server/services/moderation-regex')"),
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(import\(\) type\)/,
      ],
      [
        'tệp con mới mà barrel chưa xuất lại (thuộc nhóm nhờ mẫu tệp)',
        { 'server/services/moderation-regex-extra.ts': "import { testModerationRegex } from './moderation-regex'\nexport const _t = testModerationRegex\n" },
        /^\[moderation-regex\] server\/services\/moderation-regex-extra\.ts:1 \(import\) import ngược server\/services\/moderation-regex\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = selfImportViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 1 KHÔNG nhầm `./moderation-regex-check` với barrel moderation-regex', () => {
    assert.deepEqual(
      selfImportViolations(
        withOverrides({
          ...inject('server/services/moderation-regex-runtime.ts', "import { isRegexRuleType as _r } from './moderation-regex-check'"),
          ...inject('server/services/moderation-regex-limits.ts', "import type { Node as _N } from './moderation-regex-parser'"),
        }),
      ),
      [],
    )
  })

  it('vòng import qua nơi gọi mà tệp con nhập thì đỏ (moderation-regex) — luật 1 không thấy, phép dò vòng thấy', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'bộ phân tích cú pháp nhập cache luật (cache luật nhập barrel regex)',
        inject('server/services/moderation-regex-parser.ts', "import { getCachedRulesCount as _g } from './moderation-rules-cache'"),
        /^server\/services\/moderation-regex\.ts → .*server\/services\/moderation-regex-parser\.ts → server\/services\/moderation-rules-cache\.ts → server\/services\/moderation-regex\.ts$/,
      ],
      [
        'tệp chạy nhập barrel kiểm duyệt (worker → cache luật → regex)',
        inject('server/services/moderation-regex-runtime.ts', "import { getWorkerStats as _g } from './moderation-worker'"),
        /^server\/services\/moderation-regex\.ts → server\/services\/moderation-regex-runtime\.ts → server\/services\/moderation-worker\.ts → .*server\/services\/moderation-regex\.ts$/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      assert.deepEqual(selfImportViolations(withOverrides(override)), [], `${label}: luật 1 im lặng`)
      const cycles = familyImportCycles(withOverrides(override), FAMILIES['moderation-regex']!)
      assert.ok(cycles.length > 0, `${label}: không thấy vòng`)
      assert.ok(cycles.some((cycle) => expected.test(cycle)), `${label}: ${JSON.stringify(cycles)}`)
    }
  })

  it('luật 4 đỏ khi sổ luật bị tắt hay đồng hồ bị chép sang tệp con thứ hai (hai sổ: tắt ở một nửa, nửa kia vẫn chạy)', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'sổ luật tắt chép sang tệp kiểm',
        inject('server/services/moderation-regex-check.ts', 'const disabledUntil = new Map<string, number>()'),
        /^\[moderation-regex\] 'disabledUntil' khai ở 2 tệp \(server\/services\/moderation-regex-check\.ts:1, server\/services\/moderation-regex-runtime\.ts:\d+\)/,
      ],
      [
        'đồng hồ chép sang tệp phân tích',
        inject('server/services/moderation-regex-analysis.ts', 'let timing = { elapsed: () => 0, now: () => 0 }'),
        /^\[moderation-regex\] 'timing' khai ở 2 tệp \(server\/services\/moderation-regex-analysis\.ts:1, server\/services\/moderation-regex-runtime\.ts:\d+\)/,
      ],
      [
        'cache biên dịch chép sang tệp chạy',
        inject('server/services/moderation-regex-runtime.ts', 'const compiled = new Map<string, RegExp | null>()'),
        /^\[moderation-regex\] 'compiled' khai ở 2 tệp \(server\/services\/moderation-regex-check\.ts:\d+, server\/services\/moderation-regex-runtime\.ts:1\)/,
      ],
      [
        'bảng mẫu dựng bằng IIFE chép sang tệp kiểm (hai bảng: thêm ký tự ở một bên, bên kia không thấy)',
        inject('server/services/moderation-regex-check.ts', "const SAMPLE_CHARS: readonly string[] = (() => [' '])()"),
        /^\[moderation-regex\] 'SAMPLE_CHARS' khai ở 2 tệp \(server\/services\/moderation-regex-check\.ts:1, server\/services\/moderation-regex-parser\.ts:\d+\)/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 4 đỏ khi tệp khác ghi sổ luật tắt, cache biên dịch hay bảng mẫu của chủ — kể cả endpoint qua barrel', () => {
    const runtime = 'server/services/moderation-regex-runtime.ts'
    const check = 'server/services/moderation-regex-check.ts'
    const analysis = 'server/services/moderation-regex-analysis.ts'
    const endpoint = 'server/api/admin/ai/moderation/rules.post.ts'
    const from = "import { checkModerationPattern } from '../../../../services/moderation-regex'"
    const endpointSource = REPO.get(endpoint)!
    assert.ok(endpointSource.includes(from), `${endpoint} không còn đoạn ${JSON.stringify(from)} để đột biến`)
    const openBook = replaceIn(runtime, 'const disabledUntil = new Map', 'export const disabledUntil = new Map')
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'tệp kiểm bật lại mọi luật chậm (`.clear()`)',
        { ...openBook, [check]: `import { disabledUntil } from './moderation-regex-runtime'\n${REPO.get(check)}\nexport function _enableAll() { disabledUntil.clear() }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-check\.ts:\d+ \(\.clear\(\)\) ghi vào 'disabledUntil' của server\/services\/moderation-regex-runtime\.ts/,
      ],
      [
        'endpoint luật bật lại một luật qua barrel (`.delete()`)',
        {
          ...openBook,
          ...append(MODERATION_REGEX_BARREL, "export { disabledUntil } from './moderation-regex-runtime'"),
          [endpoint]: `${endpointSource.replace(from, "import { checkModerationPattern, disabledUntil } from '../../../../services/moderation-regex'")}\nexport function _enable(p: string) { disabledUntil.delete(p) }\n`,
        },
        /^\[moderation-regex\] server\/api\/admin\/ai\/moderation\/rules\.post\.ts:\d+ \(\.delete\(\)\) ghi vào 'disabledUntil' của server\/services\/moderation-regex-runtime\.ts/,
      ],
      [
        'tệp chạy xoá cache biên dịch của tệp kiểm',
        {
          ...replaceIn(check, 'const compiled = new Map', 'export const compiled = new Map'),
          [runtime]: `import { compiled } from './moderation-regex-check'\n${REPO.get(runtime)}\nexport function _flush() { compiled.clear() }\n`,
        },
        /^\[moderation-regex\] server\/services\/moderation-regex-runtime\.ts:\d+ \(\.clear\(\)\) ghi vào 'compiled' của server\/services\/moderation-regex-check\.ts/,
      ],
      // Qua bí danh (kiểm chứng 4.3b: I2a, I2b, I5 xanh trước khi guard lần qua bí danh).
      [
        'tệp phân tích đẩy vào SAMPLE_CHARS qua bí danh cục bộ (`const a = X as T; a.push()`)',
        { [analysis]: `${REPO.get(analysis)}\nexport function _alias() { const a = SAMPLE_CHARS as string[]; a.push('x') }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(\.push\(\)\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp phân tích đẩy vào SAMPLE_CHARS qua bí danh cấp module',
        { [analysis]: `${REPO.get(analysis)}\nconst ALIAS = SAMPLE_CHARS as string[]\nexport function _alias() { ALIAS.push('x') }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(\.push\(\)\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp kiểm cắt rỗng SAMPLE_CHARS qua bí danh của namespace (`const t = ns.X; t.length = 0`)',
        { [check]: `import * as _p from './moderation-regex-parser'\n${REPO.get(check)}\nexport function _ns() { const t = _p.SAMPLE_CHARS as string[]; t.length = 0 }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-check\.ts:\d+ \(gán\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp kiểm sắp lại SAMPLE_CHARS qua tên destructure từ namespace, qua hai tầng bí danh và một nhánh `??`',
        { [check]: `import * as _p from './moderation-regex-parser'\n${REPO.get(check)}\nconst { SAMPLE_CHARS: s } = _p\nexport function _d(fallback?: string[]) { const t = fallback ?? (s as string[]); t.sort() }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-check\.ts:\d+ \(\.sort\(\)\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      // Lớp có thành viên `static` là trạng thái (kiểm chứng 4.3b: I4b khai báo lớp, I6 biểu thức lớp).
      [
        'tệp phân tích ghi vào trường static của một lớp khai báo ở tệp phân tích cú pháp',
        {
          ...append('server/services/moderation-regex-parser.ts', "export class SampleBook { static table: string[] = ['a'] }"),
          [analysis]: `import { SampleBook } from './moderation-regex-parser'\n${REPO.get(analysis)}\nexport function _w() { SampleBook.table.push('b') }\n`,
        },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(\.push\(\)\) ghi vào 'SampleBook' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp phân tích ghi vào trường static của một biểu thức lớp ở tệp phân tích cú pháp',
        {
          ...append('server/services/moderation-regex-parser.ts', "export const SampleBook = class { static table: string[] = ['a'] }"),
          [analysis]: `import { SampleBook } from './moderation-regex-parser'\n${REPO.get(analysis)}\nexport function _w() { SampleBook.table.push('b') }\n`,
        },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(\.push\(\)\) ghi vào 'SampleBook' của server\/services\/moderation-regex-parser\.ts/,
      ],
      // `SAMPLE_CHARS` là mảng dựng bằng IIFE: trước khi lời gọi được tính là trạng thái, ba
      // ca dưới đây xanh (bằng chứng của lượt kiểm chứng: g10, g19, g20).
      [
        'tệp phân tích đẩy thêm vào SAMPLE_CHARS (`.push()`, ép kiểu bỏ readonly)',
        { [analysis]: `${REPO.get(analysis)}\nexport function _widen() { (SAMPLE_CHARS as string[]).push('ſ') }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(\.push\(\)\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp phân tích ghi đè một mẫu theo chỉ số (`[0] = …`)',
        { [analysis]: `${REPO.get(analysis)}\nexport function _swap() { (SAMPLE_CHARS as string[])[0] = 'x' }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-analysis\.ts:\d+ \(gán\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'nơi gọi ngoài nhóm cắt rỗng SAMPLE_CHARS (`.length = 0`) qua import thẳng tệp con',
        inject('server/services/moderation-worker-check.ts', "import { SAMPLE_CHARS as _S } from './moderation-regex-parser'\nexport function _drop() { (_S as string[]).length = 0 }"),
        /^\[moderation-regex\] server\/services\/moderation-worker-check\.ts:\d+ \(gán\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'tệp kiểm sắp lại SAMPLE_CHARS qua namespace (`ns.X.sort()`)',
        { [check]: `import * as _parser from './moderation-regex-parser'\n${REPO.get(check)}\nexport function _reorder() { (_parser.SAMPLE_CHARS as string[]).sort() }\n` },
        /^\[moderation-regex\] server\/services\/moderation-regex-check\.ts:\d+ \(\.sort\(\)\) ghi vào 'SAMPLE_CHARS' của server\/services\/moderation-regex-parser\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const violations = stateViolations(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 4 không đỏ oan qua bí danh: gán lại chính biến bí danh, bản sao, phần tử, phần `...rest`', () => {
    const analysis = 'server/services/moderation-regex-analysis.ts'
    for (const [label, code] of [
      ['gán lại biến bí danh chỉ đổi biến cục bộ', "export function _rebind() { let a: readonly string[] = SAMPLE_CHARS; a = []; a = SAMPLE_CHARS; return a }"],
      ['bản sao bằng spread và .slice() là mảng mới', "export function _copy() { const a = [...SAMPLE_CHARS]; a.push('x'); const b = SAMPLE_CHARS.slice(); b.sort(); return [a, b] }"],
      ['phần tử lấy ra (chuỗi) không phải bảng', "export function _each() { for (const c of SAMPLE_CHARS) { let d = c; d = `${d}x`; void d } }"],
      ['phần ...rest của destructure là đối tượng mới', "export function _rest() { const { length, ...rest } = SAMPLE_CHARS; (rest as Record<string, unknown>).x = 1; return length }"],
    ] as const) {
      assert.deepEqual(stateViolations(withOverrides({ [analysis]: `${REPO.get(analysis)}\n${code}\n` })), [], label)
    }
  })

  it('trạng thái xuất ra của moderation-regex đỏ khi sổ luật tắt, đồng hồ hay cache bị export — ở mọi tệp của nhóm, kể cả tệp con mới', () => {
    const extra = (overrides: Record<string, string>) =>
      exportedFamilyState(moderationRegexSourcesWith(overrides)).filter((entry) => !EXPORTED_STATE_ALLOWED.includes(entry))
    const runtime = 'server/services/moderation-regex-runtime.ts'
    assert.deepEqual(extra(replaceIn(runtime, 'const disabledUntil = new Map', 'export const disabledUntil = new Map')), [`${runtime}#disabledUntil`])
    assert.deepEqual(extra(replaceIn(runtime, 'let timing: RegexTiming', 'export let timing: RegexTiming')), [`${runtime}#timing`])
    assert.deepEqual(extra(replaceIn(runtime, 'const truncationLoggedUntil = new Map', 'export const truncationLoggedUntil = new Map')), [`${runtime}#truncationLoggedUntil`])
    assert.deepEqual(
      extra(replaceIn('server/services/moderation-regex-check.ts', 'const compiled = new Map', 'export const compiled = new Map')),
      ['server/services/moderation-regex-check.ts#compiled'],
    )
    // Mọi tệp của nhóm (barrel trừ ra — hình dạng barrel đã cấm khai báo), và tệp con mới.
    const parts = moderationRegexFiles().filter((file) => file !== MODERATION_REGEX_BARREL)
    assert.equal(parts.length, 5)
    for (const file of [...parts, 'server/services/moderation-regex-extra.ts'])
      assert.deepEqual(
        extra({ [file]: `${REPO.get(file) ?? ''}\nexport const _leak = new Map<string, number>()\n` }),
        [`${file}#_leak`],
        file,
      )
    // Bảng dựng bằng lời gọi (IIFE như `SAMPLE_CHARS`, hàm dựng, `.map()`), bí danh của một
    // đối tượng, regex literal, và `Object.freeze` chỉ khoá một tầng — đều là trạng thái.
    const part = 'server/services/moderation-regex-extra.ts'
    for (const [declaration, why] of [
      ['export const TABLE: readonly string[] = (() => [\'a\'])()', 'IIFE'],
      ['export const TABLE = buildTable()', 'lời gọi hàm dựng'],
      ['export const TABLE = [\'a\', \'b\'].map(x => x)', '.map()'],
      ['export const TABLE = Object.fromEntries([])', 'Object.fromEntries'],
      ['export const TABLE = SAMPLE_CHARS', 'bí danh'],
      ['export const TABLE = /a/g', 'regex literal (lastIndex ghi được)'],
      ['export const TABLE = Object.freeze({ chars: [\'a\'] })', 'Object.freeze một tầng'],
      ['export const TABLE = Object.freeze(new Set([\'a\']))', 'Object.freeze một Set'],
      ['export const TABLE = flag ? [\'a\'] : null', 'nhánh có mảng'],
      // Lớp có thành viên `static`: chính constructor mang dữ liệu (đóng khi nghi ngờ).
      ['export class TABLE { static rows: string[] = [] }', 'khai báo lớp, trường static'],
      ['export const TABLE = class { static rows: string[] = [] }', 'biểu thức lớp, trường static'],
      ['export class TABLE { static { void 0 } }', 'khối static'],
      ['export class TABLE { static make() { return 1 } }', 'phương thức static (cất được dữ liệu lên this)'],
      ['export const TABLE = class { static get n() { return 1 } }', 'accessor static'],
    ] as const)
      assert.deepEqual(extra({ [part]: `${declaration}\n` }), [`${part}#TABLE`], why)
    // Hằng nguyên thuỷ, hàm, Symbol, Object.freeze của literal nguyên thuỷ: không ghi được.
    for (const declaration of [
      'export const LIMIT = 5',
      'export const LIMIT = 10 * 60_000',
      'export const LIMIT = -1',
      'export const NAME = `${PREFIX}-x`',
      'export const ON = process.env.X === \'1\'',
      'export const KIND = typeof window',
      'export const fn = (x: number) => x + 1',
      'export const TOKEN = Symbol(\'t\')',
      'export const LIMITS = Object.freeze({ a: 1, b: \'x\', c: null, d: 2 * 3 })',
      'export const PAIR = Object.freeze([1, 2] as const)',
      // Lớp không có thành viên static: như hàm — mã, không phải dữ liệu.
      'export class Plain { rows: string[] = []; m() { return this.rows } }',
      'export const Plain = class { m() { return 1 } }',
    ])
      assert.deepEqual(extra({ [part]: `${declaration}\n` }), [], declaration)
    // Tệp ngoài nhóm không lọt vào tập quét.
    assert.deepEqual(extra({ 'server/services/moderation-regex-extra.ts': 'export const LIMIT = 5\n' }), [])
    assert.deepEqual(extra({ 'server/services/moderation-extra.ts': 'export const leak = new Set<string>()\n' }), [])
  })

  it('luật 5 đỏ khi barrel moderation-regex.ts bỏ, đổi tên, đổi loại hay xuất thêm một tên', () => {
    const barrel = MODERATION_REGEX_BARREL
    const cases: Array<[string, Record<string, string>, string[]]> = [
      ['bỏ testModerationRegex', replaceIn(barrel, '  testModerationRegex,\n', ''), [`${barrel} thiếu giá trị 'testModerationRegex'`]],
      [
        'đổi tên ModerationPatternCheck',
        replaceIn(barrel, 'export type { ModerationPatternCheck }', 'export type { ModerationPatternCheck as PatternCheck }'),
        [`${barrel} thiếu kiểu 'ModerationPatternCheck'`, `${barrel} xuất thêm kiểu 'PatternCheck'`],
      ],
      [
        'giá trị thành kiểu',
        replaceIn(barrel, "export { findCatastrophicShape } from './moderation-regex-analysis'", "export type { findCatastrophicShape } from './moderation-regex-analysis'"),
        [`${barrel} thiếu giá trị 'findCatastrophicShape'`, `${barrel} xuất thêm kiểu 'findCatastrophicShape'`],
      ],
      ['lộ phần ruột của lớp 1', append(barrel, "export { analyzePattern } from './moderation-regex-analysis'"), [`${barrel} xuất thêm giá trị 'analyzePattern'`]],
      ['export *', append(barrel, "export * from './moderation-regex-parser'"), [`${barrel} xuất thêm giá trị '* from './moderation-regex-parser''`]],
    ]
    for (const [label, override, expected] of cases) {
      const violations = moderationRegexApiViolations(withOverrides(override))
      assert.deepEqual(violations.map((violation) => violation.split(' — ')[0]), expected, label)
    }
  })

  it('hình dạng barrel moderation-regex.ts đỏ khi có mã, import, export *, hay nguồn ngoài nhóm', () => {
    const base = REPO.get(MODERATION_REGEX_BARREL)!
    const swap = (from: string, to: string) => {
      assert.ok(base.includes(from), `barrel không còn đoạn ${JSON.stringify(from)} để đột biến`)
      return base.replace(from, to)
    }
    const cases: Array<[string, string, RegExp]> = [
      // Luật 5 vẫn xanh với ca này (cùng tên, cùng loại) — chỉ phép kiểm hình dạng bắt.
      [
        'mã cùng tên dời về barrel',
        swap("export { findCatastrophicShape } from './moderation-regex-analysis'", 'export function findCatastrophicShape() { return null }'),
        /^not a re-export: export function findCatastrophicShape/,
      ],
      ['import', `import { Parser } from './moderation-regex-parser'\n${base}`, /^not a re-export: import/],
      ['export *', `${base}\nexport * from './moderation-regex-parser'\n`, /^not a named re-export/],
      ['export * as', `${base}\nexport * as parser from './moderation-regex-parser'\n`, /^not a named re-export/],
      ['anh em moderation-worker', `${base}\nexport { fastPreModerate } from './moderation-worker'\n`, /^not re-exported from a part of the family/],
      ['tệp của nhóm worker cùng tiền tố moderation-', `${base}\nexport { getWorkerStats } from './moderation-stats'\n`, /^not re-exported from a part of the family/],
      ['ngoài thư mục', `${base}\nexport { logWarn } from '../utils/logger'\n`, /^not re-exported from a part of the family/],
      ['export { … } không có module', `${base}\nexport { testModerationRegex as _t }\n`, /^a re-export without a module/],
      ['rỗng', '', /^the barrel exports nothing$/],
    ]
    for (const [label, source, expected] of cases) {
      const problems = moderationRegexBarrelProblems(source)
      assert.equal(problems.length, 1, `${label}: ${JSON.stringify(problems)}`)
      assert.match(problems[0]!, expected, label)
    }
    // Ca đầu: luật 5 đúng là không thấy gì.
    assert.deepEqual(moderationRegexApiViolations(withOverrides({ [MODERATION_REGEX_BARREL]: cases[0]![1] })), [])
  })

  it('luật 6 đỏ khi nơi gọi ngoài nhóm moderation-regex import thẳng một tệp con, ở mọi dạng', () => {
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      [
        'endpoint tạo luật nhập phép kiểm thẳng từ tệp con',
        replaceIn('server/api/admin/ai/moderation/rules.post.ts', "from '../../../../services/moderation-regex'", "from '../../../../services/moderation-regex-check'"),
        /^\[moderation-regex\] server\/api\/admin\/ai\/moderation\/rules\.post\.ts:\d+ \(import\) import server\/services\/moderation-regex-check\.ts — .*phần ruột/,
      ],
      [
        'cache luật nhập thẳng tệp chạy',
        replaceIn(
          'server/services/moderation-rules-cache.ts',
          "import { clearCompiledModerationRegexCache, resetSlowModerationRules } from './moderation-regex'",
          "import { clearCompiledModerationRegexCache } from './moderation-regex'\nimport { resetSlowModerationRules } from './moderation-regex-runtime'",
        ),
        /^\[moderation-regex\] server\/services\/moderation-rules-cache\.ts:\d+ \(import\) import server\/services\/moderation-regex-runtime\.ts/,
      ],
      [
        'lượt chặn tức thì (nhóm moderation-worker) nhập bộ phân tích cú pháp',
        inject('server/services/moderation-worker-prescreen.ts', "import { Parser as _P } from './moderation-regex-parser'"),
        /^\[moderation-regex\] server\/services\/moderation-worker-prescreen\.ts:1 \(import\) import server\/services\/moderation-regex-parser\.ts/,
      ],
      [
        'import type từ tệp kiểm',
        inject('server/api/admin/ai/moderation/rules/[id].put.ts', "import type { ModerationPatternCheck as _C } from '../../../../../services/moderation-regex-check'"),
        /^\[moderation-regex\] server\/api\/admin\/ai\/moderation\/rules\/\[id\]\.put\.ts:1 \(import\) import server\/services\/moderation-regex-check\.ts/,
      ],
      [
        'import() động',
        append('server/services/moderation-worker-check.ts', "export const _lazy = () => import('./moderation-regex-analysis')"),
        /^\[moderation-regex\] server\/services\/moderation-worker-check\.ts:\d+ \(import\(\)\) import server\/services\/moderation-regex-analysis\.ts/,
      ],
    ]
    for (const [label, override, expected] of cases) {
      const { violations } = moderationRegexConsumerCheck(withOverrides(override))
      assert.equal(violations.length, 1, `${label}: ${JSON.stringify(violations)}`)
      assert.match(violations[0]!, expected, label)
    }
  })

  it('luật 6 KHÔNG đỏ (moderation-regex): tệp con nhập tệp con, nơi gọi mới nhập barrel', () => {
    assert.deepEqual(
      moderationRegexConsumerCheck(
        withOverrides({
          ...inject('server/services/moderation-regex-runtime.ts', "import { MODERATION_REGEX_FLAGS as _f } from './moderation-regex-limits'"),
          ...inject('server/api/admin/ai/moderation/worker-status.get.ts', "import { isModerationRuleDisabled as _d } from '../../../../services/moderation-regex'"),
        }),
      ).violations,
      [],
    )
  })
})
