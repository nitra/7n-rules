/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  // --parallel: ізолює worker-процеси, уникаючи race у withTmpCwd та git-операцій у реальному репо.
  // Для продакшн-прогону: 'bun test --parallel'; тут звужено до unit-тестів для швидкої перевірки.
  commandRunner: { command: 'bun test --parallel rules/test/coverage/tests/' },
  // inPlace: уникає hoisted-node_modules issues у Bun monorepo (sandbox-копія втрачає resolution).
  // Також тести, що читають git/fs-state (integration checks), працюють тільки in-place.
  inPlace: true,
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  coverageAnalysis: 'off',
  // Mutate тільки скрипти та coverage-провайдери, що мають юніт-тести.
  // Виключаємо rule-fix/check .mjs (сотні файлів, покриті інтеграційно).
  // Тимчасово: тільки orchestrator для швидкої перевірки pipeline.
  // Для продакшн: ['scripts/*.mjs', 'scripts/utils/*.mjs', 'rules/*/coverage/coverage.mjs']
  mutate: ['rules/test/coverage/coverage.mjs']
}
