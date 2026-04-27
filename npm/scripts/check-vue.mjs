/**
 * Знаходить пакети з `vue` у dependencies і перевіряє їх за правилом vue.mdc.
 *
 * Версії Vite та плагінів, vue-macros, auto-import, layouts, вміст `vite.config`;
 * у репозиторії — рекомендацію розширення Vue.volar.
 *
 * У `vite.config.*` заборонено використовувати `process.env.npm_lifecycle_event` (Bun не підставляє його як npm),
 * натомість використовуй `mode` з `defineConfig(({ mode }) => ...)`.
 *
 * Заборонені явні value-імпорти з `vue` у джерелах пакета — сканування `.vue`/`.ts`/`.js` тощо
 * через **oxc-parser** (`module.staticImports`; див. `utils/vue-forbidden-imports.mjs`); дозволені лише type-only та side-effect `import 'vue'`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  findForbiddenVueImportsInSourceFile,
  isVueImportScanSourceFile,
  shouldSkipFileForVueImportScan
} from './utils/vue-forbidden-imports.mjs'
import { walkDir } from './utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

const MAJOR_VERSION_RE = /(\d+)/

/**
 * Формує зрозумілий для людини підпис пакета для повідомлень перевірки.
 * @param {string} rootDir відносний шлях (`'.'` або `site` тощо)
 * @returns {string} підпис для логів перевірки
 */
function packageLabel(rootDir) {
  return rootDir === '.' ? 'корінь' : rootDir
}

/**
 * Текст кількості файлів українською (1 файл, 2 файли, 5 файлів, 11 файлів).
 * @param {number} n невід’ємна кількість
 * @returns {string} фраза виду «N файл» / «N файли» / «N файлів»
 */
function ukFilesCountPhrase(n) {
  const m100 = n % 100
  if (m100 >= 11 && m100 <= 14) {
    return `${n} файлів`
  }
  const m10 = n % 10
  if (m10 === 1) {
    return `${n} файл`
  }
  if (m10 >= 2 && m10 <= 4) {
    return `${n} файли`
  }
  return `${n} файлів`
}

/**
 * Перевіряє наявність залежності в об'єкті deps.
 * @param {Record<string,string>} deps об'єкт залежностей
 * @param {string} name ім'я пакета
 * @param {string} prefix префікс повідомлення
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @param {string} hint підказка при відсутності
 */
function checkRequiredDep(deps, name, prefix, passFn, fail, hint = `${name} відсутній`) {
  if (deps[name]) {
    passFn(`${prefix}${name}: ${deps[name]}`)
  } else {
    fail(`${prefix}${hint}`)
  }
}

/**
 * Перевіряє версію vite у devDependencies.
 * @param {Record<string,string>} devDeps devDependencies з package.json
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
function checkViteVersion(devDeps, prefix, passFn, fail) {
  const v = devDeps.vite
  if (!v) {
    fail(`${prefix}vite відсутній в devDependencies`)
    return
  }
  const match = v.match(MAJOR_VERSION_RE)
  if (match && Number(match[1]) >= 8) {
    passFn(`${prefix}vite >= 8: ${v}`)
  } else {
    fail(`${prefix}vite має бути >= 8, знайдено: ${v}`)
  }
}

/**
 * Перевіряє vite.config на наявність VueMacros і AutoImport.
 * @param {string} rootDir параметр rootDir
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkViteConfig(rootDir, prefix, passFn, fail) {
  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(join(rootDir, f)))
  if (!viteConfig) {
    fail(`${prefix}немає vite.config.js|ts|mjs у каталозі пакета`)
    return
  }
  const content = await readFile(join(rootDir, viteConfig), 'utf8')
  const checks = [
    { token: 'VueMacros', ok: `${viteConfig} використовує VueMacros`, err: `${viteConfig} не містить VueMacros` },
    { token: 'AutoImport', ok: `${viteConfig} використовує AutoImport`, err: `${viteConfig} не містить AutoImport` }
  ]
  for (const { token, ok, err } of checks) {
    if (content.includes(token)) {
      passFn(`${prefix}${ok}`)
    } else {
      fail(`${prefix}${err}`)
    }
  }

  if (content.includes('process.env.npm_lifecycle_event')) {
    fail(
      `${prefix}${viteConfig} використовує process.env.npm_lifecycle_event — у Bun це не працює. ` +
        `Перенеси логіку на mode (defineConfig(({ mode }) => ...)) і передавай mode в helper-функції.`
    )
  }
}

/**
 * Сканує джерела пакета на заборонені value-імпорти з vue.
 * @param {string} rootDir параметр rootDir
 * @param {string} absPackageRoot параметр absPackageRoot
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkVueImportViolations(rootDir, absPackageRoot, prefix, passFn, fail) {
  /** @type {string[]} */
  const sourcePaths = []
  await walkDir(absPackageRoot, absPath => {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    if (!shouldSkipFileForVueImportScan(rel) && isVueImportScanSourceFile(rel)) {
      sourcePaths.push(absPath)
    }
  })

  let importViolations = 0
  for (const absPath of sourcePaths) {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    for (const v of findForbiddenVueImportsInSourceFile(content, rel)) {
      importViolations++
      fail(`${prefix}${rel}:${v.line} — прибери явний value-імпорт з 'vue' (unplugin-auto-import): ${v.snippet}`)
    }
  }
  if (importViolations === 0) {
    passFn(
      `${prefix}немає заборонених value-імпортів з 'vue' у джерелах (проскановано ${ukFilesCountPhrase(sourcePaths.length)})`
    )
  }
}

