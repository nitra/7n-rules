/**
 * CLI-обгортка над канонічним `lint-text` (text.mdc): preflight на `shellcheck`, `patch`
 * (для авто-фіксу shellcheck) і `dotenv-linter`; далі послідовно
 *   1) `cspell .` — перевірка правопису з `@nitra/cspell-dict`;
 *   2) `runShellcheckText()` — авто-фікс і фінальна перевірка `*.sh` через `shellcheck`;
 *   3) `runDotenvLinter()` — авто-фікс і фінальна перевірка `.env*` через `dotenv-linter`;
 *   4) `bunx markdownlint-cli2 --fix "**\/*.md" "**\/*.mdc"` — авто-фікс Markdown;
 *   5) `runV8rWithGlobs()` — schema-валідація json/json5/yaml/yml/toml через v8r.
 *
 * Без preflight локальний прогін може пройти cspell/markdownlint, а CI на ubuntu-latest
 * (де shellcheck передвстановлений, але dotenv-linter — ні) падає на кроці dotenv-linter
 * з неінформативним повідомленням. Preflight збирає всі відсутні бінарники до першого кроку.
 *
 * Перший ненульовий код з ланцюжка повертається як код виходу; наступні кроки не запускаються.
 * Експортовано як `runLintTextCli` — використовується з `bin/n-cursor.js` як підкоманда `lint-text`.
 */
import { platform } from 'node:process'

import { runLintStep } from '../../../scripts/utils/run-lint-step.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { withLock } from '../../../scripts/utils/with-lock.mjs'
import { runDotenvLinter } from './run-dotenv-linter.mjs'
import { runShellcheckText } from './run-shellcheck.mjs'
import { runV8rWithGlobs } from './run-v8r.mjs'

/**
 * Опис залежності preflight-ом.
 * @typedef {object} PreflightDep
 * @property {string} bin ім'я виконуваного файлу
 * @property {string[]} [winBins] альтернативні імена на Windows
 * @property {string} explanation наслідки відсутності
 * @property {string[]} install команди встановлення
 * @property {string} successMsg повідомлення на pass-шлях
 */

/** @type {PreflightDep} */
const SHELLCHECK_PREFLIGHT = {
  bin: 'shellcheck',
  winBins: ['shellcheck.exe'],
  explanation: [
    'Без нього `runShellcheckText()` пропускає перевірку tracked `*.sh` — локально lint-text',
    'може бути зеленим, а CI (shellcheck + patch) падає на тих самих скриптах.'
  ].join('\n   '),
  install: [
    'macOS:         brew install shellcheck',
    'Debian/Ubuntu: sudo apt-get install -y shellcheck',
    'Arch:          sudo pacman -S shellcheck'
  ],
  successMsg: '✅ shellcheck знайдено в PATH — lint-text перевірить *.sh'
}

/** @type {PreflightDep} */
const PATCH_PREFLIGHT = {
  bin: 'patch',
  explanation: ['Без `patch` не застосуються авто-виправлення shellcheck (`shellcheck -f diff` + `patch -p1`).'].join(
    '\n   '
  ),
  install: ['macOS:         зазвичай уже є в системі', 'Debian/Ubuntu: sudo apt-get install -y patch'],
  successMsg: '✅ patch знайдено в PATH — shellcheck auto-fix працюватиме'
}

/** @type {PreflightDep} */
const DOTENV_LINTER_PREFLIGHT = {
  bin: 'dotenv-linter',
  winBins: ['dotenv-linter.exe'],
  explanation: [
    'Без нього не виконається крок `.env*` у lint-text — локально cspell/markdownlint',
    'пройдуть, а CI без Install dotenv-linter впаде неінформативно.'
  ].join('\n   '),
  install: [
    'macOS:     brew install dotenv-linter',
    'Linux:     curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin',
    'cargo:     cargo install dotenv-linter'
  ],
  successMsg: '✅ dotenv-linter знайдено в PATH — lint-text перевірить .env*'
}

/**
 * Шукає шлях до бінарника `dep.bin` у `PATH`; на Windows додатково перебирає `dep.winBins`.
 * @param {PreflightDep} dep опис залежності з canon-списку preflight-перевірок
 * @returns {string | null} абсолютний шлях до знайденого бінарника або `null`, якщо не знайдено
 */
function resolvePreflightBin(dep) {
  if (platform === 'win32' && dep.winBins) {
    for (const name of dep.winBins) {
      const r = resolveCmd(name)
      if (r) return r
    }
  }
  return resolveCmd(dep.bin)
}

/**
 * Друкує stderr-повідомлення про відсутній бінарник з install-hint'ами і посиланням на правило.
 * @param {PreflightDep} dep опис залежності — джерело пояснення й install-команд
 * @returns {void} нічого не повертає; виводить рядки в `console.error`
 */
function printPreflightMissingMessage(dep) {
  console.error(`❌ ${dep.bin} не знайдено в PATH.`)
  console.error(`   ${dep.explanation}`)
  console.error('   Встанови:')
  for (const line of dep.install) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: text.mdc → секція про lint-text.')
}

/**
 * Виконує preflight-перевірку: повертає `true` і друкує `successMsg`, якщо бінарник знайдено,
 * інакше друкує install-hint у stderr і повертає `false`.
 * @param {PreflightDep} dep опис залежності для перевірки наявності в `PATH`
 * @returns {boolean} `true` — бінарник знайдено, `false` — відсутній
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
 * Внутрішні кроки `lint-text` без локу.
 * @returns {number} 0 — все OK, інакше — код першого кроку, що впав
 */
function runLintTextSteps() {
  let preflightOk = true
  for (const dep of [SHELLCHECK_PREFLIGHT, PATCH_PREFLIGHT, DOTENV_LINTER_PREFLIGHT]) {
    if (!preflight(dep)) preflightOk = false
  }
  if (!preflightOk) return 1

  const cspellCode = runLintStep('cspell', 'npx', ['cspell', '.'])
  if (cspellCode !== 0) return cspellCode

  console.log('\n▶ shellcheck (авто-фікс + фінальна перевірка *.sh)')
  const shellcheckCode = runShellcheckText()
  if (shellcheckCode !== 0) return shellcheckCode

  console.log('\n▶ dotenv-linter (авто-фікс + фінальна перевірка .env*)')
  const dotenvCode = runDotenvLinter()
  if (dotenvCode !== 0) return dotenvCode

  const markdownlintCode = runLintStep('markdownlint', 'bunx', ['markdownlint-cli2', '--fix', '**/*.md', '**/*.mdc'])
  if (markdownlintCode !== 0) return markdownlintCode

  console.log('\n▶ v8r (schema-валідація json/json5/yaml/yml/toml)')
  return runV8rWithGlobs()
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-text')` + дедуп за станом git-дерева.
 * @returns {Promise<number>} код виходу
 */
export const runLintTextCli = () => withLock('lint-text', () => runLintTextSteps())
