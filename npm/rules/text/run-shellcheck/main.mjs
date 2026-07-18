/**
 * Запуск shellcheck у ланцюжку lint-text: спочатку авто-застосування виправлень, потім фінальна перевірка.
 *
 * ShellCheck не має прапорця «--fix»; для виправлень, які інструмент уміє запропонувати, використовується
 * формат виводу `diff` і застосування патчу через `patch -p1` у корені проєкту (шляхи у unified diff від ShellCheck
 * узгоджуються з цим режимом).
 *
 * Якщо `shellcheck` відсутній у PATH, скрипт завершується з кодом 1 і друкує підказки встановлення
 * (macOS: Homebrew; Debian/Ubuntu: apt; Arch: pacman). Аналогічно для `patch`, якщо його немає
 * (рідко на macOS/Linux).
 *
 * Список файлів: у git-робочому дереві — `git ls-files` з pathspec `:(glob)` для всіх tracked `*.sh`;
 * інакше — `globSync` з виключенням `node_modules`. Якщо скриптів не знайдено — вихід 0.
 *
 * Після циклу авто-виправлень виконується звичайний `shellcheck` по всіх зібраних файлах; будь-яке
 * попередження чи помилка — ненульовий код виходу.
 */
import { globSync } from 'node:fs'
import { resolve } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Розширення shell-скриптів — фільтр delta-списку файлів у `lint(ctx)`. */
const SH_EXT_RE = /\.sh$/u

/** Підрядок у stderr ShellCheck, коли є зауваження, але без авто-виправлення у форматі diff. */
const NON_AUTOFIXABLE_HINT = 'none were auto-fixable'

/** Максимум ітерацій `diff`+`patch` на один файл (захист від зациклення). */
const MAX_FIX_ROUNDS_PER_FILE = 32

/**
 * Друкує підказки встановлення shellcheck у stderr.
 * @returns {void}
 */
function printShellcheckInstallHints() {
  process.stderr.write(
    [
      '❌ shellcheck не знайдено в PATH.',
      'Встанови інструмент і повтори lint-text:',
      '  macOS:    brew install shellcheck',
      '  Debian/Ubuntu: sudo apt-get install -y shellcheck',
      '  Arch:     sudo pacman -S shellcheck',
      ''
    ].join('\n')
  )
}

/**
 * Друкує підказку для відсутнього patch.
 * @returns {void}
 */
function printPatchInstallHints() {
  process.stderr.write(
    [
      '❌ patch не знайдено в PATH (потрібен для застосування diff від shellcheck).',
      '  macOS: patch зазвичай уже є; Debian/Ubuntu: sudo apt-get install -y patch',
      ''
    ].join('\n')
  )
}

/**
 * Повертає відносні шляхи до shell-скриптів для перевірки.
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} відсортований масив шляхів відносно cwd
 */
export async function listShellScriptPaths(cwd) {
  const gitPath = resolveCmd('git')
  if (gitPath) {
    const gitOk = await spawnAsync(gitPath, ['rev-parse', '--is-inside-work-tree'], { cwd, env: process.env })
    if (gitOk.exitCode === 0 && gitOk.stdout.trim() === 'true') {
      const ls = await spawnAsync(gitPath, ['ls-files', '-z', '--', ':(glob)**/*.sh'], { cwd, env: process.env })
      if (ls.exitCode !== 0) {
        return []
      }
      const files = ls.stdout.split('\0').filter(Boolean)
      return [...new Set(files)].toSorted()
    }
  }

  const fromGlob = globSync('**/*.sh', {
    cwd,
    exclude: p => p.includes('node_modules') || p.startsWith(`node_modules/`) || p.split('/').includes('node_modules')
  })
  return [...new Set(fromGlob.map(p => p.replaceAll('\\', '/')))].toSorted()
}

/**
 * Запускає shellcheck із авто-виправленнями і фінальною перевіркою.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @param {boolean} [readOnly] true → пропустити авто-фікс (diff+patch), лише фінальна перевірка
 * @param {string[]} [scopeFiles] явний перелік файлів (delta) — якщо не задано, шукає всі `*.sh` через `listShellScriptPaths`
 * @returns {Promise<number>} 0 — OK; 1 — помилка середовища або залишкові зауваження shellcheck
 */
export async function runShellcheckText(cwd, readOnly, scopeFiles) {
  const root = resolve(cwd ?? process.cwd())
  const shellcheck = resolveCmd('shellcheck')
  if (!shellcheck) {
    printShellcheckInstallHints()
    return 1
  }
  // patch потрібен лише для авто-фіксу (diff+patch); у read-only його відсутність не блокує детект.
  const patchBin = readOnly ? null : resolveCmd('patch')
  if (!readOnly && !patchBin) {
    printPatchInstallHints()
    return 1
  }

  const files = scopeFiles ?? (await listShellScriptPaths(root))
  if (files.length === 0) {
    return 0
  }

  if (!readOnly) {
    for (const rel of files) {
      const fixCode = await autofixOneFile(shellcheck, /** @type {string} */ (patchBin), root, rel)
      if (fixCode !== 0) return fixCode
    }
  }

  return runFinalShellcheck(shellcheck, files, root)
}

