/** @see ./docs/packages.md */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import {
  findForbiddenNodeImportsInVueFile,
  findForbiddenVueImportsInSourceFile,
  isVueImportScanSourceFile,
  shouldSkipFileForVueImportScan
} from '../lib/vue-forbidden-imports.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'
import { getMonorepoPackageRootDirs } from '@7n/rules/scripts/lib/workspaces.mjs'

const ESBUILD_RE = /\besbuild\b/

/** Регулярний вираз для triple-slash `reference types="vite/client"` у `src/vite-env.d.ts`. */
const VITE_CLIENT_REFERENCE_RE = /\/\/\/\s*<reference\s+types\s*=\s*["']vite\/client["']\s*\/>/

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
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkEsbuildMentions(rootDir, absPackageRoot, ignorePaths, prefix, passFn, fail) {
  /** @type {{ rel: string }[]} */
  const candidates = []
  await walkDir(
    absPackageRoot,
    absPath => {
      const rel = relative(absPackageRoot, absPath).split('\\').join('/')
      if (!isEsbuildScanFile(rel)) return
      candidates.push({ rel })
    },
    ignorePaths
  )

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
 * Перевіряє `src/vite-env.d.ts` і наявність `jsconfig.json` для підтягування типів асетів Vite у IDE.
 * @param {string} rootDir відносний шлях до кореня пакета
 * @param {string} prefix префікс повідомлень
 * @param {(msg: string) => void} passFn успіх
 * @param {(msg: string) => void} fail помилка
 * @returns {Promise<void>}
 * @param {string} cwd корінь репозиторію
 */
async function checkViteClientEnvAndEditorConfig(rootDir, prefix, passFn, fail, cwd) {
  const envAbs = join(cwd, rootDir, 'src/vite-env.d.ts')
  if (!existsSync(envAbs)) {
    fail(
      `${prefix}немає src/vite-env.d.ts — додай файл з рядком /// <reference types="vite/client" /> ` +
        `(інакше TS/Volar не бачать типів для імпортів асетів: png, avif, css як URL).`
    )
    return
  }
  const envContent = await readFile(envAbs, 'utf8')
  if (!VITE_CLIENT_REFERENCE_RE.test(envContent)) {
    fail(
      `${prefix}src/vite-env.d.ts має містити /// <reference types="vite/client" /> ` +
        `(без цього імпорти статичних файлів у .vue дають «Cannot find module … type declarations»).`
    )
    return
  }
  passFn(`${prefix}src/vite-env.d.ts посилається на vite/client`)

  if (!existsSync(join(cwd, rootDir, 'jsconfig.json'))) {
    fail(
      `${prefix}немає jsconfig.json у корені пакета — додай файл з "include": ["src/**/*"] тощо, ` +
        `щоб IDE підхопила vite-env.d.ts і .vue.`
    )
    return
  }
  passFn(`${prefix}jsconfig.json присутній`)
}

/**
 * Чи є пакет бібліотекою компонентів Vue — `vue` оголошено в `peerDependencies`.
 *
 * Такі пакети споживаються Vite-проєктами як залежність; їхні власні джерела **не** проходять
 * через `unplugin-auto-import` споживача (auto-import резолвиться лише в коді самого додатка, не в
 * `node_modules`). Тому в бібліотеці компонентів явні `import { … } from 'vue'` обовʼязкові, і правило
 * авто-імпорту (заборона value-імпортів з `'vue'`) до неї **не** застосовується.
 * @param {{ peerDependencies?: Record<string, string> }} pkg розпарсений package.json
 * @returns {boolean} true, якщо `vue` присутній у `peerDependencies`
 */
export function isVueComponentLibraryPkg(pkg) {
  return Boolean(pkg?.peerDependencies?.vue)
}

/**
 * Витягує текст аргументів першого виклику `AutoImport(` з vite.config зі збалансованими дужками.
 * Повертає `null`, якщо виклик не знайдено або дужки не збалансовані (тоді перевірка `'vue'`
 * у списку `imports` пропускається — інші чек-сигнали все одно спрацюють).
 * @param {string} content повний текст vite.config
 * @returns {string | null} текст усередині `AutoImport(...)` без зовнішніх дужок, або `null`
 */
function extractAutoImportCallArgs(content) {
  const marker = 'AutoImport('
  const idx = content.indexOf(marker)
  if (idx === -1) return null
  const start = idx + marker.length
  let depth = 1
  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return content.slice(start, i)
    }
  }
  return null
}

