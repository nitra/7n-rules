/**
 * Detect-only оркестратор unified lint surface (`n-rules lint --no-fix`).
 *
 * Discovery → scope-selection → `lint(ctx)` per concern → нормалізовані violations.
 * Без мутацій, без LLM. Fix-pipeline (T0 + ladder) обгортає цей модуль і споживає
 * його violations; сам detect ніколи не пише в дерево.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('../concern-meta.mjs').ConcernMeta} ConcernMeta
 * @typedef {{ ruleId: string, concern: ConcernMeta }} LintEntry
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { listConcerns } from '../concern-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { loadNative } from '../native.mjs'
import { getActiveCapabilities, getSlotContributions, resolveRulesDirs, resolveSlotGraph } from '../plugin-slots.mjs'
import { readNRulesConfigLite, isRuleEnabled } from '../read-n-rules-config-lite.mjs'
import { evaluateAppliesNode, readRuleApplies } from '../rule-applies.mjs'
import { isSerialLane } from './blocking-inventory.mjs'
import { runConcernDetector, DetectorError, isBuiltinNativeConcern, normalizeResult } from './detect.mjs'
import { createProgressReporter } from './progress.mjs'
import { runPlanConcurrently } from './scheduler.mjs'

/**
 * Рендерить diagnostics (тех. інфа) — лише у verbose. Не має native-порту
 * (`render.mjs` видалено — R1 фази 7 портував лише `renderViolations`, doc-комент
 * `crates/rules-core/src/lint_render.rs` явно обмежує scope violations, не diagnostics),
 * тому лишається інлайновою JS-реалізацією тут, у єдиного споживача.
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 * @param {LintDiagnostic[]} diagnostics перелік diagnostics для рендеру.
 * @returns {string} текст diagnostics (порожній рядок, якщо їх немає).
 */
function renderDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return ''
  return diagnostics.map(d => `  ${d.level === 'warn' ? '⚠' : 'ℹ'} ${d.message}`).join('\n') + '\n'
}

/** Цей файл: npm/scripts/lib/lint-surface/run-detectors.mjs → PACKAGE_ROOT = npm (4 dirname угору). */
export const DEFAULT_RULES_DIR = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'rules')

/**
 * Похідна lint-поверхня для policy-concern-а (коли немає явного `lint` блоку).
 * scope=full; glob із policy.files — щоб delta-режим тригерив concern на зміні таргета.
 * @param {import('../concern-meta.mjs').PolicySurface} policy policy-поверхня concern-а.
 * @returns {import('../concern-meta.mjs').LintSurface} похідна lint-поверхня (scope=full).
 */
function deriveLintFromPolicy(policy) {
  const f = policy.files ?? {}
  /** @type {string[]} */
  let glob = []
  if (typeof f.single === 'string') glob = [f.single]
  else if (Array.isArray(f.walkGlob)) glob = f.walkGlob
  else if (typeof f.walkGlob === 'string') glob = [f.walkGlob]
  return { scope: 'full', glob }
}

/**
 * Concern → виконуваний detector-entry. Concern із явним `lint` бере його;
 * policy-concern без `lint` отримує похідну поверхню (детектор = generated main.mjs).
 * @param {ConcernMeta} c вхідний concern.
 * @returns {ConcernMeta|null} концерн із гарантованим `lint`, або null якщо не виконуваний
 */
function asDetectorConcern(c) {
  if (c.lint !== undefined) return c
  // policy-concern → standalone detector лише якщо files резолвиться (single/walkGlob);
  // без цього concern — rego-бібліотека для parent-orchestrator-а, не самостійний detector.
  if (c.policy !== undefined) {
    const f = c.policy.files
    const resolvable = f && typeof f === 'object' && (typeof f.single === 'string' || f.walkGlob !== undefined)
    if (resolvable) return { ...c, lint: deriveLintFromPolicy(c.policy) }
  }
  return null
}

/**
 * Скан усіх concern-ів-detector-ів у `rulesDir` (із lint-поверхнею або policy).
 * @param {string} rulesDir корінь із правилами.
 * @returns {Promise<Record<string, ConcernMeta[]>>} concerns згруповані за rule-id.
 */
async function readLintConcernsByRule(rulesDir) {
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  let entries
  try {
    entries = await readdir(rulesDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const listed = await listConcerns(join(rulesDir, e.name))
    const concerns = listed.map(c => asDetectorConcern(c)).filter(Boolean)
    if (concerns.length > 0) out[e.name] = /** @type {ConcernMeta[]} */ (concerns)
  }
  return out
}

/**
 * Rules-каталоги прогону: явний `opts.rulesDirs`, або базовий (`opts.rulesDir` ?? вбудований)
 * плюс каталоги плагінів з `.n-rules.json` (hot-path: без install і без warning-шуму).
 * @param {{ rulesDirs?: string[], rulesDir?: string, cwd: string }} opts опції прогону.
 * @returns {Promise<string[]>} упорядковані rules-каталоги (ядро перше).
 */
async function effectiveRulesDirs(opts) {
  if (Array.isArray(opts.rulesDirs) && opts.rulesDirs.length > 0) return opts.rulesDirs
  const base = opts.rulesDir ?? DEFAULT_RULES_DIR
  const config = await readNRulesConfigLite(opts.cwd)
  const dirs = resolveRulesDirs(opts.cwd, { plugins: config.plugins }, base, { allowInstall: false, quiet: true })
  return dirs.map(d => d.rulesDir)
}

/**
 * Відкидає концерни з незадоволеним `requires.capability`: capability надають
 * встановлені плагіни (маніфест `n-rules.capabilities`). Явний `opts.capabilities`
 * (тести) перекриває резолв.
 * @param {Record<string, ConcernMeta[]>} byRule concerns за rule-id.
 * @param {{ capabilities?: Iterable<string>, cwd: string }} opts опції прогону.
 * @returns {Promise<Record<string, ConcernMeta[]>>} відфільтровані concerns.
 */
async function filterByCapabilities(byRule, opts) {
  let caps
  if (opts.capabilities) {
    caps = new Set(opts.capabilities)
  } else {
    const config = await readNRulesConfigLite(opts.cwd)
    caps = getActiveCapabilities(opts.cwd, { plugins: config.plugins }, { allowInstall: false, quiet: true })
  }
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    const kept = concerns.filter(c => c.requiresCapability === undefined || caps.has(c.requiresCapability))
    if (kept.length > 0) out[ruleId] = kept
  }
  return out
}

