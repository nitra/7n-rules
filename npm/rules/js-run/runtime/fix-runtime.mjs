/**
 * T0-autofix для `js-run/runtime` — детерміноване створення канонічного
 * `jsconfig.json` у backend-пакетах із `src/` де він відсутній. Канон читається
 * з `jsconfig/template/jsconfig.json.snippet.json` (єдине джерело істини).
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Workspace-и читаються з `v.message` ("[<ws>] є каталог src/, але немає jsconfig.json").
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const JSCONFIG_MISSING_RE = /є каталог src\/, але немає jsconfig\.json/u
/** Витягує workspace із message-а одного violation (`[<ws>] є каталог src/…`). */
const JSCONFIG_MISSING_WS_RE = /^\[([^\]]*)\] є каталог src\/, але немає jsconfig\.json/u

const JSCONFIG_CONTENT =
  readFileSync(
    fileURLToPath(new URL('../jsconfig/template/jsconfig.json.snippet.json', import.meta.url)),
    'utf8'
  ).trimEnd() + '\n'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-run-jsconfig-create',
    test: violations => violations.some(v => JSCONFIG_MISSING_RE.test(v.message)),
    apply: (violations, ctx) => {
      const cwd = ctx.cwd
      const touchedFiles = []
      for (const v of violations) {
        const m = JSCONFIG_MISSING_WS_RE.exec(v.message)
        if (!m) continue
        const ws = m[1]
        const target = join(cwd, ws, 'jsconfig.json')
        if (!existsSync(target)) {
          ctx.recordWrite?.(target)
          writeFileSync(target, JSCONFIG_CONTENT, 'utf8')
          touchedFiles.push(target)
        }
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `створено jsconfig.json: ${touchedFiles.join(', ')}` }
    }
  }
]
