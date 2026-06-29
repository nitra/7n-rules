/**
 * lint-поверхня text: cspell/shellcheck/dotenv-linter/markdownlint/v8r.
 */
import { platform } from 'node:process'

import { main as markdownlintCli2 } from 'markdownlint-cli2'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'
import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { runCspellText } from '../cspell-fix/main.mjs'
import { runDotenvLinter } from '../run-dotenv-linter/main.mjs'
import { runShellcheckText } from '../run-shellcheck/main.mjs'
import { runV8rWithGlobs } from '../run-v8r/main.mjs'

/** @type {{ bin: string, explanation: string, install: string[], successMsg: string }} */
const PATCH_PREFLIGHT = {
  bin: 'patch',
  explanation: 'Без `patch` не застосуються авто-виправлення shellcheck (`shellcheck -f diff` + `patch -p1`).',
  install: ['macOS:         зазвичай уже є в системі', 'Debian/Ubuntu: sudo apt-get install -y patch'],
  successMsg: '✅ patch знайдено в PATH — shellcheck auto-fix працюватиме'
}

function resolvePreflightBin(dep) {
  if (platform === 'win32' && dep.winBins) {
    for (const name of dep.winBins) {
      const r = resolveCmd(name)
      if (r) return r
    }
  }
  return resolveCmd(dep.bin)
}

function preflight(dep) {
  if (resolvePreflightBin(dep)) {
    console.log(dep.successMsg)
    return true
  }
  console.error(`❌ ${dep.bin} не знайдено в PATH.`)
  console.error(`   ${dep.explanation}`)
  console.error('   Встанови:')
  for (const line of dep.install) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: text.mdc → секція про lint-text.')
  return false
}

async function runLintTextSteps(readOnly = false, llmFix = false) {
  ensureTool('shellcheck')
  ensureTool('dotenv-linter')

  if (!readOnly && !preflight(PATCH_PREFLIGHT)) return 1

  console.log(`\n▶ cspell (${!readOnly && llmFix ? 'LLM-класифікація + словник + перевірка' : 'перевірка'})`)
  const cspellCode = await runCspellText(process.cwd(), readOnly, llmFix)
  if (cspellCode !== 0) return cspellCode

  console.log(`\n▶ shellcheck (${readOnly ? 'перевірка' : 'авто-фікс + фінальна перевірка'} *.sh)`)
  const shellcheckCode = runShellcheckText(process.cwd(), readOnly)
  if (shellcheckCode !== 0) return shellcheckCode

  console.log(`\n▶ dotenv-linter (${readOnly ? 'перевірка' : 'авто-фікс + фінальна перевірка'} .env*)`)
  const dotenvCode = runDotenvLinter(process.cwd(), readOnly)
  if (dotenvCode !== 0) return dotenvCode

  console.log('\n▶ markdownlint-cli2')
  const mdArgs = readOnly ? ['**/*.md', '**/*.mdc'] : ['--fix', '**/*.md', '**/*.mdc']
  const markdownlintCode = await markdownlintCli2({
    directory: process.cwd(),
    argv: mdArgs,
    logMessage: msg => process.stdout.write(`${msg}\n`),
    logError: msg => process.stderr.write(`${msg}\n`)
  })
  if (markdownlintCode !== 0) return markdownlintCode

  console.log('\n▶ v8r (schema-валідація json/json5/yaml/yml/toml)')
  return runV8rWithGlobs()
}

export const runLintTextCli = (opts = {}) =>
  runStandardLint(import.meta.dirname, () => runLintTextSteps(opts.readOnly === true, opts.llmFix === true))

/**
 * lint-поверхня text.
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [_cwd]
 * @param {{ readOnly?: boolean, llmFix?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintTextCli({ readOnly: opts.readOnly === true, llmFix: opts.llmFix === true })
}
