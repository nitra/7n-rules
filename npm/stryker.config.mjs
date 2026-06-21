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
  // Покриваємо весь production-код: scripts/ (lib/utils/CLI helpers), rules/<r>/{js,lib,coverage}/
  // + кореневі rule-`check.mjs`. Test-файли Stryker і так виключає за іменем (`*.test.*`),
  // але `tests/` і `__fixtures__/` міняємо явно для прозорості. `data/`, `template(s)/` —
  // baseline-шаблони/JSON-канон, що копіюються консьюмерам як-є; логіки для мутації немає,
  // тому виключаємо щоб не інфляти survived-рейтинг (виняток — `rules/test/js/data/stryker_config/
  // stryker-vue-macros-ignorer.mjs`, у якого є власні юніт-тести). `bin/` — CLI-entry,
  // покрита integration-тестами через subprocess.
  mutate: [
    'scripts/**/*.mjs',
    'rules/**/*.mjs',
    'bin/**/*.{js,mjs}',
    '!**/tests/**',
    '!**/__fixtures__/**',
    '!**/fixtures/**',
    '!**/data/**',
    '!**/template/**',
    '!**/templates/**',
    'rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs'
  ]
}
