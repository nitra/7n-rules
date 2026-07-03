/** @see ./docs/fix-toolchain_cache.md */

/**
 * T0-autofix для `rust/toolchain_cache` — детерміновано вставляє
 * `Swatinem/rust-cache@v2` одразу після кожного `dtolnay/rust-toolchain@…` кроку,
 * якому його бракує у своєму job-і, і дописує `with.workspaces` у Tauri-job-ах,
 * де Cargo.toml не в корені репо. Текстові splice-и (як `ga/workflows/fix-workflows.mjs`) —
 * зберігають коментарі/формат, мінімальний diff. Ідемпотентно: `scanToolchainSteps`
 * заново перевіряє стан файла на кожному прогоні.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MISSING_RUST_CACHE, MISSING_RUST_CACHE_WORKSPACES, scanToolchainSteps } from './main.mjs'

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

/**
 * Застосовує трансформер до унікальних файлів із violations і пише зміни.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення (джерело переліку файлів)
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, recordWrite)
 * @param {(content: string) => string|null} transformer текстовий трансформер
 * @returns {string[]} абсолютні шляхи змінених файлів
 */
function applyToFiles(violations, ctx, transformer) {
  const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
  /** @type {string[]} */
  const touchedFiles = []
  for (const rel of files) {
    const abs = join(ctx.cwd, rel)
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const next = transformer(content)
    if (next && next !== content) {
      ctx.recordWrite?.(abs)
      writeFileSync(abs, next)
      touchedFiles.push(abs)
    }
  }
  return touchedFiles
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rust-toolchain-cache-insert',
    test: violations => violations.some(v => v.data?.kind === MISSING_RUST_CACHE && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_RUST_CACHE && v.file)
      const wsTargets = violations.filter(v => v.data?.kind === MISSING_RUST_CACHE_WORKSPACES)
      const workspaceDir = wsTargets.find(v => typeof v.data?.workspaceDir === 'string')?.data?.workspaceDir
      const touchedFiles = applyToFiles(targets, ctx, content => insertRustCache(content, workspaceDir))
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
      const touchedFiles = applyToFiles(targets, ctx, content => {
        const workspaceDir = targets.find(v => typeof v.data?.workspaceDir === 'string')?.data?.workspaceDir
        return workspaceDir ? addCacheWorkspaces(content, workspaceDir) : null
      })
      return touchedFiles.length > 0
        ? { touchedFiles, message: `with.workspaces → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  }
]
