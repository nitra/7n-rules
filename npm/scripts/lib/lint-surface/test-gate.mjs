/**
 * Test-gate верифікація для non-T0 (LLM) fix-ladder rung-ів (spec addendum
 * 2026-07-24, ladder-collateral-in-file).
 *
 * `collateral-veto.mjs` детектує колатеральні правки лише ПОЗА target-set (інші
 * файли) — правки ВСЕРЕДИНІ вже-таргетованого файлу (напр. видалення навмисного,
 * задокументованого workaround поряд із фіксованим порушенням) ним не покриваються,
 * а canonical re-detect бачить лише той самий детектор/те саме порушення, тож теж
 * не ловить. Test-gate — легша альтернатива hunk-level diff (доки не реалізовано):
 * якщо rung торкнувся файлу з target-set, для якого існує сестринський тест-файл за
 * конвенцією `<dir>/tests/<stem>.test.{mjs,js,ts}` (n-test.mdc), той тест
 * виконується як частина verify. Провал тесту → veto (як і collateral), rollback.
 *
 * Fail-open за дизайном (як і collateral-veto): відсутній test-runner (`bunx`/vitest
 * недоступні), таймаут чи інша інфраструктурна помилка — НЕ блокує rung. Мета —
 * зловити семантичну регресію, а не стати новою точкою відмови ladder-а.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'

const TEST_SUFFIXES = ['.test.mjs', '.test.js', '.test.ts']
const SOURCE_SUFFIXES = ['.mjs', '.js', '.ts', '.vue']

/** Таймаут одного тест-файлу (fail-open — вважається "не зламано" при перевищенні). */
const TEST_RUN_TIMEOUT_MS = 30_000

/**
 * Сестринські тест-файли за конвенцією `<dir>/tests/<stem>.test.*` (n-test.mdc,
 * той самий шаблон, що й зворотний `inferSourcePath` у coverage-provider).
 * @param {string} sourceAbsPath Абсолютний шлях вихідного файлу.
 * @returns {string[]} Наявні на диску сестринські тест-файли (може бути порожньо).
 */
export function findSiblingTestFiles(sourceAbsPath) {
  const base = basename(sourceAbsPath)
  const suffix = SOURCE_SUFFIXES.find(s => base.endsWith(s))
  if (!suffix) return []
  const stem = base.slice(0, -suffix.length)
  const testsDir = join(dirname(sourceAbsPath), 'tests')
  return TEST_SUFFIXES.map(ext => join(testsDir, `${stem}${ext}`)).filter(existsSync)
}

/**
 * Виконує один тест-файл через vitest. Fail-open на будь-яку інфраструктурну
 * помилку (bunx/vitest відсутній, spawn error, таймаут) — повертає `passed: true`,
 * щоб test-gate ніколи не блокував ladder через відсутність test-runner-а.
 * @param {string} testAbsPath Абсолютний шлях тест-файлу.
 * @param {string} cwd Робоча директорія запуску.
 * @returns {{ passed: boolean, output: string }} Результат прогону.
 */
export function runTestFile(testAbsPath, cwd) {
  let result
  try {
    result = spawnSync('bunx', ['vitest', 'run', '--reporter=verbose', testAbsPath], {
      cwd,
      encoding: 'utf8',
      timeout: TEST_RUN_TIMEOUT_MS,
      env: process.env
    })
  } catch {
    return { passed: true, output: '' }
  }
  // result.error — spawn сам не зміг стартувати (ENOENT тощо); status===null — вбито
  // за таймаутом. Обидва — інфраструктурна невдача, не сигнал про код; fail-open.
  if (result.error || result.status === null) return { passed: true, output: '' }
  return { passed: result.status === 0, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-2000) }
}

/**
 * Test-gate над файлами, зміненими rung-ом В МЕЖАХ target-set (не колатеральними,
 * ті вже покриті collateral-veto): перший сестринський тест, що впав, зупиняє
 * пошук — цього достатньо, щоб відхилити clean-вердикт rung-а.
 * @param {{ files: string[], cwd: string, runTest?: typeof runTestFile }} args files —
 *   абсолютні шляхи наявних файлів у target-set, змінених rung-ом; cwd — робоча
 *   директорія запуску тестів; runTest — override test-runner-а (тести цього модуля).
 * @returns {{ file: string, testFile: string, output: string } | null} Перший
 *   зафіксований провал або null, якщо всі сестринські тести (за наявності) пройшли.
 */
export function findBrokenSiblingTests({ files, cwd, runTest = runTestFile }) {
  for (const file of files) {
    for (const testFile of findSiblingTestFiles(file)) {
      const { passed, output } = runTest(testFile, cwd)
      if (!passed) return { file, testFile, output }
    }
  }
  return null
}
