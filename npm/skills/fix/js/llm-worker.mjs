/** @see ./docs/llm-worker.md */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'
import { resolveModel } from '../../../lib/models.mjs'

// Тир за замовчуванням: min → avg при ескалації (каскад local→cloud).
// Перевизначення через N_CURSOR_FIX_MODEL / N_CURSOR_FIX_MODEL_HEAVY.
export const MODEL = env.N_CURSOR_FIX_MODEL ?? resolveModel('min')
export const MODEL_HEAVY = env.N_CURSOR_FIX_MODEL_HEAVY ?? resolveModel('avg')

const JSON_CODE_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/

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
  const re = /(?:^|\s)(\.?[\w][\w./-]*\.(?:json|js|mjs|ts|vue|yml|yaml|toml|mdc|md|sh|py))(?::\d+)?/gm
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
 * Запускає pi і повертає stdout як рядок.
 * @param {string} prompt текст промпта
 * @param {string} model назва моделі (provider/id)
 * @returns {{ text: string, error?: string }} stdout pi або повідомлення про помилку
 */
function callPi(prompt, model) {
  const modelArgs = model ? ['--model', model] : []
  const r = spawnSync('pi', ['-p', prompt, ...modelArgs, '--no-session', '--mode', 'text', '--no-tools'], {
    encoding: 'utf8',
    timeout: 120_000
  })
  if (r.error) return { text: '', error: r.error.message }
  if (r.status !== 0) {
    const stderr = r.stderr?.slice(0, 300) ?? ''
    if (stderr.toLowerCase().includes('no api key') || stderr.toLowerCase().includes('api key')) {
      const provider = model ? model.split('/')[0] : 'дефолтного провайдера'
      return {
        text: '',
        error: [
          `pi: немає ключа для ${provider}.`,
          `Встановіть N_CLOUD_MIN_MODEL=provider/model-id`,
          `(напр.: openai/gpt-5.4-mini, google/gemini-2.5-flash, ollama/gemma3:4b)`,
        ].join(' ')
      }
    }
    return { text: '', error: `pi exit ${r.status}: ${stderr}` }
  }
  return { text: r.stdout?.trim() ?? '' }
}

/**
 * Парсить JSON-відповідь від pi.
 * pi може обгорнути JSON у ```json ... ```, тому пробуємо витягти.
 * @param {string} text сирий stdout pi
 * @returns {{ changes: Array<{path:string,content:string}>, error?: string } | null} розпарсений патч або null
 */
function parseResponse(text) {
  // Спроба 1: прямий JSON
  try {
    return JSON.parse(text)
  } catch {
    /* fallthrough */
  }

  // Спроба 2: витягти з ```json ... ```
  const m = text.match(JSON_CODE_BLOCK_RE)
  if (m) {
    try {
      return JSON.parse(m[1].trim())
    } catch {
      /* fallthrough */
    }
  }

  // Спроба 3: перший { ... } блок
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }

  return null
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
  const filePaths = extractFilePaths(violationOutput)
  const files = filePaths
    .map(p => {
      const abs = join(projectRoot, p)
      if (!existsSync(abs)) return null
      try {
        return { path: p, content: readFileSync(abs, 'utf8') }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  // 3. Будуємо prompt і викликаємо pi
  const prompt = buildPrompt(ruleId, ruleMdc, violationOutput, files)
  const { text, error: piError } = callPi(prompt, model)

  if (piError) return { ok: false, error: piError }
  if (!text) return { ok: false, error: 'pi returned empty response' }

  // 4. Парсимо відповідь
  const parsed = parseResponse(text)
  if (!parsed) return { ok: false, error: `cannot parse pi response: ${text.slice(0, 200)}` }
  if (parsed.error) return { ok: false, error: parsed.error }

  const changes = parsed.changes ?? []
  if (changes.length === 0) return { ok: false, error: 'pi returned no changes' }

  // 5. Застосовуємо зміни
  for (const change of changes) {
    if (!change.path || typeof change.content !== 'string') continue
    const abs = join(projectRoot, change.path)
    try {
      writeFileSync(abs, change.content, 'utf8')
    } catch (error) {
      return { ok: false, error: `write ${change.path}: ${error.message}` }
    }
  }

  return { ok: true }
}
