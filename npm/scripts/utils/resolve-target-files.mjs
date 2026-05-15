/**
 * Резолвер списку файлів для одного `policy/<name>/target.json` у новій структурі правил.
 *
 * Дві форми у `target.json:files`:
 *   - `{ "single": "<rel>" }` — конкретний відносний шлях. Якщо `existsSync(root/single)` → `[single]`;
 *     інакше `[]` (caller сам вирішує fail vs silent skip за `required`).
 *   - `{ "walkGlob": <glob | glob[]> }` — picomatch проти posix-відносних шляхів, отриманих обходом
 *     `walkDir` від `root` із загальними skip-ами та `.n-cursor.json:ignore`. Обхід кешований у
 *     `walkCache` (Map ключ — підпис ignorePaths) — повторні таргети з тим самим набором ignore
 *     перевикористовують список без нового readdir.
 *
 * Path-traversal у `single` — кидаємо помилку при resolve. Реалізує інваріант контракту: полісі
 * читають лише файли в репо.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'

import picomatch from 'picomatch'

import { loadCursorIgnorePaths } from './load-cursor-config.mjs'
import { walkDir } from './walkDir.mjs'

/** Узгоджений regex для path-traversal: `..` як сегмент або абсолютний шлях. */
const PARENT_SEGMENT_RE = /(^|[\\/])\.\.([\\/]|$)/u

/**
 * Перевіряє, що `single`-шлях у `target.json:files` лежить у межах репозиторію.
 * Кидає помилку, якщо шлях абсолютний або містить сегмент `..`.
 * @param {string} singlePath значення `files.single`
 * @returns {void}
 */
function assertSafeSinglePath(singlePath) {
  if (isAbsolute(singlePath)) {
    throw new Error(`target.json: files.single має бути відносним шляхом (отримано: ${singlePath})`)
  }
  if (PARENT_SEGMENT_RE.test(singlePath)) {
    throw new Error(`target.json: files.single не може містити '..' (отримано: ${singlePath})`)
  }
}

/**
 * Збирає всі файли (posix-відносні шляхи від `root`) одним обходом дерева.
 * Скіпи: загальні з `walkDir` + `.n-cursor.json:ignore`.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string[]} ignorePaths абсолютні posix-шляхи виключених каталогів
 * @returns {Promise<string[]>} відсортовані posix-відносні шляхи
 */
async function walkAllRelative(root, ignorePaths) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    abs => {
      const rel = relative(root, abs).split(sep).join('/')
      if (rel.length > 0) out.push(rel)
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Витягує (або обчислює і кешує) список усіх файлів у дереві для заданого набору ignore-шляхів.
 * Кеш — мapа `signature → Promise<string[]>`, тож паралельні виклики одного й того ж набору
 * чекають один обхід.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string[]} ignorePaths абсолютні posix-шляхи виключених каталогів
 * @param {Map<string, Promise<string[]>>} walkCache мутабельний кеш від caller-а
 * @returns {Promise<string[]>} відсортовані posix-відносні шляхи
 */
function getAllFilesCached(root, ignorePaths, walkCache) {
  const signature = `${root}|${ignorePaths.join('|')}`
  let p = walkCache.get(signature)
  if (!p) {
    p = walkAllRelative(root, ignorePaths)
    walkCache.set(signature, p)
  }
  return p
}

/**
 * Резолвить список файлів для одного `target.json:files`.
 * @param {object} filesSpec поле `files` з `target.json` (вже після schema-валідації)
 * @param {string} root абсолютний корінь репозиторію
 * @param {Map<string, Promise<string[]>>} walkCache кеш обходів дерева (cross-target у межах одного check-прогону)
 * @returns {Promise<string[]>} абсолютні шляхи знайдених файлів (порожній — нічого не знайдено)
 */
export async function resolveTargetFiles(filesSpec, root, walkCache) {
  if (typeof filesSpec?.single === 'string') {
    assertSafeSinglePath(filesSpec.single)
    const normalized = normalize(filesSpec.single).split(sep).join('/')
    const abs = join(root, normalized)
    return existsSync(abs) ? [abs] : []
  }
  if (filesSpec?.walkGlob !== undefined) {
    const ignorePaths = await loadCursorIgnorePaths(root)
    const all = await getAllFilesCached(root, ignorePaths, walkCache)
    const globs = Array.isArray(filesSpec.walkGlob) ? filesSpec.walkGlob : [filesSpec.walkGlob]
    // picomatch у масиві трактує `!neg` як ОКРЕМИЙ позитивний матчер «не-neg» (some-OR логіка),
    // тож наївне `picomatch(['pos','!neg'])` повертає true майже на всьому. Розділяємо вручну:
    // позитиви join-имо через picomatch(...), негативні фільтруємо окремим isExcluded.
    const positives = globs.filter(g => !g.startsWith('!'))
    const negatives = globs.filter(g => g.startsWith('!')).map(g => g.slice(1))
    const isMatch = positives.length > 0 ? picomatch(positives, { dot: false }) : () => false
    const isExcluded = negatives.length > 0 ? picomatch(negatives, { dot: false }) : () => false
    return all.filter(rel => isMatch(rel) && !isExcluded(rel)).map(rel => join(root, rel))
  }
  throw new Error(`target.json: files має містити single або walkGlob (отримано: ${JSON.stringify(filesSpec)})`)
}
