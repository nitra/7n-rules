import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Підхоплюються обидві основні розкладки: тести поряд із кодом (rule `test`-конвенція —
    // у піддиректоріях `tests/`) і top-level integration suites у `<root>/tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    // reports/stryker/.tmp/ містить sandbox-копії тестів від Stryker (incremental
    // або aborted-runs); без exclude vitest run --coverage їх підхоплює і вони
    // фейляться, бо запускаються поза реальним repo root.
    exclude: ['**/node_modules/**', '**/dist/**', '**/reports/stryker/**'],
    environment: 'node',
    // `pool: 'forks'` — defence-in-depth ізоляція процесів між test-файлами.
    // Контракт тестів (`scripts/utils/test-helpers.mjs`): `withTmpDir(fn)` НЕ
    // мутує `process.cwd()`, а передає абсолютний шлях `dir` у `fn`; тест
    // явно будує `join(dir, …)` для FS і передає `cwd: dir` дочірнім процесам
    // (`execFile`, `spawnSync`) та `await check(dir)` concern-функціям.
    // Forks лишилися як safety net на випадок випадкового `process.chdir`
    // у third-party коді або під час майбутніх рефакторів.
    pool: 'forks',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