/**
 * Detector text/run-shellcheck: read-only shellcheck по `ctx.files` (delta) або по всіх `*.sh` (full).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const scopeFiles = ctx.files === undefined ? undefined : ctx.files.filter(f => SH_EXT_RE.test(f))
  if (scopeFiles !== undefined && scopeFiles.length === 0) return reporter.result()

  const code = await runShellcheckText(ctx.cwd, true, scopeFiles)
  if (code !== 0) fail('shellcheck знайшов порушення у *.sh (text.mdc)', 'shellcheck')
  return reporter.result()
}

/**
 * Запускає до `MAX_FIX_ROUNDS_PER_FILE` ітерацій `shellcheck -f diff` + `patch` для одного файла.
 * Виходить з 0 у випадках: shellcheck повернув 0, нема autofixable, або порожній diff.
 * @param {string} shellcheck абсолютний шлях до shellcheck
 * @param {string} patchBin абсолютний шлях до patch
 * @param {string} root абсолютний робочий каталог (cwd для spawn)
 * @param {string} rel відносний шлях файла від `root`
 * @returns {Promise<number>} 0 — OK; 1 — помилка spawn або patch
 */
async function autofixOneFile(shellcheck, patchBin, root, rel) {
  for (let round = 0; round < MAX_FIX_ROUNDS_PER_FILE; round++) {
    let diffResult
    try {
      diffResult = await spawnAsync(shellcheck, ['-f', 'diff', rel], { cwd: root, env: process.env })
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
    if (shouldStopAutofixLoop(diffResult)) return 0
    const patchCode = await applyShellcheckDiff(patchBin, root, rel, diffResult.stdout ?? '')
    if (patchCode !== 0) return patchCode
  }
  return 0
}

/**
 * Чи треба зупинити цикл авто-фіксів: shellcheck повернув 0, або у stderr є пометка
 * `none were auto-fixable`, або stdout порожній (нема дифу для застосування).
 * @param {{ exitCode: number | null, stdout?: string | null, stderr?: string | null }} diffResult результат `spawnAsync`
 * @returns {boolean} true — більше нічого фіксити
 */
function shouldStopAutofixLoop(diffResult) {
  const code = diffResult.exitCode ?? 1
  if (code === 0) return true
  const out = (diffResult.stdout ?? '').trim()
  const err = (diffResult.stderr ?? '').trim()
  return err.includes(NON_AUTOFIXABLE_HINT) || !out
}

/**
 * Застосовує `shellcheck -f diff`-вивід через `patch -p1`. На помилку виливає stdout/stderr від patch
 * у `process.stderr` (щоб користувач бачив, чому не застосувалося) і повертає 1.
 * @param {string} patchBin абсолютний шлях до patch
 * @param {string} root cwd для spawn
 * @param {string} rel відносний шлях для повідомлення про помилку
 * @param {string} diffStdout вміст unified-diff від shellcheck (input для patch)
 * @returns {Promise<number>} 0 — застосовано; 1 — помилка
 */
async function applyShellcheckDiff(patchBin, root, rel, diffStdout) {
  let patchRun
  try {
    patchRun = await spawnAsync(patchBin, ['-p1'], { cwd: root, input: diffStdout, env: process.env })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.stderr.write(`run-shellcheck-text: patch не застосував diff для ${rel}\n`)
    return 1
  }
  if (patchRun.exitCode === 0) return 0
  if (patchRun.stderr?.length) process.stderr.write(patchRun.stderr)
  if (patchRun.stdout?.length) process.stderr.write(patchRun.stdout)
  process.stderr.write(`run-shellcheck-text: patch не застосував diff для ${rel}\n`)
  return 1
}

/**
 * Фінальний прогон `shellcheck` по всіх файлах — без `-f diff`, щоб отримати звичайний звіт.
 * Будь-який ненульовий код shellcheck-а пробрасує як 1 (з виводом stdout/stderr на користувацькі stream-и).
 * @param {string} shellcheck абсолютний шлях до shellcheck
 * @param {string[]} files відносні шляхи файлів для перевірки
 * @param {string} root cwd для spawn
 * @returns {Promise<number>} 0 — чисто; 1 — помилка spawn або зауваження shellcheck
 */
async function runFinalShellcheck(shellcheck, files, root) {
  let finalRun
  try {
    finalRun = await spawnAsync(shellcheck, files, { cwd: root, env: process.env })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
  if (finalRun.exitCode === 0) return 0
  if (finalRun.stdout?.length) process.stdout.write(finalRun.stdout)
  if (finalRun.stderr?.length) process.stderr.write(finalRun.stderr)
  return 1
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runShellcheckText()
}
