/** @see ./docs/env_dns.md */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { abieEnvNameFromBasename, collectAbieEnvFiles, validateAbieEnvInternalUrls } from '../lib/env-dns.mjs'

/**
 * @returns {Promise<number>} результат
 * @param {string} [cwd] корінь репозиторію
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const envFiles = await collectAbieEnvFiles(root, ignorePaths)
  if (envFiles.length === 0) {
    pass('Не знайдено dev.env / ua.env у репозиторії — перевірку env→cluster DNS пропущено (abie.mdc)')
    return reporter.getExitCode()
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

  return reporter.getExitCode()
}
