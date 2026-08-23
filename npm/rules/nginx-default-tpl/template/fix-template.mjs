/**
 * T0-autofix для `nginx-default-tpl/template` — детерміновані правки без LLM.
 *
 * Покриває два типи порушень:
 *   - `default-tpl-conf-legacy-name` — перейменовує/перезаписує `default.tpl.conf` → `default.conf.template`
 *   - `error-log-off-directive` — замінює `error_log off;` → `error_log /dev/null crit;`
 *
 * `migrateDefaultTplConfFiles`/`migrateErrorLogOffDirective` і приватна залежність
 * `findDefaultConfTemplatePaths` перенесені сюди з видаленого `main.mjs` — read-only
 * детектор-бік того самого концерну портовано в `rules-core`
 * (`crates/rules-core/src/concerns/nginx_default_tpl_template.rs`), а ці три функції
 * мутують файлову систему (`rename`/`unlink`/`writeFile`) і лишаються виключно
 * JS-стороною T0-автофіксу — той самий поділ, що вже прийнятий для
 * `text/run-shellcheck` (`fix-run-shellcheck.mjs`: write-режим лишається в JS, read-only
 * детектор — у `rules-core`).
 */
import { existsSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

// `error_log off;` — НЕ валідний nginx: "off" трактується як ім'я файлу (/etc/nginx/off)
// і падає під readOnlyRootFilesystem. /dev/null — writable device, тому канон — `error_log /dev/null crit;`.
const ERROR_LOG_OFF_RE = /error_log\s+off\s*;/gu
const ERROR_LOG_CANONICAL = 'error_log /dev/null crit;'

/**
 * Збирає абсолютні шляхи до **default.conf.template** у репозиторії; будь-який сегмент
 * `fixtures/` у шляху виключається — це тестові артефакти (як `tests/fixtures/` так і
 * co-located `rules/<rule>/js/<concern>/fixtures/`).
 * @param {string} root корінь cwd
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до шаблонів
 */
async function findDefaultConfTemplatePaths(root, ignorePaths = []) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    p => {
      if (basename(p) !== 'default.conf.template') return
      const rel = relative(root, p).replaceAll('\\', '/')
      if (rel.split('/').includes('fixtures')) return
      out.push(p)
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Знаходить у дереві від `root` усі **default.tpl.conf**. Якщо поруч немає **default.conf.template** —
 * перейменовує файл; якщо є — перезаписує **default.conf.template** вмістом **default.tpl.conf** і видаляє **default.tpl.conf**.
 * @param {string} root корінь обходу (зазвичай cwd репозиторію)
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<{ renamed: string[], overwritten: string[] }>} відносні шляхи до обробленого **default.tpl.conf** (для звіту)
 */
async function migrateDefaultTplConfFiles(root, ignorePaths = []) {
  /** @type {string[]} */
  const oldPaths = []
  await walkDir(
    root,
    p => {
      if (basename(p) === 'default.tpl.conf') oldPaths.push(p)
    },
    ignorePaths
  )
  oldPaths.sort((a, b) => a.localeCompare(b))

  /** @type {string[]} */
  const renamed = []
  /** @type {string[]} */
  const overwritten = []

  for (const oldPath of oldPaths) {
    const newPath = join(dirname(oldPath), 'default.conf.template')
    const relOld = relative(root, oldPath).replaceAll('\\', '/') || oldPath.replaceAll('\\', '/')
    if (existsSync(newPath)) {
      const body = await readFile(oldPath, 'utf8')
      await writeFile(newPath, body, 'utf8')
      await unlink(oldPath)
      overwritten.push(relOld)
    } else {
      await rename(oldPath, newPath)
      renamed.push(relOld)
    }
  }

  return { renamed, overwritten }
}

/**
 * Замінює невалідну директиву `error_log off;` на `error_log /dev/null crit;` у всіх
 * **default.conf.template** від `root`. `error_log off;` — НЕ валідний nginx: "off" трактується
 * як ім'я файлу (`/etc/nginx/off`) і падає під readOnlyRootFilesystem; `/dev/null` — writable device.
 * @param {string} root корінь обходу (зазвичай cwd репозиторію)
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відносні шляхи виправлених шаблонів (для звіту)
 */
async function migrateErrorLogOffDirective(root, ignorePaths = []) {
  const templates = await findDefaultConfTemplatePaths(root, ignorePaths)
  /** @type {string[]} */
  const fixed = []
  for (const abs of templates) {
    const body = await readFile(abs, 'utf8')
    const next = body.replace(ERROR_LOG_OFF_RE, () => ERROR_LOG_CANONICAL)
    if (next === body) continue
    await writeFile(abs, next, 'utf8')
    fixed.push(relative(root, abs).replaceAll('\\', '/') || abs)
  }
  return fixed
}

const LEGACY_TPL_CONF_SUFFIX_RE = /default\.tpl\.conf$/
const CONF_TEMPLATE_SUFFIX_RE = /default\.conf\.template$/

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'nginx-default-tpl-legacy-name',
    test: violations => violations.some(v => v.data?.kind === 'default-tpl-conf-legacy-name'),
    apply: async (violations, ctx) => {
      const ignorePaths = await loadCursorIgnorePaths(ctx.cwd)
      const { renamed, overwritten } = await migrateDefaultTplConfFiles(ctx.cwd, ignorePaths)
      /** @type {string[]} */
      const touchedFiles = []
      for (const rel of renamed) {
        const abs = join(ctx.cwd, rel.replace(LEGACY_TPL_CONF_SUFFIX_RE, 'default.conf.template'))
        ctx.recordWrite?.(join(ctx.cwd, rel.replace(CONF_TEMPLATE_SUFFIX_RE, 'default.tpl.conf')))
        touchedFiles.push(abs)
      }
      for (const rel of overwritten) {
        const abs = join(ctx.cwd, rel.replace(LEGACY_TPL_CONF_SUFFIX_RE, 'default.conf.template'))
        ctx.recordWrite?.(join(ctx.cwd, rel.replace(CONF_TEMPLATE_SUFFIX_RE, 'default.tpl.conf')))
        touchedFiles.push(abs)
      }
      const count = renamed.length + overwritten.length
      return count > 0
        ? { touchedFiles, message: `default.tpl.conf → default.conf.template: ${count} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'nginx-default-tpl-error-log-off',
    test: violations => violations.some(v => v.data?.kind === 'error-log-off-directive'),
    apply: async (violations, ctx) => {
      const files = [
        ...new Set(violations.filter(v => v.data?.kind === 'error-log-off-directive' && v.file).map(v => v.file))
      ]
      const ignorePaths = await loadCursorIgnorePaths(ctx.cwd)
      const fixed = await migrateErrorLogOffDirective(ctx.cwd, ignorePaths)
      /** @type {string[]} */
      const touchedFiles = []
      for (const rel of fixed) {
        if (!(files.length === 0 || files.includes(rel))) {
          continue
        }

        const abs = join(ctx.cwd, rel)
        ctx.recordWrite?.(abs)
        touchedFiles.push(abs)
      }
      return touchedFiles.length > 0
        ? { touchedFiles, message: `error_log off → /dev/null crit: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
