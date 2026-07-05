/**
 * Semantic-collateral veto для verdict-фази fix-pipeline
 * (spec docs/specs/2026-06-26-pi-fix-engine-migration.md §12, addendum 2026-07-05).
 *
 * Клас collateral слабких локальних моделей: «виправляючи» правило, модель робить
 * семантичну правку у сторонньому файлі, яка НЕ порушує жодного правила й тому
 * проходить canonical re-detect (живий кейс App.vue: хардкод версії `'0.3.0'` з
 * коментарем "we simulate it being available" замість наявного `await getVersion()`).
 *
 * Правило veto: rung не приймається, якщо він ЗМІНИВ наявний файл поза target-set
 * порушення. Нові файли дозволені — легітимний клас (scaffold, доки поряд із кодом);
 * їх однаково покриває re-check зачеплених файлів і rollback. Порожній target-set
 * (whole-repo концерни без `file` у violations) → veto незастосовний (fail-open,
 * повертає []) — свідомо, щоб не ламати концерни без file-атрибуції.
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * realpath шляху з найкращих зусиль: для наявного — повний realpath; для ще-неіснуючого —
 * realpath батьківської теки + basename; інакше — як є. Знімає розбіжність symlink-шляхів
 * (macOS `/tmp` → `/private/tmp`) між snapshot-ключами і target-set (той самий патерн,
 * що у write-guard llm-lib). Експортовано, щоб caller relativize-ив результати veto від
 * так само нормалізованого cwd.
 * @param {string} p шлях
 * @returns {string} нормалізований абсолютний шлях
 */
export function realpathBestEffort(p) {
  try {
    return realpathSync(p)
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p))
    } catch {
      return p
    }
  }
}

/**
 * Обчислює collateral-правки rung-а: наявні (на момент S1) файли, змінені поза
 * target-set порушення. Runner на непорожньому результаті відхиляє clean-вердикт
 * rung-а (rollback + feedback + телеметрія `kind:"collateral-veto"`).
 * @param {{ modifiedExisting: string[], targetFiles: string[], cwd: string }} args
 *   modifiedExisting — абсолютні шляхи наявних файлів, змінених відносно S1
 *   (`snapshot.modifiedExisting()`); targetFiles — файли порушення
 *   (`violations[].file ∪ item.files`), відносні до cwd або абсолютні.
 * @returns {string[]} нормалізовані абсолютні шляхи відхилених правок; порожньо —
 *   veto не спрацював (нема collateral або target-set невідомий)
 */
export function findCollateralEdits({ modifiedExisting, targetFiles, cwd }) {
  const targets = new Set(targetFiles.map(f => realpathBestEffort(isAbsolute(f) ? f : resolve(cwd, f))))
  if (targets.size === 0) return []
  return modifiedExisting.map(p => realpathBestEffort(p)).filter(abs => !targets.has(abs))
}
