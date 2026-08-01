/**
 * Parity-гейт R1 фази 7 (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`
 * §4, другий зріз після `lint_plan`/P1): звіряє native `renderViolations`/
 * `sortAndRenderViolations` (`crates/rules-core/src/lint_render.rs` через
 * `rules-napi`) проти ЗАМОРОЖЕНОЇ копії старого JS-алгоритму
 * (`sortViolations`/`violationLine` з `run-detectors.mjs`,
 * `renderViolations`/`formatViolation` з `render.mjs` — обидва видалені з
 * продакшн-коду після цього гейту). Копії тут — навмисно НЕ імпорт із
 * продакшн-модулів (ті більше не містять цих гілок): незалежний
 * reference-oracle на синтетичних фікстурах — колізії ключів сортування,
 * українські повідомлення, відсутній `file`, warn-severity, `data.line`.
 */
import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'

// --- Заморожені копії старого JS-алгоритму (до видалення з run-detectors.mjs/render.mjs) ---

/**
 * @typedef {{ ruleId: string, concernId: string, reason: string, message: string, file?: string, severity?: string, data?: object }} LegacyViolation
 */

/**
 * Точна копія `violationLine` (`run-detectors.mjs:553-556`, до видалення).
 * @param {LegacyViolation} v порушення.
 * @returns {number} номер рядка або 0.
 */
function legacyViolationLine(v) {
  const line = v.data && typeof v.data === 'object' ? v.data.line : undefined
  return typeof line === 'number' ? line : 0
}

/**
 * Точна копія `sortViolations` (`run-detectors.mjs:565-574`, до видалення).
 * @param {LegacyViolation[]} violations вхідний масив.
 * @returns {LegacyViolation[]} стабільно сортований масив.
 */
function legacySortViolations(violations) {
  return violations.toSorted(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.concernId.localeCompare(b.concernId) ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      legacyViolationLine(a) - legacyViolationLine(b) ||
      a.reason.localeCompare(b.reason)
  )
}

/**
 * Точна копія `formatViolation` (`render.mjs:13-17`, до видалення).
 * @param {LegacyViolation} v порушення.
 * @returns {string} відформатований рядок.
 */
function legacyFormatViolation(v) {
  const mark = v.severity === 'warn' ? '⚠' : '❌'
  const loc = v.file ? ` → ${v.file}` : ''
  return `  ${mark} ${v.ruleId}/${v.concernId}${loc} (${v.reason}): ${v.message}`
}

/**
 * Точна копія `renderViolations` (`render.mjs:24-40`, до видалення) —
 * insertion-order групування, БЕЗ сортування.
 * @param {LegacyViolation[]} violations перелік порушень.
 * @returns {string} згрупований текст (порожній рядок, якщо порожньо).
 */
function legacyRenderViolations(violations) {
  if (violations.length === 0) return ''
  const byConcern = new Map()
  for (const v of violations) {
    const key = `${v.ruleId}/${v.concernId}`
    const arr = byConcern.get(key)
    if (arr) arr.push(v)
    else byConcern.set(key, [v])
  }
  const blocks = []
  for (const [key, vs] of byConcern) {
    blocks.push(`${key} — ${vs.length} порушення:`)
    for (const v of vs) blocks.push(legacyFormatViolation(v))
  }
  return blocks.join('\n') + '\n'
}

/**
 * Точна копія exit-code гілки `detectAll` (`run-detectors.mjs:648-658`, до видалення).
 * @param {number} violationsCount кількість violations.
 * @param {string|null} infraMessage повідомлення інфра-помилки, чи null.
 * @returns {0|1|2} exit-code.
 */
function legacyExitCode(violationsCount, infraMessage) {
  if (infraMessage !== null) return 2
  return violationsCount > 0 ? 1 : 0
}

// --- Синтетичні фікстури -----------------------------------------------------

/** Колізії ключів сортування (однакові ruleId/concernId, різні file/line/reason). */
const FIXTURE_KEY_COLLISIONS = [
  { ruleId: 'probe', concernId: 'check', reason: 'z-reason', message: 'm1', file: 'b.txt' },
  { ruleId: 'probe', concernId: 'check', reason: 'a-reason', message: 'm2', file: 'a.txt', data: { line: 5 } },
  { ruleId: 'probe', concernId: 'check', reason: 'm-reason', message: 'm3', file: 'a.txt' }, // без line → 0
  { ruleId: 'probe', concernId: 'check', reason: 'x-reason', message: 'm4', file: 'a.txt', data: { line: 1 } }
]

