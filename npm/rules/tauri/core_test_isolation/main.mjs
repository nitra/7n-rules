/**
 * @see ./docs/main.md
 *
 * Read-only detector: у Tauri-проєктах, що говорять з LLM, agent/provider-логіка
 * має жити у workspace-крейті окремо від `src-tauri` — без залежності на `tauri`,
 * щоб `cargo test -p <crate>` ганявся без повної збірки застосунку. Автофікс
 * ризикований (виділення крейту, перенесення коду) — лише репорт (core_test_isolation.mdc).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { scanGlob } from '../../../scripts/utils/glob-compat.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { findAncestorWorkspaceRoot, resolveWorkspaceMemberDirs } from '../../../scripts/utils/cargo-workspace.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Стабільний reason: LLM-залежність оголошена в app shell замість core-крейта. */
export const LLM_DEP_IN_APP_SHELL = 'llm-dep-in-app-shell'
/** Стабільний reason: core-крейт залежить від Tauri — ламає ізоляцію unit-тестів від runtime. */
export const CORE_CRATE_DEPENDS_ON_TAURI = 'core-crate-depends-on-tauri'
/** Стабільний reason: у тестах core-крейта немає fake-провайдера LLM для роботи без мережі. */
export const MISSING_FAKE_LLM_PROVIDER = 'missing-fake-llm-provider'

/** Евристичний allowlist назв LLM SDK-крейтів (без версій/scope). */
const LLM_DEP_RE =
  /^(async-openai|openai(-api)?|anthropic|claude|genai|llm(-chain)?|ollama-rs|rig-core|langchain|mistralai)/i
const TAURI_DEP_RE = /^tauri(-|$)/i
const FAKE_PROVIDER_RE = /\b(Fake|Mock|Stub)\w*(Llm|Provider|Client)\b/

/**
 * Витягує назви залежностей з розпарсеного Cargo.toml (лише `[dependencies]`).
 * @param {Record<string, unknown>} parsed розпарсений Cargo.toml
 * @returns {string[]} назви крейтів-залежностей
 */
function dependencyNames(parsed) {
  const deps = parsed?.dependencies
  if (!deps || typeof deps !== 'object') return []
  return Object.keys(deps)
}

/**
 * Знаходить усі `src-tauri/` каталоги з власним `Cargo.toml` у монорепо.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до `src-tauri/`
 */
async function findSrcTauriDirs(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const result = []
  for (const root of roots) {
    const srcTauriCargo = join(cwd, root, 'src-tauri', 'Cargo.toml')
    if (existsSync(srcTauriCargo)) {
      result.push(join(cwd, root, 'src-tauri'))
    }
  }
  return result
}

/**
 * Рекурсивно шукає в дереві крейту рядок, що відповідає `FAKE_PROVIDER_RE`
 * (fake/mock/stub-реалізацію LLM-провайдера, зазвичай у `tests/` чи `src/`).
 * @param {string} crateDir абсолютний шлях до крейту
 * @returns {Promise<boolean>} true, якщо знайдено відповідний маркер
 */
async function hasFakeLlmProviderMarker(crateDir) {
  for await (const relPath of scanGlob('**/*.rs', crateDir)) {
    if (relPath.includes('target/')) continue
    const content = await readFile(join(crateDir, relPath), 'utf8')
    if (FAKE_PROVIDER_RE.test(content)) return true
  }
  return false
}

/**
 * Перевіряє один `src-tauri/` каталог: чи LLM-залежність лежить у app-shell крейті,
 * чи окремий crate з LLM-залежністю сам не тягне `tauri`, чи є fake-провайдер у тестах.
 * @param {string} srcTauriDir абсолютний шлях до `src-tauri/`
 * @param {string} cwd корінь проєкту (для relative-шляхів у репортах)
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @returns {Promise<void>}
 */
async function checkOneSrcTauri(srcTauriDir, cwd, reporter) {
  const cargoPath = join(srcTauriDir, 'Cargo.toml')
  const parsed = parseToml(await readFile(cargoPath, 'utf8'))
  const relCargo = relative(cwd, cargoPath)

  const shellDeps = dependencyNames(parsed)
  if (shellDeps.some(d => LLM_DEP_RE.test(d))) {
    reporter.fail(
      `${relCargo}: LLM-провайдер залежність лежить у app-shell крейті src-tauri — кожна ітерація ` +
        `prompt/tool перезбирає весь Tauri-застосунок. Винеси agent-логіку у окремий workspace crate ` +
        `(без залежності на tauri) і тестуй \`cargo test -p <crate>\` (core_test_isolation.mdc)`,
      { reason: LLM_DEP_IN_APP_SHELL, file: relCargo }
    )
    return
  }

  // `[workspace]` живе або у самому src-tauri/Cargo.toml (старий/standalone патерн), або —
  // канонічно (rust/workspace_root.mdc) — у предку-workspace root над src-tauri/.
  let workspaceRootDir = srcTauriDir
  let members = Array.isArray(parsed?.workspace?.members) ? parsed.workspace.members : []
  if (members.length === 0) {
    const ancestor = await findAncestorWorkspaceRoot(srcTauriDir, cwd)
    const ancestorMembers = ancestor?.parsed?.workspace?.members
    if (!ancestor || !Array.isArray(ancestorMembers) || ancestorMembers.length === 0) return
    workspaceRootDir = ancestor.rootDir
    members = ancestorMembers
  }

  const memberDirs = await resolveWorkspaceMemberDirs(workspaceRootDir, members)
  const otherMemberDirs = memberDirs.filter(d => resolve(d) !== resolve(srcTauriDir))

  for (const memberDir of otherMemberDirs) {
    const memberCargoPath = join(memberDir, 'Cargo.toml')
    const memberParsed = parseToml(await readFile(memberCargoPath, 'utf8'))
    const memberDeps = dependencyNames(memberParsed)
    if (memberDeps.every(d => !LLM_DEP_RE.test(d))) continue

    const relMemberCargo = relative(cwd, memberCargoPath)
    if (memberDeps.some(d => TAURI_DEP_RE.test(d))) {
      reporter.fail(
        `${relMemberCargo}: agent/LLM crate залежить від tauri — \`cargo test -p\` цього крейту все ` +
          `одно потягне збірку Tauri runtime. Прибери залежність на tauri з цього крейту (core_test_isolation.mdc)`,
        { reason: CORE_CRATE_DEPENDS_ON_TAURI, file: relMemberCargo }
      )
      continue
    }

    if (!(await hasFakeLlmProviderMarker(memberDir))) {
      reporter.fail(
        `${relMemberCargo}: немає fake/mock LLM-провайдера для інтеграційних тестів — прогін ` +
          `\`cargo test -p ${dirname(relMemberCargo).split('/').pop()}\` буде або мовчки пропускати ` +
          `LLM-логіку, або бити по реальному провайдеру. Додай Fake/Mock-реалізацію провайдера в tests/ (core_test_isolation.mdc)`,
        { reason: MISSING_FAKE_LLM_PROVIDER, file: relMemberCargo }
      )
    }
  }
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const srcTauriDirs = await findSrcTauriDirs(cwd)
  for (const dir of srcTauriDirs) {
    await checkOneSrcTauri(dir, cwd, reporter)
  }
  return reporter.result()
}
