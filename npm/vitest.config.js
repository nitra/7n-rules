import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Підхоплюються обидві основні розкладки: тести поряд із кодом (rule `test`-конвенція —
    // у піддиректоріях `tests/`) і top-level integration suites у `<root>/tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    // reports/stryker/.tmp/ містить sandbox-копії тестів від Stryker (incremental
    // або aborted-runs); без exclude vitest run --coverage їх підхоплює і вони
    // фейляться, бо запускаються поза реальним repo root.
    // Git-worktree чекаути (.worktrees/ і session-worktree Claude у .claude/worktrees/) —
    // повні копії репо; їх тести дублюють основні й фейляться через інший node_modules/стан.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/reports/stryker/**',
      '**/.worktrees/**',
      '**/.claude/worktrees/**'
    ],
    environment: 'node',
    // `GIT_TRACE2_EVENT=0` — вимикає git Trace2 event-stream для всіх git-процесів,
    // що їх спавнять тести (`execFile`/`spawnSync` успадковують `process.env` воркера).
    //
    // Чому: глобальний `~/.gitconfig` локальної машини містить
    // `trace2.eventtarget=af_unix:stream:~/.git-ai/internal/daemon/trace2.sock`
    // (tooling `git-ai`). Цей таргет успадковується БУДЬ-ЯКИМ git-репо, зокрема
    // tmp-репо в тестах. Тоді КОЖНА git-команда під'єднується до Unix-сокета даемона
    // й пише в нього події. Коли даемон деградований/перевантажений, запис у
    // `af_unix:stream` блокується (~1с/команда не на CPU). Під `pool: 'forks'`
    // десятки паралельних git-операцій (changelog/check.test.mjs тощо) одночасно
    // б'ють у сокет → блокування > 5000ms `testTimeout` → масові `Test timed out`.
    // На CI цього таргета немає, тому таймаутів немає (симптом суто локальний).
    //
    // Env-змінна `GIT_TRACE2_EVENT` має пріоритет над config `trace2.eventtarget`;
    // значення `0` повністю вимикає stream. Тестові git-операції синтетичні
    // (tmp-репо, фейкові коміти) — трасувати їх AI-даемоном і сенсу нема.
    //
    // `N_LLM_TRACE_PATH` — відводить глобальний LLM wire-trace (`@7n/llm-lib/trace`)
    // у tmp: тести fix-pipeline (run-fix.test.mjs та ін.) ганяють реальний
    // startChain/writeTrace, і без override кожен прогін дописує фейкові
    // chain-записи (probe/check, fake/min, fake/cloud) у справжній
    // `~/.n-cursor/llm-trace.jsonl`, засмічуючи аналітику myllm і chains-report.
    // Тест, якому потрібен власний trace-файл, перевизначає env локально
    // (див. collateral-veto у run-fix.test.mjs).
    env: { GIT_TRACE2_EVENT: '0', N_LLM_TRACE_PATH: join(tmpdir(), 'n-cursor-vitest-llm-trace.jsonl') },
    // `testTimeout` піднято з дефолтних 5000ms до 20000ms як defence-in-depth.
    // Root-cause git-латентності прибирає `GIT_TRACE2_EVENT=0` вище, але git-важкі
    // тести (`changelog/check.test.mjs`, `ga/workflows.test.mjs`) роблять 5-7 git-
    // операцій під `pool: 'forks'` і чутливі до БУДЬ-ЯКОЇ локальної I/O-латентності
    // (APFS, Spotlight-індексація tmp, антивірус). 20s лишає величезний запас для
    // штатних ~7s, але не маскує реальні зависання настільки, як це робив би 60s+.
    testTimeout: 20000,
    // `pool: 'forks'` — defence-in-depth ізоляція процесів між test-файлами.
    // Контракт тестів (`scripts/utils/test-helpers.mjs`): `withTmpDir(fn)` НЕ
    // мутує `process.cwd()`, а передає абсолютний шлях `dir` у `fn`; тест
    // явно будує `join(dir, …)` для FS і передає `cwd: dir` дочірнім процесам
    // (`execFile`, `spawnSync`) та `await check(dir)` concern-функціям.
    // Forks лишилися як safety net на випадок випадкового `process.chdir`
    // у third-party коді або під час майбутніх рефакторів.
    pool: 'forks',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