/**
 * Обчислює legacy-гейт `<rule>/applies/main.mjs` — гілка `dynamic`
 * (аварійний клапан і сторонні правила на старому форматі).
 * @param {string} ruleId id правила (для тексту помилки).
 * @param {string} ruleDir каталог правила.
 * @param {string} cwd корінь репозиторію.
 * @returns {Promise<boolean>} вердикт гейта (`true`, якщо модуля/експорту немає).
 */
async function evaluateDynamicApplies(ruleId, ruleDir, cwd) {
  const appliesPath = join(ruleDir, 'applies', 'main.mjs')
  if (!existsSync(appliesPath)) return true
  let applies
  try {
    const mod = await import(pathToFileURL(appliesPath).href)
    applies = mod.applies
  } catch (error) {
    throw new Error(`rule ${ruleId}: не вдалося завантажити applies gate: ${error.message}`, { cause: error })
  }
  if (applies === undefined) return true
  if (typeof applies !== 'function') {
    throw new TypeError(`rule ${ruleId}: applies/main.mjs має експортувати applies(cwd)`)
  }
  return Boolean(await applies(cwd))
}

/**
 * Застосовує опційний rule-level gate до всіх concern-ів правила. Це потрібно
 * для доменних правил, чий канон має сенс лише за наявності конкретної
 * topology в репозиторії: один gate не дає policy- й JS-concern-ам розійтися
 * у власних евристиках застосовності.
 *
 * Гейт — ДЕКЛАРАТИВНИЙ предикат `main.json:applies` (зріз 3 контракту v3.1).
 * Старою гілкою виконуваного модуля йдуть лише `"dynamic"` і правила, ще не
 * переведені на новий формат (у них є `applies/main.mjs` без поля в `main.json`).
 * @param {Record<string, ConcernMeta[]>} byRule concerns за rule-id.
 * @param {string} cwd корінь репозиторію, який лінтиться.
 * @returns {Promise<Record<string, ConcernMeta[]>>} лише застосовні правила.
 */
async function filterByRuleApplies(byRule, cwd) {
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    const firstConcern = concerns[0]
    if (!firstConcern) continue
    const ruleDir = dirname(firstConcern.dir)
    let spec
    try {
      spec = readRuleApplies(ruleDir)
    } catch (error) {
      throw new Error(`rule ${ruleId}: невалідний main.json:applies — ${error.message}`, { cause: error })
    }
    if (spec.kind === 'always') {
      out[ruleId] = concerns
      continue
    }
    const verdict =
      spec.kind === 'declarative'
        ? evaluateAppliesNode(spec.node, cwd)
        : await evaluateDynamicApplies(ruleId, ruleDir, cwd)
    if (verdict) out[ruleId] = concerns
  }
  return out
}

/**
 * Мердж concerns кількох rules-каталогів: правила зливаються за id, концерни — за іменем
 * (перший власник виграє: ядро → плагіни у порядку списку). Плагін може ДОДАВАТИ концерни
 * до правила ядра (mixin), але не перекривати наявні.
 * @param {string[]} rulesDirs упорядковані rules-каталоги.
 * @returns {Promise<Record<string, ConcernMeta[]>>} об'єднані concerns за rule-id.
 */
async function readLintConcernsByRuleMulti(rulesDirs) {
  /** @type {Record<string, ConcernMeta[]>} */
  const merged = {}
  for (const dir of rulesDirs) {
    const byRule = await readLintConcernsByRule(dir)
    for (const [ruleId, concerns] of Object.entries(byRule)) {
      if (!(ruleId in merged)) {
        merged[ruleId] = [...concerns]
        continue
      }
      const seen = new Set(merged[ruleId].map(c => c.name))
      for (const c of concerns) {
        if (!seen.has(c.name)) merged[ruleId].push(c)
      }
    }
  }
  return merged
}

/**
 * Імена ВСІХ каталогів верхнього рівня під `rulesDirs` — незалежно від того, чи знайшлись
 * у них concern-и. Потрібно, щоб відрізнити «каталог є, просто без lint-поверхні» (легітимно
 * для суто-документаційних правил на кшталт `feedback`/`local-ai`) від «каталогу немає
 * взагалі ні в ядрі, ні в жодному підключеному плагіні» (ознака дрейфу конфігу — типово
 * правило переїхало в плагін, якого консюмер не підключив).
 * @param {string[]} rulesDirs rules-каталоги (ядро + плагіни).
 * @returns {Promise<Set<string>>} унікальні імена каталогів-правил.
 */
