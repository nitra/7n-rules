/**
 * CLI-обгортка над канонічним `lint-ga` (ga.mdc): додає preflight на наявність `shellcheck`,
 * тоді послідовно виконує `bunx github-actionlint` і `uvx zizmor --offline --collect=workflows .`.
 *
 * Без preflight `actionlint` (через `bunx github-actionlint`) мовчки пропускає shell-перевірки в
 * `run:` блоках, коли `shellcheck` відсутній у PATH; локально `bun lint-ga` лишається зеленим, а CI
 * на ubuntu-latest (де shellcheck передвстановлений) падає. Preflight робить цю різницю явною.
 *
 * Експортовано окремо `runLintGaCli` — використовується з `bin/n-cursor.js` як підкоманда `lint-ga`.
 */
import { spawnSync } from 'node:child_process'
import { platform } from 'node:process'

import { resolveCmd } from './utils/resolve-cmd.mjs'

/** Підказки встановлення shellcheck на типових платформах. */
const SHELLCHECK_INSTALL_HINTS = [
  'macOS:        brew install shellcheck',
  'Debian/Ubuntu: sudo apt-get install -y shellcheck',
  'Arch:         sudo pacman -S shellcheck'
]

/**
 * Друкує блок з причиною fail і командами встановлення `shellcheck`.
 * @returns {void}
 */
function printShellcheckMissingMessage() {
  console.error('❌ shellcheck не знайдено в PATH.')
  console.error('   Без нього `actionlint` пропускає shell-перевірки в run: блоках,')
  console.error('   тож локальний прогін зеленіє, а CI на ubuntu-latest (де shellcheck')
  console.error('   передвстановлений) падає на тих самих workflow. Встанови:')
  for (const line of SHELLCHECK_INSTALL_HINTS) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: ga.mdc → секція про lint-ga.')
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
 * Виконує канонічний `lint-ga` з preflight на `shellcheck`.
 *
 * Послідовність:
 * 1) перевірка наявності `shellcheck` у PATH (на Windows — `shellcheck.exe`); відсутній → exit 1;
 * 2) `bunx github-actionlint`;
 * 3) `uvx zizmor --offline --collect=workflows .`.
 *
 * Першу помилку повертаємо як код виходу; наступні кроки не запускаються (відповідає `&&` у package.json).
 * @returns {number} 0 — все OK, інакше — код першого кроку, що впав
 */
export function runLintGaCli() {
  const shellcheckBin = platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'
  if (!resolveCmd(shellcheckBin)) {
    printShellcheckMissingMessage()
    return 1
  }
  console.log('✅ shellcheck знайдено в PATH — actionlint виконуватиме SC-правила, як у CI')

  const actionlintCode = runStep('actionlint', 'bunx', ['github-actionlint'])
  if (actionlintCode !== 0) return actionlintCode

  const zizmorCode = runStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])
  return zizmorCode
}
