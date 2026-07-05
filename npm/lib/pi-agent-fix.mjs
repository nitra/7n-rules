/** @see ./docs/pi-agent-fix.md */

/**
 * Тимчасовий shim (Ф1 виносу `@nitra/llm-lib`, спека
 * docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export fix-раннера
 * з пакета під legacy-імʼям `runPiAgentFix` + інʼєкція n-cursor-специфічного
 * AST-екстрактора (`ast-extract`, oxc) як `deps.astContext` — у пакеті цей
 * дефолт більше не живе (substrate-незалежність: пакет не тягне oxc).
 * Нового коду сюди не додавати — імпортуй `runAgentFix` з
 * `@nitra/llm-lib/agent-fix` напряму і передавай astContext явно.
 */

import { resolve } from 'node:path'
import { runAgentFix } from '@nitra/llm-lib/agent-fix'
import { extractContext } from '../scripts/utils/ast-extract.mjs'

export { buildFixPrompt } from '@nitra/llm-lib/agent-fix'

/**
 * Legacy-обгортка `runAgentFix` із n-cursor-дефолтом `deps.astContext` (oxc ast-extract).
 * @param {string} ruleId id правила
 * @param {string} violation violation-output
 * @param {string} cwd корінь проєкту
 * @param {object} [opts] опції fix-спроби (див. `runAgentFix`)
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], telemetry: object|null, error: string|null, rollback: () => void }>} результат fix-спроби.
 */
export function runPiAgentFix(ruleId, violation, cwd, opts = {}) {
  const deps = { astContext: p => extractContext(resolve(cwd, p)), ...opts.deps }
  return runAgentFix(ruleId, violation, cwd, { ...opts, deps })
}
