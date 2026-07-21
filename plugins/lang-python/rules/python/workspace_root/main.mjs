/**
 * @see ./workspace_root.mdc
 *
 * Read-only detector, T0 (без spawn `uv`): репозиторій повинен мати рівно один
 * кореневий uv workspace — дзеркалить `rust/workspace_root` (яке саме дзеркалить JS-канон
 * "root package.json + workspaces + один lockfile") на бік Python/uv. Авто-фікс ризикований
 * (перенесення файлів/lockfile) — лише репорт (fixability: structural).
 */
import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { readPyprojectManifest, resolveUvWorkspaceMemberDirs } from '@7n/rules/scripts/utils/uv-workspace.mjs'

/** Каталоги, які обхід НЕ заходить: build-артефакти, vcs, залежності, protected worktrees. */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'target',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '.claude',
  'vendor',
  '__pycache__'
])

/** Стабільні reasons для чотирьох типів порушення. */
export const NESTED_WORKSPACE = 'nested-workspace'
export const NESTED_LOCKFILE = 'nested-lockfile'
export const MISSING_ROOT_WORKSPACE = 'missing-root-workspace'
export const PACKAGE_NOT_WORKSPACE_MEMBER = 'package-not-workspace-member'

const REMEDIATION =
  'створи/підтверди кореневий [tool.uv.workspace] (members) у кореневому pyproject.toml, ' +
  'запусти `uv lock` з кореня для єдиного кореневого uv.lock, видали вкладені uv.lock ' +
  'у не-виключених members — у репозиторії має лишитись один кореневий workspace і один uv.lock ' +
  '(python/workspace_root.mdc)'

/**
 * Рекурсивно шукає всі `pyproject.toml` і `uv.lock` у дереві `root`, пропускаючи
 * `IGNORED_DIR_NAMES`.
 * @param {string} root абсолютний корінь обходу
 * @returns {{pyprojectPaths: string[], lockPaths: string[]}} абсолютні шляхи знайдених файлів
 */
function findWorkspaceFiles(root) {
  const pyprojectPaths = []
  const lockPaths = []
  /** @param {string} dir поточний каталог обходу */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'pyproject.toml') {
        pyprojectPaths.push(join(dir, entry.name))
      } else if (entry.isFile() && entry.name === 'uv.lock') {
        lockPaths.push(join(dir, entry.name))
      } else if (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name)) {
        walk(join(dir, entry.name))
      }
    }
  }
  walk(root)
  return { pyprojectPaths, lockPaths }
}

/**
 * Звітує про вкладений `[tool.uv.workspace]` у не-кореневих маніфестах.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {string} cwd корінь репозиторію
 * @param {string} rootManifestPath абсолютний шлях кореневого pyproject.toml
 * @param {string[]} allManifestPaths усі знайдені шляхи pyproject.toml
 * @param {Map<string, Record<string, unknown>|null>} parsedByPath кеш розпарсених маніфестів
 */
function reportNestedWorkspaces(reporter, cwd, rootManifestPath, allManifestPaths, parsedByPath) {
  for (const p of allManifestPaths) {
    if (p === rootManifestPath) continue
    const parsed = parsedByPath.get(p)
    if (!parsed?.tool?.uv?.workspace) continue
    const rel = relative(cwd, p)
    reporter.fail(`${rel}: вкладений [tool.uv.workspace] поза кореневим pyproject.toml — ${REMEDIATION}`, {
      reason: NESTED_WORKSPACE,
      file: rel
    })
  }
}

/**
 * Звітує про package-маніфести, не покриті `members` кореневого workspace.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {string} cwd корінь репозиторію
 * @param {Record<string, unknown>} rootParsed розпарсений кореневий маніфест (з `[tool.uv.workspace]`)
 * @param {string[]} otherPackageManifestPaths абсолютні шляхи не-кореневих package-маніфестів
 * @returns {Promise<Set<string>>} абсолютні шляхи виключених (`exclude`) каталогів
 */
