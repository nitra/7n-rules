/** Спільні path-інваріанти для package-owned source discovery. */

import { isAbsolute, relative, sep } from 'node:path'

/**
 * Перетворює platform path на stable POSIX path.
 * @param {string} path filesystem path
 * @returns {string} POSIX path
 */
export function toPosix(path) {
  return path.split(sep).join('/')
}

/**
 * Перевіряє strict containment path-а у root.
 * @param {string} root absolute root
 * @param {string} path absolute candidate
 * @returns {boolean} whether candidate belongs to root
 */
export function isWithin(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Будує ignore patterns для nested documentation domains.
 * @param {{sourceRoot?: string, excludedSourceRoots?: string[]}} domain resolved domain
 * @returns {string[]} domain-relative ignore patterns
 */
export function nestedDomainIgnores(domain) {
  if (!Array.isArray(domain?.excludedSourceRoots) || typeof domain.sourceRoot !== 'string') return []
  return domain.excludedSourceRoots
    .map(excluded => toPosix(relative(domain.sourceRoot === '.' ? '' : domain.sourceRoot, excluded)))
    .filter(path => path !== '' && path !== '.' && !path.startsWith('../'))
    .flatMap(path => [path, `${path}/**`])
    .toSorted()
}
