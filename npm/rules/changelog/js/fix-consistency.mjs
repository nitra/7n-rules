/**
 * T0-autofix для `changelog/js/consistency.mjs` — детерміноване створення
 * change-файлу для воркспейсів з релевантними змінами без change-файлу.
 * Subject останнього git-коміту стає описом; bump завжди `patch`.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { writeChange } from '../../release/change.mjs'

const MISSING_CHANGE_RE = /є релевантні зміни, але немає change-файлу/
const MISSING_CHANGE_MATCH_ALL_RE = /(?:^|\s)([\w./@-]+): є релевантні зміни, але немає change-файлу/gm

const CHANGE_BUMP = 'patch'
const CHANGE_SECTION = 'Changed'
const CHANGE_FALLBACK_MESSAGE = 'оновлення'

/**
 * @param {string} cwd корінь репозиторію
 * @returns {string} непорожній опис
 */
function autoChangeMessage(cwd) {
  const r = spawnSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' })
  const subject = r.status === 0 ? (r.stdout ?? '').trim() : ''
  return subject || CHANGE_FALLBACK_MESSAGE
}

/** @type {import('../../../scripts/lib/fix/discover-t0-patterns.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'changelog-create-change-file',
    test: out => MISSING_CHANGE_RE.test(out),
    apply: async (out, cwd) => {
      const workspaces = Array.from(out.matchAll(MISSING_CHANGE_MATCH_ALL_RE), m => m[1])
      if (workspaces.length === 0) return { ok: false, action: 'no match' }

      const message = autoChangeMessage(cwd)
      const created = []
      for (const ws of workspaces) {
        try {
          const rel = await writeChange({ bump: CHANGE_BUMP, section: CHANGE_SECTION, message, ws, cwd })
          created.push(ws === '.' ? rel : join(ws, rel))
        } catch (error) {
          return { ok: false, action: `writeChange ${ws}: ${error.message}` }
        }
      }
      return { ok: true, action: `створено change-файл (${CHANGE_BUMP}/${CHANGE_SECTION}): ${created.join(', ')}` }
    }
  }
]