async function discoverAllRuleDirNames(rulesDirs) {
  const { readdir } = await import('node:fs/promises')
  /** @type {Set<string>} */
  const names = new Set()
  for (const dir of rulesDirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) names.add(e.name)
    }
  }
  return names
}

/**
 * Попереджає про rule-id з `.n-rules.json#rules`, яких немає ЖОДНИМ каталогом ні в ядрі, ні
 * в підключених плагінах (не плутати з «каталог є, але без concern-ів» — легітимний випадок
 * для суто-документаційних правил). Типова причина: правило переїхало в окремий плагін
 * (напр. `js` → `@7n/rules-lang-js` з фази 5c), а `plugins[]` консюмера про це не знає —
 * тоді перевірки для цього правила мовчки НЕ виконуються (0 знайдених concern-ів виглядає
 * як «усе чисто», хоча насправді нічого не перевірялось).
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id (з усіх rulesDirs).
 * @param {import('../read-n-rules-config-lite.mjs').LiteConfig} config розпарсений .n-rules.json.
 * @param {string[]} rulesDirs rules-каталоги (ядро + плагіни), для перевірки «каталог є, але порожній».
 * @returns {Promise<void>}
 */
async function warnAboutRulesWithoutConcerns(byRule, config, rulesDirs) {
  const missing = config.rules.filter(id => !(id in byRule))
  if (missing.length === 0) return
  const allDirNames = await discoverAllRuleDirNames(rulesDirs)
  for (const ruleId of missing) {
    if (allDirNames.has(ruleId)) continue // каталог є, просто без lint-поверхні — легітимно
    console.error(
      `⚠️  .n-rules.json: правило "${ruleId}" не знайдено НІ В ОДНОМУ з rulesDirs (ні в ядрі, ні в ` +
        `підключених плагінах "plugins") — перевірки для нього НЕ виконуються. Якщо правило нещодавно ` +
        `переїхало в окремий плагін, додай відповідний пакет у "plugins" (і в devDependencies).`
    )
  }
}

/**
 * Активні rule-id з `.n-rules.json` (для delta/full режимів).
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {string} cwd робоча директорія прогону.
 * @param {string[]} rulesDirs rules-каталоги (ядро + плагіни) — для warning про відсутні правила.
 * @returns {Promise<string[]>} перелік активних rule-id.
 */
async function enabledRuleIds(byRule, cwd, rulesDirs) {
  const config = await readNRulesConfigLite(cwd)
  if (!config.exists) return []
  await warnAboutRulesWithoutConcerns(byRule, config, rulesDirs)
  return Object.keys(byRule).filter(id => isRuleEnabled(config, id))
}

/**
 * Розширення (без крапки) з extension-map contributions slot-а — злиття `value`-мап
 * (`'.rs' → 'Rust Module'`) усіх активних contributions версії 1.
 * @param {ReturnType<typeof resolveSlotGraph>} graph slot graph від {@link resolveSlotGraph}.
 * @param {string} slot ім'я slot-а (напр. `doc-files.extensions`).
 * @returns {string[]} відсортовані розширення без крапки (порожньо — жодних contributions).
 */
function slotExtensions(graph, slot) {
  /** @type {Set<string>} */
  const exts = new Set()
  for (const c of getSlotContributions(graph, slot, [1])) {
    if (!c.value || typeof c.value !== 'object' || Array.isArray(c.value)) continue
    for (const ext of Object.keys(c.value)) {
      if (ext.startsWith('.') && ext.length > 1) exts.add(ext.slice(1))
    }
  }
  return [...exts].toSorted()
}

/**
 * Підставляє concern-ам із `lint.extensionsSlot` ефективний glob, виведений з
 * extension-map contributions активних плагінів (напр. `doc-files.extensions@1`:
 * lang-js дає js/mjs/ts/vue, lang-rust — rs) — щоб delta-режим і PostToolUse hook
 * запускали concern на файлах УСІХ плагінних мов, а не лише зі статичного glob-а
 * (раніше зміна `.rs` не запускала doc-files, хоча повний скан його бачив).
 * Без жодної contribution (плагіни не встановлені в node_modules) статичний glob
 * лишається fallback-ом — concern далі тригериться і його diagnostics можуть
 * повідомити про недоступні плагіни.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {string} cwd корінь репозиторію, який лінтиться.
 * @returns {Promise<Record<string, ConcernMeta[]>>} concerns із виведеними glob-ами.
 */
async function resolveSlotGlobs(byRule, cwd) {
  const needsResolve = Object.values(byRule).some(concerns => concerns.some(c => c.lint.extensionsSlot !== undefined))
  if (!needsResolve) return byRule
  const config = await readNRulesConfigLite(cwd)
  const graph = resolveSlotGraph(cwd, { plugins: config.plugins }, { allowInstall: false, quiet: true })
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    out[ruleId] = concerns.map(c => {
      if (c.lint.extensionsSlot === undefined) return c
      const exts = slotExtensions(graph, c.lint.extensionsSlot)
      if (exts.length === 0) return c
      const glob = exts.length === 1 ? [`**/*.${exts[0]}`] : [`**/*.{${exts.join(',')}}`]
      return { ...c, lint: { ...c.lint, glob } }
    })
  }
  return out
}

