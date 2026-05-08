/**
 * Перевіряє структуру npm-модуля в монорепо за правилом npm-module.mdc.
 *
 * Workspace `npm/`, `npm/package.json`, workflow `npm-publish.yml` з OIDC, `on.push.paths` з glob для каталогу npm.
 *
 * Якщо під `npm/src` є хоча б один файл `.js`, очікується канонічний layout: `types` → `./types/index.d.ts`,
 * згенерований `index.d.ts` у `npm/types/`, і hk з викликом `tsc` по файлах під `npm/src`.
 *
 * Якщо таких файлів немає — layout через `npm/tsconfig.emit-types.json`: поле `types` має вказувати на існуючий
 * файл під `./types/…`, у hk — `tsc -p tsconfig.emit-types.json`, у JSON-конфігу — потрібні compilerOptions для emit.
 *
 * Поля workflow перевіряються після **YAML parse**, щоб не плутати з коментарями.
 *
 * Версія та CHANGELOG: перший заголовок `## [version]` у `npm/CHANGELOG.md` має збігатися з `version` у
 * `npm/package.json` (найсвіжіший реліз зверху). Якщо в git є незакомічені зміни під `npm/`, `version` у робочому
 * файлі має відрізнятися від `HEAD` — інакше типовий пропуск bump після правок у пакеті.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  hasIdTokenWritePermission,
  hasNpmPublishStepWithPackage,
  parseWorkflowYaml,
  pushHasMainBranch,
  pushPathsIncludeNpmGlob
} from './utils/gha-workflow.mjs'
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'

const execFileAsync = promisify(execFile)

const TYPES_FILE_RE = /^\.\/types\/.+\.d\.(ts|mts)$/

/** Перший заголовок релізу у Keep a Changelog (`## [1.2.3]`). */
const CHANGELOG_FIRST_VERSION_RE = /^## \[([^\]]+)\]/m

/** Поле `version` у текстовому зрізі `package.json` (для `git show HEAD:npm/package.json`). */
const PACKAGE_JSON_VERSION_RE = /"version":\s*"([^"]+)"/u

/** Канонічний entrypoint типів для пакетів із вихідним `.js` під каталогом `npm/src` */
const TYPES_INDEX = './types/index.d.ts'

/** Файл проєкту TypeScript для emit без каталогу `src` (див. npm-module.mdc) */
const EMIT_TYPES_CONFIG = 'npm/tsconfig.emit-types.json'

/**
 * Чи є під `npm/src` хоча б один `.js` (рекурсивно).
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено хоча б один `.js`
 */
async function npmSrcTreeHasJsFile(ignorePaths = []) {
  const root = 'npm/src'
  if (!existsSync(root)) {
    return false
  }
  let found = false
  await walkDir(
    root,
    p => {
      if (p.endsWith('.js')) {
        found = true
      }
    },
    ignorePaths
  )
  return found
}

/**
 * Знаходить текстовий вміст конфігурації hk для перевірки npm-module.
 * @returns {Promise<{ path: string, text: string } | null>} знайдений файл або `null`
 */
async function readHkConfig() {
  const candidates = ['hk.pkl', '.config/hk.pkl']
  for (const p of candidates) {
    if (existsSync(p)) {
      const text = await readFile(p, 'utf8')
      return { path: p, text }
    }
  }
  return null
}

/**
 * Підрядки для hk при layout з каталогом `npm/src` і glob `src` + `.js` у команді (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkSrcLayoutFragments(hkText) {
  const need = [
    '["pre-commit"]',
    'bunx -p typescript tsc',
    'src/**/*.js',
    '--declaration',
    '--allowJs',
    '--emitDeclarationOnly',
    '--outDir types',
    '--skipLibCheck'
  ]
  return need.filter(s => !hkText.includes(s))
}

/**
 * Підрядки для hk при layout з `tsconfig.emit-types.json` (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkEmitTypesConfigFragments(hkText) {
  const need = ['["pre-commit"]', 'bunx -p typescript tsc', 'tsconfig.emit-types.json']
  return need.filter(s => !hkText.includes(s))
}

/**
 * Перевіряє `npm/tsconfig.emit-types.json` на мінімальний набір опцій для `emitDeclarationOnly` у `types/`.
 * @param {unknown} parsed результат `JSON.parse` конфігурації
 * @returns {string[]} повідомлення про помилки (порожній — OK)
 */
