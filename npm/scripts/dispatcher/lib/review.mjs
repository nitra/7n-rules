/**
 * `flow review` — adversarial-перевірка коду ПІСЛЯ написання (ідея з BMAD
 * quick-dev: self-check → adversarial-review). Незалежний субагент читає ЛИШЕ
 * `git diff base_commit` і шукає логічні баги/ризики, яких не ловлять механічні
 * гейти `verify` (lint+coverage). Findings пишуться у `.flow.json`; команда
 * інформативна (м'які ворота — завжди код 0). Кількість рецензентів — за `level`.
 *
 * Уся IO (`run`/`runner`/`now`) ін'єктується — тестується без git/LLM.
 */
import { cwd as processCwd } from 'node:process'

import { realRun } from './commands.mjs'
import { flowEventsPath } from './events.mjs'
import { reviewersFor } from './level.mjs'
import { flowStatePath, readState, recordTransition } from './state-store.mjs'
import { createRunner } from './subagent-runner.mjs'

/** Ліміт diff у промпті (символів) — щоб не роздувати контекст рецензента. */
const DIFF_LIMIT = 12_000

/**
 * Текст diff від base: `base...HEAD` (закомічене) + `git diff` (робоче дерево).
 * @param {string} base базовий комміт
 * @param {(cmd: string, args: string[], opts: object) => { stdout: string }} run git-runner
 * @param {string} cwd worktree
 * @returns {string} склеєний diff (trim)
 */
export function diffFromBase(base, run, cwd) {
  const committed = run('git', ['diff', `${base}...HEAD`], { cwd })
  const working = run('git', ['diff'], { cwd })
  return `${committed.stdout ?? ''}\n${working.stdout ?? ''}`.trim()
}

/**
 * Промпт adversarial-рецензента (читає ЛИШЕ diff). Для high-risk додає
 * безпекову лінзу.
 * @param {string} diff текст diff
 * @param {string} [risk] low|med|high — фокус перевірки
 * @returns {string} промпт
 */
export function reviewerPrompt(diff, risk) {
  const lens =
    risk === 'high'
      ? 'ОСОБЛИВА УВАГА БЕЗПЕЦІ: auth/доступи, секрети/токени, ін\'єкції, валідація входу, незворотні операції.'
      : ''
  return [
    'Ти — прискіпливий adversarial-рецензент. Знайди баги, ризики й smells ЛИШЕ в цьому diff.',
    lens,
    'Поверни ЛИШЕ JSON-масив: [{ "severity": "high|med|low", "file": "...", "issue": "...", "suggestion": "..." }].',
    'Якщо проблем нема — поверни [].',
    '',
    diff.slice(0, DIFF_LIMIT)
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Парсить findings із відповіді рецензента. Fail-soft: сміття/невалідний JSON → [].
 * @param {string} text відповідь субагента
 * @returns {{ severity?: string, file?: string, issue?: string, suggestion?: string }[]} findings
 */
export function parseFindings(text) {
  const s = String(text)
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  try {
    const arr = JSON.parse(s.slice(start, end + 1))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * Дедуплікує findings за (file, issue).
 * @param {object[]} findings вхідні
 * @returns {object[]} без дублікатів
 */
export function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = `${f?.file ?? ''}::${f?.issue ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/**
 * Іконка за severity finding-а.
 * @param {string} severity рівень
 * @returns {string} емодзі
 */
function severityIcon(severity) {
  if (severity === 'high') return '🔴'
  if (severity === 'med') return '🟡'
  return '⚪'
}

/**
 * `flow review` — спавнить adversarial-рецензента(ів) на diff від base.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {{ cwd?: string, log?: (m: string) => void, run?: (cmd: string, args: string[], opts: object) => { stdout: string }, runner?: object, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0 завжди — інформативна; 1 лише якщо нема стану/runner)
 */
export async function review(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const run = deps.run ?? realRun
  const now = deps.now ?? Date.now

  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  if (!state) {
    log('review: стану нема — спершу `flow init`')
    return 1
  }

  const base = state.metadata?.base_commit ?? 'HEAD~1'
  const diff = diffFromBase(base, run, cwd)
  if (!diff) {
    log('review: нема змін від base — нічого ревʼювити')
    return 0
  }

  let runner = deps.runner
  if (!runner) {
    try {
      runner = await createRunner(deps)
    } catch (error) {
      log(`review: ${error.message}`)
      return 1
    }
  }

  const reviewers = reviewersFor(state.level ?? 1, state.risk)
  const prompt = reviewerPrompt(diff, state.risk)
  const results = await Promise.all(Array.from({ length: reviewers }, () => runner.runStep(prompt, { cwd })))
  const findings = dedupeFindings(results.flatMap(r => (r.ok ? parseFindings(r.output) : [])))

  recordTransition(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { type: 'review', findings: findings.length },
    s => ({ ...s, review: { at: new Date(now()).toISOString(), reviewers, findings } }),
    now
  )

  for (const f of findings) {
    log(`${severityIcon(f.severity)} ${f.file ?? '?'}: ${f.issue ?? ''}`)
  }
  const high = findings.filter(f => f.severity === 'high').length
  if (high > 0) log(`⚠️ review: ${high} high-severity — рекомендовано виправити перед release`)
  log(`review: ${findings.length} findings (рецензентів: ${reviewers})`)
  return 0
}
