/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'bun test' },
  // inPlace: уникає hoisted-node_modules issues у Bun monorepo (sandbox-копія втрачає resolution).
  // Також тести, що читають git/fs-state (integration checks), працюють тільки in-place.
  inPlace: true,
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  coverageAnalysis: 'off',
  // Mutate тільки скрипти та coverage-провайдери, що мають юніт-тести.
  // Виключаємо rule-fix/check .mjs (сотні файлів, покриті інтеграційно).
  mutate: [
    'scripts/*.mjs',
    'scripts/utils/*.mjs',
    'rules/*/coverage/coverage.mjs'
  ]
}
