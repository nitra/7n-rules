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
 * Стеля тривалості одного тесту, однакова для обох конфігів.
 *
 * Гейт додано 2026-08-29 після того, як цей самий клас вади знайшовся ДРУГИЙ
 * раз — і саме у файлі, який цей контракт мав стерегти. `testTimeout: 20000`
 * жив ЛИШЕ в пакетному `npm/vitest.config.js`, а кореневий (той, що бере
 * `bun run test` і CI) лишався на дефолтних 5000: значення існувало на папері
 * й не застосовувалось там, де його потребували. Перша версія цього контракту
 * перевіряла тільки `maxWorkers`, тож близнюка в тому ж файлі пропустила.
 */
const EXPECTED_TEST_TIMEOUT = 20000

/**
 * Env-канон ізоляції, однаковий для обох конфігів. Не косметика:
 * `GIT_TRACE2_EVENT=0` у `npm/vitest.config.js` названо ROOT-CAUSE фіксом
 * масових `Test timed out` (git-події в `af_unix`-сокет під `pool: 'forks'`),
 * а `N_LLM_TRACE_PATH` не дає прогонам дописувати фейкові chain-записи у
 * справжній `~/.n-cursor/llm-trace.jsonl`. Обидві були відсутні в кореневому
 * конфізі, тобто репозиторний прогін не мав ані першого, ані другого.
 */
const EXPECTED_ENV_KEYS = ['GIT_TRACE2_EVENT', 'N_LLM_TRACE_PATH']

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

  test.each(cases)('%s: testTimeout розвʼязується у спільне значення', async (_label, configPath) => {
    const config = await resolveTestConfig(configPath)
    expect(config.testTimeout).toBe(EXPECTED_TEST_TIMEOUT)
  })

  test.each(cases)('%s: env-канон ізоляції присутній', async (_label, configPath) => {
    const config = await resolveTestConfig(configPath)
    for (const key of EXPECTED_ENV_KEYS) {
      expect(config.env?.[key], `${key} відсутній — прогін цим конфігом не ізольований`).toBeDefined()
    }
    expect(config.env.GIT_TRACE2_EVENT).toBe('0')
  })

  test('обидва конфіги дають ОДНАКОВІ значення спільних ключів', async () => {
    const [root, pkg] = await Promise.all(cases.map(([, p]) => resolveTestConfig(p)))
    const shape = c => ({
      maxWorkers: c.maxWorkers,
      pool: c.pool,
      testTimeout: c.testTimeout,
      env: Object.fromEntries(EXPECTED_ENV_KEYS.map(k => [k, c.env?.[k]]))
    })
    // Порівняння цілими обʼєктами, а не ключ-за-ключем: інакше НОВИЙ спільний
    // ключ, доданий лише в один конфіг, знову проскочив би — рівно так і
    // проскочили `testTimeout`/`env` повз першу версію цього контракту.
    expect(shape(root)).toEqual(shape(pkg))
  })
})
