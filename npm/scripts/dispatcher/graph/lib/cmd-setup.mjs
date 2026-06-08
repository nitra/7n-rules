/**
 * `n-cursor graph setup` — ініціалізація проєкту для graph task system.
 *
 * Створює:
 * - .n-cursor.json з дефолтними налаштуваннями (якщо не існує)
 * - tasks/ директорію
 * - git hook (post-commit) для автоматичного оновлення стану (якщо є .git)
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { CONFIG_DEFAULTS } from './config.mjs'

/**
 * `graph setup` command handler.
 * @param {string[]} _args аргументи (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, opts?: object) => void
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdSetup(_args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.exists ?? existsSync
  const mkdir = deps.mkdir ?? ((p, opts) => mkdirSync(p, opts))

  // 1. Створюємо .n-cursor.json якщо не існує
  const configPath = join(root, '.n-cursor.json')
  if (!exists(configPath)) {
    try {
      writeFile(configPath, JSON.stringify(CONFIG_DEFAULTS, null, 2) + '\n', 'utf8')
      log(`setup: створено ${configPath}`)
    } catch (err) {
      log(`setup: не вдалося створити ${configPath} — ${err.message ?? String(err)}`)
      return 1
    }
  } else {
    log(`setup: ${configPath} вже існує — пропускаємо`)
  }

  // 2. Створюємо tasks/ директорію
  const tasksDir = join(root, 'tasks')
  if (!exists(tasksDir)) {
    try {
      mkdir(tasksDir, { recursive: true })
      log(`setup: створено ${tasksDir}`)
    } catch (err) {
      log(`setup: не вдалося створити ${tasksDir} — ${err.message ?? String(err)}`)
      return 1
    }
  } else {
    log(`setup: ${tasksDir} вже існує — пропускаємо`)
  }

  // 3. Створюємо .n-cursor/ директорію
  const ncursorDir = join(root, '.n-cursor')
  if (!exists(ncursorDir)) {
    try {
      mkdir(ncursorDir, { recursive: true })
      log(`setup: створено ${ncursorDir}`)
    } catch (err) {
      log(`setup: не вдалося створити ${ncursorDir} — ${err.message ?? String(err)}`)
      return 1
    }
  }

  // 4. Перевіряємо чи є .git і додаємо hook
  const gitDir = join(root, '.git')
  if (exists(gitDir)) {
    const hooksDir = join(gitDir, 'hooks')
    try {
      mkdir(hooksDir, { recursive: true })
    } catch {
      // hooks/ може вже існувати
    }

    const hookPath = join(hooksDir, 'post-commit')
    if (!exists(hookPath)) {
      const hookContent = [
        '#!/bin/sh',
        '# n-cursor graph: automatic state refresh after commit',
        'npx @nitra/cursor graph scan --json > /dev/null 2>&1 || true',
        ''
      ].join('\n')
      try {
        writeFile(hookPath, hookContent, 'utf8')
        // chmod +x через окрему команду не робимо — залежить від FS dep
        log(`setup: створено git hook ${hookPath}`)
      } catch (err) {
        log(`setup: не вдалося створити git hook — ${err.message ?? String(err)}`)
        // Не критично — продовжуємо
      }
    } else {
      log(`setup: git hook ${hookPath} вже існує — пропускаємо`)
    }
  }

  log('setup: готово')
  return 0
}
