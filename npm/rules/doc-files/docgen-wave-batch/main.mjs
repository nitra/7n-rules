/** @see ./docs/docgen-wave-batch.md */
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'
import { defaultLocalProviders } from '@7n/llm-lib/local-providers'

import {
  apiSectionPlan,
  assemble,
  behaviorOnlyDocument,
  classifyDocgenError,
  commentOnlyDoc,
  CRITIC_NONE_RE,
  loadSrcAndFacts,
  resolvePromptSrc,
  scoreDoc,
  stripSection,
  stripSignatures
} from '../docgen-gen/main.mjs'
import {
  apiGapMessages,
  criticMessages,
  guaranteesFromMarkers,
  overviewMessages,
  refineMessages,
  sectionMessages
} from '../docgen-prompts/main.mjs'
import { renderTestScenarios } from '../docgen-test-context/main.mjs'
import { documentationCrc, QUALITY_THRESHOLD, stampDoc } from '../docgen-crc/main.mjs'
import { JUDGE_ENABLED, JUDGE_MODEL, judgeFailsDoc, judgeMessages, parseDocVerdict } from '../docgen-judge/main.mjs'

/**
 * Діагностика розміру джерела для рядка результату — той самий формат, що й
 * `fmtSize` у `docgen-files-batch` (дубльовано тут, не імпортовано: імпорт
 * створив би циклічну залежність `docgen-files-batch` ⇄ `docgen-wave-batch`,
 * бо `docgen-files-batch` викликає [`runWaveBatch`] звідси).
 * @param {number} bytes розмір файлу в байтах
 * @returns {string} напр. `12.3KB ~3.1k tok`
 */
