/**
 * FS-частина правила `security` (security.mdc).
 *
 * **Що тут лишилося** (FS / cross-file):
 *  - наявність `package.json` у корені (структуру валідує Rego);
 *  - наявність `.gitleaks.toml` у корені — нагадування створити з канону `security.mdc`;
 *  - `.gitleaks.toml` має `useDefault = true` у блоці `[extend]` (інакше дефолтні правила
 *    gitleaks перетираються і скан стає сліпим до 95% типових витоків).
 *
 * **Що покрила Rego** (`npx \@nitra/cursor check`, `npm/policy/security/package_json/`):
 *  - `scripts.lint-security` існує і викликає `gitleaks` з `detect`/`git` subcommand;
 *  - агрегований `scripts.lint` (якщо є) містить `bun run lint-security`;
 *  - `gitleaks` НЕ у `dependencies` / `devDependencies` (бо це глобальний CLI).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'

const GITLEAKS_CONFIG = '.gitleaks.toml'

/**
 * Перевіряє наявність `.gitleaks.toml` у корені та канонічну вимогу `useDefault = true`
 * у блоці `[extend]`. Користувач сам наповнює `[allowlist]` локальними патернами.
 * @param {(msg: string) => void} pass callback при успішній перевірці
 * @param {(msg: string) => void} fail callback при помилці
 * @returns {Promise<void>}
 */
async function checkGitleaksConfig(pass, fail) {
  if (!existsSync(GITLEAKS_CONFIG)) {
    fail(`${GITLEAKS_CONFIG} не знайдено в корені — створи за каноном security.mdc (useDefault = true + [allowlist])`)
    return
  }
  const raw = await readFile(GITLEAKS_CONFIG, 'utf8')
  if (!/useDefault\s*=\s*true/u.test(raw)) {
    fail(
      `${GITLEAKS_CONFIG}: відсутнє \`useDefault = true\` у блоці [extend] — без нього вбудовані ` +
        'gitleaks-правила перетираються і скан стає сліпим (security.mdc)'
    )
    return
  }
  pass(`${GITLEAKS_CONFIG} існує і успадковує дефолтні gitleaks-правила (useDefault = true)`)
}

/**
 * Запускає всі FS-перевірки правила security.
 * @returns {Promise<number>} 0 — все OK, 1 — є зауваження
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync('package.json')) {
    fail('package.json не знайдено в корені — додай (security.mdc)')
    return reporter.getExitCode()
  }
  pass('package.json є (структуру перевіряє npx @nitra/cursor check → security.package_json)')

  await checkGitleaksConfig(pass, fail)

  return reporter.getExitCode()
}
