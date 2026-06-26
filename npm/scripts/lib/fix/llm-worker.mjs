/** @see ./docs/llm-worker.md */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'
import { callLlmRich } from '../../../lib/llm.mjs'
import { applyChanges, parseChangesResponse, readFilesForFix } from './llm-fix-apply.mjs'

// Дефолтна модель, коли викликач не задав `opts.model` (legacy/прямі виклики).
// Драбина ескалації (`orchestrator.mjs`) завжди передає модель рунга явно, тож
// тут лишається тільки fallback на min-тир. Перевизначення — `N_CURSOR_FIX_MODEL`.
const MODEL = env.N_CURSOR_FIX_MODEL ?? resolveModel('min')

// Бюджет thinking-токенів для omlx-моделей (Gemma 4 та ін., що підтримують thinking_budget).
// Значення 0 вимикає thinking. Перевизначення — `N_CURSOR_OMLX_THINKING_BUDGET`.
const DEFAULT_THINKING_BUDGET = Number(env.N_CURSOR_OMLX_THINKING_BUDGET ?? 4096)

const API_KEY_RE = /api key/i

const FILE_EXTS = 'json|js|mjs|ts|vue|yml|yaml|toml|mdc|md|sh|py'

/**
 * Каталог `npm/rules/` у пакеті — для вибору sub-check .mdc.
 * Шлях: <package>/npm/scripts/lib/fix/ → ../../.. → npm/ → rules/.
 */
const PACKAGE_RULES_DIR = join(import.meta.dirname, '..', '..', '..', 'rules')

/**
 * Витягує шляхи файлів лише з рядків ❌ у violation output.
 * Без workspace-розгортання — повертає bare path для звірки з target.json.
 * @param {string} output violation output
 * @returns {string[]} унікальні шляхи з ❌-рядків
 */
function extractFailPaths(output) {
  const seen = new Set()
  const add = p => {
    seen.add(p)
  }
  const failSep = `(?::\\d+)?(?::\\s|[\\s—]|$)`
  // ❌ [ws] path/file.ext → strip workspace, зберігаємо bare file
  const failWsRe = new RegExp(`^\\s*❌\\s+\\[[\\w-]+\\]\\s+([\\w./][\\w./-]*\\.(?:${FILE_EXTS}))${failSep}`, 'gm')
  for (const m of output.matchAll(failWsRe)) add(m[1])
  const failRe = new RegExp(`^\\s*❌\\s+(\\.?[\\w][\\w./-]*\\.(?:${FILE_EXTS}))${failSep}`, 'gm')
  for (const m of output.matchAll(failRe)) add(m[1])
  return [...seen]
}

/**
 * Збирає .mdc-контекст правила з двох джерел у пакеті (`PACKAGE_RULES_DIR`):
 *   - `js/<check>.mdc`      — описи check-логіки (завжди всі, відсортовані за іменем);
 *   - `policy/<c>/<c>.mdc` — concern-специфічний контент: вибираємо лише ті concern/.mdc,
 *                         чий `target.json → files.single` збігається з failing paths
 *                         у violation output; якщо жоден не збігається — включаємо всі.
 * @param {string} ruleId ID правила
 * @param {string} violationOutput violation output
 * @returns {string|null} конкатенація зібраних .mdc або null, якщо нічого не знайдено
 */
