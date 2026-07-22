/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { parseSync } from 'oxc-parser'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'
import {
  dynamicImportModule,
  langFromPath,
  requireCallModule,
  walkAstWithAncestors
} from '@7n/rules/scripts/utils/ast-scan-utils.mjs'
import { contentForVueImportScan } from '@7n/rules/scripts/lib/js-source-signals.mjs'
import { isNodeBuiltinSpecifier } from '../../vue/lib/vue-forbidden-imports.mjs'
import { collectInScopeVuePackages } from '../scope/main.mjs'

const VUE_EXT_RE = /\.vue$/u

// Quasar CLI-конвенція за замовчуванням (quasar.dev/style/sass-scss-variables): плагін шукає
// саме цей файл, якщо `sassVariables` не задає власний шлях — .scss першим, .sass fallback-ом.
const SASS_VARIABLES_CANDIDATES = ['src/css/quasar.variables.scss', 'src/css/quasar.variables.sass']

// quasar({ sassVariables: true }) або quasar({ sassVariables: 'шлях' }) — обидві форми вмикають
// підключення SCSS-змінних; boolean false/відсутність поля — ні.
const SASS_VARIABLES_MARKER_RE = /sassVariables\s*:\s*(?:true|['"])/u

/**
 * Віртуальний шлях для oxc-парсера: `.vue` розбирається як `.ts` (після витягу `<script>`-блоку),
 * решта — за власним розширенням.
 * @param {string} relPath шлях файлу (posix, відносно пакета)
 * @returns {string} шлях для вибору `lang` парсером
 */
function virtualPathForParse(relPath) {
  return relPath.endsWith('.vue') ? relPath.replace(VUE_EXT_RE, '.ts') : relPath
}

/**
 * Витягає import-specifier'и з `.vue` SFC (лише `<script>`-блоки) чи звичайного JS/TS-файлу:
 * static import + dynamic `import()` + `require()`. Той самий oxc-parser pipeline, що й
 * `js/dep-policy` і `vue/lib/vue-forbidden-imports.mjs` — лише для довільного specifier-а,
 * не для конкретного заборонного списку.
 * @param {string} content сирий вміст файлу
 * @param {string} relPath шлях файлу (для вибору мови/віртуального шляху парсера)
 * @returns {string[]} список import-specifier'ів (можуть повторюватись)
 */
function extractImportSpecifiers(content, relPath) {
  const scan = contentForVueImportScan(content, relPath)
  const virtualPath = virtualPathForParse(relPath)
  let parsed
  try {
    parsed = parseSync(virtualPath, scan, { lang: langFromPath(virtualPath), sourceType: 'module' })
  } catch {
    return []
  }
  if (parsed.errors?.length) return []

  const out = []
  for (const imp of parsed.module?.staticImports ?? []) {
    if (typeof imp?.moduleRequest?.value === 'string') out.push(imp.moduleRequest.value)
  }
  const program = parsed.program
  if (program && typeof program === 'object') {
    walkAstWithAncestors(program, [], node => {
      const dyn = dynamicImportModule(node)
      if (dyn !== null) out.push(dyn)
      const req = requireCallModule(node)
      if (req !== null) out.push(req)
    })
  }
  return out
}

/**
 * Чи є specifier відносним імпортом чи псевдонімом шляху (не сторонній пакет): `./x`, `../x`,
 * абсолютний шлях, чи типові Vite-аліаси `@/...`/`~/...` на `src/`. Автоімпорт-глобали
 * (`ref`, `computed`, Quasar-композаблі через `unplugin-auto-import`) сюди не потрапляють —
 * вони не є import-специфікаторами взагалі, AST їх не бачить.
 * @param {string} spec значення `moduleRequest.value`
 * @returns {boolean} `true`, якщо це не сторонній пакет
 */
function isRelativeOrAliasSpecifier(spec) {
  return spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~/') || spec.startsWith('@/')
}

/**
 * Ім'я пакета верхнього рівня зі specifier-а: враховує scoped-пакети (`@scope/name`) і
 * subpath-імпорти (`pkg/sub/path` → `pkg`, `@scope/name/sub` → `@scope/name`).
 * @param {string} spec сторонній import-specifier
 * @returns {string} ім'я пакета для звірки з package.json deps
 */
function topLevelPackageName(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec
  }
  const idx = spec.indexOf('/')
  return idx === -1 ? spec : spec.slice(0, idx)
}

/**
 * Множина задекларованих пакетів (`dependencies` + `peerDependencies`) — workspace-пакети
 * (`@nitra/*`, `@7n/*`) не потребують окремої обробки: вони так само оголошуються тут
 * (workspace-протокол), як і звичайні npm-залежності.
 * @param {Record<string, unknown>} pkg розпарсений package.json пакета
 * @returns {Set<string>} імена задекларованих пакетів
 */
function collectDeclaredDeps(pkg) {
  const names = new Set()
  for (const field of ['dependencies', 'peerDependencies']) {
    const obj = pkg?.[field]
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const name of Object.keys(obj)) names.add(name)
    }
  }
  return names
}

