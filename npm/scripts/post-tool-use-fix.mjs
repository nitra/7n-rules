/**
 * PostToolUse hook для Claude Code: точкова маршрутизація `npx @nitra/cursor fix`
 * за типом зміненого файла. Запускається після кожного `Edit` / `Write` / `MultiEdit`;
 * замінює дорогий синхронний `Stop`-хук, що ганяв повний `fix` усіх правил на кожному
 * turn-і.
 *
 * Контракт:
 * - stdin Claude Code: JSON із `tool_input.file_path` (відносний шлях зміненого файла);
 * - exit 0, якщо файл не має маршрут (PostToolUse не блокує turn у будь-якому випадку,
 *   але ми лишаємо exit-код прозорим — для діагностики);
 * - інакше spawn `npx --no @nitra/cursor fix <rules…>` із передаванням exit-коду.
 *
 * Маршрути впорядковані від найбільш специфічного до загального; перший збіг — переможець.
 * `docs/adr/**\/*.md` свідомо повертає `[]`: ADR-нормалізація вже покривається async
 * Stop-hook'ом `normalize-decisions.sh` — повторний `fix adr` тут лише сповільнював би turn.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'

import picomatch from 'picomatch'

/**
 * @typedef {object} Route
 * @property {string} pattern picomatch glob (з підтримкою `**` і `{a,b}`)
 * @property {string[]} rules ID правил `npm/rules/<id>` (бо `fix.mjs` обов'язковий)
 */

/** Порядок важливий: специфічні маршрути (`.github/workflows/*`, `**\/k8s/**`) — перед загальними. */
/** @type {readonly Route[]} */
const ROUTES = Object.freeze([
  { pattern: 'docs/adr/**/*.md', rules: [] },
  { pattern: '.github/workflows/*.{yml,yaml}', rules: ['ga'] },
  { pattern: '**/k8s/**/*.{yaml,yml}', rules: ['k8s'] },
  { pattern: '**/*.vue', rules: ['js-lint', 'style-lint', 'vue'] },
  { pattern: '**/*.{mjs,js,cjs,ts,tsx,jsx}', rules: ['js-lint'] },
  { pattern: '**/*.{css,scss,sass}', rules: ['style-lint'] },
  { pattern: '**/*.rego', rules: ['rego'] },
  { pattern: '{**/,}Dockerfile', rules: ['docker'] },
  { pattern: '**/*.Dockerfile', rules: ['docker'] },
  { pattern: '**/*.sh', rules: ['security'] },
  { pattern: '{**/,}package.json', rules: ['npm-module', 'bun'] },
  { pattern: '**/*.md', rules: ['text'] }
])

/**
 * Повертає список правил, які слід прогнати для зміненого `filePath`.
 * Перший збіг із `ROUTES` — переможець; невідомі шляхи / некоректні входи → `[]`.
 * @param {unknown} filePath відносний шлях зміненого файла зі stdin Claude Code
 * @returns {string[]} ID правил для `npx @nitra/cursor fix`
 */
export function routeFilePathToRules(filePath) {
  if (typeof filePath !== 'string' || filePath === '') {
    return []
  }
  for (const { pattern, rules } of ROUTES) {
    if (picomatch.isMatch(filePath, pattern, { dot: true })) {
      return [...rules]
    }
  }
  return []
}

/**
 * Зчитує stdin до EOF як utf8 рядок. На TTY — повертає `''` одразу.
 * @returns {Promise<string>} вміст stdin
 */
async function readStdin() {
  if (process.stdin.isTTY) {
    return ''
  }
  process.stdin.setEncoding('utf8')
  const chunks = []
  process.stdin.on('data', chunk => {
    chunks.push(chunk)
  })
  try {
    await once(process.stdin, 'end')
  } catch {
    // 'error' на stdin — повертаємо те, що встигли зібрати
  }
  return chunks.join('')
}

/**
 * Дістає `tool_input.file_path` зі stdin JSON Claude Code. Невалідний JSON
 * або відсутнє поле → `null` (не помилка: дехто з інструментів — напр. Bash — не пише `file_path`).
 * @param {string} stdinJson сирий вміст stdin
 * @returns {string | null} відносний шлях або `null`
 */
function extractFilePath(stdinJson) {
  if (!stdinJson) {
    return null
  }
  try {
    const obj = JSON.parse(stdinJson)
    const fp = obj?.tool_input?.file_path
    return typeof fp === 'string' && fp !== '' ? fp : null
  } catch {
    return null
  }
}

/**
 * Точка входу. Викликається з `bin/n-cursor.js` коли argv[0] === `post-tool-use-fix`.
 * Параметри доступні для інʼєкції для тестів: `stdinJson` обходить read від `process.stdin`,
 * `spawnFn` — заміна `node:child_process.spawn` (повертає EventEmitter-сумісний об'єкт).
 * @param {{ stdinJson?: string, spawnFn?: typeof spawn }} [options] параметри для тестів (ін'єкція stdin/spawn)
 * @returns {Promise<number>} exit code (0 — пропущено / fix ОК; інше — exit-код `fix`)
 */
export async function runPostToolUseFixCli(options = {}) {
  const stdinJson = options.stdinJson ?? (await readStdin())
  const filePath = extractFilePath(stdinJson)
  if (filePath === null) {
    return 0
  }
  const rules = routeFilePathToRules(filePath)
  if (rules.length === 0) {
    return 0
  }
  const spawnFn = options.spawnFn ?? spawn
  const child = spawnFn('npx', ['--no', '@nitra/cursor', 'fix', ...rules], { stdio: 'inherit' })
  try {
    const [code] = await once(child, 'exit')
    return code ?? 1
  } catch (error) {
    process.stderr.write(`post-tool-use-fix: не вдалося запустити npx @nitra/cursor fix — ${error.message}\n`)
    return 1
  }
}
