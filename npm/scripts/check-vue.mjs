/**
 * Знаходить пакети з `vue` у dependencies і перевіряє їх за правилом vue.mdc.
 *
 * Версії Vite та плагінів, vue-macros, auto-import, layouts, вміст `vite.config`;
 * у репозиторії — рекомендацію розширення Vue.volar.
 *
 * Заборонені явні value-імпорти з `vue` у джерелах пакета — сканування `.vue`/`.ts`/`.js` тощо
 * через **oxc-parser** (`module.staticImports`; див. `utils/vue-forbidden-imports.mjs`); дозволені лише type-only та side-effect `import 'vue'`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { pass } from './utils/pass.mjs'
import {
  findForbiddenVueImportsInSourceFile,
  isVueImportScanSourceFile,
  shouldSkipFileForVueImportScan
} from './utils/vue-forbidden-imports.mjs'
import { walkDir } from './utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

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
 * Перевіряє залежності та vite.config одного Vue-пакета.
 * @param {string} rootDir відносний шлях до пакета
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @returns {Promise<void>} завершується після перевірок залежностей, `vite.config` і сканування джерел на імпорти з `vue`
 */
async function checkVuePackage(rootDir, fail) {
  const label = packageLabel(rootDir)
  const prefix = `[${label}] `

  const pkgPath = join(rootDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const deps = pkg.dependencies || {}
  const devDeps = pkg.devDependencies || {}
  const allDeps = { ...deps, ...devDeps }

  if (deps.vue) {
    pass(`${prefix}vue в dependencies: ${deps.vue}`)
  } else {
    fail(`${prefix}vue відсутній в dependencies`)
  }

  if (devDeps.vite) {
    const match = devDeps.vite.match(/(\d+)/)
    if (match && Number(match[1]) >= 8) {
      pass(`${prefix}vite >= 8: ${devDeps.vite}`)
    } else {
      fail(`${prefix}vite має бути >= 8, знайдено: ${devDeps.vite}`)
    }
  } else {
    fail(`${prefix}vite відсутній в devDependencies`)
  }

  if (devDeps['@vitejs/plugin-vue']) {
    pass(`${prefix}@vitejs/plugin-vue: ${devDeps['@vitejs/plugin-vue']}`)
  } else {
    fail(`${prefix}@vitejs/plugin-vue відсутній в devDependencies`)
  }

  if (allDeps['vue-macros']) {
    pass(`${prefix}vue-macros: ${allDeps['vue-macros']}`)
  } else {
    fail(`${prefix}vue-macros відсутній — bun add -d vue-macros`)
  }

  if (allDeps['unplugin-auto-import']) {
    pass(`${prefix}unplugin-auto-import присутній`)
  } else {
    fail(`${prefix}unplugin-auto-import відсутній — bun add -d unplugin-auto-import`)
  }

  if (allDeps['vite-plugin-vue-layouts-next']) {
    pass(`${prefix}vite-plugin-vue-layouts-next присутній`)
  } else {
    fail(`${prefix}vite-plugin-vue-layouts-next відсутній — bun add -d vite-plugin-vue-layouts-next`)
  }

  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(join(rootDir, f)))
  if (viteConfig) {
    const relConfig = join(rootDir, viteConfig)
    const content = await readFile(relConfig, 'utf8')
    if (content.includes('VueMacros')) {
      pass(`${prefix}${viteConfig} використовує VueMacros`)
    } else {
      fail(`${prefix}${viteConfig} не містить VueMacros`)
    }
    if (content.includes('AutoImport')) {
      pass(`${prefix}${viteConfig} використовує AutoImport`)
    } else {
      fail(`${prefix}${viteConfig} не містить AutoImport`)
    }
  } else {
    fail(`${prefix}немає vite.config.js|ts|mjs у каталозі пакета`)
  }

  const absPackageRoot = join(process.cwd(), rootDir)
  /** @type {string[]} */
  const sourcePaths = []
  await walkDir(absPackageRoot, absPath => {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    if (shouldSkipFileForVueImportScan(rel) || !isVueImportScanSourceFile(rel)) {
      return
    }
    sourcePaths.push(absPath)
  })

  let importViolations = 0
  for (const absPath of sourcePaths) {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    const hits = findForbiddenVueImportsInSourceFile(content, rel)
    for (const v of hits) {
      importViolations++
      fail(`${prefix}${rel}:${v.line} — прибери явний value-імпорт з 'vue' (unplugin-auto-import): ${v.snippet}`)
    }
  }
  if (importViolations === 0) {
    pass(
      `${prefix}немає заборонених value-імпортів з 'vue' у джерелах (проскановано ${ukFilesCountPhrase(sourcePaths.length)})`
    )
  }
}

/**
 * Перевіряє відповідність проєкту правилам vue.mdc (корінь і всі workspace-пакети з `vue` у dependencies).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

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
    return exitCode
  }

  for (const r of vueRoots) {
    await checkVuePackage(r, fail)
  }

  return exitCode
}
