import '@stryker-mutator/vitest-runner'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  // perTest: Stryker запускає лише тести, що покривають мутовану лінію — головний приріст
  // швидкості проти command runner (де треба було б ганяти ввесь test-suite на кожен мутант).
  coverageAnalysis: 'perTest',
  // inPlace більше не потрібен — vitest-runner ізолює мутантів у пам'яті через AST-patching,
  // без копіювання node_modules у sandbox (стара проблема command runner у Bun monorepo).
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  // incremental: зберігає результати між запусками, відновлює після краш/kill.
  // Дає ~262× прискорення на noop-прогонах (див. benchmarks/runner-comparison/SPIKE.md).
  incremental: true,
  incrementalFile: 'reports/stryker/incremental.json',
  // Mutate тільки скрипти та coverage-провайдери, що мають юніт-тести.
  // Виключаємо rule-fix/check .mjs (сотні файлів, покриті інтеграційними тестами).
  // Тимчасово: тільки orchestrator для швидкої перевірки pipeline.
  // Для продакшн: ['scripts/*.mjs', 'scripts/utils/*.mjs', 'rules/*/coverage/coverage.mjs']
  mutate: ['rules/test/coverage/coverage.mjs']
}
