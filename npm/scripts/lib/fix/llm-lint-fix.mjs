/**
 * Per-tool omlx-фікс лінтер-знахідок (point 4 спеки lint-orchestrator-fix-readonly).
 *
 * Для detect-only тулів без нативного `--fix` (cspell, knip, actionlint, v8r тощо): читає
 * уражені файли, просить omlx виправити за tool-специфічною інструкцією, застосовує `{changes}`.
 * Re-detect (перевірка, що знахідка закрита) — на стороні caller (convergence-патерн).
 *
 * Маршрут моделі — через `callLlm` за префіксом: `omlx/<model>` → локальний HTTP (дефолт
 * `resolveModel('min')`); cloud — фолбек каскаду. Парс/застосування — спільне ядро `llm-fix-apply`.
 */
import { env } from 'node:process'

import { resolveModel } from '../../../lib/models.mjs'
import { callLlm } from '../../../lib/llm.mjs'
import { applyChanges, parseChangesResponse, readFilesForFix } from './llm-fix-apply.mjs'

/** Дефолтний локальний тир (omlx); env `N_CURSOR_FIX_MODEL` перекриває. */
const DEFAULT_MODEL = env.N_CURSOR_FIX_MODEL ?? resolveModel('min')

/**
 * Будує prompt для omlx: tool-інструкція + знахідки + повний вміст файлів.
 * @param {string} tool назва тула (cspell/knip/…)
 * @param {string} instruction що саме виправити (tool-специфічно)
 * @param {string} findings сирий вивід тула (знахідки)
 * @param {Array<{path:string, content:string}>} files файли під фікс
 * @returns {string} prompt
 */
function buildLintFixPrompt(tool, instruction, findings, files) {
  const filesBlock = files.map(f => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n')
  return [
    `You fix ${tool} lint findings. Return ONLY valid JSON — no explanation, no markdown.`,
    ``,
    `Task: ${instruction}`,
    ``,
    `${tool} findings:`,
    findings,
    ``,
    `Current file contents:`,
    filesBlock,
    ``,
    `Return JSON with this exact shape:`,
    `{"changes":[{"path":"relative/path","content":"full corrected file content"}]}`,
    ``,
    `Rules:`,
    `- "path" is relative to the project root (use the path from the <file> tag)`,
    `- "content" is the COMPLETE new file content (not a diff)`,
    `- Only include files that actually need to change; preserve everything unrelated verbatim`,
    `- If nothing should be auto-fixed, return {"changes":[],"error":"reason"}`
  ].join('\n')
}

/**
 * Виправляє лінтер-знахідки через omlx і застосовує зміни.
 * @param {{ tool:string, instruction:string, findings:string, filePaths:string[], projectRoot:string, model?:string }} opts параметри
 * @returns {{ ok:boolean, error?:string, fixed:string[] }} статус + список змінених шляхів
 */
export function llmLintFix({ tool, instruction, findings, filePaths, projectRoot, model }) {
  const m = model ?? DEFAULT_MODEL
  const files = readFilesForFix(filePaths, projectRoot)
  if (files.length === 0) return { ok: false, error: 'no readable files to fix', fixed: [] }

  let text
  try {
    text = callLlm([{ role: 'user', content: buildLintFixPrompt(tool, instruction, findings, files) }], m, {
      timeoutMs: 120_000,
      caller: `lint:${tool}`
    })
  } catch (error) {
    return { ok: false, error: String(error.message), fixed: [] }
  }

  const parsed = parseChangesResponse(text)
  if (!parsed) return { ok: false, error: `cannot parse omlx response: ${String(text).slice(0, 200)}`, fixed: [] }
  if (parsed.error) return { ok: false, error: parsed.error, fixed: [] }

  const changes = (parsed.changes ?? []).filter(c => c.path && typeof c.content === 'string')
  if (changes.length === 0) return { ok: false, error: 'omlx returned no changes', fixed: [] }

  const applied = applyChanges(changes, projectRoot)
  if (!applied.ok) return { ok: false, error: applied.error, fixed: [] }
  return { ok: true, fixed: changes.map(c => c.path) }
}