/** Українські повідомлення — перевірка, що кирилиця не ламає ані сортування, ані рендер. */
const FIXTURE_UKRAINIAN = [
  { ruleId: 'text', concernId: 'forbidden', reason: 'crc-mismatch', message: 'документація застаріла: невірний CRC' },
  { ruleId: 'security', concernId: 'sample_secret', reason: 'secret-found', message: 'знайдено секрет у файлі' },
  {
    ruleId: 'k8s',
    concernId: 'dremio_logging',
    reason: 'zk-logback-root-level',
    message: 'zookeeper.yaml: невірний рівень логування'
  }
]

/** Відсутній `file` — має сортуватись як порожній рядок (перед будь-яким реальним шляхом). */
const FIXTURE_MISSING_FILE = [
  { ruleId: 'probe', concernId: 'check', reason: 'r1', message: 'm1', file: 'a.txt' },
  { ruleId: 'probe', concernId: 'check', reason: 'r2', message: 'm2' },
  { ruleId: 'probe', concernId: 'check', reason: 'r3', message: 'm3', file: '' }
]

/**
 * Мішанина `warn`/`error`(дефолт) severity — впливає лише на рендер-марку, не
 * на сортування. Обидва боки контракту (JS `normalizeViolation` і native
 * `Severity`, doc-комент `crate::diagnostics`) гарантують лише ці два
 * значення НА ВХОДІ sort/render-контуру — довільні рядки severity сюди не
 * потрапляють (нормалізація стається РАНІШЕ, до цього шару).
 */
const FIXTURE_WARN_SEVERITY = [
  { ruleId: 'probe', concernId: 'check', reason: 'deprecated', message: 'old api', severity: 'warn' },
  { ruleId: 'probe', concernId: 'check', reason: 'broken', message: 'still broken', severity: 'error' },
  { ruleId: 'probe', concernId: 'check', reason: 'absent-severity', message: 'дефолт без поля' }
]

/** `data.line` — числові й нечислові значення, впереміш із concern-ами без `data` взагалі. */
const FIXTURE_DATA_LINE = [
  {
    ruleId: 'js',
    concernId: 'eslint',
    reason: 'no-unused-vars',
    message: 'x unused',
    file: 'a.mjs',
    data: { line: 10 }
  },
  {
    ruleId: 'js',
    concernId: 'eslint',
    reason: 'no-unused-vars',
    message: 'y unused',
    file: 'a.mjs',
    data: { line: 2 }
  },
  {
    ruleId: 'js',
    concernId: 'eslint',
    reason: 'no-unused-vars',
    message: 'z unused',
    file: 'a.mjs',
    data: { line: 'not-a-number' }
  },
  { ruleId: 'js', concernId: 'eslint', reason: 'no-unused-vars', message: 'w unused', file: 'a.mjs' }
]

/** Кілька rule/concern груп упереміш — перевіряє і сортування, і insertion-order групування ПІСЛЯ сортування. */
const FIXTURE_MULTI_GROUP = [
  { ruleId: 'zzz', concernId: 'c', reason: 'r', message: 'm-zzz' },
  { ruleId: 'aaa', concernId: 'b', reason: 'r', message: 'm-aaa-b' },
  { ruleId: 'aaa', concernId: 'a', reason: 'r', message: 'm-aaa-a' },
  { ruleId: 'zzz', concernId: 'c', reason: 'q', message: 'm-zzz-2' }
]

/**
 * Колація ICU root ⇄ байти — регресія на клас, який попередні фікстури
 * не покривали (усі були kebab-case, тож розбіжність лишалась невидимою).
 * На КОЖНІЙ парі нижче `localeCompare` і байтове порівняння дають
 * ПРОТИЛЕЖНИЙ порядок: `_` перед `-`, велика літера після малої.
 * Ідентифікатори реальні — `stryker_config`, `doc_comments`,
 * `header_doc_pointer` є в цьому репо, як і шляхи з `package_knowledge`.
 */
