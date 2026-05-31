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
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
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
