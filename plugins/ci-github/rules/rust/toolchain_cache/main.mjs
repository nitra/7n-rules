/**
 * @see ./docs/main.md
 *
 * Read-only detector: у кожному `.github/workflows/*.yml` кожен job, що ставить
 * Rust toolchain через `dtolnay/rust-toolchain@stable`, повинен мати
 * `Swatinem/rust-cache@v2` десь пізніше у тому самому job-і (lint, coverage,
 * Tauri release/build — незалежно від job-а чи файлу; rust.mdc). Якщо job також
 * запускає `tauri-apps/tauri-action` і Cargo.toml лежить не в корені репо, а під
 * `src-tauri/`, кеш-крок повинен мати `with.workspaces` на цей каталог.
 *
 * Текстовий (не YAML-AST) аналіз — навмисно, як `ga/workflows/main.mjs`: мінімізує
 * diff і не залежить від того, чи canonical formatter зберігає коментарі при
 * round-trip через YAML-парсер. Job-межа визначається через indentation:
 * будь-який рядок з відступом меншим за відступ dash-а кроку означає вихід
 * зі step-list-а (наступний job або кінець `jobs:`).
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

export const MISSING_RUST_CACHE = 'missing-rust-cache'
export const MISSING_RUST_CACHE_WORKSPACES = 'missing-rust-cache-workspaces'

export const TOOLCHAIN_RE = /uses:\s*dtolnay\/rust-toolchain@/u
export const CACHE_RE = /uses:\s*Swatinem\/rust-cache@/u
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
 * @param {number} dashCol колонка dash-а step-list-а job-а (межа dedent-у)
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
export function scanToolchainSteps(content) {
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
 * Каталог Rust-workspace-а для `Swatinem/rust-cache` `with.workspaces`, якщо
 * `Cargo.toml` не в корені репо, а під `src-tauri/` (типовий Tauri-layout).
 * `undefined`, якщо корінь репо вже є workspace-коренем (окремий крок не потрібен).
 * @param {string} cwd корінь проєкту
 * @returns {string|undefined} відносний шлях workspace-а або `undefined`
 */
export function tauriWorkspaceDir(cwd) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return
  return existsSync(join(cwd, 'src-tauri', 'Cargo.toml')) ? 'src-tauri' : undefined
}

/**
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const wfDir = join(cwd, '.github', 'workflows')
  if (!existsSync(wfDir)) return reporter.result()

  const workspaceDir = tauriWorkspaceDir(cwd)
  const entries = await readdir(wfDir)
  const workflowFiles = entries.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))

  for (const name of workflowFiles) {
    const abs = join(wfDir, name)
    const rel = relative(cwd, abs)
    const content = await readFile(abs, 'utf8')
    for (const step of scanToolchainSteps(content)) {
      if (!step.hasCache) {
        reporter.fail(
          `${rel}: job зі \`dtolnay/rust-toolchain@stable\` потребує \`Swatinem/rust-cache@v2\` одразу після (rust.mdc)`,
          { reason: MISSING_RUST_CACHE, file: rel, data: { kind: MISSING_RUST_CACHE } }
        )
        continue
      }
      if (workspaceDir && step.jobHasTauriAction && !step.cacheHasWorkspaces) {
        reporter.fail(
          `${rel}: Swatinem/rust-cache@v2 у Tauri-job-і потребує \`with.workspaces: ${workspaceDir}\` (rust.mdc)`,
          {
            reason: MISSING_RUST_CACHE_WORKSPACES,
            file: rel,
            data: { kind: MISSING_RUST_CACHE_WORKSPACES, workspaceDir }
          }
        )
      }
    }
  }
  return reporter.result()
}
