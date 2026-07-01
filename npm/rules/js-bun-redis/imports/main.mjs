/** @see ./docs/imports.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { findRedisImportsInText, isRedisScanSourceFile, shouldSkipFileForRedisScan } from '../lib/redis-imports.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * Збирає абсолютні шляхи JS/TS джерел у репозиторії для скану заборонених redis-імпортів.
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllSourcePathsForRedisScan(repoRoot, ignorePaths) {
  /** @type {string[]} */
  const paths = []
  await walkDir(
    repoRoot,
    absPath => {
      const rel = relative(repoRoot, absPath).split('\\').join('/')
      if (isRedisScanSourceFile(rel) && !shouldSkipFileForRedisScan(rel)) {
        paths.push(absPath)
      }
    },
    ignorePaths
  )
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

/**
 * Сканує JS/TS-джерела на заборонені імпорти/require пакетів `ioredis` / `node-redis` / `redis`.
 * @param {string[]} sourcePaths абсолютні шляхи джерел
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість знайдених порушень
 */
async function scanSourcesForRedisImports(sourcePaths, repoRoot, fail) {
  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    for (const v of findRedisImportsInText(content, rel)) {
      violations++
      fail(
        `js-bun-redis: ${rel}:${v.line} — заміни '${v.module}' на Bun native Redis ` +
          `(import { redis } from 'bun', https://bun.com/docs/runtime/redis): ${v.snippet}`
      )
    }
  }
  return violations
}

/**
 * Перевіряє відповідність проєкту правилу `js-bun-redis.mdc`.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const repoRoot = ctx.cwd
  if (!existsSync(join(repoRoot, 'package.json'))) {
    pass('js-bun-redis: package.json у корені відсутній — перевірку пропущено')
    return reporter.result()
  }

  const ignorePaths = await loadCursorIgnorePaths(repoRoot)
  const sourcePaths = await findAllSourcePathsForRedisScan(repoRoot, ignorePaths)
  if (sourcePaths.length === 0) {
    pass('js-bun-redis: немає JS/TS файлів для скану імпортів ioredis / node-redis / redis')
    return reporter.result()
  }

  const violations = await scanSourcesForRedisImports(sourcePaths, repoRoot, fail)
  if (violations === 0) {
    pass(
      "js-bun-redis: немає імпортів 'ioredis' / 'node-redis' / 'redis' / '@redis/*' у джерелах " +
        '(використовується Bun native Redis або redis взагалі не задіяно)'
    )
  }

  return reporter.result()
}
