/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  coverageAnalysis: 'perTest',
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/stryker/incremental-vitest.json',
  mutate: ['src/**/*.mjs'],
  timeoutMS: 60000
}
