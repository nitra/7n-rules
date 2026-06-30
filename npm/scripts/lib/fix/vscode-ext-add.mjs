/**
 * Shared T0-autofix паттерн для правил із `vscode_extensions` policy-поверхнею.
 * Гарантує, що `.vscode/extensions.json#recommendations` містить усі канонічні
 * розширення з `template/extensions.json.snippet.json` свого concern-а (створює файл
 * якщо відсутній, домерджує відсутні). Один механізм для всіх vscode_extensions-правил.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)),
 * канон читається з template концерну (ctx.concernDir), не з тексту violation.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const REC_REQUIRE_RE = /recommendations має містити|extensions\.json/u

/** @type {import('../lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'vscode-ext-add',
    test: violations => violations.some(v => v.reason === 'policy-file-missing' || REC_REQUIRE_RE.test(v.message)),
    apply: (violations, ctx) => {
      const snippetPath = ctx.concernDir ? join(ctx.concernDir, 'template', 'extensions.json.snippet.json') : null
      if (!snippetPath || !existsSync(snippetPath)) return { touchedFiles: [] }

      /** @type {string[]} */
      let canonical = []
      try {
        canonical = JSON.parse(readFileSync(snippetPath, 'utf8')).recommendations ?? []
      } catch {
        return { touchedFiles: [] }
      }
      if (canonical.length === 0) return { touchedFiles: [] }

      const extPath = join(ctx.cwd, '.vscode/extensions.json')
      let parsed = {}
      if (existsSync(extPath)) {
        try {
          parsed = JSON.parse(readFileSync(extPath, 'utf8'))
        } catch {
          return { touchedFiles: [] } // невалідний JSON — не чіпаємо детермінованим фіксом
        }
      }
      const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
      const toAdd = canonical.filter(e => !recs.includes(e))
      if (toAdd.length === 0 && existsSync(extPath)) return { touchedFiles: [] }

      ctx.recordWrite?.(extPath)
      parsed.recommendations = [...recs, ...toAdd]
      mkdirSync(dirname(extPath), { recursive: true })
      writeFileSync(extPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
      return { touchedFiles: [extPath], message: `extensions.json: +${toAdd.join(', ') || 'created'}` }
    }
  }
]
