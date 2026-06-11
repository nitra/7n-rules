/** @see ./docs/skill_meta.md */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { parseSkillAutoSpec, readSkillMetaRaw } from '../../../scripts/lib/skill-meta.mjs'

/**
 * Перевіряє поля сирого meta.json одного скіла (без auto.md / відсутності файлу).
 * @param {string} id ідентифікатор скіла
 * @param {Record<string, unknown>} raw сирий meta.json
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер
 * @returns {boolean} true, якщо всі поля валідні
 */
function checkSkillFields(id, raw, reporter) {
  let ok = true
  if (typeof raw.worktree !== 'boolean') {
    reporter.fail(`skills/${id}: meta.json.worktree має бути boolean`)
    ok = false
  }
  if (raw.auto !== undefined && parseSkillAutoSpec(raw.auto) === null) {
    reporter.fail(`skills/${id}: meta.json.auto нерозпізнане — очікується "завжди" або непорожній масив правил`)
    ok = false
  }
  if (raw.requireRoot !== undefined && typeof raw.requireRoot !== 'boolean') {
    reporter.fail(`skills/${id}: meta.json.requireRoot має бути boolean`)
    ok = false
  }
  if (raw.worktree === true && raw.requireRoot === false) {
    reporter.fail(
      `skills/${id}: requireRoot:false суперечить worktree:true (worktree вже вимагає кореня — прибери поле)`
    )
    ok = false
  }
  return ok
}

/**
 * Валідує meta.json одного скіла.
 * @param {string} id ідентифікатор скіла
 * @param {string} skillDir каталог скіла
 * @param {ReturnType<typeof createCheckReporter>} reporter репортер
 * @returns {void}
 */
function checkSkill(id, skillDir, reporter) {
  let skillOk = true

  if (existsSync(join(skillDir, 'auto.md'))) {
    reporter.fail(`skills/${id}: залишковий auto.md — видали (метадані тепер у meta.json)`)
    skillOk = false
  }

  const raw = readSkillMetaRaw(skillDir)
  if (!raw) {
    reporter.fail(`skills/${id}: відсутній або невалідний meta.json (очікується {"auto"?, "worktree": bool})`)
    return
  }

  if (!checkSkillFields(id, raw, reporter)) skillOk = false

  if (skillOk) {
    reporter.pass(`skills/${id}: meta.json валідний`)
  }
}

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
    checkSkill(entry.name, join(skillsDir, entry.name), reporter)
  }

  return Promise.resolve(reporter.getExitCode())
}