/**
 * Спільний discovery-конвеєр detect/fix/ci-plan: rules-каталоги (ядро + плагіни) →
 * concerns за rule-id → capability-фільтр → rule-applies-гейт → резолюція
 * slot-derived glob-ів ({@link resolveSlotGlobs}).
 * @param {{ rulesDir?: string, rulesDirs?: string[], capabilities?: Iterable<string>, cwd: string }} opts опції прогону.
 * @returns {Promise<{ rulesDirs: string[], byRule: Record<string, ConcernMeta[]> }>} rules-каталоги і застосовні concerns.
 */
async function discoverConcernsByRule(opts) {
  const rulesDirs = await effectiveRulesDirs(opts)
  const capable = await filterByCapabilities(await readLintConcernsByRuleMulti(rulesDirs), opts)
  const byRule = await resolveSlotGlobs(await filterByRuleApplies(capable, opts.cwd), opts.cwd)
  return { rulesDirs, byRule }
}

/**
 * @typedef {{ entry: LintEntry, files: string[]|undefined }} PlanItem
 */

/**
 * Мінімальний DTO концернів для native `buildLintPlan` (P1 фази 7,
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4) — лише те, що
 * реально читають plan-builders у `rules_core::lint_plan`
 * (`concern.name`/`concern.lint.scope`/`concern.lint.glob`/`concern.lint.anchors`
 * — `anchors` додано разом із `LintSurfaceInput::anchors`, доккомент
 * `plan_concern_for_delta` там же). Решта `ConcernMeta` (`dir`/`policy`/
 * `check`/`fixability`/`skipLocalTier`/`cloudTimeoutMs`) лишається виключно
 * тут, у JS — {@link fromPlanItems} підставляє її назад за
 * `(ruleId, concernId)` з уже наявного `byRule`.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id (уже відфільтровані capabilities+applies).
 * @returns {Record<string, { name: string, lint: { scope: string, glob: string[], anchors: string[] } }[]>} мінімальний DTO для native.
 */
function toByRuleDto(byRule) {
  /** @type {Record<string, { name: string, lint: { scope: string, glob: string[], anchors: string[] } }[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    out[ruleId] = concerns.map(c => ({
      name: c.name,
      lint: { scope: c.lint.scope, glob: c.lint.glob, anchors: c.lint.anchors ?? [] }
    }))
  }
  return out
}

/**
 * Native `PlanItem{ruleId, concernId, files}` → JS `PlanItem{entry:{ruleId,concern},
 * files}` — зіставляє мінімальний вихід native назад із уже наявним у пам'яті
 * повним `ConcernMeta` (native ніколи не бачить `dir`/`policy`/`check`/…, doc-
 * комент {@link toByRuleDto}).
 * @param {{ ruleId: string, concernId: string, files?: string[] }[]} items вихід native `buildLintPlan`.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id (той самий, що пішов у {@link toByRuleDto}).
 * @returns {PlanItem[]} впорядкований план (порядок — уже native, зберігається як є).
 */
function fromPlanItems(items, byRule) {
  return items.map(item => {
    const concern = (byRule[item.ruleId] ?? []).find(c => c.name === item.concernId)
    return { entry: { ruleId: item.ruleId, concern }, files: item.files ?? undefined }
  })
}

/**
 * Будує план прогону для заданих опцій (discovery + scope-table).
 * Спільне джерело для detect-only і fix-pipeline.
 * @param {object} opts опції прогону.
 * @param {string} [opts.rulesDir] базовий корінь із правилами (дефолт — вбудований).
 * @param {string[]} [opts.rulesDirs] явні rules-каталоги (ядро + плагіни); без них — базовий + плагіни з конфігу.
 * @param {string} opts.cwd робоча директорія прогону.
 * @param {boolean} [opts.full] whole-repo режим (усі enabled-concerns).
 * @param {string[]} [opts.rules] scoped rule-id (порожній → delta/full).
 * @param {string[]|null} [opts.files] явний перелік файлів або null.
 * @returns {Promise<PlanItem[]>} впорядкований план прогону.
 */
export async function buildDetectPlan(opts) {
  const { rulesDirs, byRule } = await discoverConcernsByRule(opts)
  return buildPlan({
    byRule,
    full: opts.full === true,
    rules: Array.isArray(opts.rules) ? opts.rules : [],
    explicitFiles: Array.isArray(opts.files) ? opts.files : null,
    pathMode: opts.pathMode === true,
    repoWide: opts.repoWide === true,
    baseRef: typeof opts.baseRef === 'string' ? opts.baseRef : null,
    cwd: opts.cwd,
    rulesDirs
  })
}

/**
 * Discovery-фасад для споживачів поза detect/fix-конвеєром (`ci plan`):
 * concerns за rule-id (ядро + плагіни, capability-фільтр) і set активних правил.
 * @param {{ rulesDir?: string, rulesDirs?: string[], capabilities?: Iterable<string>, cwd: string }} opts опції прогону.
 * @returns {Promise<{ byRule: Record<string, ConcernMeta[]>, enabledSet: Set<string> }>} concerns і активні правила.
 */
export async function loadEnabledLintRules(opts) {
  const { rulesDirs, byRule } = await discoverConcernsByRule(opts)
  const enabledSet = new Set(await enabledRuleIds(byRule, opts.cwd, rulesDirs))
  return { byRule, enabledSet }
}

/**
 * Активність доменів (rule-id) для заданого файлового набору — єдине джерело
 * правди для `ci plan`: домен «активний», якщо хоч один його **per-file**
 * concern тригериться на цих файлах (та сама таблиця `planConcernForDelta`,
 * що й `lint <domain> --path` → «plan сказав true» ⇔ «lint щось запустить»,
 * тепер порт у `rules_core::lint_plan` — glob-збіг рахує native
 * `matchLintGlobs`, єдине джерело правди по обидва боки, doc-комент модуля
 * `rules_core::lint_plan`). Правила без жодного per-file concern не
 * потрапляють у результат (їхні full-scope перевірки — справа `--repo-wide`).
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @param {string[]} changed файловий набір (перетин path ∩ дельта або дельта).
 * @returns {Map<string, { triggered: boolean, matchedFiles: number }>} стан за rule-id.
 */
export function computeActiveDomains(byRule, enabledSet, changed) {
  /** @type {Map<string, { triggered: boolean, matchedFiles: number }>} */
  const out = new Map()
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    const perFile = concerns.filter(c => c.lint.scope === 'per-file')
    if (perFile.length === 0) continue
    const matched = new Set()
    for (const concern of perFile) {
      const { glob } = concern.lint
      // glob.length === 0 → concern матчить УСІ changed (той самий fallback,
      // що planConcernForDelta у native): matchLintGlobs([], …) навмисно
      // повертає порожньо (doc-комент rules_core::lint_plan), тож порожній
      // glob перевіряється тут, ДО виклику native.
      const files = glob.length > 0 ? loadNative().matchLintGlobs(glob, changed) : changed
      for (const f of files) matched.add(f)
    }
    out.set(ruleId, { triggered: matched.size > 0, matchedFiles: matched.size })
  }
  return out
}