/**
 * Збирає абсолютні шляхи всіх `.vue`-файлів у дереві пакета.
 * @param {string} absDir абсолютний шлях кореня пакета
 * @param {string[]} ignorePaths абсолютні шляхи, повністю виключені з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи `.vue`-файлів
 */
async function collectVueFiles(absDir, ignorePaths) {
  const files = []
  await walkDir(
    absDir,
    p => {
      if (p.endsWith('.vue')) files.push(p)
    },
    ignorePaths
  )
  return files
}

/**
 * Будує posix-relative шлях від `cwd` для violation.file — `entry.rootDir` уже relative до `cwd`
 * (`.` для кореня монорепо), `relFromPkg` — relative до `entry.absDir`.
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @param {string} relFromPkg posix-relative шлях від кореня пакета
 * @returns {string} posix-relative шлях від `cwd`
 */
function fileRelFromCwd(entry, relFromPkg) {
  return entry.rootDir === '.' ? relFromPkg : `${entry.rootDir}/${relFromPkg}`
}

/**
 * Перевіряє один пакет на undeclared third-party imports у `.vue`-файлах: import стороннього
 * пакета, якого немає в `dependencies`/`peerDependencies` package.json цього ж пакета (реальний
 * кейс ADR — зламаний default-export `@vuepic/vue-datepicker` v14, silent breakage без цієї
 * перевірки). Відносні імпорти, аліаси (`@/`, `~/`), Node-builtin і auto-import глобали
 * пропускаються.
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @param {string[]} ignorePaths абсолютні шляхи, виключені з обходу
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер порушень
 * @returns {Promise<void>}
 */
async function checkUndeclaredImportsForPackage(entry, ignorePaths, reporter) {
  const declared = collectDeclaredDeps(entry.pkg)
  const vueFiles = await collectVueFiles(entry.absDir, ignorePaths)

  for (const absFile of vueFiles) {
    const content = await readFile(absFile, 'utf8')
    const relFromPkg = relative(entry.absDir, absFile).split('\\').join('/')
    const specifiers = extractImportSpecifiers(content, relFromPkg)

    const reportedForFile = new Set()
    for (const spec of specifiers) {
      if (isRelativeOrAliasSpecifier(spec) || isNodeBuiltinSpecifier(spec)) continue
      const pkgName = topLevelPackageName(spec)
      if (declared.has(pkgName) || reportedForFile.has(pkgName)) continue
      reportedForFile.add(pkgName)

      const fileRel = fileRelFromCwd(entry, relFromPkg)
      reporter.fail(
        `[undeclared-import] ${fileRel}: import '${spec}' — пакет '${pkgName}' відсутній у dependencies/peerDependencies ${entry.rootDir === '.' ? 'кореня монорепо' : entry.rootDir} (storybook.mdc hygiene)`,
        {
          reason: 'undeclared-import',
          file: fileRel,
          data: { rootDir: entry.rootDir, package: pkgName, specifier: spec }
        }
      )
    }
  }
}

/**
 * Чи має пакет глобальні Quasar SCSS-змінні — canonical шлях за замовчуванням
 * (quasar.dev/style/sass-scss-variables): `src/css/quasar.variables.scss` (fallback `.sass`).
 * @param {string} absDir абсолютний шлях кореня пакета
 * @returns {boolean} `true`, якщо знайдено файл глобальних SCSS-змінних
 */
