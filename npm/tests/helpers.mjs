/**
 * Допоміжні функції для тестів скриптів пакета `@nitra/cursor`: тимчасові каталоги та запис JSON.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

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

/**
 * Створює тимчасовий каталог із порожнім виконуваним `shellcheck` (`shellcheck.exe` на Windows),
 * додає каталог на початок `PATH` для тривалості `fn` і потім відновлює оригінальний `PATH`.
 *
 * Дозволяє ганяти `check ga` у тестах на машинах без реального shellcheck — `resolveCmd('shellcheck')`
 * усе одно знайде стаб через PATH і `which`/`where`. Реальний shellcheck не запускається.
 * @param {() => void | Promise<void>} fn виконується з підставленим shellcheck-стабом
 * @returns {Promise<void>}
 */
export async function withShellcheckStubInPath(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'n-cursor-shellcheck-stub-'))
  const isWin = platform === 'win32'
  const stub = join(dir, isWin ? 'shellcheck.exe' : 'shellcheck')
  await writeFile(stub, isWin ? '' : '#!/bin/sh\nexit 0\n', 'utf8')
  if (!isWin) await chmod(stub, 0o755)
  const prevPath = env.PATH
  env.PATH = `${dir}${delimiter}${prevPath ?? ''}`
  try {
    await fn()
  } finally {
    if (prevPath === undefined) {
      delete env.PATH
    } else {
      env.PATH = prevPath
    }
    await rm(dir, { recursive: true, force: true })
  }
}
