/** @see ./docs/no-bun-test-import.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * Іменовані експорти `bun:test`, що мають прямий 1:1 еквівалент у vitest (той самий
 * API, лише інше джерело пакета) — безпечно переписати джерело без чіпання call-sites.
 * `mock`/`spyOn`/`jest` та інше НЕ входять сюди: у vitest вони живуть під `vi.*`
 * namespace (`vi.fn`, `vi.spyOn`), тож переписування джерела без переписування
 * call-sites дало б робочий import, але зламаний виклик — небезпечно для T0.
 */
const SAFE_SPECIFIERS = new Set([
  'describe',
  'test',
  'it',
  'expect',
  'beforeEach',
  'beforeAll',
  'afterEach',
  'afterAll'
])

/** Іменований import з `bun:test`; специфікатор-секція може бути багаторядковою. */
const BUN_TEST_IMPORT_RE = /import\s*\{([\s\S]*?)\}\s*from\s*(['"])bun:test\2/gu
/** Розділювач `imported as local` у специфікаторі. */
const AS_ALIAS_RE = /\s+as\s+/u

/**
 * Чи файл — JS-тест (`*.test.mjs` або `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} `true` для імен з `.test.{mjs,js}` суфіксом
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Розбирає список іменованих специфікаторів `{ a, b as c }` на `{imported, local}`.
 * @param {string} raw вміст фігурних дужок import-декларації
 * @returns {{imported:string, local:string}[]} розібрані специфікатори
 */
function parseSpecifiers(raw) {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [imported, local] = s.split(AS_ALIAS_RE).map(x => x.trim())
      return { imported, local: local ?? imported }
    })
}

/**
 * Знаходить усі `import { ... } from 'bun:test'` у вмісті файлу. Спільна логіка
 * для detector-а (`lint`) і T0-фіксера (`fix-no-bun-test-import.mjs`) — уникаємо
 * дублювання парсингу.
 * @param {string} content вихідний код файлу
 * @returns {{start:number, end:number, raw:string, specifiers:{imported:string,local:string}[], fixable:boolean}[]} знайдені import-декларації
 */
export function findBunTestImports(content) {
  const matches = []
  for (const m of content.matchAll(BUN_TEST_IMPORT_RE)) {
    const specifiers = parseSpecifiers(m[1])
    const fixable = specifiers.length > 0 && specifiers.every(s => SAFE_SPECIFIERS.has(s.imported))
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0], specifiers, fixable })
  }
  return matches
}

/**
 * Detector: жоден `*.test.{mjs,js}` не імпортує з `bun:test` — vitest (яким
 * запускається `@7n/test coverage` і `vitest run`) цей пакет не резолвить (test.mdc).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (`cwd` тощо)
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту зі списком violations
 */
export async function lint(ctx) {
  const { cwd } = ctx
  const ignorePaths = await loadCursorIgnorePaths(cwd)

  /** @type {string[]} */
  const testFiles = []
  await walkDir(
    cwd,
    absPath => {
      if (isTestFile(absPath)) testFiles.push(absPath)
    },
    ignorePaths
  )

  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    const found = findBunTestImports(body)
    if (found.length === 0) continue
    const file = relative(cwd, absPath).split('\\').join('/')
    for (const imp of found) {
      const line = body.slice(0, imp.start).split('\n').length
      const specNames = imp.specifiers.map(s => s.imported).join(', ')
      violations.push(
        /** @type {Partial<import('../../../scripts/lib/lint-surface/types.mjs').LintViolation>} */ ({
          reason: 'bun-test-import',
          message: imp.fixable
            ? `${file}:${line}: import з 'bun:test' — vitest не резолвить цей пакет; auto-fix перепише джерело на 'vitest' (test.mdc)`
            : `${file}:${line}: import з 'bun:test' містить специфікатори без прямого 1:1 еквіваленту у vitest ` +
              `(${specNames}) — потрібне ручне виправлення call-sites (vi.fn/vi.spyOn мають інший API) (test.mdc)`,
          file,
          data: { fixable: imp.fixable, specifiers: imp.specifiers.map(s => s.imported) }
        })
      )
    }
  }

  return { violations }
}
