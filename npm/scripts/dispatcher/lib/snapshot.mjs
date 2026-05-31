/**
 * Completion snapshot (spec §3 Ф5, §7): перед cleanup transient `.flow.json`
 * durable-слід задачі має пережити. Будуємо стислий summary і вписуємо його в
 * task record (`docs/tasks/<id>.md`) між HTML-маркерами (idempotent upsert).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const SUMMARY_START = '<!-- flow:summary:start -->'
const SUMMARY_END = '<!-- flow:summary:end -->'

/**
 * Будує completion snapshot зі стану.
 * @param {object} state стан `.flow.json`
 * @param {() => number} [now] фабрика часу (ms)
 * @returns {object} snapshot (status, branch, base_commit, gates, change, notified, finished_at)
 */
export function buildCompletionSnapshot(state, now = Date.now) {
  return {
    status: state.status ?? 'done',
    branch: state.branch ?? null,
    base_commit: state.metadata?.base_commit ?? state.base_commit ?? null,
    gates: Object.fromEntries((state.gates ?? []).map(g => [g.name, g.ok ? 'ok' : 'fail'])),
    change: state.change ?? null,
    notified: state.notified ?? null,
    finished_at: new Date(now()).toISOString()
  }
}

/**
 * Вставляє/оновлює блок Summary в markdown-контенті (між маркерами).
 * @param {string} content вихідний markdown
 * @param {object} snapshot completion snapshot
 * @returns {string} оновлений markdown
 */
export function upsertSummaryBlock(content, snapshot) {
  const block = `${SUMMARY_START}\n## Summary\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n${SUMMARY_END}`
  const i = content.indexOf(SUMMARY_START)
  const j = content.indexOf(SUMMARY_END)
  if (i !== -1 && j !== -1 && j > i) {
    return content.slice(0, i) + block + content.slice(j + SUMMARY_END.length)
  }
  return `${content.trimEnd()}\n\n${block}\n`
}

/**
 * Вписує snapshot у task record (створює файл, якщо його нема).
 * @param {string} taskPath абсолютний шлях `docs/tasks/<id>.md`
 * @param {object} snapshot completion snapshot
 * @returns {void}
 */
export function writeSummaryToTaskRecord(taskPath, snapshot) {
  if (!isAbsolute(taskPath)) {
    throw new Error(`writeSummaryToTaskRecord: очікується абсолютний шлях (отримано: ${taskPath})`)
  }
  const content = existsSync(taskPath) ? readFileSync(taskPath, 'utf8') : ''
  writeFileSync(taskPath, upsertSummaryBlock(content, snapshot), 'utf8')
}
