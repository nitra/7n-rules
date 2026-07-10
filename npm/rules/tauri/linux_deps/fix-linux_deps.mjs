/** @see ./docs/fix-linux_deps.md */

/**
 * T0-autofix для `tauri/linux_deps` — детерміновано вставляє в
 * `.github/workflows/lint-rust.yml` канонічний крок системних залежностей Linux
 * перед `dtolnay/rust-toolchain@…`, або дописує відсутні пакети в уже наявний
 * `apt-get install`-рядок. Текстові splice-и (як `rust/toolchain_cache`) —
 * зберігають коментарі/формат, мінімальний diff. Ідемпотентно: `scanLinuxDeps`
 * заново перевіряє стан файла на кожному прогоні.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MISSING_LINUX_DEPS_PACKAGES,
  MISSING_LINUX_DEPS_STEP,
  REQUIRED_LINUX_PACKAGES,
  scanLinuxDeps
} from './main.mjs'

const TOOLCHAIN_RE = /uses:\s*dtolnay\/rust-toolchain@/u

/**
 * Вставляє канонічний apt-крок перед першим `dtolnay/rust-toolchain@…` кроком
 * (той самий рівень step-list-а). Якщо apt-крок уже є або toolchain-кроку немає
 * (нетипове форматування — лишаємо T1/LLM), нічого не змінює.
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function insertLinuxDepsStep(content) {
  if (scanLinuxDeps(content).aptLine !== -1) return null
  const lines = content.split('\n')
  const at = lines.findIndex(l => TOOLCHAIN_RE.test(l))
  if (at === -1) return null
  const usesCol = lines[at].indexOf('uses:')
  const ind = ' '.repeat(Math.max(usesCol - 2, 0))
  lines.splice(
    at,
    0,
    `${ind}- name: Системні залежності Tauri (Linux)`,
    `${ind}  run: |`,
    `${ind}    sudo apt-get update`,
    `${ind}    sudo apt-get install -y ${REQUIRED_LINUX_PACKAGES.join(' ')}`,
    ''
  )
  return lines.join('\n')
}

/**
 * Дописує відсутні канонічні пакети в кінець наявного `apt-get install`-рядка
 * (з урахуванням trailing `\` shell-continuation).
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function appendMissingPackages(content) {
  const { aptLine, missing } = scanLinuxDeps(content)
  if (aptLine === -1 || missing.length === 0) return null
  const lines = content.split('\n')
  const trimmed = lines[aptLine].trimEnd()
  lines[aptLine] = trimmed.endsWith('\\')
    ? `${trimmed.slice(0, -1).trimEnd()} ${missing.join(' ')} \\`
    : `${trimmed} ${missing.join(' ')}`
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
    id: 'tauri-linux-deps-insert',
    test: violations => violations.some(v => v.data?.kind === MISSING_LINUX_DEPS_STEP && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_LINUX_DEPS_STEP && v.file)
      const touchedFiles = applyToFiles(targets, ctx, insertLinuxDepsStep)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `apt-крок системних залежностей Tauri → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'tauri-linux-deps-packages',
    test: violations => violations.some(v => v.data?.kind === MISSING_LINUX_DEPS_PACKAGES && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_LINUX_DEPS_PACKAGES && v.file)
      const touchedFiles = applyToFiles(targets, ctx, appendMissingPackages)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `канонічні Tauri-пакети → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  }
]