function emitTypesConfigIssues(parsed) {
  const issues = []
  if (!parsed || typeof parsed !== 'object') {
    return ['некоректний JSON']
  }
  const co = /** @type {{ [k: string]: unknown }} */ (parsed).compilerOptions
  if (!co || typeof co !== 'object') {
    return ['відсутній compilerOptions']
  }
  const get = k => /** @type {{ [k: string]: unknown }} */ (co)[k]
  if (get('allowJs') !== true) {
    issues.push('compilerOptions.allowJs має бути true')
  }
  if (get('declaration') !== true) {
    issues.push('compilerOptions.declaration має бути true')
  }
  if (get('emitDeclarationOnly') !== true) {
    issues.push('compilerOptions.emitDeclarationOnly має бути true')
  }
  if (get('outDir') !== 'types') {
    issues.push('compilerOptions.outDir має бути "types"')
  }
  if (get('skipLibCheck') !== true) {
    issues.push('compilerOptions.skipLibCheck має бути true')
  }
  return issues
}

/**
 * Шлях на дискі до файлу з поля `types` у `npm/package.json` (значення на кшталт `./types/bin/x.d.ts`).
 * @param {string} typesField значення поля `types` з `package.json`
 * @returns {string | null} абсолютний шлях або `null`
 */
function npmTypesFileFromPackageField(typesField) {
  if (typeof typesField !== 'string' || !typesField.startsWith('./types/')) {
    return null
  }
  const rel = typesField.slice(2)
  return join('npm', rel)
}

/**
 * Перевіряє поле types у npm/package.json.
 * @param {unknown} typesField значення поля types
 * @param {boolean} useSrcJsLayout чи використовується layout з npm/src
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkNpmTypesField(typesField, useSrcJsLayout, passFn, failFn) {
  if (useSrcJsLayout) {
    if (typesField === TYPES_INDEX) {
      passFn(`npm/package.json: "types": "${TYPES_INDEX}" (layout npm/src + .js)`)
    } else {
      failFn(`npm/package.json: при наявності .js під npm/src очікується "types": "${TYPES_INDEX}"`)
    }
  } else if (typeof typesField === 'string' && TYPES_FILE_RE.test(typesField)) {
    passFn(`npm/package.json: "types" вказує на файл під ./types/… (${typesField})`)
  } else {
    failFn(
      'npm/package.json: без .js під npm/src поле types має бути рядком виду ./types/….d.ts або .d.mts (див. npm-module.mdc)'
    )
  }
}

/**
 * Перевіряє npm/package.json на типи та files.
 * @param {boolean} useSrcJsLayout чи використовується layout з npm/src
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkNpmPackageJson(useSrcJsLayout, passFn, failFn) {
  if (!existsSync('npm/package.json')) return
  const npmPkg = JSON.parse(await readFile('npm/package.json', 'utf8'))
  const typesField = npmPkg.types

  checkNpmTypesField(typesField, useSrcJsLayout, passFn, failFn)

  if (Array.isArray(npmPkg.files) && npmPkg.files.includes('types')) {
    passFn('npm/package.json: files містить "types"')
  } else {
    failFn('npm/package.json: масив files має містити "types"')
  }

  const typesPath = useSrcJsLayout ? join('npm', 'types', 'index.d.ts') : npmTypesFileFromPackageField(typesField)
  const missingTypesMsg = useSrcJsLayout
    ? `Відсутній ${join('npm', 'types', 'index.d.ts')} (згенеруй tsc з npm-module.mdc)`
    : `Файл для поля types не знайдено або шлях не під ./types/ — ${String(typesField)}`
  if (typesPath && existsSync(typesPath)) {
    passFn(`${typesPath} існує`)
  } else {
    failFn(missingTypesMsg)
  }
}

/**
 * Перевіряє npm/tsconfig.emit-types.json.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkEmitTypesConfig(passFn, failFn) {
  if (!existsSync(EMIT_TYPES_CONFIG)) {
    failFn(
      `Без .js під npm/src потрібен ${EMIT_TYPES_CONFIG} (див. npm-module.mdc: emit через tsconfig, без штучного src/index.js)`
    )
    return
  }
  passFn(`${EMIT_TYPES_CONFIG} існує`)
  let raw
  try {
    raw = JSON.parse(await readFile(EMIT_TYPES_CONFIG, 'utf8'))
  } catch {
    failFn(`${EMIT_TYPES_CONFIG}: некоректний JSON`)
    return
  }
  const issues = emitTypesConfigIssues(raw)
  if (issues.length === 0) {
    passFn(`${EMIT_TYPES_CONFIG}: compilerOptions придатні для emitDeclarationOnly → types/`)
  } else {
    failFn(`${EMIT_TYPES_CONFIG}: ${issues.join('; ')}`)
  }
}

/**
 * Перевіряє npm-publish.yml workflow.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
/**
 * Чи виконано `git` у корені робочого дерева.
 * @returns {Promise<boolean>} true, якщо процес запущено в межах git work tree
 */
