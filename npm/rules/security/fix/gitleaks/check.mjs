/**
 * FS-частина правила `security`.
 *
 * Перевіряє:
 *  - наявність `package.json` (структуру валідує Rego);
 *  - наявність `.gitleaks.toml` (без нього скан "сліпий");
 *  - вміст `.gitleaks.toml` ⊇ канону з template/.gitleaks.toml.snippet.toml
 *    (зокрема `[extend].useDefault = true`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseToml } from 'smol-toml'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { checkSnippet, loadTemplate } from '../../../../scripts/utils/template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GITLEAKS_CONFIG = '.gitleaks.toml'

async function checkGitleaksConfig(pass, fail) {
  if (!existsSync(GITLEAKS_CONFIG)) {
    fail(`${GITLEAKS_CONFIG} не знайдено — створи за каноном template/.gitleaks.toml.snippet.toml (security.mdc)`)
    return
  }
  const target = parseToml(await readFile(GITLEAKS_CONFIG, 'utf8'))
  const tpl = await loadTemplate(HERE)
  const snippet = tpl[GITLEAKS_CONFIG]?.snippet
  if (!snippet) {
    fail(`internal: template ${GITLEAKS_CONFIG}.snippet.toml не знайдено у ${HERE}/template/`)
    return
  }
  const violations = checkSnippet(target, snippet, { targetPath: GITLEAKS_CONFIG, source: 'security.mdc' })
  if (violations.length === 0) {
    pass(`${GITLEAKS_CONFIG} відповідає канону (template/.gitleaks.toml.snippet.toml)`)
  } else {
    for (const msg of violations) fail(msg)
  }
}

export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє Rego)')
  await checkGitleaksConfig(pass, fail)
  return reporter.getExitCode()
}