function readRuleMdc(ruleId, violationOutput) {
  const ruleDir = join(PACKAGE_RULES_DIR, ruleId)
  const parts = []

  // 1. js/**/*.mdc — завжди всі
  const jsDir = join(ruleDir, 'js')
  if (existsSync(jsDir)) {
    let jsFiles
    try {
      jsFiles = readdirSync(jsDir)
        .filter(f => f.endsWith('.mdc'))
        .sort()
    } catch {
      jsFiles = []
    }
    for (const f of jsFiles) parts.push(readFileSync(join(jsDir, f), 'utf8').trim())
  }

  // 2. policy/**/*.mdc — matched через target.json; fallback — всі
  const policyDir = join(ruleDir, 'policy')
  if (existsSync(policyDir)) {
    const failPaths = extractFailPaths(violationOutput)
    let concerns
    try {
      concerns = readdirSync(policyDir, { withFileTypes: true })
    } catch {
      concerns = []
    }

    const all = []
    const matched = []
    for (const entry of concerns) {
      if (!entry.isDirectory()) continue
      const concernDir = join(policyDir, entry.name)
      const mdcEntry = readdirSync(concernDir).find(f => f.endsWith('.mdc'))
      if (!mdcEntry) continue
      const content = readFileSync(join(concernDir, mdcEntry), 'utf8').trim()
      all.push(content)

      const targetPath = join(concernDir, 'target.json')
      if (!existsSync(targetPath)) continue
      let target
      try {
        target = JSON.parse(readFileSync(targetPath, 'utf8'))
      } catch {
        continue
      }
      const targetFile = target?.files?.single
      if (!targetFile) continue
      if (failPaths.some(p => p === targetFile || p.endsWith(`/${targetFile}`))) matched.push(content)
    }

    parts.push(...(matched.length > 0 ? matched : all))
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

/**
 * Витягує відносні шляхи файлів із violation output.
 * Розуміє workspace-prefix: `[npm] skills/foo.mjs` → `npm/skills/foo.mjs`.
 * Спочатку явно парсить рядки ❌ (найвищий сигнал — файл потребує фіксу),
 * потім підхоплює решту файлів generic-regex (контекст для читання).
 * @param {string} output violation output з fix check
 * @returns {string[]} унікальні відносні шляхи (від кореня проєкту)
 */
export function extractFilePaths(output) {
  const seen = new Set()
  const results = []
  const add = p => {
    if (!seen.has(p)) {
      seen.add(p)
      results.push(p)
    }
  }

  // 1. Явні рядки ❌ — найвищий сигнал: саме ці файли потребують фіксу.
  //    Формати: `❌ [ws] path/file.ext:line — msg` та `❌ path/file.ext: msg`
  //    Роздільник після шляху: `:` (з пробілом або цифрою), `—` (em-dash), або кінець рядка.
  const failSep = `(?::\\d+)?(?::\\s|[\\s—]|$)`
  const failWsRe = new RegExp(`^\\s*❌\\s+\\[([\\w-]+)\\]\\s+([\\w./][\\w./-]*\\.(?:${FILE_EXTS}))${failSep}`, 'gm')
  for (const m of output.matchAll(failWsRe)) add(`${m[1]}/${m[2]}`)

  const failRe = new RegExp(`^\\s*❌\\s+(\\.?[\\w][\\w./-]*\\.(?:${FILE_EXTS}))${failSep}`, 'gm')
  for (const m of output.matchAll(failRe)) add(m[1])

  // 2. Generic-regex: підхоплює файли з ✅-рядків та описів (контекст для читання).
  //    Workspace: [npm] skills/foo.mjs
  const wsRe = new RegExp(`\\[([\\w-]+)\\]\\s+([\\w./][\\w./-]*\\.(?:${FILE_EXTS}))(?::\\d+)?`, 'gm')
  for (const m of output.matchAll(wsRe)) add(`${m[1]}/${m[2]}`)

  //    Без workspace: path/to/file.ext або ./file.ext
  const re = new RegExp(`(?:^|\\s)(\\.?\\w[\\w./-]*\\.(?:${FILE_EXTS}))(?::\\d+)?`, 'gm')
  for (const m of output.matchAll(re)) add(m[1])

  return results
}

/**
 * Будує prompt для pi: правило + порушення + поточний вміст файлів.
 * Будує опційний feedback-блок драбини ескалації: попередній рунг застосував
 * зміни, але re-check лишився червоним. Просимо модель спершу (в полі `diagnosis`)
 * сформулювати, **чому** попередня спроба не задовольнила правило, тоді виправити.
 * @param {{ previousModel?: string, previousChanges?: Array<{path:string}>, previousError?: string|null } | null} feedback контекст попереднього рунга
 * @returns {string[]} рядки prompt-блоку (порожній масив, якщо feedback немає)
 */
function buildFeedbackBlock(feedback) {
  if (!feedback) return []
  const changedPaths = (feedback.previousChanges ?? []).map(c => c.path).filter(Boolean)
  return [
    ``,
    `A PREVIOUS attempt (model: ${feedback.previousModel || 'pi'}) did NOT resolve this violation.`,
    changedPaths.length > 0
      ? `Previously changed files: ${changedPaths.join(', ')}`
      : `The previous attempt produced no usable changes.`,
    feedback.previousError ? `Previous attempt error: ${feedback.previousError}` : ``,
    `The violation output below is what STILL fails after that attempt.`,
    `In the "diagnosis" field, briefly state WHY the previous attempt failed, then provide a corrected fix.`
  ].filter(line => line !== ``)
}

/**
 * @param {string} ruleId ID правила
 * @param {string} ruleMdc   вміст .mdc-файлу правила
 * @param {string} output    violation output
 * @param {Array<{path:string, content:string}>} files прочитані файли (path + content)
 * @param {{ previousModel?: string, previousChanges?: Array<{path:string}>, previousError?: string|null } | null} [feedback] контекст попереднього рунга драбини (для retry-with-feedback)
 * @returns {string} текст промпта для pi
 */
function buildPrompt(ruleId, ruleMdc, output, files, feedback = null) {
  const filesBlock =
    files.length === 0
      ? '(no files identified)'
      : files.map(f => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n')

  return [
    `You fix project structure violations. Return ONLY valid JSON — no explanation, no markdown.`,
    ...buildFeedbackBlock(feedback),
    ``,
    `Rule (n-${ruleId}.mdc):`,
    `---`,
    ruleMdc,
    `---`,
    ``,
    `Violation output:`,
    output,
    ``,
    `Current file contents:`,
    filesBlock,
    ``,
    `Return JSON with this exact shape:`,
    `{"diagnosis":"short reason the rule fails (or why prior attempt failed); empty string if first attempt","changes":[{"path":"relative/path/to/file","content":"full corrected file content"}]}`,
    ``,
    `Rules:`,
    `- "path" is relative to the project root`,
    `- "content" is the complete new file content (not a diff)`,
    `- Only include files that actually need to change`,
    `- "diagnosis" is plain text inside the JSON — do NOT emit prose outside the JSON`,
    `- If nothing can be fixed automatically, return {"diagnosis":"...","changes":[],"error":"reason"}`
  ].join('\n')
}

/**
 * Викликає LLM через `callLlmRich` (маршрут за префіксом model-id; wire-trace).
 * Повертає reasoning поряд із текстом — для verbose-блоку оркестратора.
 * Зберігає дружнє повідомлення про відсутній API-ключ для хмарних провайдерів.
 * @param {string} prompt текст промпта
 * @param {string} model назва моделі (provider/id, `omlx/...` або '')
 * @param {string} caller мітка викликача для wire-trace (`fix:<rule>:<rung>`)
 * @param {number} [timeoutMs] ліміт виклику (драбина задає per-tier; undefined → дефолт callLlmRich)
 * @param {number} [thinkingBudget] бюджет thinking-токенів (лише omlx; 0 = вимкнено)
 * @returns {{ text: string, reasoning: string|null, reasoningSource: string|null, error?: string }}
 */
function callModel(prompt, model, caller, timeoutMs, thinkingBudget) {
  try {
    const { content, reasoning, reasoningSource } = callLlmRich([{ role: 'user', content: prompt }], model, {
      timeoutMs,
      caller,
      thinkingBudget
    })
    return { text: content, reasoning, reasoningSource }
  } catch (error) {
    const msg = String(error.message)
    if (API_KEY_RE.test(msg)) {
      const provider = model ? model.split('/')[0] : 'дефолтного провайдера'
      return {
        text: '',
        reasoning: null,
        reasoningSource: null,
        error: [
          `pi: немає ключа для ${provider}.`,
          `Встановіть N_CLOUD_MIN_MODEL=provider/model-id`,
          `(напр.: openai/gpt-5.4-mini, google/gemini-2.5-flash, ollama/gemma3:4b)`
        ].join(' ')
      }
    }
    return { text: '', reasoning: null, reasoningSource: null, error: msg }
  }
}

/**
 * LLM-worker: виправляє одне rule-порушення через pi (C1 pattern).
 * Повертає `changes`/`diagnosis` навіть при невдачі — драбина ескалації
 * (`orchestrator.mjs`) логує їх і прокидає як feedback у наступний рунг.
 * Поля `reasoning`/`reasoningSource`/`promptSummary` використовує оркестратор
 * для verbose-блоку після кожного рунга (`--full` режим).
 * @param {string} ruleId ID правила
 * @param {string} violationOutput  output з fix check для цього rule
 * @param {string} projectRoot      абсолютний шлях до кореня проєкту
 * @param {{ model?: string, feedback?: object|null, caller?: string, timeoutMs?: number, thinkingBudget?: number }} opts опції:
 *   `model` — перевизначення моделі; `feedback` — контекст попереднього рунга
 *   драбини (retry-with-feedback); `caller` — мітка для wire-trace; `timeoutMs` —
 *   per-tier ліміт виклику (драбина: локалі fail-fast, хмара повний);
 *   `thinkingBudget` — кількість thinking-токенів для omlx (дефолт `DEFAULT_THINKING_BUDGET`).
 *   `timeoutMs` — per-tier ліміт: локальні 300s (4b повільна, backstop — turn-ceiling), хмарні 120s.
 * @returns {{ ok: boolean, error?: string, changes: Array<{path:string}>, diagnosis: string|null, reasoning: string|null, reasoningSource: string|null, promptSummary: object }}
 */
export function runLlmWorker(ruleId, violationOutput, projectRoot, opts = {}) {
  const model = opts.model ?? MODEL
  const feedback = opts.feedback ?? null
  const caller = opts.caller ?? 'fix'
  const timeoutMs = opts.timeoutMs
  const thinkingBudget = opts.thinkingBudget ?? DEFAULT_THINKING_BUDGET

  // 1. Читаємо rule .mdc з джерела пакету: js/**/*.mdc + policy/**/*.mdc.
  const ruleMdc = readRuleMdc(ruleId, violationOutput) ?? '(rule file not found)'

  // 2. Витягуємо файли з violation output і читаємо їх
  const files = readFilesForFix(extractFilePaths(violationOutput), projectRoot)

  // 3. Будуємо summary промпту (для verbose-блоку) до виклику моделі
  const promptSummary = {
    ruleMdcLen: ruleMdc.length,
    violationLen: violationOutput.length,
    filesCount: files.length,
    filesTotalBytes: files.reduce((s, f) => s + f.content.length, 0),
    hasFeedback: !!feedback,
    feedbackModel: feedback?.previousModel ?? null,
    feedbackChangesCount: feedback?.previousChanges?.length ?? 0,
    feedbackError: feedback?.previousError ?? null
  }

  // 4. Будуємо prompt і викликаємо модель
  const prompt = buildPrompt(ruleId, ruleMdc, violationOutput, files, feedback)
  const {
    text,
    error: modelError,
    reasoning,
    reasoningSource
  } = callModel(prompt, model, caller, timeoutMs, thinkingBudget)

  if (modelError)
    return { ok: false, error: modelError, changes: [], diagnosis: null, reasoning, reasoningSource, promptSummary }
  if (!text)
    return {
      ok: false,
      error: 'model returned empty response',
      changes: [],
      diagnosis: null,
      reasoning,
      reasoningSource,
      promptSummary
    }

  // 5. Парсимо відповідь
  const parsed = parseChangesResponse(text)
  if (!parsed) {
    return {
      ok: false,
      error: `cannot parse pi response: ${text.slice(0, 200)}`,
      changes: [],
      diagnosis: null,
      reasoning,
      reasoningSource,
      promptSummary
    }
  }
  const diagnosis = typeof parsed.diagnosis === 'string' && parsed.diagnosis ? parsed.diagnosis : null
  const changes = parsed.changes ?? []
  if (parsed.error)
    return { ok: false, error: parsed.error, changes, diagnosis, reasoning, reasoningSource, promptSummary }
  if (changes.length === 0)
    return { ok: false, error: 'pi returned no changes', changes, diagnosis, reasoning, reasoningSource, promptSummary }

  // 6. Застосовуємо зміни
  const applied = applyChanges(changes, projectRoot)
  return { ...applied, changes, diagnosis, reasoning, reasoningSource, promptSummary }
}
