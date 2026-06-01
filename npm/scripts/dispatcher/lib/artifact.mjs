/**
 * Спільні утиліти фаз `spec`/`plan` (Пасивний Турнікет): резолв traceable-
 * артефакту в `docs/<kind>/`, екстракт кроків плану зі секції `## Кроки`, і
 * read-only перевірка цілісності ланцюга через `n-cursor trace` (`trace.mjs`).
 *
 * Лінки front-matter (`spec.plan`/`plan.spec`/`plan.flow`) пише сам агент за
 * контрактом `flow.mdc` — тут лише ВЕРИФІКАЦІЯ (мутатора `trace link` нема).
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { runTraceCli } from '../trace.mjs'

/**
 * Резолвить артефакт у `docs/<kind>/`. Пріоритет: файли, чия назва містить
 * хвіст гілки (slug, напр. `flow-gate` з `claude/flow-gate`); серед них (або
 * серед усіх, якщо збігу нема) — **найсвіжіший за mtime**. Лексикографічний
 * вибір був хибним при кількох артефактах на одну дату (виявлено dogfood'ом).
 * @param {string} cwd корінь worktree
 * @param {'specs' | 'plans'} kind підкаталог `docs`
 * @param {string} [branch] гілка задачі — для пріоритету за slug
 * @returns {string | null} абсолютний шлях або null, якщо каталог/файли відсутні
 */
export function resolveArtifact(cwd, kind, branch) {
  const dir = join(cwd, 'docs', kind)
  if (!existsSync(dir)) return null
  const md = readdirSync(dir).filter(f => f.endsWith('.md'))
  if (md.length === 0) return null

  const slug = branch ? branch.split('/').pop() : null
  const matched = slug ? md.filter(f => f.includes(slug)) : []
  const pool = matched.length > 0 ? matched : md

  const best = pool
    .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .toSorted((a, b) => a.mtime - b.mtime || (a.f < b.f ? -1 : 1))
    .at(-1)
  return join(dir, best.f)
}

/** Маркер критерію приймання в рядку кроку (порівняння — case-insensitive). */
const ACCEPTANCE_MARK = '— acceptance:'
/** Лише цифри — перевірка нумерації кроку (лінійний, без backtracking). */
const DIGITS_RE = /^\d+$/u

/**
 * Кроки зі секції плану — нумерований список `N. <task> — acceptance: <crit>`.
 * Best-effort парсинг через `indexOf` (без regex-backtracking): рядки поза
 * форматом ігноруються.
 * @param {string} text вміст plan-doc
 * @returns {{ task: string, acceptance?: string }[]} кроки у порядку появи
 */
export function extractSteps(text) {
  const steps = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    const dot = line.indexOf('. ')
    if (dot <= 0 || !DIGITS_RE.test(line.slice(0, dot))) continue
    const body = line.slice(dot + 2).trim()
    const sep = body.toLowerCase().indexOf(ACCEPTANCE_MARK)
    if (sep === -1) {
      steps.push({ task: body })
    } else {
      steps.push({ task: body.slice(0, sep).trim(), acceptance: body.slice(sep + ACCEPTANCE_MARK.length).trim() })
    }
  }
  return steps
}

/**
 * Read-only перевірка цілісності ланцюга артефактів (не мутує — лише сигнал).
 * @param {string} cwd корінь worktree
 * @param {(cwd: string) => number} [runTrace] runner trace (0 — цілісно, 1 — розрив); ін'єкція для тестів
 * @returns {boolean} true, якщо ланцюг цілісний
 */
export function verifyTrace(cwd, runTrace) {
  const run = runTrace ?? (c => runTraceCli([], { cwd: c, log: () => {} }))
  return run(cwd) === 0
}
