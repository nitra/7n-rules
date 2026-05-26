/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'bun test' },
  inPlace: true,
  coverageAnalysis: 'off',
  concurrency: 1,
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/stryker/incremental-bun.json',
  mutate: ['src/**/*.mjs'],
  timeoutMS: 60000
}
