/**
 * Створює спільний Vitest config для language plugins у monorepo.
 *
 * Кожен plugin запускає лише власні test surfaces, використовує isolated
 * process pool і пише LLM trace у системну temporary directory.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

/** Canonical test globs для всіх language plugins. */
const PLUGIN_TEST_GLOBS = Object.freeze([
  'coverage-provider/tests/**/*.test.{js,mjs}',
  'doc-files/tests/**/*.test.{js,mjs}',
  'knowledge/tests/**/*.test.{js,mjs}',
  'rules/**/tests/**/*.test.{js,mjs}',
  'slots/**/tests/**/*.test.{js,mjs}',
  'taze/tests/**/*.test.{js,mjs}'
])

/**
 * Повертає canonical plugin Vitest config без package-specific drift.
 * @returns {ReturnType<typeof defineConfig>} Vitest config
 */
export function createPluginVitestConfig() {
  return defineConfig({
    test: {
      include: [...PLUGIN_TEST_GLOBS],
      exclude: ['**/node_modules/**'],
      environment: 'node',
      env: { GIT_TRACE2_EVENT: '0', N_LLM_TRACE_PATH: join(tmpdir(), 'n-rules-plugin-vitest-llm-trace.jsonl') },
      testTimeout: 20000,
      pool: 'forks'
    }
  })
}
