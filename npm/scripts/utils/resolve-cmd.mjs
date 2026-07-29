/**
 * Утиліта для розв'язання абсолютного шляху до команди в PATH.
 *
 * Використовується для виклику зовнішніх інструментів через абсолютний шлях
 * замість команди з PATH (sonarjs/no-os-command-from-path).
 *
 * Реалізація — чистий JS-скан тек PATH, БЕЗ субпроцесу `which`/`where`:
 * spawn під навантаженим повним тест-прогоном транзієнтно падав (EAGAIN),
 * і «команда є» перетворювалось на null — порядко-залежні флейки гардів
 * на кшталт run-shellcheck. Скан читає `process.env.PATH` на кожен виклик,
 * тож runtime-підстановки PATH у тестах видимі одразу (на відміну від
 * Bun-снапшота оточення для дочірніх процесів).
 */
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { env, platform } from 'node:process'

const WINDOWS_DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/**
 * Чи є шлях виконуваним звичайним файлом (тека з ім'ям команди — не збіг).
 * @param {string} path абсолютний шлях-кандидат
 * @returns {boolean} true — існує, файл, виконуваний
 */
function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Суфікси-кандидати імені команди: POSIX — лише саме ім'я; Windows — саме ім'я
 * (якщо розширення вже вказане) плюс розширення з PATHEXT (семантика `where`).
 * @returns {string[]} суфікси, що додаються до імені команди
 */
function candidateSuffixes() {
  if (platform !== 'win32') return ['']
  return ['', ...(env.PATHEXT ?? WINDOWS_DEFAULT_PATHEXT).split(';').filter(Boolean)]
}

/**
 * Повертає абсолютний шлях до команди в PATH або null, якщо команда не знайдена.
 * @param {string} cmd ім'я команди без шляху
 * @returns {string | null} абсолютний шлях або null
 */
export function resolveCmd(cmd) {
  const suffixes = candidateSuffixes()
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const suffix of suffixes) {
      const candidate = join(dir, cmd + suffix)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}
