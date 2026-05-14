/**
 * Для кожного workspace-пакета перевіряє правило js-run.mdc.
 *
 * Покрито:
 *  - заборона `@nitra/bunyan` / `bunyan` як у залежностях `package.json`, так і в коді
 *    (`import` / `require` / динамічний `import()`); імпорти сканує AST через `oxc-parser`
 *    (див. `utils/bunyan-imports.mjs`);
 *  - наявність `OTEL_RESOURCE_ATTRIBUTES` зі значеннями `service.name=` та `service.namespace=`
 *    у `k8s/base/configmap.yaml`, якщо такий файл існує (відповідність імені ConfigMap імені
 *    Deployment перевіряється в `check-k8s.mjs`);
 *  - «Внутрішні аліаси» (`#conn/*`): імпорти `bun#SQL`, будь-який `mssql`, `@nitra/graphql-request#GraphQLClient`
 *    дозволені лише у каталозі conn (за замовчуванням `src/conn/`; за наявності
 *    `package.json#imports['#conn/*']` — у його цільовому каталозі); поза ним — порушення
 *    (див. `utils/conn-imports-scan.mjs`);
 *  - «Нейминг та експорти у `#conn/`»: всередині conn-каталогу basename файла має відповідати
 *    канону `ql-<id>` / `(pg|mysql|mssql)-(read|write)[-<id>]`; `export default` заборонений; має бути
 *    іменований експорт з імʼям, що дорівнює camelCase від basename файла (`pg-write-contract.js`
 *    → `export const pgWriteContract`); `index.*` як reexport-барель пропускаємо
 *    (див. `utils/conn-file-rules.mjs`);
 *  - «process.env / CheckEnv»: пряме `process.env.X` має бути замінено на `env` —
 *    з `@nitra/check-env` (для обов'язкових змінних, із `checkEnv([...])`) або з
 *    `node:process` (для опційних). Коли `env` імпортовано з `@nitra/check-env`,
 *    кожен `env.X` має бути закритий літеральним викликом `checkEnv(['X', ...])`
 *    у тому ж файлі або коментарем `// \@nitra/cursor ignore-next-line checkEnv`
 *    на попередньому рядку (див. `utils/check-env-scan.mjs`);
 *  - «Паузи через setTimeout»: `new Promise(resolve => setTimeout(resolve, ms))` (з/без `await`)
 *    треба замінити на `await setTimeout(ms)` з `node:timers/promises`
 *    (див. `utils/promise-settimeout-scan.mjs`);
 *  - «jsconfig.json»: у backend-пакеті з каталогом `src/` у корені має бути `jsconfig.json`,
 *    вміст якого збігається з каноном js-run.mdc (NodeNext і include на дерево `src`).
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  findBunyanImportsInText,
  isBunyanScanSourceFile,
  shouldSkipFileForBunyanScan
} from '../../../scripts/utils/bunyan-imports.mjs'
import { findUncheckedProcessEnvInText, isCheckEnvScanSourceFile } from '../../../scripts/utils/check-env-scan.mjs'
import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { runConftestBatch } from '../../../scripts/utils/run-conftest-batch.mjs'
import { findConnFileRuleViolations, isConnFileRulesSourceFile } from '../../../scripts/utils/conn-file-rules.mjs'
import {
  findConnFactoryImportsInText,
  isConnImportsScanSourceFile,
  isInsideConnDir,
  resolveConnDirFromPackageJson
} from '../../../scripts/utils/conn-imports-scan.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { findPromiseSetTimeoutInText, isPromiseSetTimeoutScanSourceFile } from '../../../scripts/utils/promise-settimeout-scan.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/utils/workspaces.mjs'

/**
 * Чи існує непорожній за змістом маркер каталогу `src/` (рекомендована структура js-run).
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @returns {boolean} true, якщо `src/` існує і є каталогом
 */
