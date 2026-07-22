/** Vitest-конфіг плагіна lang-rust: env-канон ядра + include лише тестів плагіна. */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Скорочена копія npm/vitest.config.js: той самий env-канон (GIT_TRACE2_EVENT=0 проти
 * git-ai trace2-сокета, N_LLM_TRACE_PATH у tmp) і pool forks; include — лише тести плагіна.
 */
export default defineConfig({
  test: {
    include: [
      'taze/tests/**/*.test.{js,mjs}',
      'rules/**/tests/**/*.test.{js,mjs}',
      'doc-files/tests/**/*.test.{js,mjs}'
    ],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    env: { GIT_TRACE2_EVENT: '0', N_LLM_TRACE_PATH: join(tmpdir(), 'n-rules-plugin-vitest-llm-trace.jsonl') },
    testTimeout: 20000,
    pool: 'forks'
  }
})
