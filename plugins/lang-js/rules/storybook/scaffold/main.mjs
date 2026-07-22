/** @see ./docs/main.md */
import { existsSync, readdirSync } from 'node:fs'
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
  { token: "'vite-plugin-vue-layouts'", hint: 'фільтр vite-plugin-vue-layouts у viteFinal' },
  { token: "'vite-plugin-vue-layouts-next'", hint: 'фільтр vite-plugin-vue-layouts-next у viteFinal' },
  {
    token: 'isVueTransformFamily',
    hint: 'сімейний фільтр vue-трансформерів (vite:vue/vue-macros) — стійкість до VueMacros-стека'
  },
  {
    token: 'resolvePluginEntry',
    hint: 'resolve/flatten Promise/масиву плагінів перед фільтрацією (VueMacros повертає Promise)'
  },
  {
    token: 'viteConfigPath',
    hint: 'core.builder.options.viteConfigPath на empty-vite.config.js (блокує builder-vite autodiscovery vite.config пакета — інакше подвійна SFC-трансформація на storybook build)'
  }
]

/** Маркери канону `.storybook/preview.js`. Експортовано — переюз у `adopt/main.mjs`. */
export const PREVIEW_JS_MARKERS = [
  { token: 'Quasar', hint: 'повний install Quasar' },
  { token: 'iconSet', hint: 'iconSet' },
  { token: 'iconMapFn', hint: 'iconMapFn (без нього внутрішні Quasar-іконки недоступні)' },
  { token: 'msw-storybook-addon', hint: 'msw-storybook-addon' },
  { token: 'onUnhandledRequest', hint: 'onUnhandledRequest-фільтр' },
  { token: 'mswLoader', hint: 'mswLoader (не mswDecorator — deprecated у msw-storybook-addon 2.x)' }
]

/**
 * Маркери канону `.storybook/main.js` для app-проєктів (хвиля 2a) — свідома дзеркальна
 * асиметрія з {@link MAIN_JS_MARKERS} бібліотек: тут немає `viteConfigPath`, бо
 * `@storybook/builder-vite` навмисно підхоплює ПОВНИЙ `vite.config.js` app-проєкту
 * (ADR-розширення 2026-07-20, прототип `gt`). `vite-plugin-pages` СВІДОМО НЕ фільтрується
 * (окремий канон-фікс, емпірично перевірено на `gt`) — знімається лише
 * `unplugin-vue-router`/`vite-plugin-vue-layouts`/`-next`, реальні layout/router-генератори;
 * `vite-plugin-pages` обробляє custom-блок `<route lang="yaml">` сторінок, без нього
 * `storybook build` падає глобально (`MISSING_EXPORT` на будь-якому `.vue` з таким блоком,
 * деталі — коментар `scaffold/template/app-main.js`). Експортовано — переюз у `adopt/main.mjs`.
 */
export const APP_MAIN_JS_MARKERS = [
  { token: '@storybook/vue3-vite', hint: 'framework @storybook/vue3-vite' },
  { token: 'staticDirs', hint: 'staticDirs на ./public (msw service worker)' },
  { token: 'viteFinal', hint: 'viteFinal-фільтр file-system-routing плагінів' },
  { token: "'vite-plugin-vue-layouts'", hint: 'фільтр vite-plugin-vue-layouts у viteFinal' },
  { token: "'vite-plugin-vue-layouts-next'", hint: 'фільтр vite-plugin-vue-layouts-next у viteFinal' },
  { token: "'unplugin-vue-router'", hint: 'фільтр unplugin-vue-router у viteFinal' }
]

/**
 * Маркери канону `.storybook/preview.js` для app-проєктів (хвиля 2a): `pageLoader`
 * (router+pinia на кожну story) і явна реєстрація `QLayout`/`QPageContainer` для
 * layout-декоратора story-файлу — на додачу до спільних msw-маркерів бібліотеки.
 * Експортовано — переюз у `adopt/main.mjs`.
 */
