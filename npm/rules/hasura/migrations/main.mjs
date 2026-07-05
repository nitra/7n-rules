/** @see ./docs/migrations.md */
import { existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Відносний шлях до директорії міграцій від кореня проєкту. */
const MIGRATIONS_REL = 'hasura/migrations'

/**
 * Перевіряє, що у `hasura/migrations/` відсутні файли `down.sql`.
 * Директорія міграції має містити лише `up.sql` — `down.sql` у проєкті не використовується.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const migrationsDir = join(cwd, MIGRATIONS_REL)

  if (!existsSync(migrationsDir)) {
    pass(`${MIGRATIONS_REL}/ відсутній — перевірка down.sql не потрібна (hasura.mdc)`)
    return reporter.result()
  }

  /** @type {string[]} */
  const offenders = []
  await walkDir(migrationsDir, absPath => {
    if (basename(absPath) === 'down.sql') {
      offenders.push(relative(cwd, absPath))
    }
  })

  if (offenders.length === 0) {
    pass(`Жоден down.sql не знайдено у ${MIGRATIONS_REL}/ (hasura.mdc)`)
    return reporter.result()
  }

  for (const file of offenders) {
    fail(
      `${file}: down.sql заборонений у ${MIGRATIONS_REL}/ — у директорії міграції має бути лише up.sql (hasura.mdc)`,
      {
        file,
        reason: 'down-sql-forbidden'
      }
    )
  }

  return reporter.result()
}
