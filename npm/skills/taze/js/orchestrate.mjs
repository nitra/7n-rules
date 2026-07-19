/** @see ./docs/orchestrate.md */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  bringChangesBackToOriginal,
  ensureRunningInWorktree,
  removeAutoCreatedWorktree
} from '../../../scripts/lib/auto-worktree.mjs'
import { assertEcosystemProvider } from '../../../scripts/lib/plugin-api.mjs'
import { readNRulesConfigLite } from '../../../scripts/lib/read-n-rules-config-lite.mjs'
import { getHandlers, resolvePlugins } from '../../../scripts/lib/resolve-plugins.mjs'
import { readMigrationCache, withKnownMigrationNotes, writeMigrationCache } from './migration-cache.mjs'

export { bringChangesBackToOriginal, removeAutoCreatedWorktree } from '../../../scripts/lib/auto-worktree.mjs'

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

    const readCache = deps.readMigrationCache ?? readMigrationCache
    const writeCache = deps.writeMigrationCache ?? writeMigrationCache
    for (const entry of diff.major) {
      log(`🔧 [${provider.id}] ${entry.pkg} (${entry.manifest}): ${entry.from} → ${entry.to}...`)
      let prompt = provider.promptFor(entry)
      const cached = await readCache(entry.pkg, entry.from, entry.to, deps)
      if (cached) {
        log(`  ♻️ Кешована міграція з "${cached.sourceRepo}" — пропускаю повторне CHANGELOG-дослідження`)
        prompt = withKnownMigrationNotes(prompt, cached)
      }
      const outcome = await call(runner, prompt, cwd, deps)
      eco.results.push({ ...entry, ...outcome })
      log(outcome.ok ? `  ✅ ${entry.pkg}` : `  ❌ ${entry.pkg}: ${outcome.error}`)
      if (outcome.ok && outcome.text) {
        await writeCache(entry.pkg, entry.from, entry.to, { notes: outcome.text, sourceRepo: cwd, updatedAt: new Date().toISOString() }, deps)
      }
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
 * ітерацій — без окремого LLM-виклику для самого звіту. Усі екосистеми
 * (включно з npm/bun — плагін `@7n/rules-lang-js`, фаза 5a) — рівноправні
 * секції; екосистема без manifests — тиша.
 * @param {{ ecosystems?: Array<object> }} args записи з `runEcosystem`, по одному на провайдера
 * @returns {string} markdown-звіт
 */
export function formatReport({ ecosystems = [] }) {
  const lines = ['## taze: підсумок']

  let total = 0
  for (const eco of ecosystems) {
    total += appendEcosystemSection(lines, eco)
  }

  lines.push('', `- **Всього змінено:** ${total}`)
  return lines.join('\n')
}

/**
 * Оркеструє taze: чистий цикл по EcosystemProvider-ах (кроки 1-3/7/8 —
 * детерміновано в провайдері, кроки 4-6 — по одному ізольованому виклику
 * `callRunner` на кожен major-запис) замість одного величезного непрозорого
 * ходу на весь монорепо. Ядро — двигун без мовної специфіки (фаза 5a spec):
 * ВСІ екосистеми, включно з npm/bun (`@7n/rules-lang-js`), приходять з
 * плагінів (extension-point `taze`). Падіння одного пакета/однієї екосистеми
 * не втрачає прогрес по інших.
 * @param {{
 *   cwd?: string,
 *   runner?: 'pi' | 'cursor' | 'codex',
 *   log?: (line: string) => void,
 *   deps?: { spawnFn?: typeof spawnSync, callRunner?: (runner: string, prompt: string, cwd: string, deps: object) => Promise<{ok: boolean, text: string, error: string|null}>, ecosystemProviders?: object[] } & Record<string, unknown>
 * }} [options] опції + інжекти для тестів (`deps.ecosystemProviders` повністю замінює список провайдерів)
 * @returns {Promise<{ ok: boolean, report: string, ecosystems: Array<object> }>} результат
 */
export async function runTazeOrchestrator(options = {}) {
  const runner = options.runner ?? 'pi'
  const log = options.log ?? (line => console.log(line))
  const deps = options.deps ?? {}
  const spawnFn = deps.spawnFn ?? spawnSync
  const call = deps.callRunner ?? callRunner

  const originalCwd = options.cwd ?? process.cwd()
  const worktree = await ensureRunningInWorktree(originalCwd, spawnFn, log, {
    suffix: 'taze',
    description: 'n-taze: worktree-only skill'
  })
  const cwd = worktree.cwd

  let cleanedUp = false
  /**
   * Переносить зміни назад і прибирає автостворений worktree — не більше
   * одного разу (idempotent), щоб і сигнальний обробник, і `finally` могли
   * безпечно кликати те саме без подвійного `bringChangesBackToOriginal`/
   * `removeAutoCreatedWorktree`.
   * @returns {Promise<void>}
   */
  const cleanupAutoCreatedWorktree = async () => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      await bringChangesBackToOriginal(cwd, originalCwd, spawnFn, log, deps)
    } catch (error) {
      log(`⚠️ Перенесення змін назад провалилось: ${error instanceof Error ? error.message : String(error)}`)
    }
    removeAutoCreatedWorktree(worktree.branchArg, originalCwd, spawnFn, log)
  }

  // SIGINT/SIGTERM (Ctrl-C, таймаут зовнішнього раннера, `kill`) без обробника
  // залишають автостворений worktree осиротілим — Node завершується одразу,
  // `finally` нижче не встигає спрацювати. Ловимо сигнал, рятуємо прогрес
  // (перенесення змін + видалення worktree) і лише тоді виходимо.
  const exitProcess = deps.exitProcessFn ?? (code => (process.exitCode = code))
  const onSignal = async signal => {
    log(`⚠️ Отримано ${signal} — переношу прогрес автоствореного worktree назад перед виходом...`)
    await cleanupAutoCreatedWorktree()
    exitProcess(1)
  }
  if (worktree.autoCreated) {
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  }

  try {
    const providers = deps.ecosystemProviders ?? (await loadPluginTazeProviders(cwd, log, deps))
    if (providers.length === 0) {
      log(
        '⏭ Жодного taze-провайдера: жоден активний плагін не надає extension-point `taze` (для npm/bun-гілки потрібен @7n/rules-lang-js)'
      )
    }
    const ecosystems = []
    for (const provider of providers) {
      ecosystems.push(await runEcosystem(provider, { cwd, runner, log, deps, spawnFn, call }))
    }

    const report = formatReport({ ecosystems })
    log(report)

    const ecosystemsOk = ecosystems.every(eco => eco.error === null && eco.results.every(r => r.ok))
    return { ok: ecosystemsOk, report, ecosystems }
  } finally {
    // Лише для АВТОстворених worktree — якщо викликач уже сидів у своєму
    // worktree (worktree.autoCreated === false), це не наш worktree і не
    // нам його чіпати/прибирати. `finally` — щоб зміни поверталися і
    // сирітський worktree прибирався навіть при кинутому винятку всередині
    // try (падіння bunx/diff/провайдера), а не лише при успішному прогоні.
    if (worktree.autoCreated) {
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      await cleanupAutoCreatedWorktree()
    }
  }
}