/**
 * Чи передано `'vue'` (або `"vue"`) як рядковий елемент у `imports` всередині виклику `AutoImport(...)`.
 * Без auto-import-ів `vue` забороняти явні value-імпорти `from 'vue'` небезпечно — їх видалення
 * зламає код, бо `ref` / `createApp` тощо більше нікому надати.
 * @param {string} content повний текст vite.config
 * @returns {boolean} true, якщо `AutoImport({ imports: [..., 'vue', ...] })` сконфігуровано
 */
function viteConfigHasVueInAutoImports(content) {
  const args = extractAutoImportCallArgs(content)
  if (args === null) return false
  return args.includes("'vue'") || args.includes('"vue"')
}

/**
 * Перевіряє vite.config на наявність VueMacros і AutoImport.
 * @param {string} rootDir параметр rootDir
 * @param {boolean} isComponentLibrary чи це бібліотека компонентів (vue у peerDependencies) — тоді auto-import не застосовується
 * @param {string} prefix параметр prefix
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<{ hasVueAutoImport: boolean }>} ознака успішно сконфігурованого vue-auto-import (для checkVueImportViolations)
 * @param {string} cwd корінь репозиторію
 */
async function checkViteConfig(rootDir, isComponentLibrary, prefix, passFn, fail, cwd) {
  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(join(cwd, rootDir, f)))
  if (!viteConfig) {
    fail(`${prefix}немає vite.config.js|ts|mjs у каталозі пакета`)
    return { hasVueAutoImport: false }
  }
  const content = await readFile(join(cwd, rootDir, viteConfig), 'utf8')
  if (ESBUILD_RE.test(content)) {
    fail(`${prefix}${viteConfig} містить 'esbuild' — заміни на 'rolldown'`)
  }
  if (!isComponentLibrary && !content.includes('lightningcss')) {
    fail(
      `${prefix}${viteConfig} не містить css: { transformer: 'lightningcss' } — додай у vite.config і встанови lightningcss у devDependencies (vue.mdc)`
    )
  }
  // VueMacros + AutoImport (і 'vue' у його imports) — інструментарій auto-import Vite-додатка;
  // бібліотека компонентів (vue у peerDependencies) споживається готовою і не потребує цього стеку.
  // npm_lifecycle_event (Bun-compat) перевіряємо нижче незалежно — це не auto-import.
  const hasVueAutoImport = viteConfigHasVueInAutoImports(content)
  if (isComponentLibrary) {
    passFn(
      `${prefix}${viteConfig}: бібліотека компонентів (vue у peerDependencies) — VueMacros/AutoImport не вимагаються`
    )
  } else {
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

    if (content.includes('AutoImport(')) {
      if (hasVueAutoImport) {
        passFn(`${prefix}${viteConfig}: AutoImport({ imports: [..., 'vue', ...] }) — value-імпорти з 'vue' покриті`)
      } else {
        fail(
          `${prefix}${viteConfig}: AutoImport не містить 'vue' у imports — додай 'vue' (інакше прибирати ` +
            `value-імпорти на кшталт \`import { ref } from 'vue'\` небезпечно: ref/createApp тощо нікому буде надати)`
        )
      }
    }
  }

  if (content.includes('process.env.npm_lifecycle_event')) {
    fail(
      `${prefix}${viteConfig} використовує process.env.npm_lifecycle_event — у Bun це не працює. ` +
        `Перенеси логіку на mode (defineConfig(({ mode }) => ...)) і передавай mode в helper-функції.`
    )
  }

  return { hasVueAutoImport }
}

