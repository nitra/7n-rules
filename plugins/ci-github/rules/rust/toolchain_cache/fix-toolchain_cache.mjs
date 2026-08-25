/** @see ./docs/fix-toolchain_cache.md */

/**
 * T0-autofix для `rust/toolchain_cache` — детерміновано вставляє
 * `Swatinem/rust-cache@v2` одразу після кожного `dtolnay/rust-toolchain@…` кроку,
 * якому його бракує у своєму job-і, і дописує `with.workspaces` у Tauri-job-ах,
 * де Cargo.toml не в корені репо. Текстові splice-и (як `ga/workflows/fix-workflows.mjs`) —
 * зберігають коментарі/формат, мінімальний diff. Ідемпотентно: `scanToolchainSteps`
 * заново перевіряє стан файла на кожному прогоні.
 *
 * `scanToolchainSteps` (і решта сканувального рушія нижче — `TOOLCHAIN_RE`/
 * `CACHE_RE`/`TAURI_ACTION_RE`/`WORKSPACES_KEY_RE`/`indentOf`/`dashColFor`/
 * `scanJobForCache`/`cacheStepHasWorkspaces`) переїхали СЮДИ з видаленого
 * `main.mjs`: канон детекту тепер `detect_toolchain_cache` wasm-гостя
 * `crates/plugin-ci-github`, і фіксер лишився ЄДИНИМ JS-споживачем цього
 * коду. `tauriWorkspaceDir` і сам `lint()` — НЕ перенесені, вони вмирали разом
 * із детектором (фіксер їх не використовував; перевірено grep-ом по репо).
 * Раніше експортовані символи стали локальними — ніхто ззовні на них не
 * посилався (перевірено тим самим grep-ом).
 *
 * Значення `MISSING_RUST_CACHE`/`MISSING_RUST_CACHE_WORKSPACES` мусять
 * збігатися з reason-рядками гостя БАЙТ-У-БАЙТ — інакше `patterns[].test`
 * нижче не побачить порушень, які гість реально видає, і T0-фікс тихо
 * перестане спрацьовувати. Звірку тримає `tests/fix-toolchain_cache.test.mjs`
 * (T0 round-trip-сценарій через `runWasmConcern`) і parity-гейт
 * (`npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-ci-github.test.mjs`).
 */
import { applyToFiles } from '@7n/rules/scripts/utils/apply-to-files.mjs'

/** Reason-код: job ставить Rust toolchain, але не має кроку `Swatinem/rust-cache@v2`. */
const MISSING_RUST_CACHE = 'missing-rust-cache'
/** Reason-код: кеш-крок Tauri-job-а без `with.workspaces` на каталог `src-tauri`. */
const MISSING_RUST_CACHE_WORKSPACES = 'missing-rust-cache-workspaces'

/** Рядок кроку встановлення Rust toolchain (`dtolnay/rust-toolchain@…`). */
const TOOLCHAIN_RE = /uses:\s*dtolnay\/rust-toolchain@/u
/** Рядок кроку кешування Cargo-артефактів (`Swatinem/rust-cache@…`). */
const CACHE_RE = /uses:\s*Swatinem\/rust-cache@/u
const TAURI_ACTION_RE = /uses:\s*tauri-apps\/tauri-action@/u
const WORKSPACES_KEY_RE = /^\s*workspaces\s*:/u

/**
 * Відступ рядка (кількість пробілів перед першим непробільним символом).
 * @param {string} line рядок файла
 * @returns {number} кількість пробілів відступу
 */
function indentOf(line) {
  return line.length - line.trimStart().length
}

/**
 * Дашова колонка кроку (`- uses: …`) з колонки `uses:`. Захист від негативного
 * значення для нетипового форматування (dash не на тому ж рядку).
 * @param {number} usesCol колонка підрядка `uses:`
 * @returns {number} колонка dash-а (не менше 0)
 */
function dashColFor(usesCol) {
  return Math.max(usesCol - 2, 0)
}

