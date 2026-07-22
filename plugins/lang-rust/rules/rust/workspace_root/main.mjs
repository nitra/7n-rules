/**
 * @see ./workspace_root.mdc
 *
 * Read-only detector, T0 (без spawn `cargo`): репозиторій повинен мати рівно один
 * кореневий Cargo workspace — дзеркалить JS-канон "root package.json + workspaces +
 * один lockfile" (npm/rules/dev-dep, npm/rules/n-npm-module) на бік Rust. Авто-фікс
 * ризикований (перенесення файлів/lockfile) — лише репорт (fixability: structural).
 */
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveWorkspaceMemberDirs } from '@7n/rules/scripts/utils/cargo-workspace.mjs'

import { RUST_WALK_IGNORED_DIR_NAMES as IGNORED_DIR_NAMES } from '../lib/ignored-dirs.mjs'

/** Стабільний reason: вкладений `[workspace]` поза кореневим Cargo.toml. */
export const NESTED_WORKSPACE = 'nested-workspace'
/** Стабільний reason: `[profile.*]` у не-кореневому Cargo.toml (Cargo його ігнорує). */
export const NESTED_PROFILE = 'nested-profile'
/** Стабільний reason: кореневий Cargo.toml без `[workspace]` при кількох крейтах. */
export const MISSING_ROOT_WORKSPACE = 'missing-root-workspace'
/** Стабільний reason: крейт не входить у members кореневого workspace. */
export const PACKAGE_NOT_WORKSPACE_MEMBER = 'package-not-workspace-member'

const REMEDIATION =
  'створи/підтверди кореневий [workspace] (resolver = "2", members) у кореневому Cargo.toml, ' +
  'перенеси [profile.*] у корінь, видали вкладені [workspace] і їхні Cargo.lock — ' +
  'у репозиторії має лишитись один кореневий workspace і один Cargo.lock (rust/workspace_root.mdc)'

/**
 * Рекурсивно шукає всі `Cargo.toml` у дереві `root`, пропускаючи `IGNORED_DIR_NAMES`.
 * @param {string} root абсолютний корінь обходу
 * @returns {string[]} абсолютні шляхи знайдених `Cargo.toml`
 */
function findAllCargoManifests(root) {
  const result = []
  /** @param {string} dir поточний каталог обходу */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'Cargo.toml') {
        result.push(join(dir, entry.name))
      } else if (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name)) {
        walk(join(dir, entry.name))
      }
    }
  }
  walk(root)
  return result
}

/**
 * Вміст Cargo.toml або null, якщо файл відсутній/невалідний TOML.
 * @param {string} absPath абсолютний шлях
 * @returns {Promise<Record<string, unknown>|null>} розпарсений маніфест або null
 */
async function readManifest(absPath) {
  try {
    const raw = await readFile(absPath, 'utf8')
    return parseToml(raw)
  } catch {
    return null
  }
}

/**
 * Звітує про вкладені `[workspace]`/`[profile.*]` у не-кореневих маніфестах.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {string} cwd корінь репозиторію
 * @param {string} rootManifestPath абсолютний шлях кореневого Cargo.toml
 * @param {string[]} allManifestPaths усі знайдені шляхи Cargo.toml
 * @param {Map<string, Record<string, unknown>|null>} parsedByPath кеш розпарсених маніфестів
 */
function reportNestedTables(reporter, cwd, rootManifestPath, allManifestPaths, parsedByPath) {
  for (const p of allManifestPaths) {
    if (p === rootManifestPath) continue
    const parsed = parsedByPath.get(p)
    if (!parsed) continue
    const rel = relative(cwd, p)
    if (parsed.workspace) {
      reporter.fail(`${rel}: вкладений [workspace] поза кореневим Cargo.toml — ${REMEDIATION}`, {
        reason: NESTED_WORKSPACE,
        file: rel
      })
    }
    if (parsed.profile) {
      reporter.fail(
        `${rel}: [profile.*] поза кореневим Cargo.toml — Cargo мовчки ігнорує чи видає попередження на profile-секції ` +
          `у не-кореневих маніфестах. ${REMEDIATION}`,
        { reason: NESTED_PROFILE, file: rel }
      )
    }
  }
}

/**
 * Звітує про package-маніфести, не покриті `members` кореневого workspace.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {string} cwd корінь репозиторію
 * @param {Record<string, unknown>} rootParsed розпарсений кореневий маніфест (з `[workspace]`)
 * @param {string[]} otherPackageManifestPaths абсолютні шляхи не-кореневих package-маніфестів
 */
async function reportUncoveredMembers(reporter, cwd, rootParsed, otherPackageManifestPaths) {
  const workspace = /** @type {{members?: string[], exclude?: string[]}} */ (rootParsed.workspace)
  const members = Array.isArray(workspace.members) ? workspace.members : []
  const excludes = Array.isArray(workspace.exclude) ? workspace.exclude : []
  const resolvedMembers = await resolveWorkspaceMemberDirs(cwd, members)
  const resolvedExcludes = await resolveWorkspaceMemberDirs(cwd, excludes)
  const memberDirs = new Set(resolvedMembers.map(d => resolve(d)))
  const excludeDirs = new Set(resolvedExcludes.map(d => resolve(d)))

  for (const p of otherPackageManifestPaths) {
    const dir = resolve(dirname(p))
    if (excludeDirs.has(dir) || memberDirs.has(dir)) continue
    const rel = relative(cwd, p)
    reporter.fail(
      `${rel}: package не покритий members кореневого workspace — додай шлях у [workspace].members ` +
        `кореневого Cargo.toml (або відобрази у workspace.exclude). ${REMEDIATION}`,
      { reason: PACKAGE_NOT_WORKSPACE_MEMBER, file: rel }
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

  const allManifestPaths = findAllCargoManifests(cwd)
  const parsedByPath = new Map()
  for (const p of allManifestPaths) {
    const parsed = await readManifest(p)
    parsedByPath.set(p, parsed)
  }

  const packageManifestPaths = allManifestPaths.filter(p => parsedByPath.get(p)?.package)
  if (packageManifestPaths.length === 0) {
    // жодного Rust-пакета у дереві — концерн не застосовний
    return reporter.result()
  }

  const rootManifestPath = join(cwd, 'Cargo.toml')
  reportNestedTables(reporter, cwd, rootManifestPath, allManifestPaths, parsedByPath)

  const rootParsed = parsedByPath.get(rootManifestPath) ?? null
  if (!rootParsed) {
    reporter.fail(
      `Cargo.toml відсутній у корені репозиторію, але знайдено ${packageManifestPaths.length} package-маніфест(и). ${REMEDIATION}`,
      { reason: MISSING_ROOT_WORKSPACE }
    )
    return reporter.result()
  }

  const otherPackageManifestPaths = packageManifestPaths.filter(p => p !== rootManifestPath)

  if (!rootParsed.workspace) {
    if (rootParsed.package && otherPackageManifestPaths.length === 0) {
      // Єдиний кореневий package — Cargo неявно робить його власним workspace root.
      reporter.pass('єдиний кореневий package — Cargo неявно є власним workspace root')
      return reporter.result()
    }
    reporter.fail(
      `Кореневий Cargo.toml не є workspace root (немає [workspace]), а в репозиторії ` +
        `${packageManifestPaths.length} package-маніфест(и). ${REMEDIATION}`,
      { reason: MISSING_ROOT_WORKSPACE }
    )
    return reporter.result()
  }

  await reportUncoveredMembers(reporter, cwd, rootParsed, otherPackageManifestPaths)
  return reporter.result()
}
