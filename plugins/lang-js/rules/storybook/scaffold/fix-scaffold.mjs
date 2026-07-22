/**
 * T0-autofix для concern-а `storybook/scaffold`: відтворює канонічні `.storybook/main.js`,
 * `.storybook/preview.js`, `.storybook/mocks/gql-sse.js` і `package.json#scripts.storybook`
 * з `template/` цього concern-а. `main.js` має одну заміну на пакет — stories-glob за
 * layout-детекцією (`detectStoriesGlob`, `main.mjs`); `preview.js`/`mocks/gql-sse.js` —
 * verbatim-копія (Quasar/msw-налаштування не залежать від конкретного пакета).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APP_STORIES_GLOB, detectStoriesGlob, STORYBOOK_SCRIPT } from './main.mjs'

const STORIES_GLOB_TOKEN = '__STORYBOOK_STORIES_GLOB__'

/** Каталог `template/` цього concern-а. Експортовано — переюз у `adopt/main.mjs`. */
export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'template')

/**
 * Рендерить канонічний `.storybook/main.js` для конкретного пакета (єдина заміна —
 * stories-glob за layout-детекцією). Експортовано — той самий рендер переюзає
 * `adopt/main.mjs` для генерації повністю відсутнього файлу (не дублювати шаблонування).
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
 * Експортовано — переюз у `adopt/main.mjs`.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `preview.js`
 */
export function renderPreviewJs(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'preview.js'), 'utf8')
}

/**
 * Вміст канонічного `.storybook/mocks/gql-sse.js` — verbatim з template. Експортовано —
 * переюз у `adopt/main.mjs`.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `mocks/gql-sse.js`
 */
export function renderMocksGqlSse(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'mocks/gql-sse.js'), 'utf8')
}

/**
 * Рендерить канонічний `.storybook/main.js` для app-проєкту (хвиля 2a) — фіксований
 * {@link APP_STORIES_GLOB} (без layout-детекції бібліотек: пер-сторінкова структура
 * `src/pages/` не потребує розрізнення `src/components/`). Експортовано — переюз у
 * `adopt/main.mjs`.
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
 * Експортовано — переюз у `adopt/main.mjs`.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст app-`preview.js`
 */
export function renderAppPreviewJs(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'app-preview.js'), 'utf8')
}

/**
 * Вміст канонічного `.storybook/empty-vite.config.js` — verbatim з template (порожній
 * стенд-ін для `core.builder.options.viteConfigPath` у `main.js`, не залежить від пакета).
 * Експортовано — переюз у `adopt/main.mjs`.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {string} вміст `empty-vite.config.js`
 */
export function renderEmptyViteConfig(templateDir = TEMPLATE_DIR) {
  return readFileSync(join(templateDir, 'empty-vite.config.js'), 'utf8')
}

/**
 * Записує файл, створюючи батьківські каталоги й реєструючи запис для rollback.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} ctx fix-контекст рунга
 * @param {string} absPath абсолютний шлях цільового файлу
 * @param {string} content вміст файлу
 * @returns {void}
 */
function writeScaffoldFile(ctx, absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true })
  ctx.recordWrite?.(absPath)
  writeFileSync(absPath, content, 'utf8')
}

/**
 * Резолвить абсолютний корінь пакета з `rootDir` violation.data (`.` — корінь репозиторію).
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {string} rootDir posix-relative корінь пакета
 * @returns {string} абсолютний шлях кореня пакета
 */
