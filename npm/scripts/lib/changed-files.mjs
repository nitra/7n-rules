/**
 * Збір змінених файлів для quick-режиму lint-оркестратора.
 *
 * Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
 * (`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
 * Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.
 */
import { spawnSync } from 'node:child_process'

import { isWorktreeCheckoutPath } from '../utils/walkDir.mjs'

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
 * Кандидати — `origin/main` і локальна `main`: рахуємо merge-base з HEAD для обох
 * і беремо **новіший** (descendant) з двох. Це захищає від stale-ref з будь-якого
 * боку: у git-worktree локальна `main` закріплена за іншим деревом і часто відстає
 * (застаріла база → фантомні «змінені» файли з давно влитих PR), а без свіжого
 * fetch може відставати вже `origin/main`. Якщо доступний лише один ref (офлайн,
 * без remote) — його merge-base; якщо жодного — null, і caller порівнює лише
 * робоче дерево з HEAD. Повернений sha завжди досяжний (це merge-base існуючого
 * ref), тож fail-closed перевірка в `collectChangedFilesSince` не спрацює хибно.
 * Явний `baseRef` (CI: `--base origin/main` після fetch) вимикає вибір —
 * merge-base рахується лише проти нього.
 * @param {string} [cwd] корінь репо
 * @param {string|null} [baseRef] явний ref бази замість вибору origin/main|main
 * @returns {string|null} merge-base commit або null
 */
export function resolveChangedBase(cwd = process.cwd(), baseRef = null) {
  const mergeBaseWith = ref => {
    const result = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8' })
    return result.status === 0 && !result.error ? result.stdout.trim() : ''
  }
  if (baseRef) return mergeBaseWith(baseRef) || null
  const [primary, secondary] = ['origin/main', 'main'].map(ref => mergeBaseWith(ref)).filter(Boolean)
  if (!primary || !secondary || primary === secondary) return primary ?? null
  // Обидва ref-и дали різні merge-base: новіший — той, що є нащадком іншого.
  // Якщо гілки merge-base розійшлися (екзотика), лишаємо пріоритет origin/main.
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', primary, secondary], { cwd })
  return ancestry.status === 0 && !ancestry.error ? secondary : primary
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
