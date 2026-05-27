import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Підхоплюються обидві основні розкладки: тести поряд із кодом (rule `test`-конвенція —
    // у піддиректоріях `tests/`) і top-level integration suites у `<root>/tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    environment: 'node',
    // `pool: 'forks'` — кожен test file у власному child-процесі. `withTmpCwd`
    // зі `scripts/utils/test-helpers.mjs` мутує `process.cwd()` через
    // `process.chdir` (це process-wide стан). У default `pool: 'threads'` усі
    // workers ділять один процес → паралельний test file може перехопити cwd,
    // і `git init`+`git commit` із `cwd: process.cwd()` (наприклад,
    // `rules/changelog/.../check.test.mjs`) потрапляє в реальний репо.
    // Forks ізолюють процеси, race усунутий.
    pool: 'forks',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