/**
 * Будує план: список entries + чи кожен запускається whole-repo (files=undefined)
 * чи per-file (files=[...]). Реалізує таблицю lint.scope зі специфікації.
 * @param {object} args аргументи побудови плану.
 * @param {Record<string, ConcernMeta[]>} args.byRule concerns згруповані за rule-id.
 * @param {boolean} args.full whole-repo режим.
 * @param {string[]} args.rules scoped rule-id (порожній → delta/full).
 * @param {string[]|null} args.explicitFiles явний перелік файлів або null.
 * @param {boolean} [args.pathMode] `--path`-дельта: лише per-file concerns.
 * @param {boolean} [args.repoWide] `--repo-wide`: лише full-scope concerns, whole-repo.
 * @param {string|null} [args.baseRef] явна база дельти (`--base <ref>`) замість каскаду main→origin/main.
 * @param {string} args.cwd робоча директорія прогону.
 * @param {string[]} [args.rulesDirs] rules-каталоги (ядро + плагіни) — для warning про відсутні правила.
 * @returns {Promise<PlanItem[]>} впорядкований план прогону.
 */
async function buildPlan({
  byRule,
  full,
  rules,
  explicitFiles,
  pathMode = false,
  repoWide = false,
  baseRef = null,
  cwd,
  rulesDirs = []
}) {
  const byRuleDto = toByRuleDto(byRule)

  // scoped + --path: per-file concerns названих правил × перетин path ∩ дельта
  if (rules.length > 0 && explicitFiles !== null) {
    const items = loadNative().buildLintPlan({ mode: 'scopedDelta', byRule: byRuleDto, rules, explicitFiles })
    return fromPlanItems(items, byRule)
  }
  // scoped: усі lint-concerns названих правил, whole-repo
  if (rules.length > 0) {
    const items = loadNative().buildLintPlan({ mode: 'scoped', byRule: byRuleDto, rules })
    return fromPlanItems(items, byRule)
  }

  const enabledRuleIdList = await enabledRuleIds(byRule, cwd, rulesDirs)

  // repo-wide: лише full-scope concerns (окремий CI-workflow, не гейтить деплой)
  if (repoWide) {
    const items = loadNative().buildLintPlan({ mode: 'repoWide', byRule: byRuleDto, enabledRuleIds: enabledRuleIdList })
    return fromPlanItems(items, byRule)
  }

  // full: усі per-file + full concerns enabled-правил, whole-repo
  if (full && explicitFiles === null) {
    const items = loadNative().buildLintPlan({ mode: 'full', byRule: byRuleDto, enabledRuleIds: enabledRuleIdList })
    return fromPlanItems(items, byRule)
  }

  // delta / explicit-files; path-режим виключає full-scope concerns
  const changed = explicitFiles ?? (await collectChangedFilesSince(await resolveChangedBase(cwd, baseRef), cwd))
  const items = loadNative().buildLintPlan({
    mode: 'delta',
    byRule: byRuleDto,
    enabledRuleIds: enabledRuleIdList,
    changed,
    pathMode
  })
  return fromPlanItems(items, byRule)
}

/**
 * Виконує один item плану: будує ctx, прогонить detector, оновлює progress. Спільний
 * крок для послідовного і конкурентного (`N_RULES_LINT_CONCURRENCY>1`) шляхів `detectAll` —
 * єдина точка, де щось може кинути `DetectorError` (чи іншу помилку), тож caller (sequential
 * for-loop чи `runPlanConcurrently`) вирішує, як саме зупинити прогін.
 * @param {PlanItem} planItem один item плану (`{ entry, files }`).
 * @param {object} runOpts опції прогону.
 * @param {string} runOpts.cwd робоча директорія прогону.
 * @param {boolean} runOpts.verbose докладний лог прогону.
 * @param {import('./progress.mjs').ProgressReporter|null} runOpts.progress reporter прогресу (може бути відсутній).
 * @param {(s: string) => void} runOpts.log функція логування.
 * @param {AbortSignal} [runOpts.signal] сигнал скасування — лише в конкурентному шляху.
 * @returns {Promise<{ entry: LintEntry, violations: LintViolation[] }>} entry і зібрані violations.
 */
