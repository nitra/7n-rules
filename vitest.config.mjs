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
    pool: 'forks'
  }
})
