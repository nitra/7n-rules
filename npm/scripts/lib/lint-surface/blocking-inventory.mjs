/**
 * Інвентар concern-ів, чий detector ще НЕ доведений на async non-blocking шлях
 * (ADR 260716-1354-внутрішній-паралелізм-lint-оркестратора). `detectAll()` виконує
 * ці concern-и у serial lane (строго послідовно, ніколи не перекриваючись самі із
 * собою) — не заявляємо паралелізм там, де detector все ще звертається до `spawnSync`/
 * `execSync` (прямо або через спільний helper), бо це блокує event loop цілком і
 * зробило б паралельний пул ілюзорним.
 *
 * Список зараз порожній: усі 22 concern-и, що на момент ADR мали прямий чи
 * shared-helper `spawnSync`/`execSync`, мігровано на `spawnAsync`
 * (`npm/scripts/utils/spawn-async.mjs`). Інвентар лишається як живий guard —
 * `tests/blocking-inventory.test.mjs` сканує активні concern-и репо і провалиться,
 * щойно новий (чи regressed) concern звернеться до `spawnSync`/`execSync` без
 * відповідного запису тут.
 *
 * Протокол для нового blocking concern-а: перевести на `spawnAsync` → оновити
 * caller-и (`await`) → якщо міграція ще не завершена, додати запис сюди на час
 * переходу; guard-тест сам підтвердить, коли можна прибрати.
 */
export const SERIAL_LANE_CONCERNS = new Set()

/**
 * Чи concern лишається у serial lane `detectAll()` (недоведений non-blocking).
 * @param {string} ruleId id правила
 * @param {string} concernId id concern-а
 * @returns {boolean} true — serial lane; false — parallel-safe
 */
export function isSerialLane(ruleId, concernId) {
  // eslint-disable-next-line sonarjs/no-empty-collection -- навмисно порожній зараз (протокол вище); живий registry, не dead code
  return SERIAL_LANE_CONCERNS.has(`${ruleId}/${concernId}`)
}