function resolvePkgDir(cwd, rootDir) {
  return rootDir === '.' ? cwd : join(cwd, rootDir)
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'storybook-scaffold-main-js',
    test: violations => violations.some(v => v.reason === 'missing-main-js'),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.reason === 'missing-main-js' && typeof v.data?.rootDir === 'string')
      if (targets.length === 0 || !ctx.concernDir) return { touchedFiles: [] }

      const templateDir = join(ctx.concernDir, 'template')
      const mocksTemplate = renderMocksGqlSse(templateDir)
      const emptyViteConfigTemplate = renderEmptyViteConfig(templateDir)

      const touchedFiles = []
      for (const v of targets) {
        const absPkgDir = resolvePkgDir(ctx.cwd, v.data.rootDir)
        const rendered = renderMainJs(absPkgDir, templateDir)

        const mainAbs = join(absPkgDir, '.storybook/main.js')
        writeScaffoldFile(ctx, mainAbs, rendered)
        touchedFiles.push(mainAbs)

        const mocksAbs = join(absPkgDir, '.storybook/mocks/gql-sse.js')
        if (!existsSync(mocksAbs)) {
          writeScaffoldFile(ctx, mocksAbs, mocksTemplate)
          touchedFiles.push(mocksAbs)
        }

        // empty-vite.config.js — main.js посилається на нього напряму (viteConfigPath),
        // без нього щойно відтворений main.js неробочий; генерується разом (belt-and-suspenders
        // з окремим 'storybook-scaffold-empty-vite-config' нижче, який покриває випадок, коли
        // ЛИШЕ цей файл видалено, а main.js лишається канонічним).
        const emptyViteConfigAbs = join(absPkgDir, '.storybook/empty-vite.config.js')
        if (!existsSync(emptyViteConfigAbs)) {
          writeScaffoldFile(ctx, emptyViteConfigAbs, emptyViteConfigTemplate)
          touchedFiles.push(emptyViteConfigAbs)
        }
      }
      return { touchedFiles, message: `.storybook/main.js: створено для ${targets.length} пакет(ів)` }
    }
  },
  {
    id: 'storybook-scaffold-empty-vite-config',
    test: violations => violations.some(v => v.reason === 'missing-empty-vite-config'),
    apply: (violations, ctx) => {
      const targets = violations.filter(
        v => v.reason === 'missing-empty-vite-config' && typeof v.data?.rootDir === 'string'
      )
      if (targets.length === 0 || !ctx.concernDir) return { touchedFiles: [] }

      const emptyViteConfigTemplate = renderEmptyViteConfig(join(ctx.concernDir, 'template'))

      const touchedFiles = []
      for (const v of targets) {
        const absPkgDir = resolvePkgDir(ctx.cwd, v.data.rootDir)
        const abs = join(absPkgDir, '.storybook/empty-vite.config.js')
        if (existsSync(abs)) continue
        writeScaffoldFile(ctx, abs, emptyViteConfigTemplate)
        touchedFiles.push(abs)
      }
      return {
        touchedFiles,
        message:
          touchedFiles.length > 0
            ? `.storybook/empty-vite.config.js: створено для ${touchedFiles.length} пакет(ів)`
            : undefined
      }
    }
  },
  {
    id: 'storybook-scaffold-preview-js',
    test: violations => violations.some(v => v.reason === 'missing-preview-js'),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.reason === 'missing-preview-js' && typeof v.data?.rootDir === 'string')
      if (targets.length === 0 || !ctx.concernDir) return { touchedFiles: [] }

      const previewTemplate = renderPreviewJs(join(ctx.concernDir, 'template'))

      const touchedFiles = []
      for (const v of targets) {
        const absPkgDir = resolvePkgDir(ctx.cwd, v.data.rootDir)
        const previewAbs = join(absPkgDir, '.storybook/preview.js')
        writeScaffoldFile(ctx, previewAbs, previewTemplate)
        touchedFiles.push(previewAbs)
      }
      return { touchedFiles, message: `.storybook/preview.js: створено для ${targets.length} пакет(ів)` }
    }
  },
  {
    id: 'storybook-scaffold-app-main-js',
    test: violations => violations.some(v => v.reason === 'missing-app-main-js'),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.reason === 'missing-app-main-js' && typeof v.data?.rootDir === 'string')
      if (targets.length === 0 || !ctx.concernDir) return { touchedFiles: [] }

      const templateDir = join(ctx.concernDir, 'template')
      const rendered = renderAppMainJs(templateDir)
      const mocksTemplate = renderMocksGqlSse(templateDir)

      const touchedFiles = []
      for (const v of targets) {
        const absPkgDir = resolvePkgDir(ctx.cwd, v.data.rootDir)

        const mainAbs = join(absPkgDir, '.storybook/main.js')
        writeScaffoldFile(ctx, mainAbs, rendered)
        touchedFiles.push(mainAbs)

        // mocks/gql-sse.js — реюз того самого канонічного helper-а, що й бібліотеки
        // (page-stories мокають Apollo-підписки тим самим wire-протоколом graphql-sse).
        const mocksAbs = join(absPkgDir, '.storybook/mocks/gql-sse.js')
        if (!existsSync(mocksAbs)) {
          writeScaffoldFile(ctx, mocksAbs, mocksTemplate)
          touchedFiles.push(mocksAbs)
        }
      }
      return { touchedFiles, message: `.storybook/main.js (app): створено для ${targets.length} пакет(ів)` }
    }
  },
  {
    id: 'storybook-scaffold-app-preview-js',
    test: violations => violations.some(v => v.reason === 'missing-app-preview-js'),
    apply: (violations, ctx) => {
      const targets = violations.filter(
        v => v.reason === 'missing-app-preview-js' && typeof v.data?.rootDir === 'string'
      )
      if (targets.length === 0 || !ctx.concernDir) return { touchedFiles: [] }

      const previewTemplate = renderAppPreviewJs(join(ctx.concernDir, 'template'))

      const touchedFiles = []
      for (const v of targets) {
        const absPkgDir = resolvePkgDir(ctx.cwd, v.data.rootDir)
        const previewAbs = join(absPkgDir, '.storybook/preview.js')
        writeScaffoldFile(ctx, previewAbs, previewTemplate)
        touchedFiles.push(previewAbs)
      }
      return { touchedFiles, message: `.storybook/preview.js (app): створено для ${targets.length} пакет(ів)` }
    }
  },
  {
    id: 'storybook-scaffold-package-script',
    test: violations => violations.some(v => v.reason === 'missing-storybook-script'),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.reason === 'missing-storybook-script' && v.file)
      const touchedFiles = []
      for (const v of targets) {
        const abs = join(ctx.cwd, v.file)
        let pkg
        try {
          pkg = JSON.parse(readFileSync(abs, 'utf8'))
        } catch {
          continue
        }
        pkg.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
        if (pkg.scripts.storybook === STORYBOOK_SCRIPT) continue
        pkg.scripts.storybook = STORYBOOK_SCRIPT
        ctx.recordWrite?.(abs)
        writeFileSync(abs, `${JSON.stringify(pkg, null, 2)}\n`)
        touchedFiles.push(abs)
      }
      return touchedFiles.length > 0
        ? { touchedFiles, message: `scripts.storybook: встановлено у ${touchedFiles.length} package.json` }
        : { touchedFiles: [] }
    }
  }
]
