/**
 * Тести панелі brainstorm (`lib/plan-panel.mjs`). runner ін'єктується фейком,
 * що відповідає за фрагментом промпта — без реальних субагентів.
 */
import { describe, expect, test } from 'vitest'

import { runPanel } from '../plan-panel.mjs'

const noop = () => { /* noop */ }

/**
 * Фейковий runner: повертає output за першим знайденим ключем-фрагментом промпта.
 * @param {Record<string, string>} map ключ-фрагмент → output
 * @param {boolean} [ok] статус відповіді
 * @returns {{ runStep: (p: string) => Promise<{ ok: boolean, output: string }> }} runner
 */
function fakeRunner(map, ok = true) {
  return {
    runStep: prompt => {
      const key = Object.keys(map).find(k => prompt.includes(k))
      return { ok, output: key ? map[key] : '' }
    }
  }
}

describe('runPanel', () => {
  test('mode plan: синтезує масив кроків', async () => {
    // ключ судді ('Синтезуй') — першим: суддя-промпт містить і імена персон (### architect)
    const runner = fakeRunner({
      Синтезуй: '[{"task":"Парсер","acceptance":"парсить кроки"}]',
      architect: 'модульний підхід',
      skeptic: 'ризик складності',
      tester: 'unit на парсер'
    })
    const steps = await runPanel({ task: 'фіча X', cwd: '/wt', runner, log: noop, mode: 'plan' })
    expect(steps).toEqual([{ task: 'Парсер', acceptance: 'парсить кроки' }])
  })

  test('mode spec: повертає текст синтезу', async () => {
    const runner = fakeRunner({ '2-3 підходи': '## Підхід A\n…' })
    const out = await runPanel({ task: 'X', cwd: '/wt', runner, log: noop, mode: 'spec' })
    expect(out).toContain('Підхід A')
  })

  test('суддя впав → null', async () => {
    const runner = fakeRunner({}, false)
    expect(await runPanel({ task: 'X', cwd: '/wt', runner, log: noop, mode: 'plan' })).toBe(null)
  })

  test('plan без JSON у синтезі → null', async () => {
    const runner = fakeRunner({ 'JSON-масив': 'нема плану тут' })
    expect(await runPanel({ task: 'X', cwd: '/wt', runner, log: noop, mode: 'plan' })).toBe(null)
  })

  test('нема runner → null', async () => {
    expect(await runPanel({ task: 'X', cwd: '/wt', runner: null, log: noop })).toBe(null)
  })
})