function fmtSize(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB ~${(bytes / 4 / 1000).toFixed(1)}k tok`
}

/**
 * Спека `2026-07-27-batch-local-avg-real-batches.md`, фаза 2: знімає компроміс
 * T8 (2b-batch = лише one-shot, без judge/best-of-2/critique-refine) для
 * `docgen-files-batch`-елементів у режимі `'comment+behavior'`/`'fallback'`
 * (тут — `'full'`). Замість one-shot-промпта на файл — той самий
 * секційний конвеєр, що й послідовний `generateDoc`, але кожен крок —
 * ОДИН `submitBatch`-виклик на ВСІ файли одразу («хвиля»), не await per-file:
 *
 *   Wave A (behavior + api-gap) → Wave B (overview, з готового behavior) →
 *   Wave C (critique overview завжди; api-gap лише якщо ВСІ export — прогалина) →
 *   Wave D (refine лише де критик не сказав NONE) → best-of-2 retry (лише
 *   Wave A+B, temp 0.5, для файлів нижче порога — без повторного critique/refine,
 *   свідоме спрощення фази 2) → Wave E (judge, опційно).
 *
 * Помилка ОДНОГО обов'язкового виклику файлу (behavior/api-gap/overview) —
 * весь файл вважається невдалим (той самий all-or-nothing семантика, що й
 * послідовний ланцюжок await у `generateDoc`) і виключається з подальших
 * хвиль; решта файлів batch-у це не зачіпає.
 */

/**
 * @typedef {{
 *   file: {sourcePath: string, docPath: string},
 *   sourceAbs: string, docAbs: string, size: number, testIndex: object,
 *   facts: object, anchors: object|null, src: string, mode: 'comment+behavior'|'full',
 *   intent: string|null
 * }} PreparedItem елемент від `prepareBatchTargets`/`prepareBatchItem` (docgen-files-batch)
 */

/**
 * Внутрішній стан одного файлу протягом хвиль.
 * @typedef {PreparedItem & {
 *   promptSrc: string, apiPlan: {coveredBlock:string, gap:Array<object>, needsCritique:boolean}|null,
 *   temperature: number, failed: string|null,
 *   behaviorText: string|null, apiGapDraft: string|null, overviewText: string|null,
 *   md: string|null, score: number|null, issues: string[], degraded: boolean, judge: object|null
 * }} WaveState
 */

/**
 * Розбирає `messages` (system+user) на `{customId, prompt, system}` — контракт
 * `submitBatch` item-у (`llm-lib/lib/batch.mjs`).
 * @param {string} customId ідентифікатор item-у (`<sourcePath>::<крок>`)
 * @param {Array<{role:string,content:string}>} messages чат-повідомлення
 * @returns {{customId: string, prompt: string, system?: string}} item для submitBatch
 */
function toBatchItem(customId, messages) {
  return {
    customId,
    prompt: messages.find(m => m.role === 'user')?.content ?? '',
    system: messages.find(m => m.role === 'system')?.content
  }
}

/**
 * Один `submitBatch`-виклик-хвиля: порожній список items — no-op (0 мережевих
 * викликів, як і в самому `submitBatch`). Помилки самого виклику (не item-у)
 * пробиваються нагору — falls-through до systemic-класифікації викликача.
 * @param {(modelSpecOrTier: string, items: Array<object>, opts?: object) => Promise<Array<object>>} submitBatchImpl injectable submitBatch
 * @param {string} model model-spec для цієї хвилі
 * @param {Array<{customId: string, messages: Array<object>}>} entries сирі entries хвилі (ще не item-и)
 * @param {object} localProviders конфіг локальних провайдерів
 * @returns {Promise<Map<string, {ok?: string, error?: string}>>} результати за customId
 */
async function runWave(submitBatchImpl, model, entries, localProviders) {
  if (entries.length === 0) return new Map()
  const items = entries.map(e => toBatchItem(e.customId, e.messages))
  const results = await submitBatchImpl(model, items, { localProviders })
  return new Map(results.map(r => [r.customId, r]))
}

/**
 * Позначає файл невдалим (обов'язковий виклик хвилі провалився) — той самий
 * `classifyDocgenError`, що й у `docgen-files-batch`; permanent → skip, інакше
 * → err. Викликається щонайбільше раз на файл (перевіряється `f.failed` перед
 * кожною хвилею). `stats`/`out` опційні: best-of-2 (`runBestOf2`) викликає
 * Wave A/B вдруге на тимчасовій копії стану, де провал ретраю не має псувати
 * реальні лічильники прогону — там викликається без них.
 * @param {WaveState} f стан файлу (мутується)
 * @param {string} message повідомлення помилки
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} [stats] акумулятор (мутується)
 * @param {(s: string) => void} [out] логер рядка результату
 * @returns {void}
 */
function failFile(f, message, stats, out) {
  if (f.failed) return
  f.failed = message
  const cls = classifyDocgenError(message)
  const prefix = `  ${f.file.sourcePath} [${fmtSize(f.size)}] `
  if (cls === 'permanent') {
    stats?.skipped.push(f.file.sourcePath)
    out?.(`${prefix}⊘ skip (permanent, wave-batch): ${message}\n`)
  } else {
    if (stats) stats.err++
    stats?.errors.push(f.file.sourcePath)
    out?.(`${prefix}✗ ${cls} (wave-batch): ${message}\n`)
  }
}

/**
 * Готує wave-стан одного вже класифікованого `prepareBatchItem`-елемента:
 * `promptSrc` (юніт-дайджест для великих файлів — той самий вибір, що й
 * послідовний `generateDoc`) і `apiPlan` (лише режим `'full'`).
 * @param {PreparedItem} p підготовлений елемент
 * @returns {Promise<WaveState>} початковий wave-стан
 */
async function prepareWaveFile(p) {
  const { estTokens, ext, langExtractors } = await loadSrcAndFacts(p.sourceAbs, p.testIndex)
  const promptSrc = resolvePromptSrc({ facts: p.facts, estTokens, langExtractors, ext, src: p.src, file: p.sourceAbs })
  const apiPlan = p.mode === 'full' ? apiSectionPlan(p.facts) : null
  return {
    ...p,
    promptSrc,
    apiPlan,
    temperature: 0.2,
    failed: null,
    behaviorText: null,
    apiGapDraft: null,
    overviewText: null,
    md: null,
    score: null,
    issues: [],
    degraded: false,
    judge: null
  }
}

/**
 * Wave A: behavior (усі файли) + api-gap (лише `'full'`, коли є непокриті
 * JSDoc-експорти). `complementaryBehavior` — той самий прапор, що й у
 * послідовному `comment+behavior`-режимі.
 * @param {WaveState[]} files живі (не `failed`) файли
 * @returns {Array<{customId: string, messages: Array<object>}>} entries хвилі A
 */
function waveAEntries(files) {
  const entries = []
  for (const f of files) {
    const [{ messages }] = sectionMessages(f.facts, f.promptSrc, f.anchors, f.intent, {
      complementaryBehavior: f.mode === 'comment+behavior'
    })
    entries.push({ customId: `${f.file.sourcePath}::behavior`, messages })
    if (f.mode === 'full' && f.apiPlan?.gap.length) {
      entries.push({ customId: `${f.file.sourcePath}::api-gap`, messages: apiGapMessages(f.apiPlan.gap, f.anchors) })
    }
  }
  return entries
}

/**
 * Застосовує результати Wave A: `behaviorText`/`apiGapDraft`. Провал
 * обов'язкового виклику (behavior завжди; api-gap — коли є прогалина) валить
 * увесь файл ([`failFile`]) — та сама all-or-nothing семантика, що й
 * послідовний ланцюжок await.
 * @param {WaveState[]} files живі файли
 * @param {Map<string, {ok?: string, error?: string}>} results результати Wave A за customId
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} stats акумулятор
 * @param {(s: string) => void} out логер
 * @returns {void}
 */
function applyWaveA(files, results, stats, out) {
  for (const f of files) {
    const behavior = results.get(`${f.file.sourcePath}::behavior`)
    if (!behavior?.ok) {
      failFile(f, behavior?.error ?? 'wave A: результат behavior відсутній', stats, out)
      continue
    }
    f.behaviorText = stripSignatures(stripSection(behavior.ok))
    if (f.mode === 'full' && f.apiPlan?.gap.length) {
      const apiGap = results.get(`${f.file.sourcePath}::api-gap`)
      if (!apiGap?.ok) {
        failFile(f, apiGap?.error ?? 'wave A: результат api-gap відсутній', stats, out)
        continue
      }
      f.apiGapDraft = stripSignatures(stripSection(apiGap.ok))
    }
  }
}

/**
 * Wave B: overview — лише `'full'`-файли (comment+behavior не має окремого
 * Огляду, він дослівно з авторського header-коментаря).
 * @param {WaveState[]} files живі файли
 * @returns {Array<{customId: string, messages: Array<object>}>} entries хвилі B
 */
function waveBEntries(files) {
  return files
    .filter(f => f.mode === 'full' && typeof f.behaviorText === 'string')
    .map(f => ({
      customId: `${f.file.sourcePath}::overview`,
      messages: overviewMessages(f.facts, f.behaviorText, f.intent)
    }))
}

/**
 * Застосовує результати Wave B.
 * @param {WaveState[]} files живі файли
 * @param {Map<string, {ok?: string, error?: string}>} results результати Wave B
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} stats акумулятор
 * @param {(s: string) => void} out логер
 * @returns {void}
 */
function applyWaveB(files, results, stats, out) {
  for (const f of files) {
    if (f.mode !== 'full' || typeof f.behaviorText !== 'string') continue
    const overview = results.get(`${f.file.sourcePath}::overview`)
    if (!overview?.ok) {
      failFile(f, overview?.error ?? 'wave B: результат overview відсутній', stats, out)
      continue
    }
    f.overviewText = stripSignatures(stripSection(overview.ok))
  }
}

/**
 * Складає документ із поточного wave-стану (без critique/refine — викликається
 * і до, і після Wave D) і рахує det-score. `'comment+behavior'` збирається
 * через `commentOnlyDoc` (авторський header + JSDoc API + LLM-behavior);
 * `'full'` — через `assemble` (усі секції, `guarantees`/`scenarios` — 0 LLM).
 * @param {WaveState} f wave-стан файлу (мутується: `md`, `score`, `issues`)
 * @returns {void}
 */
function assembleAndScore(f) {
  if (f.mode === 'comment+behavior') {
    const behavior = f.behaviorText && !CRITIC_NONE_RE.test(f.behaviorText.trim()) ? f.behaviorText : ''
    f.md = commentOnlyDoc(f.facts, f.intent, behavior).md
    const { score, issues } = scoreDoc(f.md, f.facts, { anchors: f.anchors, src: f.src })
    f.score = score
    f.issues = issues
    return
  }
  const sections = {
    guarantees: guaranteesFromMarkers(f.facts),
    scenarios: renderTestScenarios(f.facts.testScenarioFiles ?? []),
    behavior: f.behaviorText ?? '',
    api: [f.apiPlan?.coveredBlock, f.apiGapDraft].filter(Boolean).join('\n'),
    overview: f.overviewText ?? ''
  }
  f.md = assemble(basename(f.facts.relPath), sections)
  const { score, issues } = scoreDoc(f.md, f.facts, { anchors: f.anchors, src: f.src })
  f.score = score
  f.issues = issues
}

/**
 * Wave C: критика Огляду (завжди, `'full'`) і api-gap (лише коли ВСІ export —
 * прогалина, `apiPlan.needsCritique`) — той самий гейт, що й послідовний
 * `buildApiSection`. Огляд критикується без анкор-блоку (№8: анкори лише в
 * Behavior, інакше критик «повертає» їх і вони дублюються).
 * @param {WaveState[]} files живі файли (вже після `assembleAndScore`)
 * @returns {Array<{customId: string, messages: Array<object>}>} entries хвилі C
 */
function waveCEntries(files) {
  const entries = []
  for (const f of files) {
    if (f.mode !== 'full') continue
    if (typeof f.overviewText === 'string') {
      entries.push({
        customId: `${f.file.sourcePath}::critique:overview`,
        messages: criticMessages('overview', f.overviewText, f.facts, null)
      })
    }
    if (f.apiPlan?.needsCritique && typeof f.apiGapDraft === 'string') {
      entries.push({
        customId: `${f.file.sourcePath}::critique:api`,
        messages: criticMessages('api', f.apiGapDraft, f.facts, f.anchors)
      })
    }
  }
  return entries
}

/**
 * Wave D: refine лише для секцій, де критика дала непорожній непусте
 * зауваження (не NONE, довжина ≥12) — той самий гейт, що й послідовний
 * `critiqueRefineSection`.
 * @param {WaveState[]} files живі файли
 * @param {Map<string, {ok?: string, error?: string}>} critiqueResults результати Wave C
 * @returns {Array<{customId: string, messages: Array<object>}>} entries хвилі D
 */
function waveDEntries(files, critiqueResults) {
  const entries = []
  for (const f of files) {
    if (f.mode !== 'full') continue
    for (const key of ['overview', 'api']) {
      const draft = key === 'overview' ? f.overviewText : f.apiGapDraft
      if (typeof draft !== 'string') continue
      const critiqueRaw = critiqueResults.get(`${f.file.sourcePath}::critique:${key}`)
      const critique = critiqueRaw?.ok?.trim()
      if (!critique || CRITIC_NONE_RE.test(critique) || critique.length < 12) continue
      const anchors = key === 'overview' ? null : f.anchors
      entries.push({
        customId: `${f.file.sourcePath}::refine:${key}`,
        messages: refineMessages(key, draft, critique, f.facts, anchors)
      })
    }
  }
  return entries
}

/**
 * Застосовує Wave D: заміщує `overviewText`/`apiGapDraft` очищеним
 * переписаним текстом, коли виклик успішний і непорожній. Провал refine-
 * виклику НЕ валить файл (той самий підхід, що й `critiqueRefineSection`:
 * при помилці лишається оригінальна чорнетка, не throw).
 * @param {WaveState[]} files живі файли
 * @param {Map<string, {ok?: string, error?: string}>} refineResults результати Wave D
 * @returns {void}
 */
function applyWaveD(files, refineResults) {
  for (const f of files) {
    if (f.mode !== 'full') continue
    const refinedOverview = refineResults.get(`${f.file.sourcePath}::refine:overview`)
    if (refinedOverview?.ok) {
      const cleaned = stripSignatures(stripSection(refinedOverview.ok))
      if (cleaned) f.overviewText = cleaned
    }
    const refinedApi = refineResults.get(`${f.file.sourcePath}::refine:api`)
    if (refinedApi?.ok) {
      const cleaned = stripSignatures(stripSection(refinedApi.ok))
      if (cleaned) f.apiGapDraft = cleaned
    }
  }
}

/**
 * Wave E: judge (опційно, `JUDGE_ENABLED`) — лише файли, чий det-score уже
 * пройшов поріг (там ховаються семантичні false-positives, той самий гейт,
 * що й послідовний `runJudgeGate`). `'full'` судить увесь зібраний документ;
 * `'comment+behavior'` — лише LLM-секцію behavior ([`behaviorOnlyDocument`]),
 * авторський header/API суддя не оцінює.
 * @param {WaveState[]} files живі файли (вже після фінального `assembleAndScore`)
 * @returns {Array<{customId: string, messages: Array<object>}>} entries хвилі E
 */
function waveEEntries(files) {
  if (!JUDGE_ENABLED) return []
  const entries = []
  for (const f of files) {
    if (f.score === null || f.score < QUALITY_THRESHOLD) continue
    if (f.mode === 'full') {
      entries.push({ customId: `${f.file.sourcePath}::judge`, messages: judgeMessages(f.src, f.md) })
    } else {
      const behaviorDoc = behaviorOnlyDocument(f.md)
      if (behaviorDoc)
        entries.push({ customId: `${f.file.sourcePath}::judge`, messages: judgeMessages(f.src, behaviorDoc) })
    }
  }
  return entries
}

/**
 * Застосовує Wave E: `judgeFailsDoc` → `degraded=true` і issue-маркер. На
 * відміну від послідовного `runJudgeGate`, тут немає №6 judge-refine
 * доретраю (свідоме спрощення фази 2, задокументоване в спеці — судді
 * достатньо ГЕЙТУВАТИ degraded, цикл виправлення лишається на послідовному шляху).
 * @param {WaveState[]} files живі файли
 * @param {Map<string, {ok?: string, error?: string}>} judgeResults результати Wave E
 * @returns {void}
 */
function applyWaveE(files, judgeResults) {
  for (const f of files) {
    const raw = judgeResults.get(`${f.file.sourcePath}::judge`)
    if (!raw) continue
    if (!raw.ok) {
      f.issues = [...f.issues, `judge:error: ${(raw.error ?? 'unknown').slice(0, 80)}`]
      continue
    }
    try {
      const verdict = parseDocVerdict(raw.ok)
      f.judge = { ...verdict, model: JUDGE_MODEL }
      if (judgeFailsDoc(verdict)) {
        f.issues = [...f.issues, `judge:inaccurate:${verdict.confidence}`]
        f.degraded = true
      }
    } catch (error) {
      f.issues = [...f.issues, `judge:error: ${error.message.slice(0, 80)}`]
    }
  }
}

/**
 * best-of-2 (E4, свідомо звужено до Wave A+B): для `'full'`-файлів, чий
 * det-score нижче порога, повторює behavior+overview з temperature 0.5 —
 * БЕЗ повторної critique/refine-хвилі (спрощення фази 2 з акцептом
 * `docs/specs/2026-07-27-batch-local-avg-real-batches.md`). Приймає ретрай
 * лише якщо його score вищий за перший прохід.
 * @param {WaveState[]} files живі `'full'`-файли нижче `QUALITY_THRESHOLD`
 * @param {(modelSpecOrTier: string, items: Array<object>, opts?: object) => Promise<Array<object>>} submitBatchImpl injectable submitBatch
 * @param {string} model model-spec батчу
 * @param {object} localProviders конфіг локальних провайдерів
 * @returns {Promise<void>}
 */
async function runBestOf2(files, submitBatchImpl, model, localProviders) {
  const candidates = files.filter(
    f => f.mode === 'full' && !f.failed && f.score !== null && f.score < QUALITY_THRESHOLD
  )
  if (candidates.length === 0) return
  for (const f of candidates) f.temperature = 0.5

  const original = candidates.map(f => ({
    md: f.md,
    score: f.score,
    issues: f.issues,
    behaviorText: f.behaviorText,
    apiGapDraft: f.apiGapDraft,
    overviewText: f.overviewText
  }))

  const waveA = await runWave(submitBatchImpl, model, waveAEntries(candidates), localProviders)
  applyWaveA(candidates, waveA)
  const waveB = await runWave(submitBatchImpl, model, waveBEntries(candidates), localProviders)
  applyWaveB(candidates, waveB)
  for (const f of candidates) if (!f.failed) assembleAndScore(f)

  for (const [i, f] of candidates.entries()) {
    const orig = original[i]
    if (f.failed || f.score === null || f.score <= orig.score) {
      Object.assign(f, {
        md: orig.md,
        score: orig.score,
        issues: [...orig.issues, 'best-of-2:retry-lost'],
        behaviorText: orig.behaviorText,
        apiGapDraft: orig.apiGapDraft,
        overviewText: orig.overviewText,
        failed: null
      })
    } else {
      f.issues = [...f.issues, 'best-of-2:retry-won']
    }
  }
}

/**
 * Пише готовий документ на диск і оновлює лічильники — той самий формат
 * штампу/рядка результату, що й `processBatchResult` в one-shot batch-шляху,
 * з міткою `(wave-batch)` замість `(2b-batch)`.
 * @param {WaveState} f фінальний wave-стан файлу
 * @param {{ model: string, tier: string|null, stats: object, out: (s: string) => void }} ctx модель/тир/акумулятор/логер
 * @returns {void}
 */
function finishWaveFile(f, { model, tier, stats, out }) {
  const crc = documentationCrc(f.sourceAbs, f.testIndex)
  mkdirSync(dirname(f.docAbs), { recursive: true })
  const quality = f.score === null ? null : { score: f.score, issues: f.degraded ? f.issues : [], judge: f.judge }
  writeFileSync(f.docAbs, stampDoc(f.md, f.file.sourcePath, crc, quality, model, tier))
  stats.ok++
  const prefix = `  ${f.file.sourcePath} [${fmtSize(f.size)}] `
  if (f.degraded) {
    stats.degraded++
    out(`${prefix}⚠ degraded score=${f.score} crc=${crc} (wave-batch)\n`)
  } else {
    out(`${prefix}✓ score=${f.score ?? '—'} crc=${crc} (wave-batch)\n`)
  }
}

/**
 * Точка входу фази 2: хвильовий batch-конвеєр для `'comment+behavior'`/`'full'`
 * елементів `docgen-files-batch` (`prepareBatchItem`-виходи, `mode !== 'comment-only'`
 * і `!facts.unsupported`) — `docgen-files-batch` продовжує сам обробляти
 * `'comment-only'` (0 LLM) і `unsupported` (незмінний one-shot batch-шлях).
 * @param {PreparedItem[]} prepared елементи для хвильової генерації
 * @param {{ model: string, tier?: string|null, localProviders?: object, submitBatchImpl?: (modelSpecOrTier: string, items: Array<object>, opts?: object) => Promise<Array<object>> }} opts модель/тир/local-providers/інжект submitBatch
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} stats акумулятор (мутується)
 * @param {{ out: (s: string) => void }} io логер рядка результату
 * @returns {Promise<void>}
 */
export async function runWaveBatch(prepared, opts, stats, { out }) {
  if (prepared.length === 0) return
  const model = opts.model
  const submitBatchImpl = opts.submitBatchImpl ?? submitBatchNative
  const localProviders = opts.localProviders ?? defaultLocalProviders()

  const files = await Promise.all(prepared.map(p => prepareWaveFile(p)))
  const alive = () => files.filter(f => !f.failed)

  const waveA = await runWave(submitBatchImpl, model, waveAEntries(alive()), localProviders)
  applyWaveA(alive(), waveA, stats, out)

  const waveB = await runWave(submitBatchImpl, model, waveBEntries(alive()), localProviders)
  applyWaveB(alive(), waveB, stats, out)

  for (const f of alive()) assembleAndScore(f)

  const waveC = await runWave(submitBatchImpl, model, waveCEntries(alive()), localProviders)
  const waveD = await runWave(submitBatchImpl, model, waveDEntries(alive(), waveC), localProviders)
  applyWaveD(alive(), waveD)

  for (const f of alive()) if (f.mode === 'full') assembleAndScore(f)

  if (opts.bestOf2 !== false) {
    await runBestOf2(alive(), submitBatchImpl, model, localProviders)
  }

  const waveE = await runWave(submitBatchImpl, JUDGE_MODEL, waveEEntries(alive()), localProviders)
  applyWaveE(alive(), waveE)

  for (const f of alive()) finishWaveFile(f, { model, tier: opts.tier ?? null, stats, out })
}