function hasGlobalSassVariables(absDir) {
  return SASS_VARIABLES_CANDIDATES.some(f => existsSync(join(absDir, f)))
}

/**
 * Перевіряє один пакет на auto-detect глобальних SCSS-змінних: якщо в пакеті є
 * `quasar.variables.scss`/`.sass`, а `.storybook/main.js` не вмикає `sassVariables` у
 * `quasar()`-плагіні, глобальні SCSS-змінні недоступні у Storybook (тихий розсинхрон зі
 * звичайним build). Рівень — `warn` (м'який сигнал, не гейт хвилі 1, аналогічно
 * `onUnhandledRequest` у `preview.js`). Відсутність самого `.storybook/main.js` вже покриває
 * `storybook/scaffold` — тут не дублюється.
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер порушень
 * @returns {Promise<void>}
 */
async function checkSassVariablesForPackage(entry, reporter) {
  if (!hasGlobalSassVariables(entry.absDir)) return

  const mainJsPath = join(entry.absDir, '.storybook/main.js')
  if (!existsSync(mainJsPath)) return

  const content = await readFile(mainJsPath, 'utf8')
  if (SASS_VARIABLES_MARKER_RE.test(content)) return

  const fileRel = fileRelFromCwd(entry, '.storybook/main.js')
  reporter.fail(
    `[sass-variables] ${fileRel}: пакет має глобальні Quasar SCSS-змінні (${SASS_VARIABLES_CANDIDATES.join(' | ')}), але quasar({ sassVariables }) не задано в .storybook/main.js (storybook.mdc hygiene)`,
    { reason: 'missing-sass-variables', file: fileRel, severity: 'warn', data: { rootDir: entry.rootDir } }
  )
}

/**
 * Detector concern-а `storybook/hygiene`: для кожного Vue component library пакета у скоупі
 * канону Storybook (`collectInScopeVuePackages`) — undeclared third-party imports у `.vue` та
 * auto-detect глобальних Quasar SCSS-змінних без `sassVariables` у `.storybook/main.js`
 * (storybook.mdc, ADR Кластер 6). Breaking-change guard при мажорному апгрейді
 * third-party-пакетів свідомо не автоматизується — людський пункт, hygiene.mdc.
 *
 * Свідомо ЛИШЕ `type: 'library'` (хвиля 2a, фікс за результатами живого пілота gt):
 * обидві перевірки писались і перевірялись лише на бібліотечному кейсі й дають хибні
 * спрацювання на app-пакетах. (1) Undeclared-import: app-пакети типово мають
 * `resolve.alias` у своєму `vite.config.js` (Quasar CLI-конвенція — `src`, `components`,
 * `boot`, `layouts`, `pages` тощо), тож `.vue`-сторінка легітимно імпортує
 * `import X from 'components/Foo.vue'` (без `./`/`@/`-префікса) — `isRelativeOrAliasSpecifier`
 * цього не розпізнає й трактує alias як ім'я стороннього npm-пакета. (2) Sass-variables:
 * app-канонічний `.storybook/main.js` (хвиля 2a) СВІДОМО не викликає `quasar()` взагалі —
 * `@storybook/builder-vite` підхоплює повний `vite.config.js` app-проєкту без власного
 * `viteFinal`-інстанса (асиметрія з бібліотекою, `scaffold/template/app-main.js`) — маркер
 * `sassVariables` там ніколи не з'явиться, навіть якщо SCSS-змінні пакета коректно
 * підключені через власний `vite.config.js`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const cwd = ctx.cwd

  const allPkgs = await collectInScopeVuePackages(cwd)
  const pkgs = allPkgs.filter(entry => entry.type === 'library')
  if (pkgs.length === 0) {
    reporter.pass('storybook hygiene: немає Vue component library пакетів у скоупі (storybook.mdc)')
    return reporter.result()
  }

  const ignorePaths = await loadCursorIgnorePaths(cwd)
  for (const entry of pkgs) {
    await checkUndeclaredImportsForPackage(entry, ignorePaths, reporter)
    await checkSassVariablesForPackage(entry, reporter)
  }

  return reporter.result()
}
