/** @see ./docs/main.md */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
