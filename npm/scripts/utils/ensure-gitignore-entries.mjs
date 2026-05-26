/**
 * Idempotent append-only модуль оновлення `.gitignore` у корені проєкту. Перевіряє,
 * чи задані entries уже присутні (точне співпадіння рядка після `trim`); відсутні
 * дописує під header-коментар, не порушуючи решту файлу. Якщо `.gitignore` немає —
 * створюється з заданими entries + header.
 *
 * Викликається з test-концерну `stryker_config` (gitignore Stryker temp dirs).
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь репо (де знаходиться `.gitignore`)
 * @param {string[]} entries патерни для .gitignore (порядок збережено)
 * @param {string} sectionLabel header-коментар над секцією (без `#`-префікса)
 * @returns {Promise<{added: string[]}>} перелік патернів, що були дописані
 */
export async function ensureGitignoreEntries(cwd, entries, sectionLabel) {
  const gitignorePath = join(cwd, '.gitignore')
  const existing = existsSync(gitignorePath) ? await readFile(gitignorePath, 'utf8') : ''
  const existingLines = new Set(existing.split('\n').map(line => line.trim()))
  const missing = entries.filter(entry => !existingLines.has(entry))
  if (missing.length === 0) return { added: [] }

  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  const block = `${prefix}\n# ${sectionLabel}\n${missing.join('\n')}\n`
  await writeFile(gitignorePath, existing + block)
  return { added: missing }
}
