/**
 * Level-1 «Суддя» (spec §8.4): проганяє Quality Gates (§5) через **ін'єктований**
 * `run`-runner і повертає структурований verdict. Не знає про LLM/API-ключі —
 * чистий FS/Git/процеси. Один і той самий `runReview` обслуговує і Пасивний
 * Турнікет (`flow verify`), і Активний Раннер (per-step Ф4).
 *
 * Fail-fast: на першому проваленому gate зупиняємось. Fingerprint дерева
 * (`worktree-fingerprint`) фіксуємо лише на повному pass — щоб зберегти у стан і
 * пізніше ловити stale-результат (§5).
 */
import { worktreeFingerprint } from '../../utils/worktree-fingerprint.mjs'

/**
 * Канонічні gate-и verify (lint + coverage; coverage включає тести+мутації).
 * Обидва — scoped до змінених файлів: `lint` через quick-режим (`changed-files.mjs`),
 * `coverage --changed` через vitest `--changed`/Stryker `--mutate` по diff від base.
 * Турнікет (`flow verify`/per-step) перевіряє лише змінене; повний coverage —
 * окремо (`bun run coverage`, `/n-coverage-fix`).
 */
export const DEFAULT_GATES = [
  { name: 'lint', cmd: ['npx', '@nitra/cursor', 'lint'] },
  { name: 'coverage', cmd: ['npx', '@nitra/cursor', 'coverage', '--changed'] }
]

/**
 * Проганяє gate-и й повертає verdict.
 * @param {{ run: (cmd: string, args: string[], opts: object) => { status: number, stdout?: string, stderr?: string }, cwd: string, gates?: { name: string, cmd: string[] }[], fingerprint?: () => string | null }} input ін'єкції
 * @returns {{ pass: boolean, gates: { name: string, ok: boolean }[], failedOutput: string | null, fingerprint: string | null }} verdict
 */
export function runReview({ run, cwd, gates = DEFAULT_GATES, fingerprint = () => worktreeFingerprint() }) {
  const results = []
  let failedOutput = null
  for (const g of gates) {
    const r = run(g.cmd[0], g.cmd.slice(1), { cwd })
    const ok = (r?.status ?? 1) === 0
    results.push({ name: g.name, ok })
    if (!ok) {
      failedOutput = `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`.trim() || null
      break
    }
  }
  const pass = results.length === gates.length && results.every(x => x.ok)
  return { pass, gates: results, failedOutput, fingerprint: pass ? fingerprint() : null }
}