export const APP_PREVIEW_JS_MARKERS = [
  { token: 'msw-storybook-addon', hint: 'msw-storybook-addon' },
  { token: 'onUnhandledRequest', hint: 'onUnhandledRequest-фільтр' },
  { token: 'mswLoader', hint: 'mswLoader (не mswDecorator — deprecated у msw-storybook-addon 2.x)' },
  { token: 'pageLoader', hint: 'pageLoader — router/pinia на кожну story за parameters.route/parameters.pinia' },
  { token: 'createMemoryHistory', hint: 'createMemoryHistory — реальний параметризований маршрут сторінки' },
  { token: 'QLayout', hint: 'явна реєстрація QLayout (q-page кидає без layout-предка)' },
  { token: 'QPageContainer', hint: 'явна реєстрація QPageContainer' }
]

/**
 * Stories-glob для app-проєктів (хвиля 2a) — фіксований, без layout-детекції бібліотек:
 * сторінки (`src/pages/`) і сусідні `*.stories.js` живуть у довільних піддиректоріях `src/`.
 */
export const APP_STORIES_GLOB = '../src/**/*.stories.@(js|ts)'

/**
 * Маркери канону `.storybook/empty-vite.config.js` (сусідній файл main.js — стенд-ін для
 * `core.builder.options.viteConfigPath`, блокує autodiscovery `vite.config` пакета
 * `@storybook/builder-vite`-ом). Експортовано — переюз у `adopt/main.mjs`.
 */
export const EMPTY_VITE_CONFIG_MARKERS = [
  { token: 'defineConfig', hint: 'порожній defineConfig({}) — стенд-ін для viteConfigPath' }
]

/**
 * Маркери канону `.storybook/vitest.setup.js` — той самий файл для ОБОХ типів пакета
 * (library/app, хвиля 2a): стандартний `@storybook/addon-vitest`-boilerplate, підключає
 * анотації `.storybook/preview.js` (decorators/loaders/parameters) до `vitest run
 * --project=storybook` через `setupProjectAnnotations`. Без нього `storybook`-vitest-проєкт
 * (`vitest-config`-концерн, `setupFiles: ['.storybook/vitest.setup.js']`) не підключає ці
 * анотації взагалі — знайдено на живому пілоті gt (файл раніше був відсутній у шаблонах,
 * хоча `storybook-project-entry.js` уже посилався на нього). Експортовано — переюз у
 * `adopt/main.mjs`.
 */
export const VITEST_SETUP_JS_MARKERS = [
  { token: 'setProjectAnnotations', hint: 'setProjectAnnotations([previewAnnotations])' },
  { token: 'beforeAll', hint: 'beforeAll(project.beforeAll)' }
]

/**
 * Чи має корінь пакета плоскі `.vue`-файли (flat-root layout — `NDialog.vue`,
 * `NDialog.stories.js` лежать прямо в КОРЕНІ пакета, `src/` майже порожній чи
 * відсутній). Реальний кейс пілотного консюмера (components/npm) — component
 * library без `src/components/`, детекція за самою наявністю `src/` дала б 0
 * знайдених історій (тихий регрес adopt-діагностики). Перевірка нерекурсивна —
 * дивиться лише файли безпосередньо в `absPkgDir`.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {boolean} true — у корені пакета є хоча б один `.vue`-файл
 */