async function runPlanItem({ entry, files }, { cwd, verbose, progress, log, signal }) {
  /** @type {LintContext} */
  const ctx = {
    cwd,
    ruleId: entry.ruleId,
    concernId: entry.concern.name,
    files,
    verbose,
    signal,
    reportProgressDetail: progress?.detail
  }
  const key = `${entry.ruleId}/${entry.concern.name}`
  progress?.concernStart(key)
  if (verbose) {
    const countStr = files === undefined ? 'весь репо' : `${files.length} файл(ів)`
    log(`  🔍 ${key}  [${entry.concern.lint.scope}]  → ${countStr}\n`)
  }
  const result = await runConcernDetector(entry.concern, ctx)
  progress?.detectSnapshot(key, result.violations.length)
  progress?.concernDone(key)
  if (verbose && result.diagnostics && result.diagnostics.length > 0) {
    log(renderDiagnostics(result.diagnostics))
  }
  return { entry, violations: result.violations }
}

/**
 * @typedef {{ violations: LintViolation[], ran: LintEntry[], infraMessage: string|null }} PlanRunResult
 */

/**
 * @typedef {{ type: 'native', items: PlanItem[] } | { type: 'single', item: PlanItem }} PlanSegment
 */

/**
 * Партиціонує план на сегменти для послідовного шляху (R2 зрізу 3 фази 7):
 * суцільні прогони builtin-native items ({@link isBuiltinNativeConcern}) —
 * один `native`-сегмент (пізніше ОДИН `runNativeConcernsBatch`-виклик),
 * решта (wasm/policy/ручний main.mjs) — окремі `single`-сегменти, чинний
 * per-item шлях без змін. Порядок плану зберігається; зливаються лише
 * СУСІДНІ native items — нативний concern між двома невідомими items
 * лишається власним сегментом довжини 1 (без штучного "стрибка" через
 * невідповідний item), той самий порядок виконання, що дав би чистий
 * per-item прохід.
 * @param {PlanItem[]} plan впорядкований план прогону.
 * @returns {PlanSegment[]} сегменти плану.
 */
function partitionPlanIntoSegments(plan) {
  /** @type {PlanSegment[]} */
  const segments = []
  /** @type {PlanItem[]} */
  let nativeRun = []
  const flushNativeRun = () => {
    if (nativeRun.length === 0) {
      return
    }

    segments.push({ type: 'native', items: nativeRun })
    nativeRun = []
  }
  for (const item of plan) {
    if (isBuiltinNativeConcern(item.entry.ruleId, item.entry.concern.name)) {
      nativeRun.push(item)
    } else {
      flushNativeRun()
      segments.push({ type: 'single', item })
    }
  }
  flushNativeRun()
  return segments
}

/**
 * Ключ `ruleId/concernId` одного item-а плану — той самий формат, що вживають
 * progress-репортер і повідомлення `DetectorError`.
 * @param {PlanItem} item item плану.
 * @returns {string} ключ `ruleId/concernId`.
 */
function planItemKey(item) {
  return `${item.entry.ruleId}/${item.entry.concern.name}`
}

/**
 * Виконує ОДИН суцільний сегмент builtin-native items ОДНИМ native-викликом
 * (`runNativeConcernsBatch`, `crates/rules-napi/src/lib.rs`) замість N
 * окремих `runConcernDetector` (R2 зрізу 3 фази 7) — менше napi-hops на
 * гарячому шляху `detectAll`.
 *
 * Progress/verbose-репортинг відтворює per-item шлях ({@link runPlanItem})
 * один-в-один: `concernStart` + verbose pre-run лог ПЕРЕД кожним item-ом
 * (перший — до батч-виклику, бо всі `files`/`scope` уже відомі з плану;
 * решта — з `onProgress`-колбека, що спрацьовує СИНХРОННО одразу після
 * попереднього item-а, той самий порядок, що дав би `await` між двома
 * послідовними `runPlanItem`); `detectSnapshot`+`concernDone` ПІСЛЯ item-а —
 * лише за відсутності помилки (у `runPlanItem` ці два виклики стоять ПІСЛЯ
 * `await runConcernDetector(...)`, тож `DetectorError` звідти обриває їх
 * так само, як тут `stopped`-прапорець).
 *
 * Rust-бік доводить сегмент до кінця незалежно від проміжних помилок
 * (fail-soft `run_concerns_batch`, `crates/rules-core/src/concerns/batch.rs`)
 * — детектори read-only, зайве обчислення після першої помилки нешкідливе.
 * Але JS-семантика ЗУПИНЯЄТЬСЯ на першому `DetectorError` (той самий
 * контракт, що per-item `detectPlanSequentially`): `outcomes` містить лише
 * items ДО помилки, `error` — сконструйований `DetectorError` для item-а, що
 * впав, з ТИМ САМИМ форматом повідомлення (`native concern кинув: ...`), що
 * одиночний виклик у {@link runConcernDetector}.
 * @param {PlanItem[]} segmentItems суцільний сегмент native-items плану (непорожній).
 * @param {{ cwd: string, verbose: boolean, progress: import('./progress.mjs').ProgressReporter|null, log: (s: string) => void }} runOpts опції прогону.
 * @returns {{ outcomes: { entry: LintEntry, violations: LintViolation[] }[], error: DetectorError|null }}
 *   виконані items (до першої помилки) і опційна помилка.
 */
