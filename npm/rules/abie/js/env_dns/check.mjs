/**
 * Скан env-файлів abie (`*.dev.env`, `*.ua.env`): кожен внутрішньокластерний URL
 * `http://<svc>.<ns>.svc.<dns>` має відповідати кластеру за іменем файла:
 *   - `dev.env` → `abie-dev.internal` + `dev-*` namespace
 *   - `ua.env`  → `abie-ua.internal` + `ua-*` namespace
 *
 * Файл `.env` без імені (локальний для розробника) — виключено.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../../scripts/utils/load-cursor-config.mjs'

import { abieEnvNameFromBasename, collectAbieEnvFiles, validateAbieEnvInternalUrls } from '../../utils/env-dns.mjs'

/**
 * @returns {Promise<number>}
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = process.cwd()

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
