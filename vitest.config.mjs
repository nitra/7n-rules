/**
 * Кореневий Vitest-конфіг monorepo: не запускає дублікати тестів із вкладених
 * worktree та Stryker sandbox-копій під час `bun run test`.
 */
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
    // САМЕ `maxWorkers`, не `poolOptions.forks.maxForks`: vitest 4 прибрав
    // `poolOptions` (pool rework) і підняв усі його поля на верхній рівень.
    // Старий ключ не був помилкою конфігу — vitest його просто ІГНОРУВАВ,
    // друкуючи `DEPRECATED` у вивід, тож ліміт весь час був мертвий, а
    // прогони й далі брали ~кількість ядер. Класичний мовчазний no-op: конфіг
    // на місці, ефекту нема.
    maxWorkers: 4
  }
})