function runNativeSegmentSync(segmentItems, { cwd, verbose, progress, log }) {
  /**
   * Concern-start + verbose pre-run лог — той самий рядок, що runPlanItem.
   * @param {PlanItem} item item плану, який зараз стартує.
   */
  const logPreRun = item => {
    const key = planItemKey(item)
    progress?.concernStart(key)
    if (verbose) {
      const countStr = item.files === undefined ? 'весь репо' : `${item.files.length} файл(ів)`
      log(`  🔍 ${key}  [${item.entry.concern.lint.scope}]  → ${countStr}\n`)
    }
  }
  logPreRun(segmentItems[0])

  const batchItems = segmentItems.map(item => ({
    key: planItemKey(item),
    cwd,
    // `?? null` — той самий контракт, що одиночний `runNativeConcern(nativeKey, ctx.cwd, ctx.files ?? null)`
    // у `detect.mjs`: `undefined` (whole-repo) не можна передати крізь JSON, native розрізняє `null`/`Some([])`.
    files: item.files ?? null
  }))

  let idx = 0
  let stopped = false
  const onProgress = payload => {
    if (stopped) return // native фізично рахує далі (fail-soft), але JS уже не репортить — той самий early-stop, що per-item throw
    if (payload.error !== undefined) {
      stopped = true
      return
    }
    const key = planItemKey(segmentItems[idx])
    progress?.detectSnapshot(key, payload.violationsCount)
    progress?.concernDone(key)
    idx += 1
    if (idx < segmentItems.length) logPreRun(segmentItems[idx])
  }

  const { results } = loadNative().runNativeConcernsBatch(batchItems, onProgress)

  /** @type {{ entry: LintEntry, violations: LintViolation[] }[]} */
  const outcomes = []
  for (const [i, r] of results.entries()) {
    const item = segmentItems[i]
    if (r.error !== undefined) {
      // Той самий формат, що `detect.mjs::runConcernDetector` для native-гілки: "native concern кинув: <message>".
      return {
        outcomes,
        error: new DetectorError(item.entry.ruleId, item.entry.concern.name, `native concern кинув: ${r.error}`)
      }
    }
    // Ноти концерну (`diagnostics`) передаються нарівні з порушеннями — batch-шлях
    // має бути спостережувано ідентичним per-item, а `runConcernDetector` їх віддає.
    const normalized = normalizeResult(
      { violations: r.violations, diagnostics: r.diagnostics },
      { ruleId: item.entry.ruleId, concernId: item.entry.concern.name }
    )
    if (verbose && normalized.diagnostics && normalized.diagnostics.length > 0) {
      log(renderDiagnostics(normalized.diagnostics))
    }
    outcomes.push({ entry: item.entry, violations: normalized.violations })
  }
  return { outcomes, error: null }
}

/**
 * Послідовний прохід плану — незмінна поведінка до-ADR 260716-1354 (`N_RULES_LINT_CONCURRENCY<=1`,
 * дефолт), доповнена batch-виконанням суцільних native-сегментів (R2 зрізу 3 фази 7,
 * {@link partitionPlanIntoSegments}/{@link runNativeSegmentSync}) — спостережувано ідентична
 * поведінка (violations/порядок/progress/DetectorError-формат), лише менше napi-hops. Перший
 * `DetectorError` негайно зупиняє прогін (`infraMessage`); будь-яка інша помилка прокидається
 * далі (несподівана помилка самого раннера, не detector-контракту).
 * @param {PlanItem[]} plan впорядкований план прогону.
 * @param {{ cwd: string, verbose: boolean, progress: import('./progress.mjs').ProgressReporter|null, log: (s: string) => void }} runOpts опції прогону.
 * @returns {Promise<PlanRunResult>} зібрані violations, виконані entries, повідомлення інфра-помилки.
 */
async function detectPlanSequentially(plan, runOpts) {
  /** @type {LintViolation[]} */
  const violations = []
  /** @type {LintEntry[]} */
  const ran = []
  for (const segment of partitionPlanIntoSegments(plan)) {
    if (segment.type === 'single') {
      let outcome
      try {
        outcome = await runPlanItem(segment.item, runOpts)
      } catch (error) {
        if (error instanceof DetectorError) return { violations, ran, infraMessage: error.message }
        throw error
      }
      ran.push(outcome.entry)
      violations.push(...outcome.violations)
      continue
    }
    const { outcomes, error } = runNativeSegmentSync(segment.items, runOpts)
    for (const outcome of outcomes) {
      ran.push(outcome.entry)
      violations.push(...outcome.violations)
    }
    if (error !== null) return { violations, ran, infraMessage: error.message }
  }
  return { violations, ran, infraMessage: null }
}

