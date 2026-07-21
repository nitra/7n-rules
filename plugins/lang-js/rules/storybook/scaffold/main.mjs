/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { collectInScopeVuePackages } from '../scope/main.mjs'

/** Канонічне значення `package.json#scripts.storybook` (storybook.mdc). */
export const STORYBOOK_SCRIPT = 'storybook dev -p 6006 --no-open'

/**
 * Маркери канону `.storybook/main.js`, перевірені текстовим пошуком (без AST — рядки стабільні).
 * Експортовано — той самий список переюзає `adopt/main.mjs` для diff-діагностики (не дублювати).
 */
export const MAIN_JS_MARKERS = [
  { token: '@storybook/vue3-vite', hint: 'framework @storybook/vue3-vite' },
  { token: 'viteFinal', hint: 'viteFinal-override vite.config пакета' },
  { token: "'vite-plugin-pages'", hint: 'фільтр vite-plugin-pages у viteFinal' },
  { token: "'vite-plugin-vue-layouts'", hint: 'фільтр vite-plugin-vue-layouts у viteFinal' }
]

/** Маркери канону `.storybook/preview.js`. Експортовано — переюз у `adopt/main.mjs`. */
export const PREVIEW_JS_MARKERS = [
  { token: 'Quasar', hint: 'повний install Quasar' },
  { token: 'iconSet', hint: 'iconSet' },
  { token: 'iconMapFn', hint: 'iconMapFn (без нього внутрішні Quasar-іконки недоступні)' },
  { token: 'msw-storybook-addon', hint: 'msw-storybook-addon' },
  { token: 'onUnhandledRequest', hint: 'onUnhandledRequest-фільтр' }
]

/**
 * Layout-детекція для stories-glob (ADR Кластер 2): `src/components/` присутній → glob
 * звужується до нього; пласка структура (`src/` без `components/`) — ширший glob по `src/`.
 * Шлях відносний до `.storybook/` (де лежить сам `main.js`), тому з префіксом `../`.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string} glob для `stories` у `.storybook/main.js`
 */
export function detectStoriesGlob(absPkgDir) {
  return existsSync(join(absPkgDir, 'src/components'))
    ? '../src/components/**/*.stories.@(js|ts)'
    : '../src/**/*.stories.@(js|ts)'
}

/**
 * @param {string} content вміст файлу
 * @param {{ token: string, hint: string }[]} markers очікувані канонічні маркери
 * @returns {{ token: string, hint: string }[]} маркери, яких бракує
 */
export function missingMarkers(content, markers) {
  return markers.filter(m => !content.includes(m.token))
}

/**
 * Перевіряє один канонічний файл скафолду (`.storybook/main.js` або `.storybook/preview.js`):
 * відсутність → `missingReason`-порушення з посиланням на `npx \@7n/rules fix storybook`;
 * присутність без якогось канонічного маркера → `markerReason`-порушення на маркер.
 * @param {string} absDir абсолютний корінь пакета
 * @param {string} relFile posix-relative шлях файлу від кореня пакета (`.storybook/main.js`)
 * @param {{ token: string, hint: string }[]} markers канонічні маркери файлу
 * @param {string} missingReason reason для порушення "файл відсутній"
 * @param {string} markerReason reason для порушення "маркер відсутній"
 * @param {string} label людський підпис пакета для повідомлень
 * @param {string} rootDir root dir пакета (для violation.data)
 * @param {string} fileRel posix-relative шлях файлу від кореня репозиторію (для violation.file)
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkCanonFile(
  absDir,
  relFile,
  markers,
  missingReason,
  markerReason,
  label,
  rootDir,
  fileRel,
  reporter
) {
  const abs = join(absDir, relFile)
  if (existsSync(abs)) {
    const content = await readFile(abs, 'utf8')
    for (const m of missingMarkers(content, markers)) {
      reporter.fail(`[${label}] ${relFile} не відповідає канону — бракує: ${m.hint} (storybook.mdc)`, {
        reason: markerReason,
        file: fileRel
      })
    }
    return
  }
  reporter.fail(`[${label}] відсутній ${relFile} — канонічний скафолд: npx @7n/rules fix storybook (storybook.mdc)`, {
    reason: missingReason,
    file: fileRel,
    data: { rootDir }
  })
}

/**
 * Перевіряє один в-скоупі пакет: `.storybook/main.js`, `.storybook/preview.js`,
 * `package.json#scripts.storybook`.
 * @param {import('../scope/main.mjs').InScopePackage} pkgEntry пакет у скоупі
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkPackageScaffold({ rootDir, absDir, pkg }, reporter) {
  const label = rootDir === '.' ? 'корінь' : rootDir
  const relPrefix = rootDir === '.' ? '' : `${rootDir}/`

  await checkCanonFile(
    absDir,
    '.storybook/main.js',
    MAIN_JS_MARKERS,
    'missing-main-js',
    'main-js-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/main.js`,
    reporter
  )

  await checkCanonFile(
    absDir,
    '.storybook/preview.js',
    PREVIEW_JS_MARKERS,
    'missing-preview-js',
    'preview-js-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/preview.js`,
    reporter
  )

  const scriptValue = pkg?.scripts?.storybook
  if (scriptValue !== STORYBOOK_SCRIPT) {
    const pkgJsonRel = `${relPrefix}package.json`
    const current = scriptValue ? `'${scriptValue}'` : 'відсутній'
    reporter.fail(
      `[${label}] package.json#scripts.storybook має бути '${STORYBOOK_SCRIPT}' (зараз: ${current}) — storybook.mdc`,
      { reason: 'missing-storybook-script', file: pkgJsonRel, data: { rootDir } }
    )
  }
}

/**
 * Перевіряє канонічний Storybook-скафолд (`.storybook/main.js`, `.storybook/preview.js`,
 * `package.json#scripts.storybook`) для всіх пакетів у скоупі (`scope/main.mjs`).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const pkgs = await collectInScopeVuePackages(ctx.cwd)

  if (pkgs.length === 0) {
    reporter.pass('storybook: немає Vue component library пакетів у скоупі (storybook.mdc)')
    return reporter.result()
  }

  for (const entry of pkgs) {
    await checkPackageScaffold(entry, reporter)
  }

  return reporter.result()
}
