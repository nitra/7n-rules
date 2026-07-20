/** @see ./docs/migration-cache.md */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Каталог за замовчуванням для кешу міграцій — спільний для всіх репо на цій
 * машині (не прив'язаний до конкретного worktree/репо), бо ключ кешу — сам
 * пакет+діапазон версій, а не проєкт.
 */
export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'n-rules', 'taze-migrations')

/**
 * Санітизує `(pkg, from, to)` у безпечне імʼя файлу — крос-репо ключ кешу.
 * Той самий `(pkg, from, to)` у різних репо/воркспейсах дає той самий ключ.
 * @param {string} pkg назва пакета (може містити `@scope/name`)
 * @param {string} from стара версія
 * @param {string} to нова версія
 * @returns {string} ключ без розширення
 */
export function migrationCacheKey(pkg, from, to) {
  return `${pkg}@${from}__${to}`.replaceAll(/[^a-zA-Z0-9._@-]/g, '-')
}

/**
 * Читає кешований запис міграції для `(pkg, from, to)`, якщо інший
 * repo/worktree на цій машині вже проганяв через LLM ту саму пару версій.
 * Відсутній/побитий файл — `null` (мовчки, не провал прогону: кеш —
 * оптимізація, а не залежність, від якої залежить коректність).
 * @param {string} pkg назва пакета
 * @param {string} from стара версія
 * @param {string} to нова версія
 * @param {{ cacheDir?: string, existsSyncFn?: typeof existsSync, readFileFn?: typeof readFile }} [deps] інжекти для тестів
 * @returns {Promise<{notes: string, sourceRepo: string, updatedAt: string}|null>} кешований запис або null
 */
export async function readMigrationCache(pkg, from, to, deps = {}) {
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR
  const exists = deps.existsSyncFn ?? existsSync
  const read = deps.readFileFn ?? readFile
  const path = join(cacheDir, `${migrationCacheKey(pkg, from, to)}.json`)
  if (!exists(path)) return null
  try {
    return JSON.parse(await read(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Зберігає результат ізольованого LLM-виклику для `(pkg, from, to)` — щоб
 * наступний репо з тим самим bump-ом на цій машині не повторював
 * CHANGELOG-дослідження з нуля (див. `readMigrationCache`).
 * @param {string} pkg назва пакета
 * @param {string} from стара версія
 * @param {string} to нова версія
 * @param {{notes: string, sourceRepo: string, updatedAt: string}} entry запис для збереження
 * @param {{ cacheDir?: string, mkdirFn?: typeof mkdir, writeFileFn?: typeof writeFile }} [deps] інжекти для тестів
 * @returns {Promise<void>}
 */
export async function writeMigrationCache(pkg, from, to, entry, deps = {}) {
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR
  const makeDir = deps.mkdirFn ?? mkdir
  const write = deps.writeFileFn ?? writeFile
  await makeDir(cacheDir, { recursive: true })
  const path = join(cacheDir, `${migrationCacheKey(pkg, from, to)}.json`)
  await write(path, JSON.stringify(entry, null, 2))
}

/**
 * Дописує до промпта `provider.promptFor(entry)` підсумок відомої міграції,
 * якщо кеш її знайшов — каже раннеру пропустити крок 1 (CHANGELOG/diff-
 * дослідження) і одразу шукати використання в поточному проєкті.
 * @param {string} prompt базовий промпт з `provider.promptFor(entry)`
 * @param {{notes: string, sourceRepo: string}} cached кешований запис
 * @returns {string} доповнений промпт
 */
export function withKnownMigrationNotes(prompt, cached) {
  return [
    prompt,
    '',
    '## Відома міграція (кеш з іншого репо на цій машині)',
    '',
    `Це саме оновлення (той самий пакет і діапазон версій) вже проаналізовано раніше в "${cached.sourceRepo}". Підсумок того прогону:`,
    '',
    cached.notes,
    '',
    'Довірся цьому підсумку й пропусти крок 1 (повторне CHANGELOG/diff-дослідження) — одразу переходь до кроку 2 (використання API в ЦЬОМУ проєкті) і застосування міграції, якщо вона тут релевантна.'
  ].join('\n')
}
