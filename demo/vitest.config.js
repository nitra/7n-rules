/**
 * Vitest-конфіг demo-пакета: node-середовище, v8-coverage і підхоплення тестів
 * як поряд із кодом, так і в top-level теці `tests/`.
 */
import { defineConfig } from 'vitest/config'

/** Конфігурація тестового прогону demo: розкладки тестів, середовище node, v8-coverage. */
export default defineConfig({
  test: {
    // Підхоплюються обидві основні розкладки: тести поряд із кодом (rule `test`-конвенція —
    // у піддиректоріях `tests/`) і top-level integration suites у `<root>/tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
