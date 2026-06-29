/** @see ./docs/env_dns.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { abieEnvNameFromBasename, collectAbieEnvFiles, validateAbieEnvInternalUrls } from '../lib/env-dns.mjs'

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const envFiles = await collectAbieEnvFiles(root, ignorePaths)
  if (envFiles.length === 0) {
    pass('Не знайдено dev.env / ua.env у репозиторії — перевірку env→cluster DNS пропущено (abie.mdc)')
    return reporter.result()
  }

  for (const abs of envFiles) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    const envName = abieEnvNameFromBasename(basename(abs))
    if (envName === null) continue
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати (${msg})`)
      continue
    }
    const errors = validateAbieEnvInternalUrls(raw, envName)
    if (errors.length === 0) {
      pass(`${rel}: усі внутрішні URL відповідають env "${envName}" (abie.mdc)`)
    } else {
      for (const err of errors) fail(`${rel}: ${err} (abie.mdc)`)
    }
  }

  return reporter.result()
}
