/**
 * Знаходить імпорти з `@nitra/bunyan` (і застарілого `bunyan`) у джерелах — їх треба замінити
 * на `@nitra/pino` згідно з js-run.mdc.
 *
 * Семантика береться з **oxc-parser** (`module.staticImports`) — без regex по тілу файлу.
 * Додатково по AST програми ловимо `require('@nitra/bunyan')` і динамічний `import('@nitra/bunyan')`,
 * щоб правило працювало й у CommonJS і при динамічному import у межах одного файлу.
 *
 * Сканер не вимагає, щоб файл компілювався: при синтаксичних помилках повертається порожній
 * результат — спочатку треба полагодити синтаксис, потім перезапустити перевірку.
 */
import { parseSync } from 'oxc-parser'

import {
  dynamicImportModule,
  langFromPath,
  normalizeSnippet,
  offsetToLine,
  requireCallModule,
  walkAstWithAncestors
} from '../../../../scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const FORBIDDEN_MODULES = new Set(['@nitra/bunyan', 'bunyan'])

/**
 * Знаходить заборонені імпорти/require з `@nitra/bunyan` у тексті.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/foo.ts`)
 * @returns {{ line: number, snippet: string, module: string }[]} список порушень
 */
export function findBunyanImportsInText(content, virtualPath = 'scan.ts') {
  const pathForLang = virtualPath || 'scan.ts'
  const lang = langFromPath(pathForLang)
  let result
  try {
    result = parseSync(pathForLang, content, { lang, sourceType: 'module' })
  } catch {
    return []
  }
  if (result.errors?.length) {
    return []
  }

  /** @type {{ line: number, snippet: string, module: string }[]} */
  const out = []

  for (const imp of result.module?.staticImports ?? []) {
    const mod = imp.moduleRequest?.value
    if (mod && FORBIDDEN_MODULES.has(mod)) {
      out.push({
        line: offsetToLine(content, imp.start),
        snippet: normalizeSnippet(content.slice(imp.start, imp.end)),
        module: mod
      })
    }
  }

  walkAstWithAncestors(result.program, [], node => {
    const reqMod = requireCallModule(node)
    if (reqMod && FORBIDDEN_MODULES.has(reqMod)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        module: reqMod
      })
      return
    }
    const dynMod = dynamicImportModule(node)
    if (dynMod && FORBIDDEN_MODULES.has(dynMod)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        module: dynMod
      })
    }
  })

  return out
}

/**
 * Чи сканувати цей файл за розширенням (JS/TS-сім'я).
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для пошуку імпорту
 */
export function isBunyanScanSourceFile(relativePath) {
  return SOURCE_FILE_RE.test(relativePath)
}

/**
 * Чи слід пропустити файл під час обходу пакета (декларації типів).
 * @param {string} relativePosix шлях з posix-слешами
 * @returns {boolean} `true`, якщо файл не сканувати
 */
export function shouldSkipFileForBunyanScan(relativePosix) {
  return relativePosix.endsWith('.d.ts')
}
