/**
 * T0-autofix для `nginx-default-tpl/template` — детерміновані правки без LLM.
 *
 * Покриває два типи порушень:
 *   - `default-tpl-conf-legacy-name` — перейменовує/перезаписує `default.tpl.conf` → `default.conf.template`
 *   - `error-log-off-directive` — замінює `error_log off;` → `error_log /dev/null crit;`
 */
import { join } from 'node:path'

import { migrateDefaultTplConfFiles, migrateErrorLogOffDirective } from './main.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

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