function backendPackageHasSrcDir(absPackageRoot) {
  const srcPath = join(absPackageRoot, 'src')
  try {
    return statSync(srcPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * FS-existence + структурна валідація `jsconfig.json` у backend-пакеті з
 * каталогом `src/`. Структуру (canonical `compilerOptions` і `include`)
 * делегуємо у rego-пакет `js_run.jsconfig` через `runConftestBatch` — Plan B:
 * Rego-authoritative, JS оркеструє per-package gate (frontend з `vite` сюди
 * взагалі не доходить, бо викликається лише з backend-гілки).
 * @param {string} rootDir відносний шлях workspace
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string} label префікс `[pkg] `
 * @param {(msg: string) => void} fail callback для повідомлень про порушення
 * @param {(msg: string) => void} passFn callback для повідомлень про успішну перевірку
 * @returns {void}
 */
function checkBackendJsconfigWhenSrcPresent(rootDir, absPackageRoot, label, fail, passFn) {
  if (!backendPackageHasSrcDir(absPackageRoot)) return

  const jcPath = join(rootDir, 'jsconfig.json')
  if (!existsSync(jcPath)) {
    fail(
      `${label}є каталог src/, але немає jsconfig.json — додай канонічний файл з js-run.mdc ` +
        `(NodeNext, include: src/**/*).`
    )
    return
  }
  const violations = runConftestBatch({
    policyDirRel: 'js_run/jsconfig',
    namespace: 'js_run.jsconfig',
    files: [jcPath]
  })
  if (violations.length === 0) {
    passFn(`${label}jsconfig.json відповідає js_run.jsconfig (rego)`)
    return
  }
  for (const v of violations) fail(`${label}${v.message}`)
}

/**
 * Перетворює абсолютний шлях у posix-формі відносно кореня пакета.
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string} absPath абсолютний шлях до файлу
 * @returns {string} відносний posix-шлях
 */
function relPosix(absPackageRoot, absPath) {
  return relative(absPackageRoot, absPath).split('\\').join('/')
}

/**
 * Сканує джерела пакета на заборонені імпорти `@nitra/bunyan` / `bunyan`.
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість знайдених порушень
 */
async function checkBunyanImports(absPackageRoot, ignorePaths, label, fail) {
  /** @type {string[]} */
  const sourcePaths = []
  await walkDir(
    absPackageRoot,
    absPath => {
      const rel = relPosix(absPackageRoot, absPath)
      if (!shouldSkipFileForBunyanScan(rel) && isBunyanScanSourceFile(rel)) {
        sourcePaths.push(absPath)
      }
    },
    ignorePaths
  )

  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relPosix(absPackageRoot, absPath)
    const content = await readFile(absPath, 'utf8')
    for (const v of findBunyanImportsInText(content, rel)) {
      violations++
      fail(`${label}${rel}:${v.line} — заміни '${v.module}' на '@nitra/pino': ${v.snippet}`)
    }
  }
  return violations
}

/**
 * Збирає всі JS/TS-файли пакета (без node_modules, dist тощо).
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} абсолютні шляхи до файлів
 */
async function collectSourceFiles(absPackageRoot, ignorePaths) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    absPackageRoot,
    absPath => {
      const rel = relPosix(absPackageRoot, absPath)
      if (isCheckEnvScanSourceFile(rel)) out.push(absPath)
    },
    ignorePaths
  )
  return out
}

/**
 * Перевіряє правило «Внутрішні аліаси» для пакета.
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string[]} sourcePaths абсолютні шляхи до файлів
 * @param {unknown} pkgJson розпарсений `package.json` пакета (або null)
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість порушень
 */
async function checkConnImports(absPackageRoot, sourcePaths, pkgJson, label, fail) {
  const connDir = resolveConnDirFromPackageJson(pkgJson)
  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relPosix(absPackageRoot, absPath)
    if (!isConnImportsScanSourceFile(rel)) continue
    if (isInsideConnDir(rel, connDir)) continue
    const content = await readFile(absPath, 'utf8')
    for (const v of findConnFactoryImportsInText(content, rel)) {
      violations++
      const target = v.specifier === '*' ? `'${v.module}'` : `{ ${v.specifier} } from '${v.module}'`
      fail(
        `${label}${rel}:${v.line} — імпорт ${target} має бути в '${connDir}/' і реекспортуватися через '#conn/*': ${v.snippet}`
      )
    }
  }
  return violations
}

/**
 * Перевіряє правила нейминга та експортів для файлів усередині `#conn/`.
 *
 * Канон імені: `ql-<id>` для GraphQL, `(pg|mysql|mssql)-(read|write)[-<id>]` для БД (js-run.mdc,
 * розділ «Нейминг файлів у `src/conn/`»). Експорт у файлі — лише іменований, з імʼям, що
 * дорівнює camelCase від basename файла (`pg-write-contract.js` → `export const pgWriteContract`).
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string[]} sourcePaths абсолютні шляхи до файлів пакета
 * @param {unknown} pkgJson розпарсений package.json пакета (або null)
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість порушень
 */
async function checkConnFileNamingAndExports(absPackageRoot, sourcePaths, pkgJson, label, fail) {
  const connDir = resolveConnDirFromPackageJson(pkgJson)
  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relPosix(absPackageRoot, absPath)
    if (!isConnFileToCheck(rel, connDir)) continue
    const content = await readFile(absPath, 'utf8')
    for (const v of findConnFileRuleViolations(content, rel)) {
      violations++
      fail(formatConnFileViolation(v, label, rel, connDir))
    }
  }
  return violations
}

