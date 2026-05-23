/**
 * Перевіряє текстовий стек і форматування за правилом text.mdc.
 *
 * **Що тут лишилося** (FS / VSCode-конфіги / markdown / лінт-скрипт):
 *  - `.v8rignore` (текстовий формат, рядки шляхів);
 *  - `.vscode/extensions.json` рекомендації (markdownlint, oxc, shellcheck) і
 *    `.vscode/settings.json` (`editor.formatOnSave`, `[lang].editor.defaultFormatter`);
 *  - наявність FS-файлів `.oxfmtrc.json`, `.cspell.json`, `.markdownlint-cli2.jsonc`,
 *    `package.json` (саме *існування* — структуру вже валідує Rego);
 *  - конфіги Prettier у корені (заборонено — FS);
 *  - абзац про український апостроф у `.cursor/rules/n-text.mdc` /
 *    `npm/mdc/text.mdc` (markdown-текст, не JSON/YAML);
 *  - складна валідація скрипта `lint-text` (cspell, markdownlint, v8r у трьох
 *    варіантах, run-shellcheck-text.mjs, обовʼязкові glob-и);
 *  - workflow `lint-text.yml` має крок `bun run lint-text` (структура — rego `text.lint_text`).
 *
 * **Що покрила Rego** (`npx \@nitra/cursor check`):
 *  - `npm/policy/text/oxfmtrc/` — обовʼязкові ключі `.oxfmtrc.json` і канонічні
 *    значення (semi/singleQuote/tabWidth/useTabs/printWidth) + `ignorePatterns`
 *    канонічні glob-и;
 *  - `npm/policy/text/cspell/` — `.cspell.json` `version "0.2"`, `language`,
 *    імпорт `@nitra/cspell-dict`, заборона `@cspell/dict-*`, обовʼязкові
 *    `ignorePaths`;
 *  - `npm/policy/text/markdownlint/` — `.markdownlint-cli2.jsonc` `gitignore: true`
 *    (працює лише якщо файл — валідний JSON без коментарів);
 *  - `npm/policy/text/package_json/` — заборона Prettier (`prettier` поле +
 *    `prettier`/`@nitra/prettier-config` у залежностях), `@nitra/cspell-dict ^2.0.0+`
 *    у `devDependencies`, заборона `markdownlint-cli2` у залежностях.
 *  - `npm/policy/bun/package_json/` — у `devDependencies` лише `@nitra/*`
 *    (раніше дублювалося тут).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { anyRunStepIncludes, parseWorkflowYaml } from '../../../../scripts/utils/gha-workflow.mjs'

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
 */
async function checkV8rIgnore(passFn, failFn) {
  const required = ['.vscode/extensions.json', '.vscode/settings.json']
  if (!existsSync('.v8rignore')) {
    failFn('.v8rignore не існує — створи згідно n-text.mdc (мінімум .vscode/extensions.json і .vscode/settings.json)')
    return
  }
  const raw = await readFile('.v8rignore', 'utf8')
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
 */
function checkTextConfigsExistence(passFn, failFn) {
  for (const [path, mdcRef] of [
    ['.oxfmtrc.json', 'text.oxfmtrc'],
    ['.cspell.json', 'text.cspell'],
    ['.markdownlint-cli2.jsonc', 'text.markdownlint'],
    ['.vscode/extensions.json', 'text.vscode_extensions'],
    ['.vscode/settings.json', 'text.vscode_settings']
  ]) {
    if (existsSync(path)) {
      passFn(`${path} є (структуру перевіряє npx @nitra/cursor check → ${mdcRef})`)
    } else {
      failFn(`${path} не існує — створи згідно n-text.mdc`)
    }
  }
  return Promise.resolve()
}

/**
 * Перевіряє package.json для текстового стека: складний `lint-text` скрипт і
 * виклик `bun run lint-text` у відповідному workflow. Решта (Prettier-заборона,
 * `@nitra/cspell-dict ^2.0.0+`, заборона `markdownlint-cli2` у залежностях,
 * `@nitra/*` гейт) — у Rego (`text.package_json`, `bun.package_json`).
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
async function checkPackageJsonText(passFn, failFn) {
  if (!existsSync('package.json')) return
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  checkLintTextScript(pkg.scripts?.['lint-text'], passFn, failFn)

  if (existsSync('.github/workflows/lint-text.yml')) {
    const wf = await readFile('.github/workflows/lint-text.yml', 'utf8')
    const root = parseWorkflowYaml(wf)
    const ok = root ? anyRunStepIncludes(root, 'bun run lint-text') : wf.includes('bun run lint-text')
    if (ok) {
      passFn('lint-text.yml викликає bun run lint-text')
    } else {
      failFn('lint-text.yml має містити крок bun run lint-text')
    }
  } else {
    failFn('.github/workflows/lint-text.yml не існує — створи згідно n-text.mdc')
  }
}

/**
 * Перевіряє скрипт lint-text: канонічний — `n-cursor lint-text` (CLI пакета `@nitra/cursor` робить
 * `cspell` → `runShellcheckText()` → `bunx markdownlint-cli2 --fix` → `runV8rWithGlobs()`).
 * Дозволено whitespace навколо команди.
 * @param {unknown} lintText значення `scripts.lint-text` з package.json
 * @param {(msg: string) => void} passFn callback при успішній перевірці
 * @param {(msg: string) => void} failFn callback при помилці
 */
function checkLintTextScript(lintText, passFn, failFn) {
  const lt = typeof lintText === 'string' ? lintText.trim() : ''
  if (lt === 'n-cursor lint-text') {
    passFn('lint-text делегує CLI n-cursor lint-text (cspell + shellcheck + markdownlint + v8r)')
  } else {
    failFn(
      'package.json: lint-text має бути "n-cursor lint-text" — CLI пакета @nitra/cursor виконує cspell → shellcheck → markdownlint-cli2 → v8r (text.mdc)'
    )
  }
}

/**
 * Перевіряє відповідність проєкту правилам text.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  await checkV8rIgnore(pass, fail)
  await checkTextConfigsExistence(pass, fail)

  for (const f of ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', '.prettierrc.yml']) {
    if (existsSync(f)) fail(`Знайдено конфіг prettier: ${f} — видали його`)
  }

  const textRulePaths = ['.cursor/rules/n-text.mdc', 'npm/mdc/text.mdc'].filter(p => existsSync(p))
  if (textRulePaths.length === 0) {
    pass('n-text.mdc / npm/mdc/text.mdc відсутні — перевірку абзацу про апостроф пропущено')
  } else {
    for (const p of textRulePaths) {
      verifyUkApostropheRuleParagraph(p, await readFile(p, 'utf8'), fail, pass)
    }
  }

  await checkPackageJsonText(pass, fail)

  return reporter.getExitCode()
}
