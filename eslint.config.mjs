// @ts-check
/**
 * ESLint flat config (v9).
 *
 * Luật ở mức `warn`, nhưng kết quả bị chặn ở SỐ 0 (đo 2026-11-06, trước đó 44): `npm run lint`
 * chạy `--max-warnings=0`, và `tests/ratchets/lint-warnings.test.ts` (trong `npm test` và job unit
 * của CI) đỏ khi bất kỳ tệp theo dõi nào có một message. Mức `warn` giữ nguyên chỉ để một luật mới
 * của lần nâng cấp ESLint hiện ra thành danh sách để sửa, thay vì làm gãy cả `npm run lint` bằng
 * lỗi cấu hình.
 *
 * Không sink vào `nuxt build`: build có guard riêng (admin-password, db:drift).
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  // TS parser + plugin trong cùng block để rule @typescript-eslint/* resolve.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  // Vue recommended — rule 'error' của nó hạ xuống warn ở block rules dưới.
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    // Mức `warn` — nhưng số warning bị chặn ở 0 (xem đầu tệp), nên một warning mới làm CI đỏ.
    rules: {
      // Nuxt auto-import `defineEventHandler`, `$fetch`, `ref`, `computed`...
      // JS preset `no-undef` không biết auto-import → tắt, TS typecheck đã lo.
      'no-undef': 'off',
      // TS no-unused-vars đã lo chính xác hơn JS preset.
      'no-unused-vars': 'off',
      'no-regex-spaces': 'warn',
      // Hai luật mới trong `recommended` của ESLint 10 (23 + 6 chỗ lúc nâng cấp, đã sửa hết 2026-11-06). Mức `warn` giữ nguyên
    // vì kết quả bị chặn ở số 0 bởi `npm run lint` (`--max-warnings=0`) và `tests/ratchets/lint-warnings.test.ts`.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-irregular-whitespace': 'warn',
      'no-control-regex': 'warn',
      'prefer-const': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-useless-catch': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-unsafe-finally': 'warn',
      'no-loss-of-precision': 'warn',
      // Vue template multiline — tắt để không red 1282 dòng default.vue.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/attributes-order': 'off',
      'vue/order-in-components': 'off',
      'vue/html-indent': 'off',
      'vue/script-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/no-multi-spaces': 'off',
      'vue/no-trailing-spaces': 'off',
      'vue/padding-line-between-blocks': 'off',
      'vue/html-quotes': 'warn',
      'vue/require-v-for-key': 'warn',
      'vue/require-default-prop': 'warn',
      'vue/no-unused-vars': 'warn',
      'vue/no-v-html': 'warn',
      'vue/valid-template-root': 'warn',
      'vue/no-mutating-props': 'warn',
      'vue/no-parsing-error': 'warn',
      'vue/no-required-prop-with-default': 'warn',
    },
  },
  // ── Ngoại lệ có tên (mỗi cái có lý do; thêm cái mới phải ghi lý do ở đây) ────
  {
    // `any` trong tests/ là mock/stub có chủ đích: test runner Node không biên dịch
    // type nên `any` ở đó không rò rỉ ra production (CLAUDE.md, mục `any`). 154 cảnh
    // báo này che mất tín hiệu thật ở app/ server/ scripts/, nơi `any` là 0.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Page Builder: component cha sở hữu cây block, panel thuộc tính và trình soạn
    // mảng sửa `block.data` TẠI CHỖ qua v-model — thiết kế có chủ đích, và việc đổi
    // sang emit từng thay đổi là thay đổi kiến trúc của trình soạn trang (autosave,
    // nháp, lịch sử), không phải dọn dẹp.
    files: ['app/components/admin/builder/PropertyPanel.vue', 'app/components/admin/builder/BuilderArrayEditor.vue'],
    rules: { 'vue/no-mutating-props': 'off' },
  },
  {
    ignores: [
      '.output/**',
      '.nuxt/**',
      // Worktree của agent/phiên song song (`.claude/worktrees/<tên>/`): mã của nhánh khác, không phải của cây này.
      // Không loại ra thì `npm run lint` và ratchet quét luôn chúng và đỏ vì cảnh báo của nhánh khác.
      '.claude/**',
      '.data/**',
      'node_modules/**',
      'dist/**',
      'public/**',
      'tests/e2e/test-results/**',
      'migrations/**',
      'CDKT/**',
    ],
  },
)
