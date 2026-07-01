/**
 * Збір змінених файлів для quick-режиму lint-оркестратора.
 *
 * Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
 * (`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
 * Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.
 */
import { spawnSync } from 'node:child_process'

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
  return [...new Set([...modified, ...untracked])]
}

/**
 * Визначає git base для scoped-перевірок без зовнішнього runtime-стану.
 * Пріоритет: локальна `main`, потім `origin/main`; якщо обидві відсутні,
 * повертає null і caller порівнює лише робоче дерево з HEAD.
 * @param {string} [cwd] корінь репо
 * @returns {string|null} merge-base commit або null
 */
export function resolveChangedBase(cwd = process.cwd()) {
  for (const ref of ['main', 'origin/main']) {
    const result = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8' })
    const base = result.status === 0 && !result.error ? result.stdout.trim() : ''
    if (base) return base
  }
  return null
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
  const verify = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^` + '{commit}'], {
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
  return [...new Set([...changed, ...untracked])]
}
