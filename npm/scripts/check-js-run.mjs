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
 *  - «process.env / CheckEnv»: пряме `process.env.X` має бути замінено на `env` —
 *    з `@nitra/check-env` (для обов'язкових змінних, із `checkEnv([...])`) або з
 *    `node:process` (для опційних). Коли `env` імпортовано з `@nitra/check-env`,
 *    кожен `env.X` має бути закритий літеральним викликом `checkEnv(['X', ...])`
 *    у тому ж файлі або коментарем `// \@nitra/cursor ignore-next-line checkEnv`
 *    на попередньому рядку (див. `utils/check-env-scan.mjs`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  findBunyanImportsInText,
  isBunyanScanSourceFile,
  shouldSkipFileForBunyanScan
} from './utils/bunyan-imports.mjs'
import { findUncheckedProcessEnvInText, isCheckEnvScanSourceFile } from './utils/check-env-scan.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  findConnFactoryImportsInText,
  isConnImportsScanSourceFile,
  isInsideConnDir,
  resolveConnDirFromPackageJson
} from './utils/conn-imports-scan.mjs'
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

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
 * Перевіряє відповідність правилам js-run.mdc для одного workspace-пакета.
 * @param {string} rootDir відносний шлях workspace (не `'.'`)
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @param {(msg: string) => void} passFn успішне повідомлення (як у check-reporter)
 * @returns {Promise<void>} завершується після перевірок цього пакета
 */
async function checkWorkspacePackage(rootDir, ignorePaths, fail, passFn) {
  const label = `[${rootDir}] `
  const absPackageRoot = join(process.cwd(), rootDir)
  const pkgJson = await loadPackageJsonAndCheckBunyanDeps(rootDir, label, fail)

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

  const envViolations = await checkProcessEnvUsage(absPackageRoot, sourcePaths, label, fail)
  if (envViolations === 0) {
    passFn(
      `${label}немає прямого process.env.*; усі env.* з '@nitra/check-env' закриті checkEnv(['…']) (або '// @nitra/cursor ignore-next-line checkEnv')`
    )
  }

  await checkOtelConfigmap(rootDir, label, fail, passFn)
}

/**
 * Завантажує `package.json` пакета (якщо є) і реєструє порушення для bunyan-залежностей.
 * @param {string} rootDir відносний шлях workspace
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<unknown>} розпарсений package.json або null
 */
async function loadPackageJsonAndCheckBunyanDeps(rootDir, label, fail) {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkgJson = JSON.parse(await readFile(pkgPath, 'utf8'))
  const deps = /** @type {Record<string, unknown>} */ (pkgJson).dependencies
  const devDeps = /** @type {Record<string, unknown>} */ (pkgJson).devDependencies
  const allDeps = { ...deps, ...devDeps }
  if (allDeps['@nitra/bunyan']) {
    fail(`${label}@nitra/bunyan знайдено — замінити на @nitra/pino`)
  }
  if (allDeps.bunyan) {
    fail(`${label}bunyan знайдено — замінити на @nitra/pino`)
  }
  return pkgJson
}

/**
 * Перевіряє вміст `k8s/base/configmap.yaml` пакета на наявність OTEL_RESOURCE_ATTRIBUTES
 * з обов'язковими `service.name=` та `service.namespace=` всередині.
 * @param {string} rootDir відносний шлях workspace
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @param {(msg: string) => void} passFn успішне повідомлення
 * @returns {Promise<void>} завершується після перевірки configmap
 */
async function checkOtelConfigmap(rootDir, label, fail, passFn) {
  const configmapPath = join(rootDir, 'k8s', 'base', 'configmap.yaml')
  if (!existsSync(configmapPath)) return
  const content = await readFile(configmapPath, 'utf8')
  if (!content.includes('OTEL_RESOURCE_ATTRIBUTES')) {
    fail(`${label}k8s/base/configmap.yaml не містить OTEL_RESOURCE_ATTRIBUTES`)
    return
  }
  passFn(`${label}k8s/base/configmap.yaml містить OTEL_RESOURCE_ATTRIBUTES`)
  if (content.includes('service.name=') && content.includes('service.namespace=')) {
    passFn(`${label}OTEL_RESOURCE_ATTRIBUTES містить service.name та service.namespace`)
  } else {
    fail(`${label}OTEL_RESOURCE_ATTRIBUTES має містити service.name=<name>,service.namespace=<namespace>`)
  }
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
