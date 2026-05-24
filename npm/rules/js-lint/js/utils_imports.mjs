/**
 * Перевіряє, що файли всередині будь-якого `utils/` каталогу не мають імпортів за межі
 * самого каталогу (relative-import з `..`). За правилом `js-lint.mdc` каталог `utils/` — це
 * generic helpers без бізнес-логіки і без залежностей від домену; якщо файлу потрібен
 * сусідній модуль, конфіг проєкту чи cross-rule helper — він має жити в `lib/`, а не в `utils/`.
 *
 * Перевіряються лише не-тестові `.mjs|.mts|.cjs|.cts|.js|.ts|.jsx|.tsx` під будь-яким
 * `utils/`-каталогом у monorepo-воркспейсах. Файли всередині `utils/tests/` (тести)
 * і будь-які `__fixtures__/` ігноруються — тести легально імпортують свій модуль через `../X`.
 *
 * Дозволені імпорти:
 *  - `./X`, `./sub/X` — same-dir чи глибше всередині самої `utils/`
 *  - bare-package (`oxc-parser`, `@scope/pkg`) — npm-залежність
 *  - `node:fs`, `fs` тощо — Node-builtin
 *
 * Заборонено:
 *  - будь-який `..`-шлях (`../X`, `../../X`) — це порушення granular `utils/`-кордону
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { parseSync } from 'oxc-parser'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'
import {
  dynamicImportModule,
  langFromPath,
  requireCallModule,
  walkAstWithAncestors
} from '../../../scripts/utils/ast-scan-utils.mjs'

const JS_SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/u
const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/u
const PARENT_RELATIVE_RE = /^\.\.(?:\/|$)/u
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', '.next', '__fixtures__'])

/**
 * Чи каталог `dir` входить у список ignore (точний збіг або префікс).
 * @param {string} dir абсолютний posix-шлях
 * @param {string[]} ignorePaths абсолютні posix-шляхи з .n-cursor.json
 * @returns {boolean} true — пропускаємо
 */
function isIgnored(dir, ignorePaths) {
  for (const p of ignorePaths) {
    if (dir === p || dir.startsWith(`${p}/`)) return true
  }
  return false
}

/**
 * Рекурсивно знаходить усі каталоги з ім'ям `utils` під `root` (пропускаючи типові артефакти).
 * @param {string} root корінь
 * @param {string[]} ignorePosix абс. posix-шляхи з ignore-конфігу
 * @returns {Promise<string[]>} абсолютні шляхи знайдених `utils/`-каталогів
 */
async function findUtilsDirs(root, ignorePosix) {
  const found = []
  /**
   * @param {string} dir поточний каталог обходу
   */
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      const full = join(dir, entry.name)
      const posix = full.split(sep).join('/')
      if (isIgnored(posix, ignorePosix)) continue
      if (entry.name === 'utils') {
        found.push(full)
        continue
      }
      await walk(full)
    }
  }
  await walk(root)
  return found
}

/**
 * Збирає всі не-тестові `.[cm]?[jt]sx?` файли під `utilsDir` (включно з підкаталогами,
 * крім `tests/` і `__fixtures__/`).
 * @param {string} utilsDir абсолютний шлях `utils/`
 * @returns {Promise<string[]>} абсолютні шляхи джерел
 */
async function collectUtilsSources(utilsDir) {
  const out = []
  /**
   * @param {string} dir поточний каталог
   */
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'tests' || entry.name === '__fixtures__' || SKIP_DIR_NAMES.has(entry.name)) continue
        await walk(full)
        continue
      }
      if (entry.isFile() && JS_SOURCE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(utilsDir)
  return out
}

/**
 * Витягає з джерела всі рядкові імпорт-source (статичні, динамічні, require). Помилки парсера
 * не падають — спочатку треба полагодити синтаксис, потім перезапустити концерн.
 * @param {string} source текст файлу
 * @param {string} filePath шлях (для вибору мови)
 * @returns {string[]} список source-рядків, як вони задані в коді
 */
function extractImportSources(source, filePath) {
  /** @type {string[]} */
  const sources = []
  let parsed
  try {
    parsed = parseSync(filePath, source, { lang: langFromPath(filePath) })
  } catch {
    return sources
  }
  const staticImports = parsed?.module?.staticImports ?? []
  for (const imp of staticImports) {
    if (typeof imp?.moduleRequest?.value === 'string') {
      sources.push(imp.moduleRequest.value)
    }
  }
  const program = parsed?.program
  if (program && typeof program === 'object') {
    walkAstWithAncestors(program, [], node => {
      const dyn = dynamicImportModule(node)
      if (dyn !== null) sources.push(dyn)
      const req = requireCallModule(node)
      if (req !== null) sources.push(req)
    })
  }
  return sources
}

/**
 * @returns {Promise<number>} 0 — усе чисто, 1 — знайдено заборонені імпорти
 */
export async function check() {
  const reporter = createCheckReporter()
  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const ignorePosix = ignorePaths.map(p => p.split(sep).join('/'))
  const packageRoots = await getMonorepoPackageRootDirs(root)
  /** @type {Set<string>} */
  const utilsDirSet = new Set()
  for (const pkgRel of packageRoots) {
    const pkgAbs = pkgRel === '.' ? root : join(root, pkgRel)
    for (const utilsDir of await findUtilsDirs(pkgAbs, ignorePosix)) {
      utilsDirSet.add(utilsDir)
    }
  }
  if (utilsDirSet.size === 0) {
    reporter.pass('utils-каталогів немає — перевірку пропущено (js-lint.mdc)')
    return reporter.getExitCode()
  }
  let violations = 0
  let checkedFiles = 0
  for (const utilsDir of utilsDirSet) {
    const sources = await collectUtilsSources(utilsDir)
    for (const file of sources) {
      checkedFiles += 1
      const content = await readFile(file, 'utf8')
      const imports = extractImportSources(content, file)
      for (const src of imports) {
        if (PARENT_RELATIVE_RE.test(src)) {
          const rel = relative(root, file)
          reporter.fail(`${rel}: заборонений імпорт '${src}' — utils/-файли мають бути generic (js-lint.mdc)`)
          violations += 1
        }
      }
    }
  }
  if (violations === 0) {
    reporter.pass(
      `utils-каталогів: ${utilsDirSet.size}, перевірено ${checkedFiles} файлів — domain-bound імпортів немає (js-lint.mdc)`
    )
  }
  return reporter.getExitCode()
}
