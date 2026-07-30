/**
 * Збір змінених файлів для quick-режиму lint-оркестратора.
 *
 * Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
 * (`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
 * Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.
 */
import { spawnSync } from 'node:child_process'

import { isWorktreeCheckoutPath } from '../utils/walkDir.mjs'
import { readGitPolicy } from './git-policy.mjs'
import { loadNative } from './native.mjs'

/**
 * @param {string[]} args аргументи git
 * @param {string} cwd корінь
 * @returns {string[]} непорожні рядки stdout або [] при помилці
 */
function gitLines(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0 || r.error) return []
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Relative-posix список змінених + untracked файлів робочого дерева.
 * @param {string} [cwd] корінь репо
 * @returns {string[]} унікальні шляхи (без видалених)
 */
export function collectChangedFiles(cwd = process.cwd()) {
  const modified = gitLines(['diff', 'HEAD', '--name-only', '--diff-filter=ACMR'], cwd)
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], cwd)
  return dropWorktreeCheckouts([...new Set([...modified, ...untracked])])
}

/**
 * Прибирає шляхи всередині worktree-чекаутів (`.worktrees/`, `.claude/worktrees/`):
 * це повні копії репо (сесійні worktree Claude/агентів), а не робочий код, і в
 * споживацьких репо вони можуть бути не gitignored — git тоді віддає їх як untracked.
 * @param {string[]} paths relative-posix шляхи
 * @returns {string[]} шляхи без worktree-чекаутів
 */
function dropWorktreeCheckouts(paths) {
  return paths.filter(p => !isWorktreeCheckoutPath(p))
}

/**
 * Визначає git base для scoped-перевірок без зовнішнього runtime-стану.
 * Кандидати — effective Git policy: `baseBranch` + `releaseBranches`, кожна у
 * `origin/` та локальній формах; розгортання policy лишається тут (Р5 спеки
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`). Саме обчислення
 * «найновішого» сумісного merge-base — у native (`rules-core::changed_base`
 * через `rules-napi`, T4 фази 1): захист від stale-ref і вже інтегрованих
 * змін між довгоживучими середовищами перенесено туди без зміни контракту.
 * Якщо жодного ref немає — null, і caller порівнює лише робоче дерево з HEAD.
 * Повернений sha завжди досяжний (це merge-base існуючого ref), тож
 * fail-closed перевірка в `collectChangedFilesSince` не спрацює хибно. Явний
 * `baseRef` (CI: `--base origin/dev` після fetch) вимикає вибір — merge-base
 * рахується лише проти нього.
 * @param {string} [cwd] корінь репо
 * @param {string|null} [baseRef] явний ref бази замість Git policy
 * @returns {string|null} merge-base commit або null
 */
export function resolveChangedBase(cwd = process.cwd(), baseRef = null) {
  const { integrationBranches } = readGitPolicy(cwd)
  const candidates = integrationBranches.flatMap(name => [`origin/${name}`, name])
  return loadNative().resolveChangedBase(cwd, candidates, baseRef ?? null) ?? null
}

/**
 * Список змінених + untracked файлів **відносно базового комміту**.
 *
 * `git diff <base>` (без `..`/`...`, без `HEAD`) порівнює base-комміт із поточним
 * **робочим деревом** — тобто однаково ловить і закомічене від base, і staged, і
 * незакомічені модифікації. Це гарантує однакову поведінку незалежно від того, чи
 * зміни вже закомічені у worktree. Без `base` — fallback на `collectChangedFiles`
 * (робоче дерево vs HEAD).
 * @param {string|null} [base] базовий комміт
 * @param {string} [cwd] корінь репо
 * @returns {string[]} унікальні шляхи (без видалених)
 */
export function collectChangedFilesSince(base, cwd = process.cwd()) {
  if (!base) return collectChangedFiles(cwd)
  // Fail-closed: недосяжний base (rebase/force-update/shallow prune) інакше дав би `git diff`
  // exit 128 → порожній список → gate мовчки пройшов би без перевірки. Краще явна помилка.
  // `^{commit}` — git peel-синтаксис (літерал), не template-інтерполяція; окрема строкова
  // константа тримає обидва правила тихими (no-useless-concat і no-incorrect-template-string-interpolation).
  const commitPeel = '^{commit}'
  const verify = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}${commitPeel}`], {
    cwd,
    encoding: 'utf8'
  })
  if (verify.status !== 0 || verify.error) {
    throw new Error(
      `collectChangedFilesSince: base-комміт «${base}» недосяжний у ${cwd} ` +
        '(rebase/force-update?) — coverage --changed не може визначити scope'
    )
  }
  const changed = gitLines(['diff', base, '--name-only', '--diff-filter=ACMR'], cwd)
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], cwd)
  return dropWorktreeCheckouts([...new Set([...changed, ...untracked])])
}
