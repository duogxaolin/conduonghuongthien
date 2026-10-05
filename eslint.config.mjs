// @ts-check
/**
 * ESLint flat config (v9).
 *
 * Cố ý tải LỜI CANH BÁO thay vì lỗi — spec này tồn tại để giữ phong cách, không
 * để chặn build hay đỏ CI. Một guard đỏ 167 file getDb() thẳng hoặc 20 vết
 * `any` sẽ bị maintainer tắt (vô dụng) hoặc disable từng dòng (noise) — đúng
 * thứ em đã phân tích ROI. Chạy bằng `npm run lint`, xem warning, sửa chủ đích.
 *
 * Không sink vào `nuxt build` hay `npm test`: test runner là Node thuần không
 * cài thêm (CLAUDE.md), và build có guard riêng (admin-password, db:drift).
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
    // Cố ý tải cảnh báo thay vì lỗi — không đỏ CI. Maintainer xem warning,
    // sửa chủ đích.
    rules: {
      // Nuxt auto-import `defineEventHandler`, `$fetch`, `ref`, `computed`...
      // JS preset `no-undef` không biết auto-import → tắt, TS typecheck đã lo.
      'no-undef': 'off',
      // TS no-unused-vars đã lo chính xác hơn JS preset.
      'no-unused-vars': 'off',
      'no-regex-spaces': 'warn',
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
  {
    ignores: [
      '.output/**',
      '.nuxt/**',
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
