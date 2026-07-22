/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'
import { collectInScopeVuePackages } from '../storybook-scope/main.mjs'

const STORIES_SUFFIX_RE = /\.stories\.(js|ts)$/u

/**
 * Обходить `src/pages/` app-пакета й збирає окремо абсолютні шляхи `.vue`-сторінок і множину
 * каталогів, де лежить бодай один `*.stories.js`/`*.stories.ts` (незалежно від імені файлу —
 * ADR-розширення 2026-07-20 не вимагає збігу basename, лише "поряд", реальний кейс `gt`:
 * `src/pages/task/[id].vue` + `src/pages/task/task-detail.stories.js`).
 * @param {string} absPagesDir абсолютний шлях `src/pages` пакета
 * @param {string[]} ignorePaths абсолютні шляхи, повністю виключені з обходу
 * @returns {Promise<{ vueFiles: string[], storyDirs: Set<string> }>} зібрані шляхи
 */
async function collectPagesTree(absPagesDir, ignorePaths) {
  const vueFiles = []
  const storyDirs = new Set()
  if (!existsSync(absPagesDir)) return { vueFiles, storyDirs }
  await walkDir(
    absPagesDir,
    absPath => {
      if (absPath.endsWith('.vue')) vueFiles.push(absPath)
      if (STORIES_SUFFIX_RE.test(absPath)) storyDirs.add(dirname(absPath))
    },
    ignorePaths
  )
  return { vueFiles, storyDirs }
}

/**
 * Перевіряє smoke-покриття сторінок одного app-пакета: кожен `.vue` під `src/pages/` має мати
 * хоча б один `*.stories.js` у тому самому каталозі. М'який рівень (`warn`, не `error`) —
 * хвиля 2a мʼяка, ADR-розширення 2026-07-20.
 * @param {import('../storybook-scope/main.mjs').InScopePackage} entry app-пакет у скоупі
 * @param {string[]} ignorePaths абсолютні шляхи, виключені з обходу
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkAppPageCoverage(entry, ignorePaths, reporter) {
  const absPagesDir = join(entry.absDir, 'src/pages')
  const { vueFiles, storyDirs } = await collectPagesTree(absPagesDir, ignorePaths)

  for (const absFile of vueFiles) {
    if (storyDirs.has(dirname(absFile))) continue
    const relFromPkg = relative(entry.absDir, absFile).split('\\').join('/')
    const fileRel = entry.rootDir === '.' ? relFromPkg : `${entry.rootDir}/${relFromPkg}`
    reporter.fail(
      `[page-coverage] ${fileRel}: немає жодної *.stories.js поряд — сторінка app-проєкту без smoke-story (storybook.mdc, хвиля 2a)`,
      { reason: 'page-missing-story', file: fileRel, severity: 'warn', data: { rootDir: entry.rootDir } }
    )
  }
}

/**
 * Detector concern-а `storybook/page-coverage` (ADR-розширення 2026-07-20, хвиля 2a): для
 * кожного app-пакета у скоупі (`storybook.detectApps: true`, `collectInScopeVuePackages`,
 * `type: 'app'`) — кожен `.vue` під `src/pages/` має мати хоча б одну story поряд. Рівень
 * `warn` (не гейт) — на відміну від бібліотечного скафолду хвилі 1, smoke-покриття
 * сторінок хвилі 2a свідомо мʼяке.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const cwd = ctx.cwd

  const allPkgs = await collectInScopeVuePackages(cwd)
  const pkgs = allPkgs.filter(p => p.type === 'app')
  if (pkgs.length === 0) {
    reporter.pass('storybook page-coverage: немає app-пакетів у скоупі (storybook.mdc)')
    return reporter.result()
  }

  const ignorePaths = await loadCursorIgnorePaths(cwd)
  for (const entry of pkgs) {
    await checkAppPageCoverage(entry, ignorePaths, reporter)
  }

  return reporter.result()
}
