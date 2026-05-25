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
  // incremental: зберігає прогрес між прогонами — відновлення після переривання без старту з нуля.
  incremental: true,
  incrementalFile: 'reports/stryker/stryker-incremental.json',
}