const FIXTURE_COLLATION = [
  { ruleId: 'test', concernId: 'stryker-config', reason: 'r', message: 'm1', file: 'npm/rules/doc-files/a.md' },
  { ruleId: 'test', concernId: 'stryker_config', reason: 'r', message: 'm2', file: 'npm/rules/doc_files/b.md' },
  { ruleId: 'js', concernId: 'doc-comments', reason: 'r', message: 'm3', file: 'npm/rules/z_a/package-json.md' },
  { ruleId: 'js', concernId: 'doc_comments', reason: 'r', message: 'm4', file: 'npm/rules/z_a/package_knowledge.md' },
  { ruleId: 'Npm-module', concernId: 'header_doc_pointer', reason: 'r', message: 'm5' },
  { ruleId: 'npm-module', concernId: 'header-doc-pointer', reason: 'r', message: 'm6' }
]

const FIXTURES = [
  { label: 'колізії ключів сортування (file/line/reason)', violations: FIXTURE_KEY_COLLISIONS },
  { label: 'колація ICU root: _ перед -, великі після малих', violations: FIXTURE_COLLATION },
  { label: 'українські повідомлення', violations: FIXTURE_UKRAINIAN },
  { label: 'відсутній file', violations: FIXTURE_MISSING_FILE },
  { label: 'warn/error/absent severity', violations: FIXTURE_WARN_SEVERITY },
  { label: 'data.line числові/нечислові/відсутні', violations: FIXTURE_DATA_LINE },
  { label: 'кілька rule/concern груп упереміш', violations: FIXTURE_MULTI_GROUP },
  { label: 'порожній вхід', violations: [] }
]

/**
 * Нормалізує порушення для порівняння `sorted`-виходу: native завжди
 * серіалізує `severity` явно (`error` дефолт, doc-комент `LintViolation` у
 * `crates/rules-core/src/lint_render.rs`), тоді як «сирі» фікстури тут (як і
 * в реальному пайплайні ДО `normalizeViolation`) можуть не мати ключа
 * `severity` взагалі — сама відсутність ключа не є семантичною різницею
 * (обидва означають `'error'`). Проєкція на явний `severity`/`file`/`data`
 * робить `toEqual` звіркою ЗМІСТУ, не сирої форми вхідного об'єкта.
 * @param {LegacyViolation} v порушення.
 * @returns {object} нормалізована проєкція для порівняння.
 */
function normalizeForCompare(v) {
  return {
    ruleId: v.ruleId,
    concernId: v.concernId,
    reason: v.reason,
    message: v.message,
    file: v.file ?? null,
    severity: v.severity === 'warn' ? 'warn' : 'error',
    data: v.data ?? null
  }
}

describe('lint_render native ⇄ JS-reference parity (R1 фази 7)', () => {
  for (const { label, violations } of FIXTURES) {
    describe(`fixture: ${label}`, () => {
      test('renderViolations (без сортування) — insertion-order групування', () => {
        const native = loadNative().renderViolations(violations)
        const legacy = legacyRenderViolations(violations)
        expect(native).toEqual(legacy)
      })

      test('sortAndRenderViolations.sorted === sortViolations', () => {
        const { sorted } = loadNative().sortAndRenderViolations({ violations, infraMessage: null })
        const legacy = legacySortViolations(violations)
        expect(sorted.map(x => normalizeForCompare(x))).toEqual(legacy.map(x => normalizeForCompare(x)))
      })

      test('sortAndRenderViolations.rendered === renderViolations(sortViolations(...))', () => {
        const { rendered } = loadNative().sortAndRenderViolations({ violations, infraMessage: null })
        const legacy = legacyRenderViolations(legacySortViolations(violations))
        expect(rendered).toEqual(legacy)
      })

      test('sortAndRenderViolations.exitCode без infra-помилки', () => {
        const { exitCode } = loadNative().sortAndRenderViolations({ violations, infraMessage: null })
        expect(exitCode).toBe(legacyExitCode(violations.length, null))
      })

      test('sortAndRenderViolations.exitCode з infra-помилкою домінує над violations', () => {
        const { exitCode } = loadNative().sortAndRenderViolations({ violations, infraMessage: 'boom' })
        expect(exitCode).toBe(legacyExitCode(violations.length, 'boom'))
        expect(exitCode).toBe(2)
      })
    })
  }
})
