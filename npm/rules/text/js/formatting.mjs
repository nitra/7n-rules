/** @see ./docs/formatting.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { anyRunStepIncludes, parseWorkflowYaml } from '../../../scripts/lib/gha-workflow.mjs'

/** Заголовок абзацу про апостроф у text.mdc / n-text.mdc. */
const UK_APOSTROPHE_HEADING = '**Український апостроф:**'

/**
 * Перевіряє абзац про український апостроф у вмісті правила text.
 * @param {string} filePath шлях до файлу (для повідомлень)
 * @param {string} body вміст .mdc у UTF-8
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyUkApostropheRuleParagraph(filePath, body, failFn, passFn) {
  if (!body.includes(UK_APOSTROPHE_HEADING)) {
    failFn(`${filePath}: додай абзац **Український апостроф:** (U+0027 / U+2019, масив words) — див. text.mdc`)
    return
  }
  if (!body.includes('U+0027') || !body.includes('U+2019')) {
    failFn(`${filePath}: абзац про апостроф має містити позначки U+0027 та U+2019`)
    return
  }
  if (!body.includes('’')) {
    failFn(`${filePath}: у прикладі має бути типографський символ U+2019 (’)`)
    return
  }
  passFn(`${filePath}: абзац про український апостроф на місці`)
}

/**
 * Перевіряє .v8rignore.
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkV8rIgnore(passFn, failFn, cwd) {
  const required = ['.vscode/extensions.json', '.vscode/settings.json']
  const v8rPath = join(cwd, '.v8rignore')
  if (!existsSync(v8rPath)) {
    failFn('.v8rignore не існує — створи згідно n-text.mdc (мінімум .vscode/extensions.json і .vscode/settings.json)')
    return
  }
  const raw = await readFile(v8rPath, 'utf8')
  const lines = new Set(
    raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'))
  )
  for (const path of required) {
    if (lines.has(path)) {
      passFn(`.v8rignore містить ${path}`)
    } else {
      failFn(`.v8rignore: додай рядок "${path}" (JSON без схеми в Schema Store — див. n-text.mdc)`)
    }
  }
}

// `.vscode/extensions.json` (`DavidAnson.vscode-markdownlint`, `oxc.oxc-vscode`,
// `timonwong.shellcheck`) і `.vscode/settings.json` (`editor.formatOnSave` +
// `[lang].editor.defaultFormatter`) валідують rego-пакети `text.vscode_extensions`
// і `text.vscode_settings` (auto-discovered через `target.json` поруч з `.rego`).
// FS-existence файлів — у `checkTextConfigsExistence`.

/**
 * FS-existence стек текстових конфігів. Контент-валідація — у Rego
 * (`text.oxfmtrc`, `text.cspell`, `text.markdownlint`).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @returns {Promise<void>}
 * @param {string} cwd корінь репозиторію
 */
function checkTextConfigsExistence(passFn, failFn, cwd) {
  for (const [path, mdcRef] of [
    ['.oxfmtrc.json', 'text.oxfmtrc'],
    ['.cspell.json', 'text.cspell'],
    ['.markdownlint-cli2.jsonc', 'text.markdownlint'],
    ['.vscode/extensions.json', 'text.vscode_extensions'],
    ['.vscode/settings.json', 'text.vscode_settings']
  ]) {
    if (existsSync(join(cwd, path))) {
      passFn(`${path} є (структуру перевіряє npx @nitra/cursor fix → ${mdcRef})`)
    } else {
      failFn(`${path} не існує — створи згідно n-text.mdc`)
    }
  }
  return Promise.resolve()
}

/**
 * Перевіряє CI-workflow текстового стека: крок `n-cursor lint text --read-only` у
 * `.github/workflows/lint-text.yml` (CI — нуль мутацій). Окремого `lint-text` скрипта в
 * `package.json` немає — лінт через `n-cursor lint text`. Решта package.json-перевірок
 * (Prettier-заборона, `@nitra/cspell-dict`, `@nitra/*` гейт) — у Rego (`text.package_json`, `bun.package_json`).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 * @param {string} cwd корінь репозиторію
 */
async function checkLintTextWorkflow(passFn, failFn, cwd) {
  const lintTextWf = join(cwd, '.github/workflows/lint-text.yml')
  if (existsSync(lintTextWf)) {
    const wf = await readFile(lintTextWf, 'utf8')
    const root = parseWorkflowYaml(wf)
    const canonRun = 'n-cursor lint text --read-only'
    const ok = root ? anyRunStepIncludes(root, canonRun) : wf.includes(canonRun)
    if (ok) {
      passFn(`lint-text.yml викликає ${canonRun}`)
    } else {
      failFn(`lint-text.yml має містити крок ${canonRun} (CI — read-only, нуль мутацій)`)
    }
  } else {
    failFn('.github/workflows/lint-text.yml не існує — створи згідно n-text.mdc')
  }
}

/**
 * Перевіряє відповідність проєкту правилам text.mdc.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkV8rIgnore(pass, fail, cwd)
  await checkTextConfigsExistence(pass, fail, cwd)

  // Prettier-конфіги/ignore — окремий concern `text.forbidden-prettier` (rules/text/js/forbidden-prettier.mjs).

  const textRulePaths = ['.cursor/rules/n-text.mdc', 'npm/mdc/text.mdc'].filter(p => existsSync(join(cwd, p)))
  if (textRulePaths.length === 0) {
    pass('n-text.mdc / npm/mdc/text.mdc відсутні — перевірку абзацу про апостроф пропущено')
  } else {
    for (const p of textRulePaths) {
      verifyUkApostropheRuleParagraph(p, await readFile(join(cwd, p), 'utf8'), fail, pass)
    }
  }

  await checkLintTextWorkflow(pass, fail, cwd)

  return reporter.getExitCode()
}
