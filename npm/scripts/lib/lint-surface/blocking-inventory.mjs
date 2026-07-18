/**
 * Інвентар concern-ів, чий detector ще НЕ доведений на async non-blocking шлях
 * (ADR 260716-1354-внутрішній-паралелізм-lint-оркестратора). `detectAll()` виконує
 * ці concern-и у serial lane (строго послідовно, ніколи не перекриваючись самі із
 * собою) — не заявляємо паралелізм там, де detector все ще звертається до `spawnSync`/
 * `execSync` (прямо або через спільний helper), бо це блокує event loop цілком і
 * зробило б паралельний пул ілюзорним.
 *
 * Нова міграція (наступний shared helper на `spawnAsync`, за протоколом
 * `runConftestBatch`/`runOxlintJson`): переведи helper → онови caller-и (`await`) →
 * прибери відповідний запис звідси → розшир `docs/blocking-inventory-guard.test.mjs`
 * (guard-тест сам перевірить, що жоден із них більше не викликає `spawnSync`/`execSync`).
 */

/**
 * Concern-и з прямим `spawnSync`/`execSync` у власному `main.mjs` — кожен спавнить свій
 * зовнішній тул напряму, ще не через `spawnAsync`.
 */
const DIRECT_SPAWN_CONCERNS = [
  'text/run-dotenv-linter',
  'text/oxfmt',
  'text/cspell-fix',
  'text/run-v8r',
  'text/run-shellcheck',
  'image-compress/check',
  'php/phpcs',
  'php/project',
  'php/cs_fixer',
  'js/jscpd_duplicates',
  'k8s/manifests',
  'style/lint',
  'bun/licensee',
  'python/ruff',
  'python/project',
  'python/mypy',
  'security/scan',
  'rust/check',
  'rego/conftest_verify'
]

/**
 * Concern-и, чий detector сам не викликає `spawnSync`/`execSync`, але делегує спільному
 * helper-у, який його викликає: `docker/lib/docker-hadolint.mjs` (hadolint) і
 * `rego/lib/run-external-tool.mjs` (regal/opa).
 */
const SHARED_HELPER_CONCERNS = ['docker/lint', 'rego/regal', 'rego/opa_check']

/** Повний serial-lane список: `${ruleId}/${concernId}` — 19 прямих + 3 через shared helper = 22. */
export const SERIAL_LANE_CONCERNS = new Set([...DIRECT_SPAWN_CONCERNS, ...SHARED_HELPER_CONCERNS])

/**
 * Чи concern лишається у serial lane `detectAll()` (недоведений non-blocking).
 * @param {string} ruleId id правила
 * @param {string} concernId id concern-а
 * @returns {boolean} true — serial lane; false — parallel-safe
 */
export function isSerialLane(ruleId, concernId) {
  return SERIAL_LANE_CONCERNS.has(`${ruleId}/${concernId}`)
}
