/**
 * Знаходить імпорти з `ioredis` та `node-redis` (та підшляхів `redis/...`) у джерелах —
 * їх треба замінити на Bun native Redis (`import { redis } from 'bun'`) згідно з
 * `js-bun-redis.mdc` (<https://bun.com/docs/runtime/redis>).
 *
 * Семантика береться з **oxc-parser** (`module.staticImports`) — без regex по тілу файлу.
 * Додатково по AST програми ловимо `require('ioredis')` і динамічний `import('ioredis')`,
 * щоб правило працювало і у CommonJS, і при динамічному `import` у межах одного файлу.
 *
 * `node-redis` публікується під рядом імен:
 *  - кореневий пакет `redis` (саме так його імпортують у v4+);
 *  - історичний `node-redis` (рідше);
 *  - підпакети, які тягнуться разом: `@redis/client`, `@redis/json`, `@redis/search`,
 *    `@redis/time-series`, `@redis/bloom` — їх теж треба прибирати разом із основним
 *    клієнтом, щоб не лишилось «половини» інтеграції після переходу на Bun.
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
} from '@7n/rules/scripts/utils/ast-scan-utils.mjs'

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/u
const FORBIDDEN_MODULE_NAMES = new Set([
  'ioredis',
  'node-redis',
  'redis',
  '@redis/client',
  '@redis/json',
  '@redis/search',
  '@redis/time-series',
  '@redis/bloom'
])

/**
 * Чи є рядок-специфікатор імпорту забороненим (`ioredis`, `node-redis`, `redis`, `redis/...`,
 * `ioredis/...`, `@redis/<sub>`).
 *
 * Використовуємо префікс-збіг для `ioredis/` та `redis/` — щоб ловити підшляхи
 * (`ioredis/built/utils`, `redis/dist/...`), але не зачепити сторонні пакети
 * на кшталт `redis-mock`, які треба валідувати окремо.
 * @param {string} mod рядкове значення з `import '...'` / `require('...')`
 * @returns {boolean} true, якщо такий specifier треба викинути на користь Bun native Redis
 */
function isForbiddenRedisModule(mod) {
  if (FORBIDDEN_MODULE_NAMES.has(mod)) return true
  return mod.startsWith('ioredis/') || mod.startsWith('redis/') || mod.startsWith('@redis/')
}

/**
 * Знаходить заборонені імпорти/require з `ioredis` / `node-redis` у тексті.
 * @param {string} content вихідний код
 * @param {string} [virtualPath] шлях для вибору `lang` (наприклад `pkg/src/foo.ts`)
 * @returns {{ line: number, snippet: string, module: string }[]} список порушень
 */
export function findRedisImportsInText(content, virtualPath = 'scan.ts') {
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
    if (typeof mod === 'string' && isForbiddenRedisModule(mod)) {
      out.push({
        line: offsetToLine(content, imp.start),
        snippet: normalizeSnippet(content.slice(imp.start, imp.end)),
        module: mod
      })
    }
  }

  walkAstWithAncestors(result.program, [], node => {
    const reqMod = requireCallModule(node)
    if (reqMod && isForbiddenRedisModule(reqMod)) {
      out.push({
        line: offsetToLine(content, node.start),
        snippet: normalizeSnippet(content.slice(node.start, node.end)),
        module: reqMod
      })
      return
    }
    const dynMod = dynamicImportModule(node)
    if (dynMod && isForbiddenRedisModule(dynMod)) {
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
 * Чи сканувати цей файл за розширенням (JS/TS-сімʼя).
 * @param {string} relativePath відносний шлях до файлу
 * @returns {boolean} `true`, якщо розширення підходить для пошуку імпорту
 */
export function isRedisScanSourceFile(relativePath) {
  return SOURCE_FILE_RE.test(relativePath)
}

/**
 * Чи слід пропустити файл під час обходу пакета (декларації типів — лише типи, не виконувані).
 * @param {string} relativePosix шлях з posix-слешами
 * @returns {boolean} `true`, якщо файл не сканувати
 */
export function shouldSkipFileForRedisScan(relativePosix) {
  return relativePosix.endsWith('.d.ts')
}
