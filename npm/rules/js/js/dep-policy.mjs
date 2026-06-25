/** @see ./docs/dep-policy.md */
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { parseSync } from 'oxc-parser'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import {
  dynamicImportModule,
  langFromPath,
  requireCallModule,
  walkAstWithAncestors
} from '../../../scripts/utils/ast-scan-utils.mjs'

const JS_SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/u

/**
 * Пакети, заборонені як import-specifier у будь-якому JS/TS-файлі.
 * Ключ — specifier, значення — підказка про заміну.
 */
const BANNED_SPECIFIERS = new Map([
  ['@nitra/as-integrations-fastify', 'використовуй @as-integrations/fastify'],
  [
    'ua-parser-js',
    'замінити на bowser (MIT, ~6 KB) — npm i bowser. ua-parser-js v2 змінив ліцензію на AGPL-3.0, несумісну з комерційним використанням'
  ]
])

/**
 * Витягає з джерела всі import-specifier'и (static + dynamic + require).
 * @param {string} source текст файлу
 * @param {string} filePath шлях до файлу (для вибору мови OXC-парсера)
 * @returns {string[]} список specifier'ів
 */
function extractImportSpecifiers(source, filePath) {
  /** @type {string[]} */
  const result = []
  let parsed
  try {
    parsed = parseSync(filePath, source, { lang: langFromPath(filePath) })
  } catch {
    return result
  }
  for (const imp of parsed?.module?.staticImports ?? []) {
    if (typeof imp?.moduleRequest?.value === 'string') result.push(imp.moduleRequest.value)
  }
  const program = parsed?.program
  if (program && typeof program === 'object') {
    walkAstWithAncestors(program, [], node => {
      const dyn = dynamicImportModule(node)
      if (dyn !== null) result.push(dyn)
      const req = requireCallModule(node)
      if (req !== null) result.push(req)
    })
  }
  return result
}

/**
 * Сканує всі JS/TS-файли проєкту на заборонені import-specifier'и (dep-policy.mdc).
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — чисто, 1 — знайдено заборонені specifier'и
 */
export async function check(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const cwd = cwdParam
  const ignorePaths = await loadCursorIgnorePaths(cwd)

  const files = []
  await walkDir(
    cwd,
    p => {
      if (JS_SOURCE_RE.test(p)) files.push(p)
    },
    ignorePaths
  )

  let violations = 0
  for (const absPath of files) {
    const source = await readFile(absPath, 'utf8')
    const specifiers = extractImportSpecifiers(source, absPath)
    for (const spec of specifiers) {
      const hint = BANNED_SPECIFIERS.get(spec)
      if (hint !== undefined) {
        const rel = relative(cwd, absPath)
        reporter.fail(`${rel}: заборонений import '${spec}' — ${hint} (js.mdc dep-policy)`)
        violations += 1
      }
    }
  }

  if (violations === 0) {
    reporter.pass(`dep-policy: перевірено ${files.length} файлів — заборонених import-specifier'ів немає (js.mdc)`)
  }

  return reporter.getExitCode()
}