/**
 * Чи `rel` — це conn-файл, який треба валідувати: під `connDir/`, з JS/TS-розширенням,
 * не `index.*` (який є реекспортним барелем).
 * @param {string} rel відносний шлях у posix-форматі
 * @param {string} connDir каталог conn-файлів (наприклад `src/conn`)
 * @returns {boolean} true, якщо файл потрібно перевірити
 */
function isConnFileToCheck(rel, connDir) {
  if (!isInsideConnDir(rel, connDir)) return false
  if (!isConnFileRulesSourceFile(rel)) return false
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return !base.startsWith('index.')
}

/**
 * Будує повідомлення про конкретне порушення canon-у файла з `connDir/`.
 * @param {{ kind: 'name' | 'default-export' | 'export-name', expectedName?: string, foundNames?: string[] }} v опис порушення
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {string} rel відносний шлях файла
 * @param {string} connDir каталог conn-файлів
 * @returns {string} повний текст повідомлення для `fail(...)`
 */
function formatConnFileViolation(v, label, rel, connDir) {
  if (v.kind === 'name') {
    return (
      `${label}${rel} — назва файла в '${connDir}/' не відповідає канону js-run: ` +
      `'ql-<id>', 'pg-{read|write}[-<id>]', 'mysql-{read|write}[-<id>]' або 'mssql-{read|write}[-<id>]' ` +
      `(kebab-case, [a-z0-9-])`
    )
  }
  if (v.kind === 'default-export') {
    return `${label}${rel} — 'export default' заборонений у '${connDir}/'; зроби іменований експорт`
  }
  const found = v.foundNames?.length ? v.foundNames.join(', ') : '—'
  return (
    `${label}${rel} — очікується іменований експорт 'export const ${v.expectedName} = …' ` +
    `(camelCase від назви файла); знайдено: ${found}`
  )
}

/**
 * Перевіряє правило «CheckEnv» для пакета.
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string[]} sourcePaths абсолютні шляхи до файлів
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість порушень
 */
async function checkProcessEnvUsage(absPackageRoot, sourcePaths, label, fail) {
  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relPosix(absPackageRoot, absPath)
    const content = await readFile(absPath, 'utf8')
    for (const v of findUncheckedProcessEnvInText(content, rel)) {
      violations++
      const message =
        v.kind === 'process-env'
          ? `${label}${rel}:${v.line} — process.env.${v.name}: заміни на env з '@nitra/check-env' (обов'язкова змінна + checkEnv(['${v.name}'])) або з 'node:process' (опційна)`
          : `${label}${rel}:${v.line} — env.${v.name} (з '@nitra/check-env') без checkEnv(['${v.name}']) (або '// @nitra/cursor ignore-next-line checkEnv' попереду)`
      fail(message)
    }
  }
  return violations
}

/**
 * Сканує джерела пакета на паттерн `new Promise(resolve => setTimeout(resolve, ms))`.
 * @param {string} absPackageRoot абсолютний корінь пакета
 * @param {string[]} sourcePaths абсолютні шляхи до файлів
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість порушень
 */
async function checkPromiseSetTimeoutPause(absPackageRoot, sourcePaths, label, fail) {
  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relPosix(absPackageRoot, absPath)
    if (!isPromiseSetTimeoutScanSourceFile(rel)) continue
    const content = await readFile(absPath, 'utf8')
    for (const v of findPromiseSetTimeoutInText(content, rel)) {
      violations++
      fail(
        `${label}${rel}:${v.line} — заміни 'new Promise(r => setTimeout(r, ms))' на 'await setTimeout(ms)' з 'node:timers/promises': ${v.snippet}`
      )
    }
  }
  return violations
}

/**
 * Перевіряє відповідність правилам js-run.mdc для одного workspace-пакета.
 * @param {string} rootDir відносний шлях workspace (не `'.'`)
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @param {(msg: string) => void} passFn успішне повідомлення (як у check-reporter)
 * @returns {Promise<void>} завершується після перевірок цього пакета
 */
