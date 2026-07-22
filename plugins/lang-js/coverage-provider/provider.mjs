/** @see ./docs/provider.md */
import { collect, detect } from './js-collector.mjs'
import { collectPerFile } from './per-file.mjs'

/**
 * CoverageProvider JS/TS-екосистеми (порт `coverage` plugin-api, spec
 * 2026-07-22 absorb-7n-test): vitest line coverage + Stryker мутаційка +
 * окремий Storybook-вимір (browser mode). CLI-оркестрації тут немає — методи
 * викликає концерн `coverage` правила `test` ядра (`npm/rules/test/coverage/`).
 */
export default {
  id: 'js',
  title: 'JS/TS (vitest + Stryker)',
  detect,
  collect,
  collectPerFile
}
