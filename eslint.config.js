// ESLint（flat config）：抓未定義變數、未使用變數、常數條件等會直接變成執行期錯誤的東西。
// 資料表（wordbank／phonemes／readings／zhconv）與建置產物不檢查。
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'ios/**', 'syl/**',
      'js/wordbank.js', 'js/phonemes.js', 'js/readings.js', 'js/zhconv.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'tools/**/*.mjs', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 救援層是傳統 script（非 module），全域變數就是瀏覽器的
    files: ['js/rescue.js'],
    languageOptions: { sourceType: 'script', ecmaVersion: 2020, globals: globals.browser },
  },
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
];