async function gitInsideWorkTree() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Список незакомічених шляхів під `npm/` відносно `HEAD`.
 * @returns {Promise<string[] | null>} шляхи або `null`, якщо `git` недоступний
 */
async function gitDiffNameOnlyNpm() {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD', '--', 'npm'], { encoding: 'utf8' })
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Поле `version` з `npm/package.json` на заданому git-ref (`HEAD:npm/package.json`).
 * @param {string} refPath на кшталт `HEAD:npm/package.json`
 * @returns {Promise<string | null>} значення поля `version` або `null`, якщо ref недоступний
 */
async function gitShowNpmPackageVersionAt(refPath) {
  try {
    const { stdout } = await execFileAsync('git', ['show', refPath], { encoding: 'utf8' })
    const m = stdout.match(/"version":\s*"([^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * Версія з першого заголовка `## […]` у тексті CHANGELOG.
 * @param {string} changelogText вміст файлу CHANGELOG.md
 * @returns {string | null} версія з першої секції або `null`, якщо заголовка немає
 */
function firstChangelogSectionVersion(changelogText) {
  const m = changelogText.match(CHANGELOG_FIRST_VERSION_RE)
  return m ? m[1] : null
}

/**
 * Перший реліз у CHANGELOG має збігатися з `version` у `npm/package.json`.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при виявленому порушенні
 * @returns {Promise<void>}
 */
async function checkChangelogTopMatchesPackageVersion(passFn, failFn) {
  if (!existsSync('npm/CHANGELOG.md') || !existsSync('npm/package.json')) return
  const pkg = JSON.parse(await readFile('npm/package.json', 'utf8'))
  const ver = typeof pkg.version === 'string' ? pkg.version : null
  if (!ver) {
    failFn('npm/package.json: відсутнє поле version')
    return
  }
  const cl = await readFile('npm/CHANGELOG.md', 'utf8')
  const first = firstChangelogSectionVersion(cl)
  if (!first) {
    failFn('npm/CHANGELOG.md: не знайдено жодного заголовка ## [version]')
    return
  }
  if (first !== ver) {
    failFn(
      `npm/CHANGELOG.md: перша секція [${first}] не збігається з npm/package.json version "${ver}" ` +
        '(зверху має бути найсвіжіший реліз і той самий номер — npm-module.mdc).'
    )
    return
  }
  passFn(`npm/CHANGELOG.md: перша секція [${first}] збігається з npm/package.json`)
}

/**
 * Незакомічені зміни під `npm/` вимагають підвищення `version` відносно `HEAD`.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при виявленому порушенні
 * @returns {Promise<void>}
 */
async function checkDirtyNpmRequiresVersionBump(passFn, failFn) {
  if (!(await gitInsideWorkTree())) {
    passFn('npm-module: git недоступний або поза work tree — перевірку незакоміченого bump пропущено')
    return
  }
  const changed = await gitDiffNameOnlyNpm()
  if (changed === null) {
    passFn('npm-module: git diff під npm/ недоступний — пропущено')
    return
  }
  if (changed.length === 0) return

  const headVer = await gitShowNpmPackageVersionAt('HEAD:npm/package.json')
  if (headVer === null) return

  const pkg = JSON.parse(await readFile('npm/package.json', 'utf8'))
  const cur = typeof pkg.version === 'string' ? pkg.version : null
  if (!cur) return

  if (cur === headVer) {
    failFn(
      `Незакомічені зміни під npm/ (${changed.join(', ')}), але "version" у npm/package.json лишився ${cur} ` +
        '(як у HEAD). Підвищ version (+1) і додай секцію ## [нова версія] зверху CHANGELOG (npm-module.mdc).'
    )
    return
  }
  passFn(`npm/: незакомічені зміни під npm/ узгоджені з підвищенням version (${headVer} → ${cur})`)
}

/**
 * Перевіряє npm-publish.yml workflow на наявність потрібних полів і кроків.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при виявленому порушенні
 * @returns {Promise<void>}
 */
async function checkPublishWorkflow(passFn, failFn) {
  const publishWf = '.github/workflows/npm-publish.yml'
  if (!existsSync(publishWf)) {
    failFn(`Відсутній ${publishWf} (npm-module.mdc: npm publish)`)
    return
  }
  passFn(`${publishWf} існує`)
  const pub = await readFile(publishWf, 'utf8')
  const root = parseWorkflowYaml(pub)
  if (root) {
    const checks = [
      {
        ok: pushPathsIncludeNpmGlob(root),
        pass: `${publishWf}: on.push.paths містить npm/**`,
        fail: `${publishWf}: у on.push.paths має бути npm/**`
      },
      {
        ok: pushHasMainBranch(root),
        pass: `${publishWf}: очікується branch main`,
        fail: `${publishWf}: очікується branch main`
      },
      {
        ok: hasIdTokenWritePermission(root),
        pass: `${publishWf}: permissions містить id-token: write (OIDC)`,
        fail: `${publishWf}: permissions має містити id-token: write (OIDC)`
      },
      {
        ok: hasNpmPublishStepWithPackage(root),
        pass: `${publishWf}: uses JS-DevTools/npm-publish та with.package npm/package.json`,
        fail: `${publishWf}: очікується uses: JS-DevTools/npm-publish та with.package: npm/package.json`
      }
    ]
    for (const c of checks) {
      if (c.ok) {
        passFn(c.pass)
      } else {
        failFn(c.fail)
      }
    }
    return
  }
  const need = [
    { sub: 'npm/**', msg: `${publishWf}: у on.push.paths має бути npm/**` },
    { sub: 'branches:', msg: `${publishWf}: очікується on.push.branches` },
    { sub: 'main', msg: `${publishWf}: очікується branch main` },
    { sub: 'id-token: write', msg: `${publishWf}: permissions має містити id-token: write (OIDC)` },
    { sub: 'JS-DevTools/npm-publish', msg: `${publishWf}: очікується uses: JS-DevTools/npm-publish` },
    { sub: 'package: npm/package.json', msg: `${publishWf}: with.package має бути npm/package.json` }
  ]
  for (const { sub, msg } of need) {
    if (pub.includes(sub)) {
      passFn(`${publishWf} містить «${sub}»`)
    } else {
      failFn(msg)
    }
  }
}

/**
 * Перевіряє базову структуру монорепо (package.json, npm/, workspaces, npm/package.json).
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 */
async function checkNpmModuleBasicStructure(pass, fail) {
  if (existsSync('package.json')) {
    pass('package.json існує')
  } else {
    fail('package.json не існує')
  }

  if (existsSync('npm')) {
    const s = await stat('npm')
    if (s.isDirectory()) {
      pass('npm/ директорія існує')
    } else {
      fail('npm має бути директорією')
    }
  } else {
    fail('npm/ директорія не існує')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    if (Array.isArray(pkg.workspaces) && pkg.workspaces.includes('npm')) {
      pass('package.json workspaces містить "npm"')
    } else {
      fail('package.json workspaces має містити "npm"')
    }
  }

  if (existsSync('npm/package.json')) {
    pass('npm/package.json існує')
  } else {
    fail('npm/package.json не існує — створи package.json для npm модуля')
  }
}

/**
 * Перевіряє відповідність проєкту правилам npm-module.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkNpmModuleBasicStructure(pass, fail)

  const ignorePaths = await loadCursorIgnorePaths(process.cwd())
  const useSrcJsLayout = await npmSrcTreeHasJsFile(ignorePaths)

  await checkNpmPackageJson(useSrcJsLayout, pass, fail)

  if (!useSrcJsLayout) {
    await checkEmitTypesConfig(pass, fail)
  }

  const layoutLabel = useSrcJsLayout ? 'layout src' : 'tsconfig emit-types'
  const hk = await readHkConfig()
  if (hk) {
    pass(`${hk.path} існує`)
    const missing = useSrcJsLayout ? missingHkSrcLayoutFragments(hk.text) : missingHkEmitTypesConfigFragments(hk.text)
    if (missing.length === 0) {
      pass(`${hk.path}: pre-commit містить очікуваний виклик tsc (${layoutLabel})`)
    } else {
      fail(`${hk.path}: онови pre-commit крок (npm-module.mdc); не знайдено: ${missing.join(', ')}`)
    }
  } else {
    fail('Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)')
  }

  if (existsSync('.github/workflows')) {
    pass('.github/workflows/ існує')
  } else {
    fail('.github/workflows/ не існує')
  }

  await checkPublishWorkflow(pass, fail)

  await checkChangelogTopMatchesPackageVersion(pass, fail)
  await checkDirtyNpmRequiresVersionBump(pass, fail)

  return reporter.getExitCode()
}
