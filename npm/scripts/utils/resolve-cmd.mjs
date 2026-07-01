/**
 * Утиліта для розв'язання абсолютного шляху до команди в PATH.
 *
 * Використовується для виклику зовнішніх інструментів через абсолютний шлях
 * замість команди з PATH (sonarjs/no-os-command-from-path).
 */
import { spawnSync } from 'node:child_process'
import { platform } from 'node:process'

/**
 * Повертає абсолютний шлях до команди в PATH або null, якщо команда не знайдена.
 * @param {string} cmd ім'я команди без шляху
 * @returns {string | null} абсолютний шлях або null
 */
export function resolveCmd(cmd) {
  const whichCmd = platform === 'win32' ? 'where' : 'which'
  // Явно передаємо `process.env`, інакше Bun вмикає snapshot оточення на старті процесу
  // і не бачить змін `process.env.PATH` у runtime (типова ситуація — підстановка стабів у тестах).
  const result = spawnSync(whichCmd, [cmd], { encoding: 'utf8', env: process.env })
  if (result.status !== 0 || result.error) {
    return null
  }
  const line = result.stdout.trim().split('\n', 1)[0].trim()
  return line || null
}
