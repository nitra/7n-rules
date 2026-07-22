/**
 * Fingerprint git-робочого дерева (HEAD + diff + untracked-файли) —
 * використовується для дедуплікації повторних lint --full прогонів на
 * незміненому дереві.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * Fingerprint поточного стану git-робочого дерева.
 * @param {typeof import('child_process').spawnSync} [spawn] sync-виклик git (ін'єкція для тестів)
 * @returns {string|null} sha256-hex (64 символи) або null, якщо не в git-репо
 */
export function worktreeFingerprint(spawn = spawnSync) {
  /**
   * @param {string[]} args аргументи підкоманди git
   * @returns {string} stdout git-команди
   */
  function git(args) {
    const r = spawn('git', args, { encoding: 'utf8' })
    if (r.status !== 0 || r.error) throw new Error(`git ${args[0]} failed`)
    return r.stdout
  }

  try {
    const commitHash = git(['rev-parse', 'HEAD']).trim()
    const diffText = git(['diff', 'HEAD'])
    // -z: NUL-розділення без C-екранування. Без нього імена з не-ASCII символами
    // повертаються у `"..."` формі, і `git hash-object` не знаходить файл → throw → fingerprint=null.
    const untrackedRaw = git(['ls-files', '-z', '--others', '--exclude-standard'])
    const untrackedFiles = untrackedRaw.split('\0').filter(Boolean)
    const pairs = untrackedFiles.map(f => `${f}:${git(['hash-object', f]).trim()}`).toSorted()
    const raw = [commitHash, diffText, ...pairs].join('\n')
    return createHash('sha256').update(raw).digest('hex')
  } catch {
    return null
  }
}