/**
 * Bounded two-lane прохід плану (`N_RULES_LINT_CONCURRENCY>1`, experimental — ADR 260716-1354).
 * Parallel lane — concern-и, доведені non-blocking (`blocking-inventory.mjs`), bounded pool до
 * `concurrency`; serial lane — решта, строго послідовно. Перший `DetectorError` зупиняє нові
 * старти в обох лейнах (`scheduler.mjs`); уже завершені concern-и лишаються в результаті.
 * @param {PlanItem[]} plan впорядкований план прогону.
 * @param {{ cwd: string, verbose: boolean, progress: import('./progress.mjs').ProgressReporter|null, log: (s: string) => void, concurrency: number }} runOpts опції прогону.
 * @returns {Promise<PlanRunResult>} зібрані violations, виконані entries, повідомлення інфра-помилки.
 */
async function detectPlanConcurrently(plan, { cwd, verbose, progress, log, concurrency }) {
  const { results, infraError } = await runPlanConcurrently(plan, {
    concurrency,
    isSerial: item => isSerialLane(item.entry.ruleId, item.entry.concern.name),
    runItem: (item, signal) => runPlanItem(item, { cwd, verbose, progress, log, signal })
  })

  if (infraError !== null && !(infraError instanceof DetectorError)) throw infraError

  /** @type {LintViolation[]} */
  const violations = []
  /** @type {LintEntry[]} */
  const ran = []
  for (const { result } of results) {
    if (!result) continue
    ran.push(result.entry)
    violations.push(...result.violations)
  }
  return { violations, ran, infraMessage: infraError?.message ?? null }
}

/**
 * Запускає detect-only прохід. Повертає всі violations і похідний exitCode.
 * @param {object} opts опції прогону.
 * @param {string} [opts.rulesDir] базовий корінь із правилами (дефолт — вбудований).
 * @param {string[]} [opts.rulesDirs] явні rules-каталоги (ядро + плагіни); без них — базовий + плагіни з конфігу.
 * @param {string} opts.cwd робоча директорія прогону.
 * @param {boolean} [opts.full] whole-repo режим.
 * @param {string[]} [opts.rules] scoped rule-id (порожній → delta/full).
 * @param {string[]|null} [opts.files] явний перелік файлів або null.
 * @param {boolean} [opts.pathMode] `--path`-дельта: лише per-file concerns.
 * @param {boolean} [opts.repoWide] `--repo-wide`: лише full-scope concerns.
 * @param {boolean} [opts.verbose] докладний лог прогону.
 * @param {(s: string) => void} [opts.log] функція логування.
 * @param {boolean} [opts.isTTY] override TTY-режиму ProgressReporter (тести); типово isTTY stdout.
 * @param {(snap: object) => void} [opts.onProgress] публікація знімків прогресу назовні (черга lint --full).
 * @returns {Promise<{ violations: LintViolation[], exitCode: 0|1|2, ran: LintEntry[] }>} violations, exitCode і виконані entries.
 */
export async function detectAll(opts) {
  const { cwd } = opts
  const full = opts.full === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const explicitFiles = Array.isArray(opts.files) ? opts.files : null
  const verbose = opts.verbose === true
  const baseLog = opts.log ?? (s => process.stdout.write(s))

  const { rulesDirs, byRule } = await discoverConcernsByRule(opts)
  const plan = await buildPlan({
    byRule,
    full,
    rules,
    explicitFiles,
    pathMode: opts.pathMode === true,
    repoWide: opts.repoWide === true,
    baseRef: typeof opts.baseRef === 'string' ? opts.baseRef : null,
    cwd,
    rulesDirs
  })

  // Detect-only бар — ЛИШЕ в TTY (без тикера «виправлено»). У не-TTY (hooks, CI-gate,
  // пайпи) append-рядки ⏱ на кожен концерн засмітили б вивід кожного PostToolUse-хука,
  // тож там reporter створюється лише за наявності onProgress і «мовчазним»
  // (appendInNonTTY: false) — publisher черги (--full) отримує знімки без шуму.
  const isTTY = opts.isTTY ?? process.stdout.isTTY === true
  const progress =
    isTTY || opts.onProgress
      ? createProgressReporter({
          total: plan.length,
          log: baseLog,
          isTTY,
          withFixed: false,
          onUpdate: opts.onProgress,
          appendInNonTTY: false
        })
      : null
  const log = progress ? progress.log : baseLog

  // Default 1 — production-паралелізм ще не пройшов benchmark-gates ADR 260716-1354;
  // >1 лишається experimental override.
  const concurrency = Math.max(1, Number(env['N_RULES_LINT_CONCURRENCY']) || 1)
  const runOpts = { cwd, verbose, progress, log }

  let planResult
  try {
    planResult = await (concurrency > 1
      ? detectPlanConcurrently(plan, { ...runOpts, concurrency })
      : detectPlanSequentially(plan, runOpts))
  } finally {
    progress?.stop()
  }

  const { ran, infraMessage } = planResult
  // Сортування (ruleId/concernId/file/line/reason) + рендер + exit-code —
  // один native-виклик (R1 фази 7, `crates/rules-core/src/lint_render.rs`,
  // `sortAndRenderViolations`): менше hops, ніж три окремі функції.
  const { sorted, rendered, exitCode } = loadNative().sortAndRenderViolations({
    violations: planResult.violations,
    infraMessage
  })

  if (infraMessage !== null) {
    log(`💥 ${infraMessage}\n`)
    return { violations: sorted, exitCode, ran }
  }

  if (sorted.length > 0) baseLog(rendered)
  return { violations: sorted, exitCode, ran }
}