/**
 * Один запис аналізу `dtolnay/rust-toolchain` кроку в межах його job-а (обмеженого
 * indentation-dedent-ом, без явного YAML-парсу job-структури).
 * @typedef {object} ToolchainStepScan
 * @property {number} line індекс рядка кроку `dtolnay/rust-toolchain@…`
 * @property {number} dashCol колонка dash-а кроку (рівень step-list-а job-а)
 * @property {boolean} hasCache чи є `Swatinem/rust-cache@…` пізніше в тому самому job-і
 * @property {number} cacheLine індекс рядка кеш-кроку (−1, якщо відсутній)
 * @property {boolean} cacheHasWorkspaces чи кеш-крок вже має ключ `workspaces`
 * @property {boolean} jobHasTauriAction чи job також викликає `tauri-apps/tauri-action`
 */

/**
 * Сканує job від рядка ОДРАЗУ ПІСЛЯ toolchain-кроку до dedent-у: шукає перший
 * `Swatinem/rust-cache@…` крок і чи job також викликає `tauri-apps/tauri-action`.
 * @param {string[]} lines усі рядки файла
 * @param {number} fromLine рядок, з якого починати сканування (i + 1)
 * @param {number} dashCol колонка dash-а step-list-а job-а (межа dedent-у)
 * @returns {{hasCache: boolean, cacheLine: number, jobHasTauriAction: boolean}} результат сканування job-а
 */
function scanJobForCache(lines, fromLine, dashCol) {
  let hasCache = false
  let cacheLine = -1
  let jobHasTauriAction = false
  for (let j = fromLine; j < lines.length; j++) {
    const line = lines[j]
    if (line.trim() === '') continue
    if (indentOf(line) < dashCol) break // dedent → вийшли зі step-list-а цього job-а
    if (!hasCache && CACHE_RE.test(line)) {
      hasCache = true
      cacheLine = j
    }
    if (TAURI_ACTION_RE.test(line)) jobHasTauriAction = true
  }
  return { hasCache, cacheLine, jobHasTauriAction }
}

/**
 * Чи кеш-крок (`cacheLine`) уже має ключ `with.workspaces` у своєму блоці (до dedent-у).
 * @param {string[]} lines усі рядки файла
 * @param {number} cacheLine рядок кеш-кроку
 * @param {number} dashCol колонка даша step-list-а job-а (межа dedent-у)
 * @returns {boolean} true — ключ `workspaces` уже є
 */
function cacheStepHasWorkspaces(lines, cacheLine, dashCol) {
  for (let j = cacheLine + 1; j < lines.length; j++) {
    const line = lines[j]
    if (line.trim() === '') continue
    if (indentOf(line) < dashCol) break
    if (WORKSPACES_KEY_RE.test(line)) return true
  }
  return false
}

/**
 * Сканує вміст workflow-файла й повертає по одному запису на кожен
 * `dtolnay/rust-toolchain@…` крок, з інформацією про cache-крок і tauri-action
 * у тому самому job-і (обмежено indentation-dedent-ом).
 * @param {string} content вміст workflow-файла
 * @returns {ToolchainStepScan[]} записи аналізу
 */
function scanToolchainSteps(content) {
  const lines = content.split('\n')
  /** @type {ToolchainStepScan[]} */
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const usesCol = lines[i].indexOf('uses:')
    if (usesCol === -1 || !TOOLCHAIN_RE.test(lines[i])) continue
    const dashCol = dashColFor(usesCol)
    const { hasCache, cacheLine, jobHasTauriAction } = scanJobForCache(lines, i + 1, dashCol)
    const cacheHasWorkspaces = hasCache && cacheStepHasWorkspaces(lines, cacheLine, dashCol)
    out.push({ line: i, dashCol, hasCache, cacheLine, cacheHasWorkspaces, jobHasTauriAction })
  }
  return out
}

/**
 * Індекс першого рядка після step-блоку, що починається на `stepLine`
 * (dash-колонка `dashCol`) — перший рядок з відступом не більшим за `dashCol`
 * (сусідній крок того самого рівня або dedent), або EOF.
 * @param {string[]} lines усі рядки
 * @param {number} stepLine індекс рядка кроку (`- uses: …`)
 * @param {number} dashCol колонка dash-а кроку
 * @returns {number} індекс вставки (кінець блоку кроку)
 */
