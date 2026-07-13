/**
 * lint-поверхня changelog/presence: дешевий per-file companion до `changelog/consistency`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §7). Без мережі й без
 * git-історії: мапить `ctx.files` на workspace-и й перевіряє, що для кожного зачепленого
 * не-root workspace існує хоча б один change-файл у `.changes/` (`readChangeFiles`).
 * Версійна коректність, registry-дрейф і merge-детекція лишаються в `changelog/consistency`
 * (full, поза delta-планом) — presence лише повертає миттєвий delta-гейт "чи є changeset".
 */
import { getMonorepoProjectRootDirs } from '../lib/package-manifest.mjs'
import { readChangeFiles } from '../../release/lib/change-file.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Префікси шляхів (posix), які не вважаються релізними змінами — та сама інверсія, що в
 * `changelog/consistency` (`CHANGELOG_IGNORE_PATH_PREFIXES`): документація й синхронізований
 * із `@7n/rules` інструментарій (`.cursor/`, `.claude/`).
 */
const CHANGELOG_IGNORE_PATH_PREFIXES = ['docs/', 'doc/', '.cursor/', '.claude/']

const LEADING_DOTSLASH_RE = /^\.\//

/**
 * @param {string} relPath posix-relative шлях файлу.
 * @returns {boolean} true — файл не рахується релізною зміною.
 */
function isChangelogIgnoredPath(relPath) {
  const p = relPath.replaceAll('\\', '/').replace(LEADING_DOTSLASH_RE, '')
  return CHANGELOG_IGNORE_PATH_PREFIXES.some(prefix => p.startsWith(prefix))
}

/**
 * Знаходить workspace (найдовший префікс-збіг) для відносного шляху файлу.
 * @param {string} relFile posix-relative шлях файлу.
 * @param {string[]} workspaces усі workspace-каталоги монорепо (`.` — корінь).
 * @returns {string} найкращий workspace-збіг (`.`, якщо жоден підкаталог не підійшов).
 */
function workspaceForFile(relFile, workspaces) {
  let best = '.'
  let bestLen = -1
  for (const ws of workspaces) {
    if (ws === '.') continue
    const prefix = `${ws}/`
    if (relFile.startsWith(prefix) && prefix.length > bestLen) {
      best = ws
      bestLen = prefix.length
    }
  }
  return best
}

/**
 * Detector changelog/presence (read-only, per-file).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter

  if (ctx.files === undefined || ctx.files.length === 0) return reporter.result()

  const cwd = ctx.cwd
  const workspaces = await getMonorepoProjectRootDirs(cwd)
  const subWorkspaces = workspaces.filter(w => w !== '.')
  const isMonorepoRoot = subWorkspaces.length > 0

  const touchedWorkspaces = new Set()
  for (const f of ctx.files) {
    if (isChangelogIgnoredPath(f)) continue
    const ws = workspaceForFile(f, workspaces)
    if (ws === '.' && isMonorepoRoot) continue // корінь монорепо — glue/tooling, без власного CHANGELOG
    touchedWorkspaces.add(ws)
  }

  for (const ws of touchedWorkspaces) {
    const changes = await readChangeFiles(ws, cwd)
    if (changes.length === 0) {
      const label = ws === '.' ? '<root>' : ws
      fail(
        `${label}: змінені файли без change-файлу в .changes/ — додай \`npx @7n/n ch\` (n-changelog.mdc)`,
        'changeset-missing'
      )
    }
  }

  return reporter.result()
}
