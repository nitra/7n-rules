/**
 * Перевірка метаданих скілів пакета `@nitra/cursor` (концерн правила npm-module).
 *
 * Кожен `npm/skills/<id>/` має містити валідний `meta.json`:
 *  - `worktree` присутнє і boolean;
 *  - `auto` (якщо присутнє) — розпізнане (`"завжди"` або непорожній масив рядків);
 *  - залишковий `auto.md` заборонено (міграція на meta.json завершена).
 *
 * Концерн застосовний лише в репо самого пакета (де є `npm/skills/`); у споживача
 * каталогу `npm/skills/` нема, тож перевірка мовчки проходить.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseSkillAutoSpec, readSkillMetaRaw } from '../../../scripts/lib/skill-meta.mjs'

/**
 * Валідує всі `npm/skills/<id>/meta.json`.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const skillsDir = join(cwd, 'npm', 'skills')
  if (!existsSync(skillsDir)) {
    reporter.pass('npm/skills/ відсутній — немає скілів для валідації')
    return Promise.resolve(reporter.getExitCode())
  }

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const id = entry.name
    const skillDir = join(skillsDir, id)
    let skillOk = true

    if (existsSync(join(skillDir, 'auto.md'))) {
      reporter.fail(`skills/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
      skillOk = false
    }

    const raw = readSkillMetaRaw(skillDir)
    if (!raw) {
      reporter.fail(`skills/${id}: відсутній або невалідний meta.json (очікується {"auto"?, "worktree": bool})`)
      continue
    }
    if (typeof raw.worktree !== 'boolean') {
      reporter.fail(`skills/${id}: meta.json.worktree має бути boolean`)
      skillOk = false
    }
    if (raw.auto !== undefined && parseSkillAutoSpec(raw.auto) === null) {
      reporter.fail(`skills/${id}: meta.json.auto нерозпізнане — очікується "завжди" або непорожній масив правил`)
      skillOk = false
    }
    if (skillOk) {
      reporter.pass(`skills/${id}: meta.json валідний`)
    }
  }

  return Promise.resolve(reporter.getExitCode())
}
