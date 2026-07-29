/**
 * LLM-довизначення потреби в тестах для непокритого файлу (fix-шлях концерну
 * `coverage` правила `test`, команда \`npx \@7n/rules lint test\`).
 *
 * Швидка локальна евристика (`quickClassify`, спільна з делта-гейтом) відсіює
 * очевидні випадки — LLM викликається лише для неоднозначних файлів, ОДНИМ
 * `submitBatch`-викликом на всі неоднозначні файли разом (уніфікація на
 * `@7n/llm-lib/batch`, спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`,
 * кластер E) замість конкурентного `Promise.all` окремих one-shot-викликів.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { submitBatch as submitBatchNative } from '@7n/llm-lib/batch'
import { defaultLocalProviders } from '@7n/llm-lib/local-providers'
import { CLOUD_MIN, LOCAL_MIN } from '@7n/llm-lib/model-tiers'
import { quickClassify } from '../lib/quick-classify.mjs'

const MAX_CONTENT_BYTES = 6000

const SYSTEM_PROMPT = `You are a test-need classifier for JS/TS source files.

Given a source file with low test coverage, decide if unit tests are worthwhile.

Reply ONLY with a JSON object (no markdown fence):
{"needsTests": true|false, "reason": "one sentence in Ukrainian"}

needsTests: false when:
- File only contains types, interfaces, constants, or re-exports with no logic
- Thin config or index file that just wires up other modules
- Behavior is fully covered by integration/e2e tests (name them)

needsTests: true when:
- File contains utility functions, parsers, transformers with branches
- Business logic with conditions or non-trivial contracts
- Pure functions that can be unit-tested cheaply`

const FALLBACK = { needsTests: true, reason: 'оцінка не вдалась — вважаємо що потрібні тести' }

/**
 * Витягує підрядок від першої `{` до останньої `}` — кандидат JSON-обʼєкта
 * відповіді моделі (без regex — уникаємо super-linear backtracking).
 * @param {string} text відповідь моделі
 * @returns {string|null} кандидат JSON або null
 */
function extractJsonCandidate(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  return candidate.includes('"needsTests"') ? candidate : null
}

/**
 * Парсить сиру відповідь моделі у вердикт. Кидає на структурно невалідному
 * JSON (кандидат є, але не парситься) — caller (batch-каскад) трактує це як
 * невдачу тиру й іде на наступний тир/fallback.
 * @param {string} raw сира відповідь моделі
 * @returns {{needsTests: boolean, reason: string}} вердикт
 */
