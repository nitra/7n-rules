/**
 * Module-singleton FS-walk cache, спільний для всіх concerns одного `check`-прогону.
 * Ключі — рядкові glob/regex дескриптори; значення — `Promise<string[]>` зі списком файлів.
 * Кеш живий у межах одного процесу (Node/Bun module-instance). Тести скидають через `resetWalkCache()`.
 */

/** @type {Map<string, Promise<string[]>> | null} */
let cache = null

/**
 * Повертає поточний cache; lazy-ініціалізує при першому виклику.
 * @returns {Map<string, Promise<string[]>>} module-singleton walk cache
 */
export function getOrCreateWalkCache() {
  if (cache === null) cache = new Map()
  return cache
}

/**
 * Скидає cache (для тестів між кейсами).
 */
export function resetWalkCache() {
  cache = new Map()
}
