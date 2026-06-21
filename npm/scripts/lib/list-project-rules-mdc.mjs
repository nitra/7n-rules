/**
 * Список `.mdc`-файлів правил у `.cursor/rules/` проєкту-споживача (відсортований).
 * Винесено зі `bin/n-cursor.js`, щоб ділити між CLI-dispatch і `run-conformance-check` (конформність-детект).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

/** Каталог правил у проєкті-споживачі (відносно кореня). */
export const CURSOR_RULES_DIR = '.cursor/rules'

/**
 * @param {string} [cwd] корінь проєкту
 * @returns {Promise<string[]>} імена `*.mdc` (відсортовані), або `[]` якщо каталогу немає
 */
export async function listProjectRulesMdcFiles(cwd = processCwd()) {
  const dir = join(cwd, CURSOR_RULES_DIR)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  return names.filter(n => n.endsWith('.mdc')).toSorted((a, b) => a.localeCompare(b))
}
