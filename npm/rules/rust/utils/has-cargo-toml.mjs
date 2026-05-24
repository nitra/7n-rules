/**
 * Rule-level applies-walker правила rust: рекурсивно шукає Cargo.toml у
 * cwd або будь-якому workspace-підкаталозі. Пропускає `node_modules`, `.git`,
 * `.next`, `.turbo` за тим самим списком, що `npm/scripts/auto-rules.mjs`.
 *
 * Утиліта rule-local, бо лише `rust` потребує "знайти Cargo.toml у дереві";
 * якщо з'явиться другий споживач — підняти у `npm/scripts/utils/`.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Чи присутній хоч один Cargo.toml у дереві `root` (синхронно, з раннім return).
 * @param {string} root абсолютний шлях кореня
 * @param {Set<string>} ignoredDirNames імена директорій, в які НЕ заходимо
 * @returns {boolean} true, якщо знайдено Cargo.toml
 */
export function hasCargoTomlInTree(root, ignoredDirNames) {
  /**
   * @param {string} dir абсолютний шлях каталогу для обходу
   * @returns {boolean} true якщо в піддереві є Cargo.toml
   */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'Cargo.toml') return true
      if (entry.isDirectory() && !ignoredDirNames.has(entry.name)) {
        if (walk(join(dir, entry.name))) return true
      }
    }
    return false
  }
  return walk(root)
}
