/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

import { parseSync } from 'oxc-parser'

import { APP_STORIES_GLOB, detectStoriesGlob } from '../storybook-scaffold/main.mjs'

/**
 * Канонічні назви vitest-конфіга пакета (пріоритет .mjs — нові файли, js.mdc);
 * .ts підтримано для "стійкості до варіацій" (vitest-config.mdc).
 */
export const VITEST_CONFIG_NAMES = ['vitest.config.mjs', 'vitest.config.js', 'vitest.config.ts']
// Ті самі варіанти, що й `vite.config.*` у scope/main.mjs (не експортовано звідти — дублюємо).
const VITE_CONFIG_NAMES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']

/** Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився. */
export const STORYBOOK_TEST_IMPORT = "import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'\n"

/** Import, який має бути присутній у файлі, щоб `playwright(...)`-factory (vitest@^4) резолвилась. */
export const PLAYWRIGHT_PROVIDER_IMPORT = "import { playwright } from '@vitest/browser-playwright'\n"

/**
 * Import-и, потрібні ЛИШЕ app-storybook-запису (хвиля 2a, `app-storybook-project-entry.js`):
 * `quasar()`/`AutoImport()`/`Pages()`-плагіни, яких немає у бібліотечному записі
 * (`storybook-project-entry.js`) — сторінковий storybook-проєкт app-пакета отримує ВЛАСНІ
 * копії цих плагінів замість урізаного батьківського `baseVite` (unit-ізоляція, test.mdc).
 * Експортовано — переюз у `fix-vitest-config.mjs`.
 */
export const QUASAR_PLUGIN_IMPORT = "import { quasar } from '@quasar/vite-plugin'\n"
/** Import `AutoImport`-плагіна — app-storybook-запис (див. опис над `QUASAR_PLUGIN_IMPORT`). */
export const AUTO_IMPORT_PLUGIN_IMPORT = "import AutoImport from 'unplugin-auto-import/vite'\n"
/** Import `Pages`-плагіна — app-storybook-запис (див. опис над `QUASAR_PLUGIN_IMPORT`). */
export const VITE_PLUGIN_PAGES_IMPORT = "import Pages from 'vite-plugin-pages'\n"

/** Стабільний reason (namespace: ruleId/concernId/reason): у пакета немає жодного vitest-конфіга. */
export const REASON_VITEST_CONFIG_MISSING = 'vitest-config-missing'
/** Стабільний reason: відсутній ізольований `vitest.stryker.config` поруч із vitest-конфігом. */
export const REASON_STRYKER_CONFIG_MISSING = 'stryker-config-missing'
/** Стабільний reason: vitest-конфіг не парситься / без test-блоку — правити вручну. */
export const REASON_CONFIG_UNRESOLVABLE = 'vitest-config-unresolvable'
/** Стабільний reason: `test.projects` — не статичний масив (spread/змінна). */
export const REASON_PROJECTS_DYNAMIC = 'projects-dynamic'
/** Стабільний reason: у `test.projects` немає запису `unit`. */
export const REASON_UNIT_PROJECT_MISSING = 'unit-project-missing'
/** Стабільний reason: у `test.projects` немає запису `storybook`. */
export const REASON_STORYBOOK_PROJECT_MISSING = 'storybook-project-missing'
/** Стабільний reason: storybook-запис без канонічних маркерів (chromium/browser/stories/provider). */
export const REASON_STORYBOOK_PROJECT_MARKER_MISSING = 'storybook-project-marker-missing'

