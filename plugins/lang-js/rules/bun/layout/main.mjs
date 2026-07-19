/** @see ./docs/layout.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

// Перевірка `devDependencies` кореневого `package.json` (дозволено лише `@nitra/*`)
// — у rego (`npm/policy/bun/package_json/`). JS-копії `isAllowedRootDevDependency`
// видалено, щоб не було двох джерел істини.

/**
 * Перевіряє відповідність проєкту правилам bun.mdc
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult} результат перевірки
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']) {
    if (existsSync(join(cwd, f))) {
      fail(`Знайдено заборонений файл: ${f} — видали його`)
    } else {
      pass(`Немає ${f}`)
    }
  }

  if (existsSync(join(cwd, '.yarn'))) {
    fail('Знайдено директорію .yarn — видали її')
  } else {
    pass('Немає .yarn/')
  }
  if (existsSync(join(cwd, 'bun.lock'))) {
    pass('bun.lock є')
  } else {
    fail('Відсутній bun.lock — запусти bun i')
  }

  if (existsSync(join(cwd, 'bunfig.toml'))) {
    pass('bunfig.toml є (структуру перевіряє npx @7n/rules fix → bun.bunfig)')
  } else {
    fail('Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)')
  }

  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    fail('Відсутній package.json у корені')
    return reporter.result()
  }

  return reporter.result()
}