function parseVerdict(raw) {
  const parsed = JSON.parse(extractJsonCandidate(raw) ?? '{}')
  return { needsTests: parsed.needsTests !== false, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
}

/**
 * Один item черги: файл-кандидат на LLM-оцінку разом із готовим промптом.
 * @typedef {{ fileInfo: {file: string, pct: number}, prompt: string }} PendingItem
 */

/**
 * Розділяє файли на готові вердикти (файл недоступний / `quickClassify`
 * вирішив локально) і чергу на LLM (неоднозначні, з уже зібраним промптом).
 * @param {Array<{file: string, pct: number}>} files непокриті файли
 * @param {string} dir корінь проєкту
 * @returns {{ verdicts: Array<object|null>, pending: PendingItem[] }} вердикти (з `null`-заповнювачами для `pending`) і черга на LLM
 */
function prepareQueue(files, dir) {
  const verdicts = []
  const pending = []
  for (const fileInfo of files) {
    const absPath = join(dir, fileInfo.file)
    if (!existsSync(absPath)) {
      verdicts.push({ ...fileInfo, needsTests: false, reason: 'файл недоступний' })
      continue
    }

    const rawContent = readFileSync(absPath, 'utf8')
    const quick = quickClassify(rawContent)
    if (quick !== null) {
      verdicts.push({ ...fileInfo, ...quick })
      continue
    }

    let content = rawContent
    if (content.length > MAX_CONTENT_BYTES) content = content.slice(0, MAX_CONTENT_BYTES) + '\n...(truncated)'
    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      `## File: ${fileInfo.file} (current coverage: ${fileInfo.pct.toFixed(1)}%)\n\n` +
      `\`\`\`\n${content}\n\`\`\``
    pending.push({ fileInfo, prompt })
    verdicts.push(null) // заповнюється після batch-хвиль
  }
  return { verdicts, pending }
}

/**
 * Одна batch-хвиля: `submitBatch(model, items)` на всі `items` разом. Провал
 * САМОГО виклику хвилі не кидає далі — порожня мапа трактується як "усі items
 * цієї хвилі невдалі", той самий graceful-degradation принцип, що й у
 * `test/coverage/lib/classify`.
 * @param {PendingItem[]} items items хвилі
 * @param {string} model model-spec тиру — порожній рядок пропускає хвилю
 * @param {object} localProviders конфіг локальних провайдерів
 * @param {(model: string, items: Array<object>, opts?: object) => Promise<Array<object>>} submitBatchImpl injectable submitBatch (тест/прод)
 * @returns {Promise<Map<string, {ok?: string, error?: string}>>} результати за `customId` (`fileInfo.file`)
 */
async function runWave(items, model, localProviders, submitBatchImpl) {
  if (items.length === 0 || !model) return new Map()
  try {
    const results = await submitBatchImpl(
      model,
      items.map(i => ({ customId: i.fileInfo.file, prompt: i.prompt })),
      {
        localProviders
      }
    )
    return new Map(results.map(r => [r.customId, r]))
  } catch {
    return new Map()
  }
}

/**
 * Оцінює список непокритих файлів: чи потрібні їм тести.
 * Очевидні випадки (реекспорти, функції з розгалуженнями) вирішуються локально;
 * неоднозначні йдуть ОДНОЮ batch-хвилею на tier1, ті, чию відповідь не вдалось
 * розпарсити, — другою хвилею на tier2, решта — conservative fallback.
 * @param {Array<{file: string, pct: number}>} files непокриті файли
 * @param {string} dir корінь проєкту
 * @param {{ tier1?: string, tier2?: string, localProviders?: object,
 *   submitBatchImpl?: (model: string, items: Array<object>, opts?: object) => Promise<Array<object>> }} [opts]
 *   `tier1`/`tier2` — явні model-specs (дефолт: `LOCAL_MIN`/`CLOUD_MIN`); `submitBatchImpl` — інʼєкція `submitBatch` (тест)
 * @returns {Promise<Array<{file: string, pct: number, needsTests: boolean, reason: string}>>} вердикти по файлах, у вхідному порядку
 */
export async function assessNeed(files, dir, opts = {}) {
  const submitBatchImpl = opts.submitBatchImpl ?? submitBatchNative
  const tier1 = opts.tier1 ?? LOCAL_MIN
  const tier2 = opts.tier2 ?? CLOUD_MIN
  const localProviders = opts.localProviders ?? defaultLocalProviders()

  const { verdicts, pending } = prepareQueue(files, dir)
  if (pending.length === 0) return verdicts

  const tier1Results = await runWave(pending, tier1, localProviders, submitBatchImpl)
  const tier1Failed = []
  const resolved = new Map()
  for (const item of pending) {
    const r = tier1Results.get(item.fileInfo.file)
    if (r?.ok) {
      try {
        resolved.set(item.fileInfo.file, parseVerdict(r.ok))
        continue
      } catch {
        // невалідний вихід tier1 → кандидат на tier2 нижче
      }
    }
    tier1Failed.push(item)
  }

  if (tier1Failed.length > 0) {
    const tier2Results = await runWave(tier1Failed, tier2, localProviders, submitBatchImpl)
    for (const item of tier1Failed) {
      const r = tier2Results.get(item.fileInfo.file)
      if (r?.ok) {
        try {
          resolved.set(item.fileInfo.file, parseVerdict(r.ok))
          continue
        } catch {
          // впало і на tier2 → fallback нижче
        }
      }
      resolved.set(item.fileInfo.file, FALLBACK)
    }
  }

  let pendingCursor = 0
  return verdicts.map(v => {
    if (v !== null) return v
    const item = pending[pendingCursor++]
    return { ...item.fileInfo, ...resolved.get(item.fileInfo.file) }
  })
}
