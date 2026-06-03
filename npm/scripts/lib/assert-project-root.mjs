/**
 * Guard для дефолтної синхронізації `npx @nitra/cursor` (гілка без підкоманди).
 *
 * Дефолтний sync (`runSync` у `bin/n-cursor.js`) скаффолдить у `cwd()` керовані
 * артефакти — `.cursor/rules/`, `.cursor/skills/`, `.claude/`, `AGENTS.md`,
 * `CLAUDE.md`, `.n-cursor.json`, `.gitignore` — і запускає `bun install`. Усе це
 * розраховане на **корінь** проєкту-споживача. Якщо бінар викликати напряму
 * (`bun npm/bin/n-cursor.js`, `node …/n-cursor.js`) з піддиректорії git-репо,
 * `cwd()` — та піддиректорія, і конфіг розкидається не туди.
 *
 * `bun run start`/`npm start` цей кейс не створює (менеджер скидає cwd на корінь
 * пакета), але прямий виклик бінаря — створює. Тому guard прив'язаний до
 * **git-кореня**, а не до конкретного монорепо: CLI публічний і легітимно
 * запускається в корені будь-якого репо-споживача.
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { cwd } from 'node:process'

/**
 * Корінь git-репозиторію для `dir` через `git rev-parse --show-toplevel`.
 * Повертає realpath-шлях кореня або `null`, якщо `dir` поза git-репо чи `git`
 * недоступний — у такому разі визначити корінь неможливо, тож не блокуємо.
 * @param {string} [dir] каталог, з якого питаємо git
 * @returns {string | null} абсолютний (realpath) корінь репо або null
 */
export function gitToplevel(dir = cwd()) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' })
  if (res.status !== 0 || typeof res.stdout !== 'string') return null
  const top = res.stdout.trim()
  return top.length > 0 ? top : null
}

/**
 * Безпечний realpath: повертає реальний шлях `dir`, а якщо його не існує —
 * сам `dir` без змін (порівняння нижче все одно дасть коректний результат).
 * Потрібен бо `git rev-parse --show-toplevel` віддає realpath (symlink'и
 * розгорнуті), а `cwd()` — ні; без нормалізації корінь під symlink-шляхом
 * (типово `/var` → `/private/var` на macOS) хибно вважався б піддиректорією.
 * @param {string} dir шлях для нормалізації
 * @returns {string} realpath або вихідний шлях
 */
function safeRealpath(dir) {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/**
 * Кидає помилку, якщо `dir` — піддиректорія git-репозиторію (тобто не його
 * корінь). Поза git-репо (немає toplevel) — пропускає без помилки. У git-worktree
 * (`.worktrees/<branch>/`) toplevel = корінь самого worktree, тож запуск із нього
 * проходить — гард ловить лише старт із піддиректорії робочого дерева.
 *
 * Викликати перед мутаційними діями (default sync, `fix`, `lint`, `coverage`,
 * `change`, `release`), які скаффолдять / переписують файли в CWD. Не для
 * підкоманд із власним `--root` чи read-only-логікою.
 * @param {string} [dir] каталог, що перевіряємо (типово `cwd()`)
 * @param {string} [action] людинозрозумілий опис дії для тексту помилки
 * @throws {Error} коли `dir` всередині git-репо, але не його корінь
 * @returns {void}
 */
export function assertCwdIsProjectRoot(
  dir = cwd(),
  action = 'Команда @nitra/cursor мутує проєкт у поточному каталозі'
) {
  const top = gitToplevel(dir)
  if (top === null) return
  const here = safeRealpath(dir)
  if (here === top) return
  throw new Error(
    `❌ @nitra/cursor запущено не в корені проєкту.\n` +
      `   Поточний каталог: ${here}\n` +
      `   Корінь git-репо:  ${top}\n` +
      `   ${action} — із піддиректорії це зачепило б не той каталог.\n` +
      `   Перейдіть у корінь репозиторію: cd ${top}`
  )
}
