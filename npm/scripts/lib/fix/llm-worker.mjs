/** @see ./docs/llm-worker.md */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'
import { callLlm } from '../../../lib/llm.mjs'
import { applyChanges, parseChangesResponse, readFilesForFix } from './llm-fix-apply.mjs'

// Дефолтна модель, коли викликач не задав `opts.model` (legacy/прямі виклики).
// Драбина ескалації (`orchestrator.mjs`) завжди передає модель рунга явно, тож
// тут лишається тільки fallback на min-тир. Перевизначення — `N_CURSOR_FIX_MODEL`.
const MODEL = env.N_CURSOR_FIX_MODEL ?? resolveModel('min')

const API_KEY_RE = /api key/i

/**
 * Витягує відносні шляхи файлів із violation output.
 * Розуміє workspace-prefix: `[npm] skills/foo.mjs` → `npm/skills/foo.mjs`.
 * @param {string} output violation output з fix check
 * @returns {string[]} унікальні відносні шляхи (від кореня проєкту)
 */
function extractFilePaths(output) {
  const seen = new Set()
  const results = []

  // Патерн з workspace: [npm] skills/foo.mjs або [demo] src/bar.ts
  const wsRe = /\[([\w-]+)\]\s+([\w./][\w./-]*\.(?:json|js|mjs|ts|vue|yml|yaml|toml|mdc|md|sh|py))(?::\d+)?/gm
  for (const m of output.matchAll(wsRe)) {
    const p = `${m[1]}/${m[2]}`
    if (!seen.has(p)) {
      seen.add(p)
      results.push(p)
    }
  }

  // Патерн без workspace: просто path/to/file.ext або ./file.ext
  const re = /(?:^|\s)(\.?\w[\w./-]*\.(?:json|js|mjs|ts|vue|yml|yaml|toml|mdc|md|sh|py))(?::\d+)?/gm
  for (const m of output.matchAll(re)) {
    const p = m[1]
    if (!seen.has(p)) {
      seen.add(p)
      results.push(p)
    }
  }

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
 * Викликає LLM через спільний `callLlm` (маршрут за префіксом model-id; wire-trace).
 * Зберігає дружнє повідомлення про відсутній API-ключ для хмарних провайдерів.
 * @param {string} prompt текст промпта
 * @param {string} model назва моделі (provider/id, `omlx/...` або '')
 * @param {string} caller мітка викликача для wire-trace (`fix:<rule>:<rung>`)
 * @param {number} [timeoutMs] ліміт виклику (драбина задає per-tier; undefined → дефолт callLlm)
 * @returns {{ text: string, error?: string }} текст відповіді або повідомлення про помилку
 */
function callModel(prompt, model, caller, timeoutMs) {
  try {
    return { text: callLlm([{ role: 'user', content: prompt }], model, { timeoutMs, caller }) }
  } catch (error) {
    const msg = String(error.message)
    if (API_KEY_RE.test(msg)) {
      const provider = model ? model.split('/')[0] : 'дефолтного провайдера'
      return {
        text: '',
        error: [
          `pi: немає ключа для ${provider}.`,
          `Встановіть N_CLOUD_MIN_MODEL=provider/model-id`,
          `(напр.: openai/gpt-5.4-mini, google/gemini-2.5-flash, ollama/gemma3:4b)`
        ].join(' ')
      }
    }
    return { text: '', error: msg }
  }
}

/**
 * LLM-worker: виправляє одне rule-порушення через pi (C1 pattern).
 * Повертає `changes`/`diagnosis` навіть при невдачі — драбина ескалації
 * (`orchestrator.mjs`) логує їх і прокидає як feedback у наступний рунг.
 * @param {string} ruleId ID правила
 * @param {string} violationOutput  output з fix check для цього rule
 * @param {string} projectRoot      абсолютний шлях до кореня проєкту
 * @param {{ model?: string, feedback?: object|null, caller?: string, timeoutMs?: number }} opts опції:
 *   `model` — перевизначення моделі; `feedback` — контекст попереднього рунга
 *   драбини (retry-with-feedback); `caller` — мітка для wire-trace; `timeoutMs` —
 *   per-tier ліміт виклику (драбина: локалі fail-fast, хмара повний)
 * @returns {{ ok: boolean, error?: string, changes: Array<{path:string}>, diagnosis: string|null }}
 *   статус виправлення, помилка, запропоновані зміни і само-аналіз моделі
 */
export function runLlmWorker(ruleId, violationOutput, projectRoot, opts = {}) {
  const model = opts.model ?? MODEL
  const feedback = opts.feedback ?? null
  const caller = opts.caller ?? 'fix'
  const timeoutMs = opts.timeoutMs

  // 1. Читаємо rule .mdc
  const mdcPath = join(projectRoot, '.cursor', 'rules', `n-${ruleId}.mdc`)
  const ruleMdc = existsSync(mdcPath) ? readFileSync(mdcPath, 'utf8') : '(rule file not found)'

  // 2. Витягуємо файли з violation output і читаємо їх
  const files = readFilesForFix(extractFilePaths(violationOutput), projectRoot)

  // 3. Будуємо prompt і викликаємо модель
  const prompt = buildPrompt(ruleId, ruleMdc, violationOutput, files, feedback)
  const { text, error: modelError } = callModel(prompt, model, caller, timeoutMs)

  if (modelError) return { ok: false, error: modelError, changes: [], diagnosis: null }
  if (!text) return { ok: false, error: 'model returned empty response', changes: [], diagnosis: null }

  // 4. Парсимо відповідь
  const parsed = parseChangesResponse(text)
  if (!parsed) {
    return { ok: false, error: `cannot parse pi response: ${text.slice(0, 200)}`, changes: [], diagnosis: null }
  }
  const diagnosis = typeof parsed.diagnosis === 'string' && parsed.diagnosis ? parsed.diagnosis : null
  const changes = parsed.changes ?? []
  if (parsed.error) return { ok: false, error: parsed.error, changes, diagnosis }
  if (changes.length === 0) return { ok: false, error: 'pi returned no changes', changes, diagnosis }

  // 5. Застосовуємо зміни
  const applied = applyChanges(changes, projectRoot)
  return { ...applied, changes, diagnosis }
}
