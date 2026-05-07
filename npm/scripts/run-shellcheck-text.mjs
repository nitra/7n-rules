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
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'

import { isRunAsCli } from './cli-entry.mjs'
import { resolveCmd } from './utils/resolve-cmd.mjs'

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
 * @param {string} cwd корінь проєкту
 * @returns {string[]} відсортований масив шляхів відносно cwd
 */
export function listShellScriptPaths(cwd) {
  const gitOk = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd,
    encoding: 'utf8',
    env: process.env
  })
  if (gitOk.status === 0 && gitOk.stdout.trim() === 'true') {
    const ls = spawnSync('git', ['ls-files', '-z', '--', ':(glob)**/*.sh'], {
      cwd,
      encoding: 'utf8',
      env: process.env
    })
    if (ls.status !== 0) {
      return []
    }
    const files = ls.stdout.split('\0').filter(Boolean)
    return [...new Set(files)].sort()
  }

  const fromGlob = globSync('**/*.sh', {
    cwd,
    exclude: p =>
      p.includes('node_modules') ||
      p.startsWith(`node_modules/`) ||
      p.split('/').includes('node_modules')
  })
  return [...new Set(fromGlob.map(p => p.replaceAll('\\', '/')))].sort()
}

/**
 * Запускає shellcheck із авто-виправленнями і фінальною перевіркою.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @returns {number} 0 — OK; 1 — помилка середовища або залишкові зауваження shellcheck
 */
export function runShellcheckText(cwd = process.cwd()) {
  const root = resolve(cwd)
  const shellcheck = resolveCmd('shellcheck')
  if (!shellcheck) {
    printShellcheckInstallHints()
    return 1
  }
  const patchBin = resolveCmd('patch')
  if (!patchBin) {
    printPatchInstallHints()
    return 1
  }

  const files = listShellScriptPaths(root)
  if (files.length === 0) {
    return 0
  }

  for (const rel of files) {
    for (let round = 0; round < MAX_FIX_ROUNDS_PER_FILE; round++) {
      const diffResult = spawnSync(shellcheck, ['-f', 'diff', rel], {
        cwd: root,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 10 * 1024 * 1024
      })

      if (diffResult.error) {
        process.stderr.write(`${diffResult.error.message}\n`)
        return 1
      }

      const code = diffResult.status ?? 1
      const out = (diffResult.stdout ?? '').trim()
      const err = (diffResult.stderr ?? '').trim()

      if (code === 0) {
        break
      }

      if (err.includes(NON_AUTOFIXABLE_HINT) || !out) {
        break
      }

      const patchRun = spawnSync(patchBin, ['-p1'], {
        cwd: root,
        input: diffResult.stdout ?? '',
        encoding: 'utf8',
        env: process.env
      })

      if (patchRun.status !== 0) {
        if (patchRun.stderr?.length) {
          process.stderr.write(patchRun.stderr)
        }
        if (patchRun.stdout?.length) {
          process.stderr.write(patchRun.stdout)
        }
        process.stderr.write(`run-shellcheck-text: patch не застосував diff для ${rel}\n`)
        return 1
      }
    }
  }

  const finalRun = spawnSync(shellcheck, files, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (finalRun.error) {
    process.stderr.write(`${finalRun.error.message}\n`)
    return 1
  }

  if (finalRun.status !== 0) {
    if (finalRun.stdout?.length) {
      process.stdout.write(finalRun.stdout)
    }
    if (finalRun.stderr?.length) {
      process.stderr.write(finalRun.stderr)
    }
    return 1
  }

  return 0
}

if (isRunAsCli()) {
  process.exitCode = runShellcheckText()
}
