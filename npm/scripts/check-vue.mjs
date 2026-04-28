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
const ESBUILD_RE = /\besbuild\b/

/**
 * Визначає, чи можна сканувати файл як текст на згадки `esbuild`.
 * @param {string} relPosix відносний шлях у posix-форматі
 * @returns {boolean} true якщо файл варто перевірити
 */
function isEsbuildScanFile(relPosix) {
  if (
    relPosix.startsWith('node_modules/') ||
    relPosix.startsWith('dist/') ||
    relPosix.startsWith('build/') ||
    relPosix.startsWith('coverage/') ||
    relPosix.startsWith('.git/')
  ) {
    return false
  }

  const lower = relPosix.toLowerCase()
  if (
    lower === 'bun.lock' ||
    lower === 'bun.lockb' ||
    lower === 'package-lock.json' ||
    lower === 'yarn.lock' ||
    lower === 'pnpm-lock.yaml'
  ) {
    return false
  }

  return (
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.vue') ||
    lower.endsWith('.json') ||
    lower.endsWith('.jsonc') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.md') ||
    lower.endsWith('.mdc')
  )
}

/**
 * Збирає `esbuild`-матчі по рядках одного файлу, поки буфер не досягне ліміту.
 * @param {string} rel relative path
 * @param {string} content вміст файлу
 * @param {{ rel: string; line: number; snippet: string }[]} matches буфер для збору матчів
 * @param {number} maxMatches максимум елементів у буфері
 */
function appendEsbuildLineMatches(rel, content, matches, maxMatches) {
  const lines = content.split('\n')
  for (const [i, line] of lines.entries()) {
    if (matches.length >= maxMatches) return
    if (ESBUILD_RE.test(line)) {
      matches.push({ rel, line: i + 1, snippet: line.trim() })
    }
  }
}

/**
 * Перебирає вибрані файли пакета і збирає до `maxMatches` згадок `esbuild`.
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {{ rel: string }[]} files перелік відносних шляхів
 * @param {number} maxMatches максимум знайдених матчів
 * @returns {Promise<{ rel: string; line: number; snippet: string }[]>} зібрані матчі
 */
async function collectEsbuildMatchesInFiles(absPackageRoot, files, maxMatches) {
  /** @type {{ rel: string; line: number; snippet: string }[]} */
  const matches = []
  for (const { rel } of files) {
    if (matches.length >= maxMatches) break
    const content = await readFile(join(absPackageRoot, rel), 'utf8')
    if (!ESBUILD_RE.test(content)) continue
    appendEsbuildLineMatches(rel, content, matches, maxMatches)
  }
  return matches
}

/**
 * Сканує дерево пакета на згадки `esbuild` і підказує заміну на `rolldown`.
 * @param {string} rootDir відносний шлях до пакета
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkEsbuildMentions(rootDir, absPackageRoot, prefix, passFn, fail) {
  /** @type {{ rel: string }[]} */
  const candidates = []
  await walkDir(absPackageRoot, absPath => {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    if (!isEsbuildScanFile(rel)) return
    candidates.push({ rel })
  })

  const maxMatches = 30
  const matches = await collectEsbuildMatchesInFiles(absPackageRoot, candidates, maxMatches)

  if (matches.length === 0) {
    passFn(`${prefix}немає згадок 'esbuild' у джерелах пакета (очікується rolldown)`)
    return
  }

  for (const m of matches) {
    fail(`${prefix}${m.rel}:${m.line} — знайдено 'esbuild'. Замінити на 'rolldown'. Фрагмент: ${m.snippet}`)
  }
  if (matches.length >= maxMatches) {
    fail(`${prefix}показано перші ${maxMatches} збігів 'esbuild' (замінити на 'rolldown')`)
  }
}

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
  if (ESBUILD_RE.test(content)) {
    fail(`${prefix}${viteConfig} містить 'esbuild' — заміни на 'rolldown'`)
  }
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

  if (allDeps.esbuild) {
    fail(`${prefix}esbuild заборонено (знайдено: ${allDeps.esbuild}). Замінити на rolldown та прибрати esbuild.`)
  }

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
  await checkEsbuildMentions(rootDir, join(process.cwd(), rootDir), prefix, passFn, fail)
}

/**
 * Збирає корені пакетів, у яких у `dependencies` є `vue`.
 * @param {string[]} roots усі корені пакетів monorepo
 * @returns {Promise<string[]>} перелік пакетів з vue у dependencies
 */
async function collectVueRoots(roots) {
  /** @type {string[]} */
  const vueRoots = []
  for (const r of roots) {
    const p = join(r, 'package.json')
    if (!existsSync(p)) continue
    const pkg = JSON.parse(await readFile(p, 'utf8'))
    if (pkg.dependencies?.vue) vueRoots.push(r)
  }
  return vueRoots
}

/**
 * Перевіряє наявність рекомендації `Vue.volar` у `.vscode/extensions.json`.
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {Promise<void>}
 */
async function checkVueVolarRecommendation(pass, fail) {
  if (!existsSync('.vscode/extensions.json')) {
    fail('.vscode/extensions.json не існує (для Vue-проєкту потрібна рекомендація Vue.volar)')
    return
  }
  const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
  if (ext.recommendations?.includes('Vue.volar')) {
    pass('extensions.json містить Vue.volar')
  } else {
    fail('extensions.json не містить Vue.volar — додай до recommendations')
  }
}

/**
 * Перевіряє відповідність проєкту правилам vue.mdc (корінь і всі workspace-пакети з `vue` у dependencies).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const roots = await getMonorepoPackageRootDirs()
  const vueRoots = await collectVueRoots(roots)

  if (vueRoots.length === 0) {
    pass('Vue.volar: пропущено (у repo немає пакетів з vue у dependencies)')
    pass('vue не знайдено в dependencies жодного пакета (перевірка vue пропущена)')
    return reporter.getExitCode()
  }

  await checkVueVolarRecommendation(pass, fail)

  for (const r of vueRoots) {
    await checkVuePackage(r, fail, pass)
  }

  return reporter.getExitCode()
}
