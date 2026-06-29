/**
 * T0-autofix для `js-run/js/runtime.mjs` — детерміноване створення канонічного
 * `jsconfig.json` у backend-пакетах із `src/` де він відсутній. Канон читається
 * з `jsconfig/template/jsconfig.json.snippet.json` (єдине джерело істини).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const JSCONFIG_MISSING_RE = /є каталог src\/, але немає jsconfig\.json/
const JSCONFIG_MISSING_MATCH_ALL_RE = /\[([^\]]+)\] є каталог src\/, але немає jsconfig\.json/gu

const JSCONFIG_CONTENT =
  readFileSync(
    fileURLToPath(new URL('../jsconfig/template/jsconfig.json.snippet.json', import.meta.url)),
    'utf8'
  ).trimEnd() + '\n'

/** @type {import('../../../scripts/lib/fix/discover-t0-patterns.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-run-jsconfig-create',
    test: out => JSCONFIG_MISSING_RE.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(JSCONFIG_MISSING_MATCH_ALL_RE)]
      if (matches.length === 0) return { ok: false, action: 'no match' }

      const created = []
      for (const m of matches) {
        const ws = m[1]
        const target = join(cwd, ws, 'jsconfig.json')
        if (!existsSync(target)) {
          writeFileSync(target, JSCONFIG_CONTENT, 'utf8')
          created.push(ws)
        }
      }
      if (created.length === 0) return { ok: false, action: 'jsconfig.json вже існує в усіх воркспейсах' }
      return { ok: true, action: `створено jsconfig.json: ${created.join(', ')}` }
    }
  }
]
