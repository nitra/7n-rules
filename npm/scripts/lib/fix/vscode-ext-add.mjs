/**
 * Shared T0-autofix паттерн для правил із `vscode_extensions.rego`.
 * Читає назву розширення з violation-message і додає його до
 * `.vscode/extensions.json#recommendations`.
 *
 * Не прив'язаний до конкретного правила — один механізм для всіх правил,
 * що емітують «recommendations має містити "…"».
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REC_REQUIRE_RE = /recommendations має містити "[^"]+"/
const REC_MATCH_ALL_RE = /recommendations має містити "([^"]+)"/g

/** @type {import('./discover-t0-patterns.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'vscode-ext-add',
    test: out => REC_REQUIRE_RE.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(REC_MATCH_ALL_RE)]
      if (matches.length === 0) return { ok: false, action: 'no match' }

      const extPath = join(cwd, '.vscode/extensions.json')
      if (!existsSync(extPath)) {
        return { ok: false, action: '.vscode/extensions.json не знайдено' }
      }

      let parsed
      try {
        parsed = JSON.parse(readFileSync(extPath, 'utf8'))
      } catch {
        return { ok: false, action: '.vscode/extensions.json: невалідний JSON' }
      }

      const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
      const toAdd = matches.map(m => m[1]).filter(e => !recs.includes(e))
      if (toAdd.length === 0) return { ok: false, action: 'вже є' }

      parsed.recommendations = [...recs, ...toAdd]
      writeFileSync(extPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
      return { ok: true, action: `додано до extensions.json: ${toAdd.join(', ')}` }
    }
  }
]
