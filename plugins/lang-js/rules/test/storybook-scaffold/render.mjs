/**
 * Рендери канонічних файлів `.storybook/` з `template/` цього концерну — сім
 * чистих функцій без жодного FS-запису (читають лише шаблон і підставляють
 * stories-glob).
 *
 * Чому окремий модуль, а не половина `fix-storybook-scaffold.mjs`, де вони
 * жили раніше (§2.93): T0-фікс концерну `test/storybook-scaffold` портовано
 * у wasm-гість `crates/plugin-lang-js` (`fix_storybook_scaffold`, шаблони —
 * `include_str!` ТИХ САМИХ файлів `template/`), і JS-канон фіксу знято. Але
 * ці рендери — не дублікат гостя: їх імпортує ЖИВИЙ adopt-режим
 * (`../storybook-adopt/main.mjs`, `--fix-missing` зі скіла
 * `npm/skills/storybook/SKILL.md`), який у гість не портований і генерує
 * відсутні секції тим самим шаблонуванням, щоб не дублювати його.
 *
 * Отже, після §2.93 `template/` цього концерну має РІВНО двох читачів:
 * `include_str!` гостя (T0-фікс) і цей модуль (adopt). Дрейф між ними
 * неможливий — джерело байт-у-байт одне.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APP_STORIES_GLOB, detectStoriesGlob } from './main.mjs'

const STORIES_GLOB_TOKEN = '__STORYBOOK_STORIES_GLOB__'

/** Каталог `template/` цього concern-а — дефолт для всіх рендерів нижче. */
export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'template')

/**
 * Рендерить канонічний `.storybook/main.js` для конкретного пакета (єдина заміна —
 * stories-glob за layout-детекцією).
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} готовий вміст `main.js`
 */
export function renderMainJs(absPkgDir, templateDir = TEMPLATE_DIR) {
  const mainTemplate = readFileSync(join(templateDir, 'main.js'), 'utf8')
  return mainTemplate.split(STORIES_GLOB_TOKEN).join(detectStoriesGlob(absPkgDir))
}

/**
 * Вміст канонічного `.storybook/preview.js` — verbatim з template (не залежить від пакета).
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `preview.js`
 */
export function renderPreviewJs(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'preview.js'), 'utf8')
}

/**
 * Вміст канонічного `.storybook/mocks/gql-sse.js` — verbatim з template.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `mocks/gql-sse.js`
 */
export function renderMocksGqlSse(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'mocks/gql-sse.js'), 'utf8')
}

/**
 * Рендерить канонічний `.storybook/main.js` для app-проєкту (хвиля 2a) — фіксований
 * {@link APP_STORIES_GLOB} (без layout-детекції бібліотек: пер-сторінкова структура
 * `src/pages/` не потребує розрізнення `src/components/`).
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} готовий вміст app-`main.js`
 */
export function renderAppMainJs(templateDir = TEMPLATE_DIR) {
  const mainTemplate = readFileSync(join(templateDir, 'app-main.js'), 'utf8')
  return mainTemplate.split(STORIES_GLOB_TOKEN).join(APP_STORIES_GLOB)
}

/**
 * Вміст канонічного `.storybook/preview.js` для app-проєкту (хвиля 2a) — verbatim з
 * template (`pageLoader`/QLayout-реєстрація не залежать від конкретного app-пакета).
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст app-`preview.js`
 */
export function renderAppPreviewJs(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'app-preview.js'), 'utf8')
}

/**
 * Вміст канонічного `.storybook/empty-vite.config.js` — verbatim з template (порожній
 * стенд-ін для `core.builder.options.viteConfigPath` у `main.js`, не залежить від пакета).
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `empty-vite.config.js`
 */
export function renderEmptyViteConfig(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'empty-vite.config.js'), 'utf8')
}

/**
 * Вміст канонічного `.storybook/vitest.setup.js` — verbatim з template (той самий файл
 * для library і app пакетів, не залежить від типу).
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `vitest.setup.js`
 */
export function renderVitestSetupJs(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'vitest.setup.js'), 'utf8')
}
