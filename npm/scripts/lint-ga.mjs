/**
 * CLI-обгортка над канонічним `lint-ga` (ga.mdc): робить preflight на `shellcheck` і `uv` (для `uvx`),
 * тоді послідовно виконує `bunx github-actionlint` і `uvx zizmor --offline --collect=workflows .`.
 *
 * Без preflight `actionlint` (через `bunx github-actionlint`) мовчки пропускає shell-перевірки в
 * `run:` блоках, коли `shellcheck` відсутній у PATH; локально `bun lint-ga` лишається зеленим, а CI
 * на ubuntu-latest (де shellcheck передвстановлений) падає. Preflight робить цю різницю явною.
 *
 * `uv` потрібен для `uvx zizmor`. Якщо його нема — `uvx zizmor` падає неінформативно («command not
 * found»); підказка з командою встановлення коротша й корисніша.
 *
 * Експортовано окремо `runLintGaCli` — використовується з `bin/n-cursor.js` як підкоманда `lint-ga`.
 */
import { spawnSync } from 'node:child_process'
import { platform } from 'node:process'

import { resolveCmd } from './utils/resolve-cmd.mjs'

/**
 * Опис залежності preflight-ом: бінарник, для чого потрібен, і команди встановлення.
 * @typedef {object} PreflightDep
 * @property {string} bin ім'я виконуваного файлу (на Windows додається `.exe` за потреби)
 * @property {string[]} winBins альтернативні імена на Windows (`shellcheck.exe`); якщо нема — fallback на `bin`
 * @property {string} explanation 1-2 рядки про наслідки відсутності
 * @property {string[]} install список рядків з командами встановлення (друкуються як є, з відступом)
 * @property {string} successMsg повідомлення на pass-шлях
 */

/** @type {PreflightDep} */
const SHELLCHECK_PREFLIGHT = {
  bin: 'shellcheck',
  winBins: ['shellcheck.exe'],
  explanation: [
    'Без нього `actionlint` пропускає shell-перевірки в run: блоках,',
    'тож локальний прогін зеленіє, а CI на ubuntu-latest (де shellcheck',
    'передвстановлений) падає на тих самих workflow.'
  ].join('\n   '),
  install: [
    'macOS:        brew install shellcheck',
    'Debian/Ubuntu: sudo apt-get install -y shellcheck',
    'Arch:         sudo pacman -S shellcheck'
  ],
  successMsg: '✅ shellcheck знайдено в PATH — actionlint виконуватиме SC-правила, як у CI'
}

/** @type {PreflightDep} */
const UV_PREFLIGHT = {
  bin: 'uv',
  winBins: ['uv.exe'],
  explanation: [
    'Без `uv` (а отже без `uvx`) не виконається `uvx zizmor` — second-stage аудит',
    'workflow на ризики GitHub Actions просто не запуститься.'
  ].join('\n   '),
  install: [
    'macOS:        brew install uv',
    'Universal:    curl -LsSf https://astral.sh/uv/install.sh | sh',
    'pip:          pip install uv'
  ],
  successMsg: '✅ uv знайдено в PATH — uvx zizmor запуститься'
}

/**
 * Шукає бінарник у PATH з урахуванням Windows: спершу `winBins`, потім `bin`.
 * @param {PreflightDep} dep опис залежності
 * @returns {string | null} абсолютний шлях або null
 */
function resolvePreflightBin(dep) {
  if (platform === 'win32') {
    for (const name of dep.winBins) {
      const r = resolveCmd(name)
      if (r) return r
    }
  }
  return resolveCmd(dep.bin)
}

/**
 * Друкує блок з причиною fail і командами встановлення.
 * @param {PreflightDep} dep опис залежності
 * @returns {void}
 */
function printPreflightMissingMessage(dep) {
  console.error(`❌ ${dep.bin} не знайдено в PATH.`)
  console.error(`   ${dep.explanation}`)
  console.error('   Встанови:')
  for (const line of dep.install) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: ga.mdc → секція про lint-ga.')
}

/**
 * Запускає preflight-перевірку: pass → лог success і повертає true; fail → лог hint і повертає false.
 * @param {PreflightDep} dep опис залежності
 * @returns {boolean} чи знайдено бінарник
 */
function preflight(dep) {
  if (resolvePreflightBin(dep)) {
    console.log(dep.successMsg)
    return true
  }
  printPreflightMissingMessage(dep)
  return false
}

/**
 * Запускає крок lint-ga з відображенням команди користувачу. Stdout/stderr дочірнього процесу
 * передається користувачу як є (`stdio: 'inherit'`), щоб виглядало як прямий виклик у shell.
 * @param {string} title заголовок для логу (наприклад `actionlint`)
 * @param {string} cmd ім'я команди (`bunx`, `uvx`)
 * @param {string[]} args аргументи команди
 * @returns {number} код виходу дочірнього процесу (0 — OK, інше — помилка)
 */
function runStep(title, cmd, args) {
  console.log(`\n▶ ${title}: ${cmd} ${args.join(' ')}`)
  const resolved = resolveCmd(cmd)
  if (!resolved) {
    console.error(`❌ ${cmd} не знайдено в PATH (${title}).`)
    return 127
  }
  const r = spawnSync(resolved, args, { stdio: 'inherit', env: process.env })
  if (r.error) {
    console.error(`❌ Не вдалося запустити ${cmd}: ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}

/**
 * Виконує канонічний `lint-ga` з preflight-перевірками й послідовним запуском actionlint + zizmor.
 *
 * Послідовність:
 * 1) preflight: `shellcheck` (для actionlint SC-правил) і `uv` (для `uvx zizmor`); відсутній → exit 1;
 * 2) `bunx github-actionlint`;
 * 3) `uvx zizmor --offline --collect=workflows .`.
 *
 * Якщо хоча б один preflight не пройшов — виходимо одразу з кодом 1, **до** запуску actionlint/zizmor,
 * бо їхні власні повідомлення про відсутність залежностей менш інформативні (особливо для shellcheck —
 * actionlint мовчки пропускає SC-правила; ця перевірка — головний сенс обгортки).
 *
 * Першу помилку від actionlint/zizmor повертаємо як код виходу; наступні кроки не запускаються
 * (відповідає `&&` у package.json).
 * @returns {number} 0 — все OK, інакше — код першого кроку, що впав
 */
export function runLintGaCli() {
  let preflightOk = true
  for (const dep of [SHELLCHECK_PREFLIGHT, UV_PREFLIGHT]) {
    if (!preflight(dep)) preflightOk = false
  }
  if (!preflightOk) return 1

  const actionlintCode = runStep('actionlint', 'bunx', ['github-actionlint'])
  if (actionlintCode !== 0) return actionlintCode

  const zizmorCode = runStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])
  return zizmorCode
}
