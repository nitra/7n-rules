/**
 * T0-autofix для `changelog/consistency` — детерміноване створення change-файлу
 * для воркспейсів з релевантними змінами без change-файлу. Subject останнього
 * git-коміту стає описом; bump завжди `patch`.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Назви воркспейсів читаються з `v.message` ("<ws>: є релевантні зміни, але немає
 * change-файлу"), не з агрегованого output-рядка.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { writeChange } from '../../release/change.mjs'

const MISSING_CHANGE_RE = /є релевантні зміни, але немає change-файлу/u
/** Витягує мітку воркспейсу з message-а одного violation. */
const MISSING_CHANGE_LABEL_RE = /^(\S+): є релевантні зміни, але немає change-файлу/u

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

/**
 * Мітка воркспейсу (`<root>` для кореня) → шлях для `writeChange` (`.` для кореня).
 * @param {string} label мітка з повідомлення
 * @returns {string} workspace для writeChange
 */
function labelToWorkspace(label) {
  return label === '<root>' ? '.' : label
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'changelog-create-change-file',
    test: violations => violations.some(v => MISSING_CHANGE_RE.test(v.message)),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      const workspaces = []
      for (const v of violations) {
        const m = MISSING_CHANGE_LABEL_RE.exec(v.message)
        if (m) workspaces.push(labelToWorkspace(m[1]))
      }
      if (workspaces.length === 0) return { touchedFiles: [] }

      const message = autoChangeMessage(cwd)
      const touchedFiles = []
      for (const ws of new Set(workspaces)) {
        const rel = await writeChange({ bump: CHANGE_BUMP, section: CHANGE_SECTION, message, ws, cwd })
        const created = ws === '.' ? rel : join(ws, rel)
        const abs = join(cwd, created)
        ctx.recordWrite?.(abs)
        touchedFiles.push(abs)
      }
      return {
        touchedFiles,
        message: `створено change-файл (${CHANGE_BUMP}/${CHANGE_SECTION}): ${touchedFiles.join(', ')}`
      }
    }
  }
]