function hasFlatRootVueFiles(absPkgDir) {
  let entries
  try {
    entries = readdirSync(absPkgDir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some(e => e.isFile() && e.name.endsWith('.vue'))
}

/**
 * Layout-детекція для stories-glob (ADR Кластер 2, розширено пілотом на flat-root):
 * `.vue`-файли прямо в корені пакета (без `src/`) → flat-root glob по корені;
 * інакше `src/components/` присутній → glob звужується до нього; інакше — ширший
 * glob по всьому `src/`. Шлях відносний до `.storybook/` (де лежить сам `main.js`),
 * тому з префіксом `../`.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string} glob для `stories` у `.storybook/main.js`
 */
export function detectStoriesGlob(absPkgDir) {
  if (hasFlatRootVueFiles(absPkgDir)) return '../*.stories.@(js|ts)'
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
 * Перевіряє скафолд бібліотечного пакета (тип `library`): `.storybook/main.js`,
 * `.storybook/preview.js`, сусідній `.storybook/empty-vite.config.js`
 * (`viteConfigPath`-стенд-ін — не потрібен app-проєктам, дзеркальна асиметрія).
 * @param {string} absDir абсолютний корінь пакета
 * @param {string} label людський підпис пакета
 * @param {string} rootDir root dir пакета
 * @param {string} relPrefix `${rootDir}/` чи `''` для кореня монорепо
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkLibraryScaffold(absDir, label, rootDir, relPrefix, reporter) {
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

  // empty-vite.config.js — сусідній файл, на який main.js посилається через
  // core.builder.options.viteConfigPath; без нього посилання в main.js "розбите" навіть
  // якщо сам main.js канонічний (маркер viteConfigPath присутній), тому перевіряється
  // окремо, а не лише як частина MAIN_JS_MARKERS.
  await checkCanonFile(
    absDir,
    '.storybook/empty-vite.config.js',
    EMPTY_VITE_CONFIG_MARKERS,
    'missing-empty-vite-config',
    'empty-vite-config-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/empty-vite.config.js`,
    reporter
  )
}

/**
 * Перевіряє скафолд app-пакета (тип `app`, хвиля 2a): `.storybook/main.js`/`preview.js` за
 * app-канонічними маркерами ({@link APP_MAIN_JS_MARKERS}/{@link APP_PREVIEW_JS_MARKERS}) —
 * без `empty-vite.config.js`, бо `viteConfigPath`-обхід тут свідомо не застосовується
 * (builder-vite підхоплює повний `vite.config.js` app-проєкту, ADR-розширення 2026-07-20).
 * @param {string} absDir абсолютний корінь пакета
 * @param {string} label людський підпис пакета
 * @param {string} rootDir root dir пакета
 * @param {string} relPrefix `${rootDir}/` чи `''` для кореня монорепо
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkAppScaffold(absDir, label, rootDir, relPrefix, reporter) {
  await checkCanonFile(
    absDir,
    '.storybook/main.js',
    APP_MAIN_JS_MARKERS,
    'missing-app-main-js',
    'app-main-js-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/main.js`,
    reporter
  )

  await checkCanonFile(
    absDir,
    '.storybook/preview.js',
    APP_PREVIEW_JS_MARKERS,
    'missing-app-preview-js',
    'app-preview-js-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/preview.js`,
    reporter
  )
}

/**
 * Перевіряє один в-скоупі пакет: `.storybook/main.js`, `.storybook/preview.js`
 * (розгалужено за {@link import('../scope/main.mjs').InScopePackage.type} — бібліотека чи
 * app, хвиля 2a) і спільний для обох типів `package.json#scripts.storybook`.
 * @param {import('../scope/main.mjs').InScopePackage} pkgEntry пакет у скоупі
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkPackageScaffold({ rootDir, absDir, pkg, type }, reporter) {
  const label = rootDir === '.' ? 'корінь' : rootDir
  const relPrefix = rootDir === '.' ? '' : `${rootDir}/`

  if (type === 'app') {
    await checkAppScaffold(absDir, label, rootDir, relPrefix, reporter)
  } else {
    await checkLibraryScaffold(absDir, label, rootDir, relPrefix, reporter)
  }

  // vitest.setup.js — той самий файл для обох типів пакета (vitest-config-концерн
  // посилається на нього як на setupFiles storybook-vitest-проєкту незалежно від library/app).
  await checkCanonFile(
    absDir,
    '.storybook/vitest.setup.js',
    VITEST_SETUP_JS_MARKERS,
    'missing-vitest-setup-js',
    'vitest-setup-js-marker-missing',
    label,
    rootDir,
    `${relPrefix}.storybook/vitest.setup.js`,
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
