/**
 * Fallback (n-cursor-release-design рішення 3): коли в workspace є релевантні зміни,
 * але жодного change-файлу — синтезуємо один запис із commit-subjects від останнього
 * релізного тегу `<name>@*`. Усі git-виклики через `runGit` (ін'єкція для тестів).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * @param {string} cwd робочий каталог
 * @returns {(args: string[]) => Promise<string | null>} тихий git-раннер (null при помилці)
 */
export function defaultRunGit(cwd) {
  return async args => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd })
      return stdout
    } catch {
      return null
    }
  }
}

/**
 * @param {string} name ім'я пакета (для тегу `<name>@*`)
 * @param {string} ws workspace (pathspec для `git log`; `.` → без обмеження шляху)
 * @param {object} [opts] опції
 * @param {(args: string[]) => Promise<string | null>} [opts.runGit] git-раннер
 * @returns {Promise<{ bump: string, section: string, description: string } | null>} синтезований запис або null
 */
export async function synthesizeChangeFromCommits(name, ws, opts = {}) {
  const runGit = opts.runGit ?? defaultRunGit(process.cwd())
  const lastTagRaw = await runGit(['describe', '--tags', '--abbrev=0', '--match', `${name}@*`, 'HEAD'])
  const lastTag = lastTagRaw?.trim()
  // Bootstrap: якщо жодного попереднього тегу немає — перший реліз зроблено вручну;
  // fallback-синтез не запускаємо, щоб не подвоїти bump.
  if (!lastTag) return null
  const pathspec = ws === '.' ? [] : ['--', `${ws}/`]
  const logRaw = await runGit(['log', '--no-merges', '--format=%s', `${lastTag}..HEAD`, ...pathspec])
  const subjects = (logRaw ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (subjects.length === 0) return null
  return { bump: 'patch', section: 'Changed', description: subjects.join('; ') }
}
