/**
 * Smoke-перевірка після install: динамічно імпортує кожен `.mjs`-файл пакету, щоб зловити
 * клас «named export зник після hoisting» (напр. `ajv-draft-04` знайшов чужий `ajv@6`
 * замість `ajv@8`, або `globby` знайшов v11 замість v16 з іншим набором named exports) —
 * SyntaxError/ReferenceError на рівні модуля, який delta-lint чи одиничний unit-тест міг
 * не зачепити, бо конкретний файл не імпортувався в тому прогоні.
 *
 * Запуск (CI, після `bun install`, до release/publish): `node npm/scripts/smoke-check-imports.mjs`.
 */
import { dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { walkDir } from './utils/walkDir.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Тільки бібліотечні модулі (без top-level side-effects): `npm/rules/**` (детектори/фікси
// концернів) і `npm/scripts/lib/**`. Свідомо ВИКЛЮЧЕНО `npm/bin/**` і top-level
// `npm/scripts/*.mjs` — це прямі CLI-скрипти для запуску (мережеві виклики, мутації дерева,
// `process.exit`), імпорт яких як модуля виконав би їх побічні ефекти замість перевірки.
const INCLUDE_ROOTS = ['rules/', 'scripts/lib/']
const SKIP_SEGMENTS = ['/node_modules/', '/reports/', '/.tmp/', '/fixtures/', '/__fixtures__/']

/**
 * @param {string} absPath абсолютний шлях файлу
 * @returns {boolean} true, якщо файл треба пропустити (тести/фікстури/артефакти прогонів/не-бібліотечні скрипти)
 */
function shouldSkip(absPath) {
  if (!absPath.endsWith('.mjs')) return true
  if (SKIP_SEGMENTS.some(seg => absPath.includes(seg))) return true
  const rel = relative(PACKAGE_ROOT, absPath)
  if (INCLUDE_ROOTS.every(root => !rel.startsWith(root))) return true
  return rel.endsWith('.test.mjs')
}

/** @type {string[]} */
const files = []
await walkDir(PACKAGE_ROOT, fp => {
  if (!shouldSkip(fp)) files.push(fp)
})
files.sort()

/** @type {Array<{ file: string, error: Error }>} */
const failures = []

for (const abs of files) {
  try {
    // file:// URL зі списку файлів репо (перевірених walkDir), не user input
    // eslint-disable-next-line no-unsanitized/method
    await import(pathToFileURL(abs).href)
  } catch (error) {
    failures.push({ file: relative(PACKAGE_ROOT, abs), error: /** @type {Error} */ (error) })
  }
}

console.log(`smoke-check-imports: ${files.length - failures.length}/${files.length} модулів імпортовано чисто`)

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} модул(ів) не імпортувались (можлива hoisting-регресія залежностей):\n`)
  for (const { file, error } of failures) {
    console.error(`  ${file}\n    ${error.message.split('\n', 1)[0]}\n`)
  }
  process.exitCode = 1
} else {
  console.log('✅ smoke-check-imports: усі модулі імпортуються чисто')
}