async function reportUncoveredMembers(reporter, cwd, rootParsed, otherPackageManifestPaths) {
  const workspace = /** @type {{members?: string[], exclude?: string[]}} */ (rootParsed.tool.uv.workspace)
  const members = Array.isArray(workspace.members) ? workspace.members : []
  const excludes = Array.isArray(workspace.exclude) ? workspace.exclude : []
  const resolvedMembers = await resolveUvWorkspaceMemberDirs(cwd, members)
  const resolvedExcludes = await resolveUvWorkspaceMemberDirs(cwd, excludes)
  const memberDirs = new Set(resolvedMembers.map(d => resolve(d)))
  const excludeDirs = new Set(resolvedExcludes.map(d => resolve(d)))

  for (const p of otherPackageManifestPaths) {
    const dir = resolve(dirname(p))
    if (excludeDirs.has(dir) || memberDirs.has(dir)) continue
    const rel = relative(cwd, p)
    reporter.fail(
      `${rel}: package не покритий members кореневого workspace — додай шлях у [tool.uv.workspace].members ` +
        `кореневого pyproject.toml (або відобрази у workspace.exclude — навмисний опт-аут з конфліктними ` +
        `залежностями). ${REMEDIATION}`,
      { reason: PACKAGE_NOT_WORKSPACE_MEMBER, file: rel }
    )
  }
  return excludeDirs
}

/**
 * Звітує про `uv.lock` поза кореневим workspace — окрім member-ів, виключених через
 * `workspace.exclude` (escape hatch: навмисно конфліктні залежності, uv-специфічно,
 * такого немає в rust/workspace_root бо Cargo резолвить кілька версій однієї крейти).
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {string} cwd корінь репозиторію
 * @param {string} rootLockPath абсолютний шлях кореневого uv.lock
 * @param {string[]} lockPaths усі знайдені шляхи uv.lock
 * @param {Set<string>} excludeDirs абсолютні шляхи виключених (`workspace.exclude`) каталогів
 */
function reportNestedLocks(reporter, cwd, rootLockPath, lockPaths, excludeDirs) {
  for (const p of lockPaths) {
    if (p === rootLockPath) continue
    const dir = resolve(dirname(p))
    if (excludeDirs.has(dir)) continue
    const rel = relative(cwd, p)
    reporter.fail(
      `${rel}: вкладений uv.lock поза кореневим workspace — lock лише кореневий (або каталог має бути ` +
        `у workspace.exclude, якщо це навмисний опт-аут). ${REMEDIATION}`,
      { reason: NESTED_LOCKFILE, file: rel }
    )
  }
}

/**
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  const { pyprojectPaths: allManifestPaths, lockPaths } = findWorkspaceFiles(cwd)
  const parsedByPath = new Map()
  for (const p of allManifestPaths) {
    parsedByPath.set(p, await readPyprojectManifest(p))
  }

  const packageManifestPaths = allManifestPaths.filter(p => parsedByPath.get(p)?.project)
  if (packageManifestPaths.length === 0) {
    // жодного Python-пакета (з [project]) у дереві — концерн не застосовний
    return reporter.result()
  }

  const rootManifestPath = join(cwd, 'pyproject.toml')
  reportNestedWorkspaces(reporter, cwd, rootManifestPath, allManifestPaths, parsedByPath)

  const rootParsed = parsedByPath.get(rootManifestPath) ?? null
  if (!rootParsed) {
    reporter.fail(
      `pyproject.toml відсутній у корені репозиторію, але знайдено ${packageManifestPaths.length} package-маніфест(и). ${REMEDIATION}`,
      { reason: MISSING_ROOT_WORKSPACE }
    )
    return reporter.result()
  }

  const otherPackageManifestPaths = packageManifestPaths.filter(p => p !== rootManifestPath)

  if (!rootParsed.tool?.uv?.workspace) {
    if (rootParsed.project && otherPackageManifestPaths.length === 0) {
      // Єдиний кореневий package — uv неявно робить його власним workspace root.
      reporter.pass('єдиний кореневий package — uv неявно є власним workspace root')
      return reporter.result()
    }
    reporter.fail(
      `Кореневий pyproject.toml не є workspace root (немає [tool.uv.workspace]), а в репозиторії ` +
        `${packageManifestPaths.length} package-маніфест(и). ${REMEDIATION}`,
      { reason: MISSING_ROOT_WORKSPACE }
    )
    return reporter.result()
  }

  const excludeDirs = await reportUncoveredMembers(reporter, cwd, rootParsed, otherPackageManifestPaths)
  reportNestedLocks(reporter, cwd, join(cwd, 'uv.lock'), lockPaths, excludeDirs)
  return reporter.result()
}
