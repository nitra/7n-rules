/** @see ./docs/orchestrate.md */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  bringChangesBackToOriginal,
  ensureRunningInWorktree,
  removeAutoCreatedWorktree
} from '../../../scripts/lib/auto-worktree.mjs'
import { assertEcosystemProvider } from '../../../scripts/lib/plugin-api.mjs'
import { readNRulesConfigLite } from '../../../scripts/lib/read-n-rules-config-lite.mjs'
import { getHandlers, resolvePlugins } from '../../../scripts/lib/resolve-plugins.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'
import { collectTazeDiff } from './diff.mjs'

export { bringChangesBackToOriginal, removeAutoCreatedWorktree } from '../../../scripts/lib/auto-worktree.mjs'

/** Суфікс бекапу package.json — той самий, що й у `diff.mjs`/кроці 1 SKILL.md. */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику — лише кроки 4-6 SKILL.md (breaking
 * changes → сумісність коду → рефакторинг) для ОДНОГО major-пакета. Кроки
 * 1-3/7/8 виконує оркестратор детерміновано, без LLM.
 * @param {{workspace: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectTazeDiff`)
 * @returns {string} готовий промпт
 */
export function buildDependencyPrompt({ workspace, pkg, from, to }) {
  return [
    '# Major-оновлення одного пакета: перевірка сумісності й рефакторинг',
    '',
    `Пакет \`${pkg}\` у воркспейсі \`${workspace}\`: **${from} → ${to}** — вже застосовано в package.json/bun.lock (кроки 1-3 виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: CHANGELOG/Releases репозиторію модуля (поле \`repository\` у \`node_modules/${pkg}/package.json\`), або git/diff між закешованою старою версією (\`~/.bun/install/cache/${pkg}@<стара-версія>/\`) і новою (\`node_modules/${pkg}/\`).`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n\` по імпортах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати імпорт, оновити сигнатуру виклику, замінити видалену опцію еквівалентом).',
    '4. Якщо були правки — запусти `npx @7n/rules lint`, typecheck/test якщо є в проєкті.',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Диспетчер одного ітеративного виклику на обраний раннер. `pi` — вбудований
 * pi-агент (`@7n/llm-lib/agent-skill`; текст перехоплюється через `deps.out`,
 * бо `runAgentSkill` не повертає його напряму — лише стрімить у stdout).
 * `cursor`/`codex` — napi-міст ACP (`@7n/llm-lib/acp`; текст — прямий return,
 * idle-timeout і видимість прогресу вже вбудовані в сам міст).
 * @param {'pi' | 'cursor' | 'codex'} runner раннер
 * @param {string} prompt промпт для одного пакета
 * @param {string} cwd робочий каталог
 * @param {{ runAgentSkill?: (prompt: string, opts?: object) => Promise<{ok: boolean, error: string|null}>, runAcpAgent?: (kind: string, prompt: string, cwd: string) => Promise<string> }} [deps] інжекти для тестів
 * @returns {Promise<{ ok: boolean, text: string, error: string|null }>} результат виклику
 */
export async function callRunner(runner, prompt, cwd, deps = {}) {
  if (runner === 'pi') {
    let runAgentSkill = deps.runAgentSkill
    if (!runAgentSkill) {
      const agentSkillModule = await import('@7n/llm-lib/agent-skill')
      runAgentSkill = agentSkillModule.runAgentSkill
    }
    let text = ''
    const result = await runAgentSkill(prompt, {
      skillId: 'taze',
      tier: 'avg',
      cwd,
      deps: { out: chunk => (text += chunk) }
    })
    return { ok: result.ok, text, error: result.error }
  }

  let runAcpAgent = deps.runAcpAgent
  if (!runAcpAgent) {
    const acpModule = await import('@7n/llm-lib/acp')
    runAcpAgent = acpModule.runAcpAgent
  }
  try {
    const text = await runAcpAgent(runner, prompt, cwd)
    return { ok: true, text, error: null }
  } catch (error) {
    return { ok: false, text: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Синхронно виконує детерміновану команду (bunx/bun), кидає з
 * exit-кодом+stderr при провалі.
 * @param {string} cmd бінарник
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {typeof spawnSync} spawnFn інжект для тестів
 * @returns {string} stdout
 */
function runCommand(cmd, args, cwd, spawnFn) {
  const result = spawnFn(cmd, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

/**
 * Бекапить package.json кожного воркспейсу (крок 1 SKILL.md) — потрібно для
 * класифікації major/minor через `collectTazeDiff` після bump-у.
 * @param {string} cwd корінь репо
 * @param {{ getMonorepoPackageRootDirs?: (cwd: string) => Promise<string[]>, copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжекти
 * @returns {Promise<string[]>} відносні шляхи воркспейсів, що мали package.json
 */
export async function backupWorkspacePackageFiles(cwd, deps = {}) {
  const getRoots = deps.getMonorepoPackageRootDirs ?? getMonorepoPackageRootDirs
  const copy = deps.copyFile ?? copyFile
  const roots = await getRoots(cwd)
  const backedUp = []
  for (const ws of roots) {
    const pkgPath = join(cwd, ws, 'package.json')
    if (!existsSync(pkgPath)) continue
    await copy(pkgPath, `${pkgPath}${BACKUP_SUFFIX}`)
    backedUp.push(ws)
  }
  return backedUp
}

/**
 * Прибирає бекапи package.json після завершення (крок 7 SKILL.md).
 * @param {string} cwd корінь репо
 * @param {string[]} workspaces воркспейси з бекапом (з `backupWorkspacePackageFiles`)
 * @param {{ rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function cleanupBackups(cwd, workspaces, deps = {}) {
  const remove = deps.rm ?? rm
  for (const ws of workspaces) {
    await remove(join(cwd, ws, `package.json${BACKUP_SUFFIX}`), { force: true })
  }
}

/**
 * Завантажує EcosystemProvider-и з активних плагінів проєкту: `.n-rules.json`
 * (або автодетект за файловими сигналами — `pyproject.toml` → lang-python) →
 * `resolvePlugins` (плагін доставляється автоматично при першому запуску) → handler-модулі
 * extension-point `taze` → default-експорт кожного валідується
 * `assertEcosystemProvider`. Битий плагін (нема модуля/невалідна форма) —
 * warning і пропуск, не провал прогону.
 * @param {string} cwd корінь репо
 * @param {(line: string) => void} log колбек прогресу
 * @param {{ readNRulesConfigLite?: (cwd: string) => Promise<object>, resolvePlugins?: (root: string, config: object, opts?: object) => object[], getHandlers?: (root: string, config: object, point: string) => Array<{pluginName: string, modulePath: string}>, importModule?: (url: string) => Promise<object> }} [deps] інжекти для тестів
 * @returns {Promise<object[]>} валідні провайдери плагінів
 */
export async function loadPluginTazeProviders(cwd, log, deps = {}) {
  const readConfig = deps.readNRulesConfigLite ?? readNRulesConfigLite
  const config = await readConfig(cwd)
  const resolve = deps.resolvePlugins ?? resolvePlugins
  resolve(cwd, config)
  const handlers = (deps.getHandlers ?? getHandlers)(cwd, config, 'taze')
  // eslint-disable-next-line no-unsanitized/method
  const importModule = deps.importModule ?? (url => import(url))

  const providers = []
  for (const handler of handlers) {
    try {
      const mod = await importModule(pathToFileURL(handler.modulePath).href)
      providers.push(assertEcosystemProvider(mod.default, handler.pluginName))
    } catch (error) {
      log(`⚠️ Плагін ${handler.pluginName}: taze-провайдер не завантажився — ${error.message}`)
    }
  }
  return providers
}

/**
 * Проганяє одну екосистему (провайдера) наскрізь: detect → available →
 * backup → bump → diff → ізольований виклик раннера по кожному major-запису →
 * cleanup. Виняток усередині (bump/diff/команда) не зупиняє інших провайдерів —
 * фіксується в `error` запису екосистеми.
 * @param {import('../../../scripts/lib/plugin-api.mjs').EcosystemProvider} provider провайдер екосистеми
 * @param {{ cwd: string, runner: string, log: (line: string) => void, deps: object, spawnFn: typeof spawnSync, call: typeof callRunner }} ctx контекст прогону
 * @returns {Promise<object>} запис екосистеми для звіту
 */
async function runEcosystem(provider, { cwd, runner, log, deps, spawnFn, call }) {
  const base = {
    id: provider.id,
    title: provider.title,
    manifestNoun: provider.manifestNoun,
    skillSection: provider.skillSection
  }
  const eco = { ...base, manifests: [], processed: false, skippedReason: null, error: null, minorPatch: 0, results: [] }
  try {
    eco.manifests = provider.detect(cwd, { spawnFn })
    if (eco.manifests.length === 0) return eco

    const availability = provider.available(spawnFn)
    if (!availability.ok) {
      eco.skippedReason = availability.reason
      log(`⏭ ${provider.title}: ${availability.reason}`)
      return eco
    }

    log(`📦 Бекап (${provider.manifestNoun})...`)
    await provider.backup(cwd, eco.manifests, deps)
    await provider.bump(cwd, eco.manifests, { spawnFn, log, deps })

    const diff = await provider.diff(cwd, eco.manifests, deps)
    log(`🔍 ${provider.title} diff: ${diff.major.length} major, ${diff.minorPatch} minor/patch`)

    for (const entry of diff.major) {
      log(`🔧 [${provider.id}] ${entry.pkg} (${entry.manifest}): ${entry.from} → ${entry.to}...`)
      const outcome = await call(runner, provider.promptFor(entry), cwd, deps)
      eco.results.push({ ...entry, ...outcome })
      log(outcome.ok ? `  ✅ ${entry.pkg}` : `  ❌ ${entry.pkg}: ${outcome.error}`)
    }

    await provider.cleanup(cwd, eco.manifests, deps)
    eco.processed = true
    eco.minorPatch = diff.minorPatch
  } catch (error) {
    eco.error = error instanceof Error ? error.message : String(error)
    log(`❌ ${provider.title}: ${eco.error}`)
  }
  return eco
}

/**
 * Форматує один рядок результату ітерації (спільний для npm-гілки й екосистем).
 * @param {{pkg: string, ok: boolean, error: string|null, from: string, to: string}} r результат ітерації
 * @param {string} scopeLabel мітка джерела (`workspace` для npm, `manifest` для екосистем)
 * @returns {string} один рядок звіту
 */
function formatResultLine(r, scopeLabel) {
  const status = r.ok ? '✅' : '❌'
  const errorSuffix = r.error ? ` — ${r.error}` : ''
  return `  ${status} \`${r.pkg}\` (${scopeLabel}): ${r.from} → ${r.to}${errorSuffix}`
}

/**
 * Додає секцію звіту однієї екосистеми (Rust/Python/…) — мітки бере з самого
 * запису (`title`/`manifestNoun`/`skillSection` — з провайдера).
 * @param {string[]} lines масив рядків звіту (мутується)
 * @param {{title: string, manifestNoun: string, skillSection: string, manifests: string[], processed: boolean, skippedReason: string|null, error: string|null, minorPatch: number, results: Array<{pkg:string, manifest:string, from:string, to:string, ok:boolean, error:string|null}>}} eco запис екосистеми
 * @returns {number} totalChanged цієї екосистеми
 */
function appendEcosystemSection(lines, eco) {
  if (eco.manifests.length === 0 && !eco.error) return 0
  lines.push('', `### ${eco.title}`)
  if (eco.error) {
    lines.push(`- ❌ Провал (${eco.error}) — переглянь дерево вручну, бекапи могли лишитись`)
    return 0
  }
  if (!eco.processed) {
    lines.push(
      `- ⏭ Пропущено (${eco.skippedReason}) — ${eco.manifests.length} ${eco.manifestNoun}, онови вручну за ${eco.skillSection}: ${eco.manifests.join(', ')}`
    )
    return 0
  }
  lines.push(`- **Оновлено (minor/patch):** ${eco.minorPatch}`, `- **Major-оновлення:** ${eco.results.length}`)
  for (const r of eco.results) {
    lines.push(formatResultLine(r, r.manifest))
  }
  return eco.minorPatch + eco.results.length
}

/**
 * Компонує підсумковий звіт (крок 8 SKILL.md) детерміновано з результатів
 * ітерацій — без окремого LLM-виклику для самого звіту.
 * @param {{
 *   minorPatch: number,
 *   totalChanged: number,
 *   results: Array<{pkg:string, workspace:string, from:string, to:string, ok:boolean, error:string|null}>,
 *   ecosystems?: Array<object>,
 *   npmPresent?: boolean
 * }} args дані звіту (`ecosystems` — записи з `runEcosystem`, по одному на провайдера;
 *   `npmPresent: false` — репо без кореневого package.json, npm-рядки не друкуються)
 * @returns {string} markdown-звіт
 */
export function formatReport({ minorPatch, totalChanged, results, ecosystems = [], npmPresent = true }) {
  const lines = ['## taze: підсумок', '']
  if (npmPresent) {
    lines.push(`- **Оновлено (minor/patch):** ${minorPatch}`, `- **Major-оновлення:** ${results.length}`)
    for (const r of results) {
      lines.push(formatResultLine(r, r.workspace))
    }
  }

  let ecosystemsTotal = 0
  for (const eco of ecosystems) {
    ecosystemsTotal += appendEcosystemSection(lines, eco)
  }

  lines.push('', `- **Всього змінено:** ${totalChanged + ecosystemsTotal}`)
  return lines.join('\n')
}

/**
 * Оркеструє taze: детерміновані кроки (бекап → масовий bump → diff →
 * прибирання → звіт) без LLM, і по одному ізольованому, обмеженому по
 * обсягу виклику `callRunner` на кожен major-пакет (кроки 4-6 SKILL.md) —
 * замість одного величезного непрозорого ходу на весь монорепо. npm/bun-гілка
 * вбудована; решта екосистем — EcosystemProvider-и, завантажені з плагінів
 * (`@7n/rules-lang-*`, extension-point `taze`; фаза 2 spec — Rust теж плагін).
 * Падіння одного пакета/однієї екосистеми не втрачає прогрес по інших.
 * @param {{
 *   cwd?: string,
 *   runner?: 'pi' | 'cursor' | 'codex',
 *   log?: (line: string) => void,
 *   deps?: { spawnFn?: typeof spawnSync, collectTazeDiff?: (cwd: string) => Promise<object>, callRunner?: (runner: string, prompt: string, cwd: string, deps: object) => Promise<{ok: boolean, text: string, error: string|null}>, ecosystemProviders?: object[] } & Record<string, unknown>
 * }} [options] опції + інжекти для тестів (`deps.ecosystemProviders` повністю замінює список провайдерів)
 * @returns {Promise<{ ok: boolean, report: string, results: Array<object>, ecosystems: Array<object> }>} результат
 */
export async function runTazeOrchestrator(options = {}) {
  const runner = options.runner ?? 'pi'
  const log = options.log ?? (line => console.log(line))
  const deps = options.deps ?? {}
  const spawnFn = deps.spawnFn ?? spawnSync
  const call = deps.callRunner ?? callRunner

  const originalCwd = options.cwd ?? process.cwd()
  const worktree = ensureRunningInWorktree(originalCwd, spawnFn, log, {
    suffix: 'taze',
    description: 'n-taze: worktree-only skill'
  })
  const cwd = worktree.cwd

  try {
    // npm/bun-гілка активна лише за кореневим package.json — на чисто-Python/Rust
    // репо `bun install` падає з exit 1, і без цього гейта весь прогін гинув би
    // до екосистемних провайдерів. Той самий принцип «тиші», що й для мовних
    // екосистем: немає сигналу — немає ані кроків, ані згадки у звіті.
    const npmPresent = existsSync(join(cwd, 'package.json'))
    let diff = { major: [], minorPatch: 0, totalChanged: 0 }
    const results = []
    if (npmPresent) {
      log('📦 Бекап package.json...')
      const backedUpWorkspaces = await backupWorkspacePackageFiles(cwd, deps)

      log('⬆️  bunx taze -w -r latest...')
      runCommand('bunx', ['taze', '-w', '-r', 'latest'], cwd, spawnFn)
      log('📥 bun install...')
      runCommand('bun', ['install'], cwd, spawnFn)

      const collectDiff = deps.collectTazeDiff ?? collectTazeDiff
      diff = await collectDiff(cwd)
      log(`🔍 diff: ${diff.major.length} major, ${diff.minorPatch} minor/patch`)

      for (const entry of diff.major) {
        log(`🔧 ${entry.pkg} (${entry.workspace}): ${entry.from} → ${entry.to}...`)
        const outcome = await call(runner, buildDependencyPrompt(entry), cwd, deps)
        results.push({ ...entry, ...outcome })
        log(outcome.ok ? `  ✅ ${entry.pkg}` : `  ❌ ${entry.pkg}: ${outcome.error}`)
      }

      await cleanupBackups(cwd, backedUpWorkspaces, deps)
    } else {
      log('⏭ npm/bun: кореневого package.json немає — гілка пропущена')
    }

    const providers = deps.ecosystemProviders ?? (await loadPluginTazeProviders(cwd, log, deps))
    const ecosystems = []
    for (const provider of providers) {
      ecosystems.push(await runEcosystem(provider, { cwd, runner, log, deps, spawnFn, call }))
    }

    const report = formatReport({
      minorPatch: diff.minorPatch,
      totalChanged: diff.totalChanged,
      results,
      ecosystems,
      npmPresent
    })
    log(report)

    const ecosystemsOk = ecosystems.every(eco => eco.error === null && eco.results.every(r => r.ok))
    return { ok: results.every(r => r.ok) && ecosystemsOk, report, results, ecosystems }
  } finally {
    // Лише для АВТОстворених worktree — якщо викликач уже сидів у своєму
    // worktree (worktree.autoCreated === false), це не наш worktree і не
    // нам його чіпати/прибирати. `finally` — щоб зміни поверталися і
    // сирітський worktree прибирався навіть при кинутому винятку всередині
    // try (падіння bunx/diff/провайдера), а не лише при успішному прогоні.
    if (worktree.autoCreated) {
      try {
        await bringChangesBackToOriginal(cwd, originalCwd, spawnFn, log, deps)
      } catch (error) {
        log(`⚠️ Перенесення змін назад провалилось: ${error instanceof Error ? error.message : String(error)}`)
      }
      removeAutoCreatedWorktree(worktree.branchArg, originalCwd, spawnFn, log)
    }
  }
}
