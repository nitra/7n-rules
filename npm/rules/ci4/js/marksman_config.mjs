/**
 * Концерн `marksman_config` правила ci4 (ci4.mdc): копіює canonical
 * `.marksman.toml` baseline у корінь cwd, якщо файлу ще немає.
 *
 * Marksman LSP читає `.marksman.toml` для визначення workspace-роота,
 * GLFM-флага (GitHub-Flavored Markdown), стилю wiki-links і code actions.
 * Дефолти marksman не вмикають GLFM і використовують `title-slug-ref` —
 * але portable subset з ci4.mdc вимагає GLFM (alerts/таблиці/todo) +
 * `file-stem` (ADR slug == ім'я файла). Без явного конфіга частина
 * marksman-функцій працює інакше, ніж задокументовано у правилі.
 *
 * Idempotent: якщо `.marksman.toml` вже існує (навіть з кастомним вмістом)
 * — не перетирається, тільки рапортується факт існування. Ручні правки
 * користувача зберігаються між прогонами.
 *
 * Файл скопійовано в `cwd`, бо marksman визначає workspace-root за
 * розташуванням свого `.marksman.toml`. У корені репо марксман бачить
 * і docs/, і README.md усіх workspaces одним workspace-ом.
 */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARKSMAN_BASELINE_PATH = join(HERE, 'data', 'marksman_config', 'marksman.baseline.toml')
const MARKSMAN_TARGET_FILENAME = '.marksman.toml'

/**
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK (створено або вже існує), 1 — baseline-файл пакета зламаний
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()

  if (!existsSync(MARKSMAN_BASELINE_PATH)) {
    reporter.fail(`canonical baseline не знайдено (${MARKSMAN_BASELINE_PATH}) — перевстанови @nitra/cursor`)
    return reporter.getExitCode()
  }

  const target = join(cwd, MARKSMAN_TARGET_FILENAME)
  if (existsSync(target)) {
    reporter.pass(`${MARKSMAN_TARGET_FILENAME} існує (${relative(cwd, target)})`)
    return reporter.getExitCode()
  }

  await copyFile(MARKSMAN_BASELINE_PATH, target)
  reporter.pass(`${MARKSMAN_TARGET_FILENAME} створено з canonical baseline (${relative(cwd, target)}) (ci4.mdc)`)
  return reporter.getExitCode()
}