/**
 * Сканує `.vue` SFC пакета на заборонені імпорти Node-нативних модулів
 * (`node:*` префікс або bare-ім’я вбудованого модуля Node).
 * @param {string} rootDir відносний шлях до пакета
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string[]} ignorePaths шляхи, які треба пропускати при обході
 * @param {string} prefix префікс повідомлень
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkVueNodeImportViolations(rootDir, absPackageRoot, ignorePaths, prefix, passFn, fail) {
  /** @type {string[]} */
  const vuePaths = []
  await walkDir(
    absPackageRoot,
    absPath => {
      const rel = relative(absPackageRoot, absPath).split('\\').join('/')
      if (!shouldSkipFileForVueImportScan(rel) && rel.endsWith('.vue')) {
        vuePaths.push(absPath)
      }
    },
    ignorePaths
  )

  let nodeImportViolations = 0
  for (const absPath of vuePaths) {
    const rel = relative(absPackageRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    for (const v of findForbiddenNodeImportsInVueFile(content, rel)) {
      nodeImportViolations++
      fail(
        `${prefix}${rel}:${v.line} — імпорт Node-нативного модуля '${v.specifier}' у .vue заборонено ` +
          `(SFC виконується в браузері, Node API недоступне). Винеси логіку у server-side утіліту. Фрагмент: ${v.snippet}`
      )
    }
  }
  if (nodeImportViolations === 0) {
    passFn(`${prefix}немає імпортів Node-нативних модулів у .vue (проскановано ${ukFilesCountPhrase(vuePaths.length)})`)
  }
}

/**
 * Сканує джерела пакета на заборонені value-імпорти з vue.
 *
 * Якщо `unplugin-auto-import` не сконфігурований на `'vue'` у `vite.config`, явні value-імпорти
 * формально не заборонені — їх видалення зламає код. У цьому випадку перевірка пропускається,
 * а fail про відсутній `'vue'` у `AutoImport.imports` уже зареєстровано в `checkViteConfig`.
 * @param {string} rootDir відносний шлях до пакета
 * @param {string} absPackageRoot абсолютний шлях до кореня пакета
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {boolean} isComponentLibrary чи це бібліотека компонентів (vue у peerDependencies) — її джерела не проходять auto-import
 * @param {boolean} hasVueAutoImport чи `AutoImport({ imports: [..., 'vue', ...] })` сконфігуровано
 * @param {string} prefix префікс повідомлення `[<pkg>] `
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkVueImportViolations(
  rootDir,
  absPackageRoot,
  ignorePaths,
  isComponentLibrary,
  hasVueAutoImport,
  prefix,
  passFn,
  fail
) {
  if (isComponentLibrary) {
    passFn(
      `${prefix}бібліотека компонентів (vue у peerDependencies) — явні value-імпорти з 'vue' дозволені ` +
        `(джерела не проходять через unplugin-auto-import споживача)`
    )
    return
  }
  if (!hasVueAutoImport) {
    passFn(`${prefix}value-імпорти з 'vue' не заборонені — спершу додай 'vue' до AutoImport.imports у vite.config`)
    return
  }
  /** @type {string[]} */
  const sourcePaths = []
  await walkDir(
    absPackageRoot,
    absPath => {
      const rel = relative(absPackageRoot, absPath).split('\\').join('/')
      if (!shouldSkipFileForVueImportScan(rel) && isVueImportScanSourceFile(rel)) {
        sourcePaths.push(absPath)
      }
    },
    ignorePaths
  )

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
 * @param {boolean} isComponentLibrary чи це бібліотека компонентів (vue у peerDependencies) — auto-import не застосовується
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @param {(msg: string) => void} passFn успішне повідомлення (як у check-reporter)
 * @returns {Promise<void>} завершується після перевірок залежностей, `vite.config` і сканування джерел на імпорти з `vue`
 * @param {string} cwd корінь репозиторію
 */
async function checkVuePackage(rootDir, isComponentLibrary, ignorePaths, fail, passFn, cwd) {
  const prefix = `[${packageLabel(rootDir)}] `
  passFn(`${prefix}package.json залежності перевіряє npx @7n/rules fix → vue.package_json`)

  await checkViteClientEnvAndEditorConfig(rootDir, prefix, passFn, fail, cwd)

  const { hasVueAutoImport } = await checkViteConfig(rootDir, isComponentLibrary, prefix, passFn, fail, cwd)
  await checkVueImportViolations(
    rootDir,
    join(cwd, rootDir),
    ignorePaths,
    isComponentLibrary,
    hasVueAutoImport,
    prefix,
    passFn,
    fail
  )
  await checkVueNodeImportViolations(rootDir, join(cwd, rootDir), ignorePaths, prefix, passFn, fail)
  await checkEsbuildMentions(rootDir, join(cwd, rootDir), ignorePaths, prefix, passFn, fail)
}

