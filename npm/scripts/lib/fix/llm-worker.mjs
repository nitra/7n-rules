/** @see ./docs/llm-worker.md */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'
import { callLlm } from '../../../lib/llm.mjs'
import { applyChanges, parseChangesResponse, readFilesForFix } from './llm-fix-apply.mjs'

// Тир за замовчуванням: min → avg при ескалації (каскад local→cloud).
// Перевизначення через N_CURSOR_FIX_MODEL / N_CURSOR_FIX_MODEL_HEAVY.
export const MODEL = env.N_CURSOR_FIX_MODEL ?? resolveModel('min')
export const MODEL_HEAVY = env.N_CURSOR_FIX_MODEL_HEAVY ?? resolveModel('avg')

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
 * @param {string} ruleId ID правила
 * @param {string} ruleMdc   вміст .mdc-файлу правила
 * @param {string} output    violation output
 * @param {Array<{path:string, content:string}>} files прочитані файли (path + content)
 * @returns {string} текст промпта для pi
 */
function buildPrompt(ruleId, ruleMdc, output, files) {
  const filesBlock =
    files.length === 0
      ? '(no files identified)'
      : files.map(f => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n')

  return [
    `You fix project structure violations. Return ONLY valid JSON — no explanation, no markdown.`,
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
    `{"changes":[{"path":"relative/path/to/file","content":"full corrected file content"}]}`,
    ``,
    `Rules:`,
    `- "path" is relative to the project root`,
    `- "content" is the complete new file content (not a diff)`,
    `- Only include files that actually need to change`,
    `- If nothing can be fixed automatically, return {"changes":[],"error":"reason"}`
  ].join('\n')
}

/**
 * Викликає LLM через спільний `callLlm` (маршрут за префіксом model-id; wire-trace).
 * Зберігає дружнє повідомлення про відсутній API-ключ для хмарних провайдерів.
 * @param {string} prompt текст промпта
 * @param {string} model назва моделі (provider/id, `omlx/...` або '')
 * @returns {{ text: string, error?: string }} текст відповіді або повідомлення про помилку
 */
function callModel(prompt, model) {
  try {
    return { text: callLlm([{ role: 'user', content: prompt }], model, { timeoutMs: 120_000, caller: 'fix' }) }
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
 * @param {string} ruleId ID правила
 * @param {string} violationOutput  output з fix check для цього rule
 * @param {string} projectRoot      абсолютний шлях до кореня проєкту
 * @param {{ model?: string }} opts опції (model — перевизначення моделі)
 * @returns {Promise<{ ok: boolean, error?: string }>} статус виправлення і можлива помилка
 */
export function runLlmWorker(ruleId, violationOutput, projectRoot, opts = {}) {
  const model = opts.model ?? MODEL

  // 1. Читаємо rule .mdc
  const mdcPath = join(projectRoot, '.cursor', 'rules', `n-${ruleId}.mdc`)
  const ruleMdc = existsSync(mdcPath) ? readFileSync(mdcPath, 'utf8') : '(rule file not found)'

  // 2. Витягуємо файли з violation output і читаємо їх
  const files = readFilesForFix(extractFilePaths(violationOutput), projectRoot)

  // 3. Будуємо prompt і викликаємо модель
  const prompt = buildPrompt(ruleId, ruleMdc, violationOutput, files)
  const { text, error: modelError } = callModel(prompt, model)

  if (modelError) return { ok: false, error: modelError }
  if (!text) return { ok: false, error: 'model returned empty response' }

  // 4. Парсимо відповідь
  const parsed = parseChangesResponse(text)
  if (!parsed) return { ok: false, error: `cannot parse pi response: ${text.slice(0, 200)}` }
  if (parsed.error) return { ok: false, error: parsed.error }

  const changes = parsed.changes ?? []
  if (changes.length === 0) return { ok: false, error: 'pi returned no changes' }

  // 5. Застосовуємо зміни
  return applyChanges(changes, projectRoot)
}
