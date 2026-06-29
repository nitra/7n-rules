/** @see ./docs/migrations.md */
import { existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Відносний шлях до директорії міграцій від кореня проєкту. */
const MIGRATIONS_REL = 'hasura/migrations'

/**
 * Перевіряє, що у `hasura/migrations/` відсутні файли `down.sql`.
 * Директорія міграції має містити лише `up.sql` — `down.sql` у проєкті не використовується.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — чисто, 1 — знайдено `down.sql`
 */
export async function main(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const cwd = cwdParam
  const migrationsDir = join(cwd, MIGRATIONS_REL)

  if (!existsSync(migrationsDir)) {
    pass(`${MIGRATIONS_REL}/ відсутній — перевірка down.sql не потрібна (hasura.mdc)`)
    return reporter.getExitCode()
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
    return reporter.getExitCode()
  }

  for (const file of offenders) {
    fail(`${file}: down.sql заборонений у ${MIGRATIONS_REL}/ — у директорії міграції має бути лише up.sql (hasura.mdc)`)
  }

  return reporter.getExitCode()
}