/**
 * Збирає корені пакетів, у яких у `dependencies` є `vue`, із ознакою «бібліотека компонентів».
 *
 * Пакети, де `vue` лише в `peerDependencies` (без `dependencies`), — це бібліотеки компонентів, які
 * споживаються Vite-додатками; вони не є самостійними Vite-проєктами, тож app-перевірки (vite-env,
 * VueMacros тощо) до них не застосовуються — їх не збираємо. Якщо ж пакет має `vue` і в
 * `dependencies` (повноцінний проєкт), і в `peerDependencies` — позначаємо `isComponentLibrary`,
 * щоб вимкнути саме правило auto-import (його джерела не проходять через unplugin-auto-import споживача).
 * @param {string[]} roots усі корені пакетів monorepo
 * @returns {Promise<Array<{ rootDir: string, isComponentLibrary: boolean }>>} пакети з vue у dependencies
 * @param {string} cwd корінь репозиторію
 */
async function collectVueRoots(roots, cwd) {
  /** @type {Array<{ rootDir: string, isComponentLibrary: boolean }>} */
  const vueRoots = []
  for (const r of roots) {
    const p = join(cwd, r, 'package.json')
    if (!existsSync(p)) continue
    const pkg = JSON.parse(await readFile(p, 'utf8'))
    if (pkg.dependencies?.vue) vueRoots.push({ rootDir: r, isComponentLibrary: isVueComponentLibraryPkg(pkg) })
  }
  return vueRoots
}

/**
 * Перевіряє наявність рекомендації `Vue.volar` у `.vscode/extensions.json`.
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {Promise<void>}
 * @param {string} cwd корінь репозиторію
 */
async function checkVueVolarRecommendation(pass, fail, cwd) {
  const extPath = join(cwd, '.vscode/extensions.json')
  if (!existsSync(extPath)) {
    fail('.vscode/extensions.json не існує (для Vue-проєкту потрібна рекомендація Vue.volar)')
    return
  }
  const ext = JSON.parse(await readFile(extPath, 'utf8'))
  if (ext.recommendations?.includes('Vue.volar')) {
    pass('extensions.json містить Vue.volar')
  } else {
    fail('extensions.json не містить Vue.volar — додай до recommendations')
  }
}

// Vitest-пакети мусять бути у кореневому devDependencies монорепо,
// бо npm-module правило забороняє devDeps у published Vue workspace.
const ROOT_VITEST_DEV_DEPS = ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner']

/**
 * Перевіряє, що кореневий `package.json` монорепо містить vitest-залежності
 * у `devDependencies`. Викликається тільки коли є Vue-пакети у воркспейсі.
 * @param {string} cwd корінь репозиторію
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {void}
 */
function checkRootVitestDevDeps(cwd, pass, fail) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) {
    fail('vue: кореневий package.json не знайдено — неможливо перевірити vitest devDependencies')
    return
  }
  let rootPkg
  try {
    rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
  } catch {
    fail('vue: кореневий package.json не вдалося розпарсити — неможливо перевірити vitest devDependencies')
    return
  }
  const devDeps =
    rootPkg.devDependencies && typeof rootPkg.devDependencies === 'object' ? Object.keys(rootPkg.devDependencies) : []
  const missing = ROOT_VITEST_DEV_DEPS.filter(p => !devDeps.includes(p))
  if (missing.length === 0) {
    pass(`vue: кореневий devDependencies містить ${ROOT_VITEST_DEV_DEPS.join(', ')} (vue.mdc testing)`)
  } else {
    for (const pkg of missing) {
      fail(
        `vue: кореневий devDependencies не містить '${pkg}' — перенеси з Vue workspace у корінь монорепо (vue.mdc testing)`
      )
    }
  }
}

/**
 * Перевіряє відповідність проєкту правилам vue.mdc (корінь і всі workspace-пакети з `vue` у dependencies).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки з порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const roots = await getMonorepoPackageRootDirs(cwd)
  const vueRoots = await collectVueRoots(roots, cwd)

  if (vueRoots.length === 0) {
    pass('Vue.volar: пропущено (у repo немає пакетів з vue у dependencies)')
    pass('vue не знайдено в dependencies жодного пакета (перевірка vue пропущена)')
    return reporter.result()
  }

  await checkVueVolarRecommendation(pass, fail, cwd)
  checkRootVitestDevDeps(cwd, pass, fail)

  const ignorePaths = await loadCursorIgnorePaths(cwd)
  for (const { rootDir, isComponentLibrary } of vueRoots) {
    await checkVuePackage(rootDir, isComponentLibrary, ignorePaths, fail, pass, cwd)
  }

  return reporter.result()
}
