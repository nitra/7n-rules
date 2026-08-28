/**
 * Контракт паралелізму vitest-конфігів (2026-08-28).
 *
 * Обидва конфіги монорепо (кореневий `vitest.config.mjs` і пакетний
 * `npm/vitest.config.js`) МУСЯТЬ обмежувати кількість одночасних воркерів —
 * інакше `pool: 'forks'` бере ~кількість ядер, а кілька паралельних прогонів
 * із різних worktree множаться до десятків `node`-процесів.
 *
 * Чому це окремий гейт, а не «просто рядок у конфізі»: у Vitest 4 ключ
 * `poolOptions.forks.maxForks` ВИДАЛЕНО, і невідомий ключ не є помилкою — його
 * мовчки ігнорують, друкуючи лише рядок DEPRECATED у stderr. Тобто ліміт
 * зникає без жодного червоного. Заміряно на 12 файлах / 10 ядрах: зі старим
 * ключем 9 паралельних форків, з `maxWorkers` — рівно 4. Цей тест ловить
 * наступне таке перейменування ГУЧНО: перевіряється не текст конфігу, а
 * РОЗВʼЯЗАНЕ значення, яке vitest реально застосує.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import { realRepoRoot } from '../scripts/utils/test-helpers.mjs'

/** Стеля одночасних воркерів, однакова для обох конфігів. */
const EXPECTED_MAX_WORKERS = 4

/**
 * Розвʼязує конфіг тим самим кодом, що й сам vitest, і повертає `test`-секцію.
 * @param {string} configPath абсолютний шлях до конфігу
 * @returns {Promise<Record<string, unknown>>} розвʼязана `test`-конфігурація
 */
async function resolveTestConfig(configPath) {
  const { resolveConfig } = await import('vitest/node')
  const resolved = await resolveConfig({ config: configPath })
  return resolved.vitestConfig
}

describe('vitest-конфіги монорепо', () => {
  const cases = [
    ['кореневий', join(realRepoRoot(), 'vitest.config.mjs')],
    ['пакетний @7n/rules', join(realRepoRoot(), 'npm', 'vitest.config.js')]
  ]

  test.each(cases)('%s: maxWorkers розвʼязується у число, а не зникає', async (_label, configPath) => {
    const config = await resolveTestConfig(configPath)
    expect(config.maxWorkers).toBe(EXPECTED_MAX_WORKERS)
  })

  test.each(cases)('%s: pool лишається forks (ізоляція процесів)', async (_label, configPath) => {
    const config = await resolveTestConfig(configPath)
    expect(config.pool).toBe('forks')
  })
})
