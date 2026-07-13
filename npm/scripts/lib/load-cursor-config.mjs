/**
 * Утиліта читання `.n-rules.json` у корені репозиторію (fallback — legacy `.n-cursor.json`
 * до першого синку, який мігрує ім'я файлу).
 *
 * Зараз експортує `loadCursorIgnorePaths(root)` — список абсолютних posix-шляхів каталогів,
 * які check-скрипти повністю виключають з обходу (поле `ignore` у конфізі).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

const CONFIG_FILE = '.n-rules.json'
const LEGACY_CONFIG_FILE = '.n-cursor.json'

/**
 * Нормалізує шлях до абсолютного posix-формату без trailing-slash.
 * Відносні шляхи розв'язуються від `root`.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string} p шлях з конфігу (відносний або абсолютний)
 * @returns {string} абсолютний posix-шлях
 */
function toAbsPosix(root, p) {
  const trimmed = String(p).trim()
  const abs = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed)
  let posix = abs.split(sep).join('/')
  while (posix.endsWith('/')) posix = posix.slice(0, -1)
  return posix
}

/**
 * Читає `.n-rules.json` з кореня та повертає нормалізовані ignore-шляхи.
 * Якщо файлу нема, поле `ignore` відсутнє чи має невалідний формат — повертає порожній масив.
 * Сам конфіг не валідується (це робить v8r/окрема перевірка) — лише поле `ignore`.
 * @param {string} root абсолютний корінь репозиторію
 * @returns {Promise<string[]>} абсолютні posix-шляхи без trailing-slash
 */
export async function loadCursorIgnorePaths(root) {
  let file = join(root, CONFIG_FILE)
  if (!existsSync(file)) file = join(root, LEGACY_CONFIG_FILE)
  if (!existsSync(file)) return []
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return []
  }
  const list = raw?.ignore
  if (!Array.isArray(list)) return []
  /** @type {string[]} */
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const v = item.trim()
    if (v.length === 0) continue
    out.push(toAbsPosix(root, v))
  }
  return out
}