function stepBlockEnd(lines, stepLine, dashCol) {
  let j = stepLine + 1
  while (j < lines.length) {
    const line = lines[j]
    if (line.trim() !== '' && line.length - line.trimStart().length <= dashCol) break
    j++
  }
  return j
}

/**
 * Вставляє `Swatinem/rust-cache@v2` (з опційним `with.workspaces`) одразу після
 * кожного `dtolnay/rust-toolchain@…` кроку без cache-кроку в тому самому job-і.
 * @param {string} content вміст workflow-файла
 * @param {string} [workspaceDir] відносний шлях workspace-а для `with.workspaces` (опційно)
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function insertRustCache(content, workspaceDir) {
  const lines = content.split('\n')
  const missing = scanToolchainSteps(content).filter(s => !s.hasCache)
  if (missing.length === 0) return null

  /** @type {Array<{ at: number, text: string[] }>} */
  const inserts = []
  for (const step of missing) {
    const at = stepBlockEnd(lines, step.line, step.dashCol)
    const ind = ' '.repeat(step.dashCol)
    const text = [`${ind}- uses: Swatinem/rust-cache@v2`]
    if (workspaceDir && step.jobHasTauriAction) {
      text.push(`${ind}  with:`, `${ind}    workspaces: ${workspaceDir}`)
    }
    inserts.push({ at, text })
  }
  inserts.sort((a, b) => b.at - a.at) // згори вниз — індекси не зсуваються під час splice
  for (const ins of inserts) lines.splice(ins.at, 0, ...ins.text)
  return lines.join('\n')
}

/**
 * Дописує `with: workspaces: <dir>` у кожен уже наявний `Swatinem/rust-cache@…`
 * крок Tauri-job-а (`tauri-apps/tauri-action`), якому бракує `workspaces`.
 * @param {string} content вміст workflow-файла
 * @param {string} workspaceDir відносний шлях workspace-а
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function addCacheWorkspaces(content, workspaceDir) {
  const lines = content.split('\n')
  const targets = scanToolchainSteps(content).filter(s => s.hasCache && s.jobHasTauriAction && !s.cacheHasWorkspaces)
  if (targets.length === 0) return null

  /** @type {Array<{ at: number, text: string[] }>} */
  const inserts = []
  for (const step of targets) {
    const cacheLine = lines[step.cacheLine]
    const usesCol = cacheLine.indexOf('uses:')
    const ind = ' '.repeat(usesCol)
    const at = stepBlockEnd(lines, step.cacheLine, usesCol - 2)
    inserts.push({ at, text: [`${ind}with:`, `${ind}  workspaces: ${workspaceDir}`] })
  }
  inserts.sort((a, b) => b.at - a.at)
  for (const ins of inserts) lines.splice(ins.at, 0, ...ins.text)
  return lines.join('\n')
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rust-toolchain-cache-insert',
    test: violations => violations.some(v => v.data?.kind === MISSING_RUST_CACHE && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_RUST_CACHE && v.file)
      const wsTargets = violations.filter(v => v.data?.kind === MISSING_RUST_CACHE_WORKSPACES)
      const workspaceDir = wsTargets.find(v => typeof v.data?.workspaceDir === 'string')?.data?.workspaceDir
      const touchedFiles = applyToFiles(targets, ctx, () => content => insertRustCache(content, workspaceDir))
      return touchedFiles.length > 0
        ? { touchedFiles, message: `Swatinem/rust-cache@v2 → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'rust-toolchain-cache-workspaces',
    test: violations => violations.some(v => v.data?.kind === MISSING_RUST_CACHE_WORKSPACES && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_RUST_CACHE_WORKSPACES && v.file)
      const touchedFiles = applyToFiles(targets, ctx, () => content => {
        const workspaceDir = targets.find(v => typeof v.data?.workspaceDir === 'string')?.data?.workspaceDir
        return workspaceDir ? addCacheWorkspaces(content, workspaceDir) : null
      })
      return touchedFiles.length > 0
        ? { touchedFiles, message: `with.workspaces → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  }
]