// Маркери канонічного storybook-проєкту (текстовий пошук у зрізі джерела самого
// елемента масиву — стійко до форматування/AST-варіацій, як і scaffold/main.mjs).
// Експортовані — переюз у `adopt/main.mjs`.
const UNIT_NAME_RE = /name\s*:\s*['"]unit['"]/u
const STORYBOOK_NAME_RE = /name\s*:\s*['"]storybook['"]/u
/** Маркер chromium-інстанса у storybook-запису (текстовий пошук у зрізі елемента). */
export const CHROMIUM_RE = /chromium/u
/** Маркер browser-mode (`browser:`-ключ) у storybook-запису. */
export const BROWSER_KEY_RE = /\bbrowser\s*:/u
/** Маркер явного stories-джерела (підрядок `stories`) у storybook-запису. */
export const STORIES_RE = /stories/iu
/**
 * `storybookTest({ configDir: ... })` без явного `include` — легітимний патерн:
 * Storybook підхоплює stories-glob автоматично зі своєї `.storybook/main.js`-конфігурації
 * (той самий stories-glob, що й `detectStoriesGlob`), явний include у vitest-конфізі не
 * обов'язковий (реальний кейс components/npm/vitest.config.js — пілот adopt-діагностики).
 */
export const STORYBOOK_TEST_CONFIG_DIR_RE = /storybookTest\([^)]*configDir/u
/**
 * vitest@^4: `browser.provider` — factory-виклик (`playwright()` з `@vitest/browser-playwright`),
 * не рядок `'playwright'` (застаріле API попередніх мажорів).
 */
export const PROVIDER_FACTORY_RE = /provider\s*:\s*playwright\s*\(/u
/**
 * App-специфічні маркери (хвиля 2a, `type: 'app'`): storybook-проєкт app-пакета має отримувати
 * ВЛАСНІ quasar()/AutoImport()/Pages()-плагіни (не той самий урізаний набір, що й unit-проєкт,
 * canon test.mdc) — без них сторінкові stories падають на Quasar SCSS-змінних/
 * auto-import globals/`<route>`-блоках (деталі — `app-storybook-project-entry.js`).
 */
export const QUASAR_PLUGIN_RE = /quasar\s*\(/u
/** App-маркер: виклик `AutoImport()`-плагіна у storybook-запису (див. опис над `QUASAR_PLUGIN_RE`). */
export const AUTO_IMPORT_PLUGIN_RE = /AutoImport\s*\(/u
/** App-маркер: виклик `Pages()`-плагіна у storybook-запису (див. опис над `QUASAR_PLUGIN_RE`). */
export const VITE_PLUGIN_PAGES_RE = /\bPages\s*\(/u
const STORIES_GLOB_PREFIX_RE = /^\.\.\//u
/**
 * Module-scope (prefer-static-regex): рядок-відступ цілком whitespace; leading
 * кома (можливо з whitespace) — спільні з fix-vitest-config.mjs патерном augment-у.
 */
export const WHITESPACE_ONLY_RE = /^\s*$/u
/** Leading кома (можливо з whitespace) — див. опис над `WHITESPACE_ONLY_RE`. */
export const LEADING_COMMA_RE = /^\s*,/u

/**
 * Резолвить абсолютний шлях наявного `vitest.config.*` пакета (перший знайдений
 * за пріоритетом {@link VITEST_CONFIG_NAMES}), або `null` якщо жодного немає.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string | null} абсолютний шлях конфіга або null
 */
export function resolveVitestConfigPath(absPkgDir) {
  const name = VITEST_CONFIG_NAMES.find(n => existsSync(join(absPkgDir, n)))
  return name ? join(absPkgDir, name) : null
}

/**
 * Резолвить ім'я `vite.config.*` пакета для import-шляху в baseline-шаблонах
 * (той самий файл, що й `viteFinal` у `.storybook/main.js`). Пакет у скоупі
 * Storybook НЕ гарантовано має власний `vite.config.*` (хвиля 1.4 — вимогу
 * `hasStandardBuild` прибрано зі скоуп-детекції, `scope/main.mjs`) — source-only
 * Vue-бібліотека (напр. tauri-components/npm) законно потрапляє у скоуп без
 * жодного `vite.config.*`. `null` — сигнал викликачу (`fix-vitest-config.mjs`)
 * підставити порожній placeholder замість імпорту неіснуючого файлу.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @returns {string | null} ім'я файлу vite-конфіга або `null`, якщо жодного немає
 */
export function resolveViteConfigName(absPkgDir) {
  return VITE_CONFIG_NAMES.find(n => existsSync(join(absPkgDir, n))) ?? null
}

/**
 * Шлях до ізольованого `vitest.stryker.config.*` — той самий каталог і
 * розширення, що й основний vitest-конфіг пакета.
 * @param {string} vitestConfigPath абсолютний шлях `vitest.config.*`
 * @returns {string} абсолютний шлях `vitest.stryker.config.*`
 */
export function strykerConfigPathFor(vitestConfigPath) {
  return join(dirname(vitestConfigPath), `vitest.stryker.config${extname(vitestConfigPath)}`)
}

/**
 * Stories-glob для vitest-конфіга пакета (на відміну від `detectStoriesGlob`
 * scaffold-концерна — той повертає шлях відносно `.storybook/`, тут vitest-конфіг
 * лежить у корені пакета, тож префікс `../` треба зняти). Для app-пакетів (хвиля 2a,
 * `type: 'app'`) — фіксований {@link APP_STORIES_GLOB}, НЕ layout-детекція бібліотек:
 * app-проєкт може мати одночасно `src/components/` (переюзані презентаційні компоненти)
 * і `src/pages/` (сторінки) — вузький `detectStoriesGlob`-glob тоді мовчки пропустив би
 * page-stories з vitest storybook-проєкту.
 * @param {string} absPkgDir абсолютний шлях кореня пакета
 * @param {'library'|'app'} [type] тип пакета (`InScopePackage.type`); типово `library`-детекція
 * @returns {string} glob відносно кореня пакета
 */
export function storiesGlobForVitestConfig(absPkgDir, type) {
  const glob = type === 'app' ? APP_STORIES_GLOB : detectStoriesGlob(absPkgDir)
  return glob.replace(STORIES_GLOB_PREFIX_RE, '')
}

/**
 * Парсить JS/TS файл через oxc-parser з обраним lang за розширенням.
 * @param {string} absPath абсолютний шлях файлу (для diagnostics парсера)
 * @param {string} src вміст файлу
 * @returns {{program: object, errors?: Array<{message: string}>}} результат парсингу
 */
export function parseModule(absPath, src) {
  const lang = extname(absPath) === '.ts' ? 'ts' : 'js'
  return parseSync(absPath, src, { lang, sourceType: 'module' })
}

/**
 * Рекурсивно шукає перший `ObjectExpression` у довільному AST-вузлі, що має
 * property `test` зі значенням-`ObjectExpression`.
 * @param {unknown} node довільний AST-вузол/масив/примітив
 * @returns {object | null} `test`-ObjectExpression або null
 */
function findTestObjectIn(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'ObjectExpression') {
    const prop = node.properties?.find(
      p =>
        p.type === 'Property' &&
        !p.computed &&
        p.key &&
        (p.key.name === 'test' || p.key.value === 'test') &&
        p.value?.type === 'ObjectExpression'
    )
    if (prop) return prop.value
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        const res = findTestObjectIn(item)
        if (res) return res
      }
    } else if (val && typeof val === 'object') {
      const res = findTestObjectIn(val)
      if (res) return res
    }
  }
  return null
}

/**
 * Шукає перший `ObjectExpression` у дереві AST, що має property `test` зі
 * значенням-`ObjectExpression` — незалежно від того, чи огорнутий він у
 * `defineConfig(...)`/`mergeConfig(...)`, чи це простий об'єкт (стійко до
 * варіацій testing.mdc-канону).
 * @param {object} program oxc Program node
 * @returns {object | null} `test`-ObjectExpression або null
 */
export function findTestObject(program) {
  return findTestObjectIn(program)
}

/**
 * Шукає property `name` у `ObjectExpression`.
 * @param {object} objExpr ObjectExpression node
 * @param {string} name ім'я property
 * @returns {object | null} Property node або null
 */
export function findProperty(objExpr, name) {
  return (
    objExpr.properties.find(
      p => p.type === 'Property' && !p.computed && p.key && (p.key.name === name || p.key.value === name)
    ) ?? null
  )
}

/**
 * Класифікує елементи масиву `test.projects`: чи є `unit`-проєкт, і
 * source-зріз елемента `storybook`-проєкту (для marker-перевірки).
 * @param {string} src вихідний текст vitest-конфіга
 * @param {object} arr ArrayExpression node (`test.projects`)
 * @returns {{hasUnit: boolean, storybookSlice: string | null}} стан projects-масиву
 */
export function classifyProjects(src, arr) {
  let hasUnit = false
  let storybookSlice = null
  for (const el of arr.elements) {
    if (!el || el.type !== 'ObjectExpression') continue
    const slice = src.slice(el.start, el.end)
    if (UNIT_NAME_RE.test(slice)) hasUnit = true
    if (STORYBOOK_NAME_RE.test(slice)) storybookSlice = slice
  }
  return { hasUnit, storybookSlice }
}

/**
 * Чи присутній валідний маркер джерела stories у зрізі `storybook`-проєкту:
 * явний stories-glob (`include: [...]`, {@link STORIES_RE}) АБО виклик
 * `storybookTest({ configDir })` без явного `include` — Storybook підхоплює glob
 * автоматично зі своєї конфігурації, явний include не обов'язковий (реальний
 * кейс components/npm/vitest.config.js — пілот adopt-діагностики). Раніше гола
 * вимога підрядка `stories` давала хибний позитив на цьому валідному патерні.
 * Спільна логіка для `main.mjs` (lint) і `adopt/main.mjs` (diff-діагностика) —
 * не дублювати комбінацію двох regex у двох місцях.
 * @param {string} storybookSlice текстовий зріз елемента `storybook` у `test.projects`
 * @returns {boolean} true — маркер джерела stories присутній (явно чи неявно)
 */
export function hasStoriesMarker(storybookSlice) {
  return STORIES_RE.test(storybookSlice) || STORYBOOK_TEST_CONFIG_DIR_RE.test(storybookSlice)
}
