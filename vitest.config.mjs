/**
 * Кореневий Vitest-конфіг monorepo: не запускає дублікати тестів із вкладених
 * worktree та Stryker sandbox-копій під час `bun run test`.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

/** Конфігурація єдиного test-runner для всіх workspace пакетів. */
export default defineConfig({
  test: {
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/reports/stryker/**',
      '**/.worktrees/**',
      '**/.claude/worktrees/**'
    ],
    environment: 'node',
    pool: 'forks',
    // Ліміт форків: пул за замовчуванням бере ~кількість ядер (10 на dev-машині),
    // і кілька паралельних прогонів — типова ситуація, коли над репо працюють
    // кілька агентів/worktree одночасно — множать це до 30-40 процесів. Чотири
    // форки на прогін лишають запас під паралелізм, не подовжуючи одиночний
    // прогін відчутно (`pool: 'forks'` тут — defence-in-depth ізоляція, не
    // спосіб вичавити швидкість).
    //
    // САМЕ `maxWorkers`, а не `poolOptions.forks.maxForks`: у Vitest 4
    // `poolOptions` ВИДАЛЕНО, всі його опції піднято на верхній рівень. Старий
    // ключ не помилка — він мовчки ІГНОРУЄТЬСЯ (у stderr лише рядок DEPRECATED),
    // тож ліміт існував на папері, а прогін брав ядра. Заміряно 2026-08-28 на
    // 12 тестових файлах / 10 ядрах: `poolOptions.forks.maxForks: 4` → 9
    // паралельних форків, `maxWorkers: 4` → рівно 4. Контракт стереже
    // `npm/tests/vitest-config-contract.test.mjs`.
    maxWorkers: 4,
    // `env` і `testTimeout` — ДЗЕРКАЛО пакетного `npm/vitest.config.js`.
    //
    // Обидва ключі жили ЛИШЕ там, і це був той самий клас вади, що
    // `poolOptions.forks.maxForks` вище: налаштування існувало на папері й не
    // застосовувалось там, де його потребували. Пакетний конфіг вантажиться
    // тільки при `cd npm && vitest run`; репозиторний прогін (`bun run test`
    // у корені, і CI) бере ЦЕЙ файл — і не мав ані env-ізоляції, ані
    // піднятого таймауту. Заміряно через `resolveConfig` з `vitest/node`
    // (2026-08-29): кореневий `testTimeout = 5000`, `env = null`; пакетний —
    // `20000` і обидві змінні.
    //
    // Чому кожна змінна потрібна саме тут — розгорнуті доккоментарі в
    // `npm/vitest.config.js`; стисло:
    // - `GIT_TRACE2_EVENT=0` там названо ROOT-CAUSE фіксом масових
    //   `Test timed out`: глобальний `~/.gitconfig` може слати git-події в
    //   `af_unix`-сокет, і під `pool: 'forks'` десятки паралельних git-
    //   операцій блокуються на ньому. Репозиторний прогін — саме той, де
    //   git-важких тестів найбільше;
    // - `N_LLM_TRACE_PATH` відводить LLM wire-trace у tmp. Без нього КОЖЕН
    //   кореневий прогін дописував фейкові chain-записи у справжній
    //   `~/.n-cursor/llm-trace.jsonl`, засмічуючи аналітику myllm.
    //
    // `testTimeout` 20s — те саме значення й та сама мотивація, що в
    // пакетному конфізі (запас для git-важких тестів, але не 60s+, який
    // маскував би справжні зависання). ЦЕ НЕ заміна розігріву для повільних
    // wasm-фікстур: холодний старт wasmtime заміряно у 13-22 с, тобто вже за
    // цією стелею — такі suite-и гріються у `beforeAll` окремо.
    //
    // Розходження двох конфігів стереже `npm/tests/vitest-config-contract.test.mjs`.
    env: { GIT_TRACE2_EVENT: '0', N_LLM_TRACE_PATH: join(tmpdir(), 'n-cursor-vitest-llm-trace.jsonl') },
    testTimeout: 20000
  }
})
