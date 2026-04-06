/**
 * Допоміжні функції для тестів скриптів пакета `@nitra/cursor`: тимчасові каталоги та запис JSON.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Створює тимчасову директорію, тимчасово змінює `process.cwd()`, виконує `fn`, потім відкочує cwd і видаляє директорію.
 * @param {(dir: string) => void | Promise<void>} fn викликається з абсолютним шляхом до тимчасової директорії
 * @returns {Promise<void>} завершується після виконання `fn` і прибирання тимчасової директорії
 */
export async function withTmpCwd(fn) {
  const prev = process.cwd()
  const dir = await mkdtemp(join(tmpdir(), 'n-cursor-test-'))
  try {
    process.chdir(dir)
    await fn(dir)
  } finally {
    process.chdir(prev)
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Записує JSON-файл з типовим форматуванням і завершальним переносом рядка.
 * @param {string} relPath відносний шлях від cwd
 * @param {unknown} data об’єкт для серіалізації
 * @returns {Promise<void>}
 */
export async function writeJson(relPath, data) {
  await writeFile(relPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * Створює вкладені каталоги відносно cwd.
 * @param {string} relPath відносний шлях каталогу від поточного cwd
 * @returns {Promise<void>} завершується після створення каталогу (і батьківських сегментів)
 */
export async function ensureDir(relPath) {
  await mkdir(relPath, { recursive: true })
}