async function checkWorkspacePackage(rootDir, ignorePaths, fail, passFn) {
  const label = `[${rootDir}] `
  const absPackageRoot = join(process.cwd(), rootDir)
  const pkgJson = await loadPackageJson(rootDir)

  // Frontend-пакети (vite у devDependencies) виходять за межі js-run:
  // браузерний бандл не має `node:process`, а `process.env.*` бандлер
  // обробляє самостійно. Перевірку process.env / conn-аліасів пропускаємо;
  // bunyan-залежність валідується в Rego (`bun run lint-conftest`).
  if (packageJsonHasViteDevDependency(pkgJson)) {
    passFn(`${label}vite-пакет (frontend) — js-run пропущено (process.env / conn-aliases / OTEL configmap)`)
    return
  }

  await checkBackendJsconfigWhenSrcPresent(rootDir, absPackageRoot, label, fail, passFn)

  const importViolations = await checkBunyanImports(absPackageRoot, ignorePaths, label, fail)
  if (importViolations === 0) {
    passFn(`${label}немає імпортів '@nitra/bunyan' / 'bunyan' у джерелах`)
  }

  const sourcePaths = await collectSourceFiles(absPackageRoot, ignorePaths)

  const connViolations = await checkConnImports(absPackageRoot, sourcePaths, pkgJson, label, fail)
  if (connViolations === 0) {
    const connDir = resolveConnDirFromPackageJson(pkgJson)
    passFn(`${label}імпорти підключень (bun#SQL / mssql / @nitra/graphql-request#GraphQLClient) лише в '${connDir}/'`)
  }

  const connFileViolations = await checkConnFileNamingAndExports(absPackageRoot, sourcePaths, pkgJson, label, fail)
  if (connFileViolations === 0) {
    const connDir = resolveConnDirFromPackageJson(pkgJson)
    passFn(
      `${label}файли в '${connDir}/' дотримують канону js-run: нейминг (ql-/pg-/mysql-/mssql-…) і іменований експорт у camelCase від basename`
    )
  }

  const envViolations = await checkProcessEnvUsage(absPackageRoot, sourcePaths, label, fail)
  if (envViolations === 0) {
    passFn(
      `${label}немає прямого process.env.*; усі env.* з '@nitra/check-env' закриті checkEnv(['…']) (або '// @nitra/cursor ignore-next-line checkEnv')`
    )
  }

  const pauseViolations = await checkPromiseSetTimeoutPause(absPackageRoot, sourcePaths, label, fail)
  if (pauseViolations === 0) {
    passFn(`${label}немає 'new Promise(r => setTimeout(r, ms))' — паузи через 'node:timers/promises'`)
  }

  checkOtelConfigmap(rootDir, passFn)
}

/**
 * Чи має пакет `vite` у `devDependencies` (маркер frontend-пакета — vite/quasar/capacitor SPA).
 * Семантично ідентично `packageJsonLacksViteDevDependency` з `auto-rules.mjs`, але
 * приймає вже розпарсений pkgJson.
 * @param {unknown} pkgJson розпарсений `package.json` пакета (або null)
 * @returns {boolean} true, якщо `vite` присутній у `devDependencies`
 */
function packageJsonHasViteDevDependency(pkgJson) {
  if (!pkgJson || typeof pkgJson !== 'object' || Array.isArray(pkgJson)) return false
  const devDeps = /** @type {Record<string, unknown>} */ (pkgJson).devDependencies
  if (!devDeps || typeof devDeps !== 'object' || Array.isArray(devDeps)) return false
  return Object.hasOwn(devDeps, 'vite')
}

/**
 * Завантажує `package.json` пакета (якщо є). Заборону `@nitra/bunyan` / `bunyan`
 * у dependencies/devDependencies перенесено в Rego (`npm/policy/js_run/package_json/`);
 * `bun run lint-conftest` запускає її по всіх workspace `package.json`. Тут лишилася
 * лише AST-перевірка імпортів.
 * @param {string} rootDir відносний шлях workspace
 * @returns {Promise<unknown>} розпарсений package.json або null
 */
async function loadPackageJson(rootDir) {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  return JSON.parse(await readFile(pkgPath, 'utf8'))
}

/**
 * Перевіряє наявність `k8s/base/configmap.yaml` пакета. Структуру (наявність
 * `OTEL_RESOURCE_ATTRIBUTES` з обов'язковими `service.name=` / `service.namespace=`)
 * перенесено в Rego (`npm/policy/js_run/configmap/`); `bun run lint-conftest`
 * запускає її на всіх `k8s/base/configmap.yaml`.
 * @param {string} rootDir відносний шлях workspace
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {void}
 */
function checkOtelConfigmap(rootDir, passFn) {
  const configmapPath = join(rootDir, 'k8s', 'base', 'configmap.yaml')
  if (!existsSync(configmapPath)) return
  passFn(`${rootDir}/k8s/base/configmap.yaml є (OTEL — bun run lint-conftest → js_run.configmap)`)
}

/**
 * Перевіряє відповідність проєкту правилам js-run.mdc лише для workspace-пакетів (не корінь репо).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const roots = await getMonorepoPackageRootDirs()
  const workspaceRoots = roots.filter(r => r !== '.')

  if (workspaceRoots.length === 0) {
    pass('js-run: немає workspace-пакетів у кореневому package.json — перевірку залежностей і k8s у пакетах пропущено')
    return reporter.getExitCode()
  }

  const ignorePaths = await loadCursorIgnorePaths(process.cwd())
  for (const r of workspaceRoots) {
    await checkWorkspacePackage(r, ignorePaths, fail, pass)
  }

  return reporter.getExitCode()
}
