/**
 * Для кожного workspace-пакета перевіряє правило js-pino.mdc.
 *
 * Заборона `@nitra/bunyan` / `bunyan` як у залежностях `package.json`, так і в коді
 * (`import` / `require` / динамічний `import()`); наявність `OTEL_RESOURCE_ATTRIBUTES`
 * у `k8s/base/configmap.yaml`, якщо такий файл існує.
 *
 * Перевірка відповідності імені ConfigMap імені Deployment — у `check-k8s.mjs` (k8s.mdc).
 *
 * Імпорти в джерелах сканує AST через `oxc-parser` (див. `utils/bunyan-imports.mjs`),
 * щоб виявити випадки на кшталт `import log from '@nitra/bunyan'`, які лишаються в коді
 * після підміни залежності.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  findBunyanImportsInText,
  isBunyanScanSourceFile,
  shouldSkipFileForBunyanScan
} from './utils/bunyan-imports.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { walkDir } from './utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

/**
 * Сканує джерела пакета на заборонені імпорти `@nitra/bunyan` / `bunyan`.
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string} label префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<number>} кількість знайдених порушень
 */
async function checkBunyanImports(absPackageRoot, label, fail) {
  /** @type {string[]} */
  const sourcePaths = []
  await walkDir(absPackageRoot, absPath => {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    if (!shouldSkipFileForBunyanScan(rel) && isBunyanScanSourceFile(rel)) {
      sourcePaths.push(absPath)
    }
  })

  let violations = 0
  for (const absPath of sourcePaths) {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    for (const v of findBunyanImportsInText(content, rel)) {
      violations++
      fail(`${label}${rel}:${v.line} — заміни '${v.module}' на '@nitra/pino': ${v.snippet}`)
    }
  }
  return violations
}

/**
 * Перевіряє відповідність правилам js-pino.mdc для одного workspace-пакета.
 * @param {string} rootDir відносний шлях workspace (не `'.'`)
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @param {(msg: string) => void} passFn успішне повідомлення (як у check-reporter)
 * @returns {Promise<void>} завершується після перевірок цього пакета
 */
async function checkWorkspacePackage(rootDir, fail, passFn) {
  const label = `[${rootDir}] `
  const pkgPath = join(rootDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (allDeps['@nitra/bunyan']) {
      fail(`${label}@nitra/bunyan знайдено — замінити на @nitra/pino`)
    }
    if (allDeps.bunyan) {
      fail(`${label}bunyan знайдено — замінити на @nitra/pino`)
    }
  }

  const importViolations = await checkBunyanImports(join(process.cwd(), rootDir), label, fail)
  if (importViolations === 0) {
    passFn(`${label}немає імпортів '@nitra/bunyan' / 'bunyan' у джерелах`)
  }

  const configmapPath = join(rootDir, 'k8s', 'base', 'configmap.yaml')
  if (existsSync(configmapPath)) {
    const content = await readFile(configmapPath, 'utf8')
    if (content.includes('OTEL_RESOURCE_ATTRIBUTES')) {
      passFn(`${label}k8s/base/configmap.yaml містить OTEL_RESOURCE_ATTRIBUTES`)
      if (content.includes('service.name=') && content.includes('service.namespace=')) {
        passFn(`${label}OTEL_RESOURCE_ATTRIBUTES містить service.name та service.namespace`)
      } else {
        fail(`${label}OTEL_RESOURCE_ATTRIBUTES має містити service.name=<name>,service.namespace=<namespace>`)
      }
    } else {
      fail(`${label}k8s/base/configmap.yaml не містить OTEL_RESOURCE_ATTRIBUTES`)
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам js-pino.mdc лише для workspace-пакетів (не корінь репо).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const roots = await getMonorepoPackageRootDirs()
  const workspaceRoots = roots.filter(r => r !== '.')

  if (workspaceRoots.length === 0) {
    pass('js-pino: немає workspace-пакетів у кореневому package.json — перевірку залежностей і k8s у пакетах пропущено')
    return reporter.getExitCode()
  }

  for (const r of workspaceRoots) {
    await checkWorkspacePackage(r, fail, pass)
  }

  return reporter.getExitCode()
}