/**
 * Перевіряє залежності та vite.config одного Vue-пакета.
 * @param {string} rootDir відносний шлях до пакета
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @param {(msg: string) => void} passFn успішне повідомлення (як у check-reporter)
 * @returns {Promise<void>} завершується після перевірок залежностей, `vite.config` і сканування джерел на імпорти з `vue`
 */
async function checkVuePackage(rootDir, fail, passFn) {
  const prefix = `[${packageLabel(rootDir)}] `
  const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
  const deps = pkg.dependencies || {}
  const devDeps = pkg.devDependencies || {}
  const allDeps = { ...deps, ...devDeps }

  checkRequiredDep(deps, 'vue', prefix, passFn, fail, 'vue відсутній в dependencies')
  checkViteVersion(devDeps, prefix, passFn, fail)
  checkRequiredDep(
    devDeps,
    '@vitejs/plugin-vue',
    prefix,
    passFn,
    fail,
    '@vitejs/plugin-vue відсутній в devDependencies'
  )
  checkRequiredDep(allDeps, 'vue-macros', prefix, passFn, fail, 'vue-macros відсутній — bun add -d vue-macros')
  checkRequiredDep(
    allDeps,
    'unplugin-auto-import',
    prefix,
    passFn,
    fail,
    'unplugin-auto-import відсутній — bun add -d unplugin-auto-import'
  )
  checkRequiredDep(
    allDeps,
    'vite-plugin-vue-layouts-next',
    prefix,
    passFn,
    fail,
    'vite-plugin-vue-layouts-next відсутній — bun add -d vite-plugin-vue-layouts-next'
  )

  await checkViteConfig(rootDir, prefix, passFn, fail)
  await checkVueImportViolations(rootDir, join(process.cwd(), rootDir), prefix, passFn, fail)
}

/**
 * Перевіряє відповідність проєкту правилам vue.mdc (корінь і всі workspace-пакети з `vue` у dependencies).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('Vue.volar')) {
      pass('extensions.json містить Vue.volar')
    } else {
      fail('extensions.json не містить Vue.volar — додай до recommendations')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  const roots = await getMonorepoPackageRootDirs()
  /** @type {string[]} */
  const vueRoots = []
  for (const r of roots) {
    const p = join(r, 'package.json')
    if (existsSync(p)) {
      const pkg = JSON.parse(await readFile(p, 'utf8'))
      if (pkg.dependencies?.vue) vueRoots.push(r)
    }
  }

  if (vueRoots.length === 0) {
    fail('vue не знайдено в dependencies жодного пакета (корінь репо та каталоги з кореневого workspaces)')
    return reporter.getExitCode()
  }

  for (const r of vueRoots) {
    await checkVuePackage(r, fail, pass)
  }

  return reporter.getExitCode()
}
