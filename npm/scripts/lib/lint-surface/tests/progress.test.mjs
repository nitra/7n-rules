import { describe, expect, test } from 'vitest'

import { createProgressReporter } from '../progress.mjs'

// ANSI CSI-послідовності починаються з ESC[ — у не-TTY виводі `[` бути не повинно.
const ANSI_CSI_RE = /\[/u

/**
 * Reporter із захопленням виводу (не-TTY, без cli-progress бара).
 * @param {number} total кількість одиниць
 * @param {object} [extra] додаткові опції createProgressReporter
 * @returns {{ r: ReturnType<typeof createProgressReporter>, lines: string[] }} reporter і буфер
 */
function makeReporter(total, extra = {}) {
  const lines = []
  const r = createProgressReporter({
    total,
    log: s => {
      lines.push(s)
    },
    isTTY: false,
    ...extra
  })
  return { r, lines }
}

describe('progress reporter — семантика found/fixed (spec 2026-07-03)', () => {
  test('простий шлях: знайшли 10, виправили всі', () => {
    const { r } = makeReporter(1)
    r.detectSnapshot('a', 10)
    expect(r.summary()).toMatchObject({ found: 10, fixed: 0 })
    r.detectSnapshot('a', 0)
    expect(r.summary()).toMatchObject({ found: 10, fixed: 10 })
  })

  test('часткове виправлення: fixed = found - remaining', () => {
    const { r } = makeReporter(1)
    r.detectSnapshot('a', 10)
    r.detectSnapshot('a', 4)
    expect(r.summary()).toMatchObject({ found: 10, fixed: 6 })
  })

  test('маскування: re-detect більший за очікуваний → found росте, fixed не падає', () => {
    const { r } = makeReporter(1)
    r.detectSnapshot('a', 10) // found 10
    r.detectSnapshot('a', 4) //  fixed 6
    r.detectSnapshot('a', 7) //  нові порушення відкрились: found 13, fixed лишається 6
    expect(r.summary()).toMatchObject({ found: 13, fixed: 6 })
    r.detectSnapshot('a', 0)
    expect(r.summary()).toMatchObject({ found: 13, fixed: 13 })
  })

  test('standalone-концерн: перший знімок після apply — found росте з нуля', () => {
    const { r } = makeReporter(1)
    // без початкового detect: перший знімок — post-T0 re-detect
    r.detectSnapshot('s', 3)
    expect(r.summary()).toMatchObject({ found: 3, fixed: 0 })
    r.detectSnapshot('s', 0)
    expect(r.summary()).toMatchObject({ found: 3, fixed: 3 })
  })

  test('агрегація по кількох концернах', () => {
    const { r } = makeReporter(3)
    r.detectSnapshot('a', 5)
    r.detectSnapshot('b', 2)
    r.detectSnapshot('a', 0)
    expect(r.summary()).toMatchObject({ found: 7, fixed: 5 })
  })

  test('concernDone інкрементує done; порожній концерн без знімків не ламає тикер', () => {
    const { r } = makeReporter(2)
    r.concernDone('clean')
    r.detectSnapshot('dirty', 1)
    r.detectSnapshot('dirty', 0)
    r.concernDone('dirty')
    expect(r.summary()).toMatchObject({ done: 2, total: 2, found: 1, fixed: 1 })
  })
})

describe('progress reporter — не-TTY фолбек', () => {
  test('append-рядок зведення на кожен concernDone, без ANSI', () => {
    const { r, lines } = makeReporter(2)
    r.detectSnapshot('a', 3)
    r.detectSnapshot('a', 0)
    r.concernDone('a')
    r.concernDone('b')
    const progressLines = lines.filter(l => l.includes('⏱'))
    expect(progressLines).toHaveLength(2)
    expect(progressLines[0]).toContain('1/2 концернів')
    expect(progressLines[0]).toContain('знайдено 3')
    expect(progressLines[0]).toContain('виправлено 3')
    expect(progressLines[1]).toContain('2/2 концернів')
    for (const l of lines) expect(l).not.toMatch(ANSI_CSI_RE)
  })

  test('log проксіюється напряму (без multibar)', () => {
    const { r, lines } = makeReporter(1)
    r.log('  ✅ T0: x/y\n')
    expect(lines).toContain('  ✅ T0: x/y\n')
  })

  test('withFixed:false ховає тикер (detect-only/doc-files)', () => {
    const { r, lines } = makeReporter(1, { withFixed: false, unitLabel: 'файлів' })
    r.concernDone('f1')
    const line = lines.find(l => l.includes('⏱'))
    expect(line).toContain('1/1 файлів')
    expect(line).not.toContain('виправлено')
  })

  test('detectSnapshot без concernDone не емитить рядків (тихий знімок)', () => {
    const { r, lines } = makeReporter(1)
    r.detectSnapshot('a', 5)
    expect(lines.filter(l => l.includes('⏱'))).toHaveLength(0)
  })

  test('stop() у не-TTY — no-op без падіння', () => {
    const { r } = makeReporter(1)
    expect(() => r.stop()).not.toThrow()
  })

  test('appendInNonTTY:false — «мовчазний» reporter: без ⏱-рядків, onUpdate публікує', () => {
    const snaps = []
    const { r, lines } = makeReporter(2, {
      appendInNonTTY: false,
      onUpdate: s => {
        snaps.push(s)
      }
    })
    r.detectSnapshot('a', 3)
    r.concernDone('a')
    expect(lines.filter(l => l.includes('⏱'))).toHaveLength(0)
    expect(snaps.at(-1)).toMatchObject({ done: 1, total: 2, found: 3 })
  })

  test('onUpdate отримує знімок на кожну зміну стану (публікація для черги lint)', () => {
    const snaps = []
    const { r } = makeReporter(2, {
      onUpdate: s => {
        snaps.push(s)
      }
    })
    r.concernStart('js/eslint', 'haiku')
    r.detectSnapshot('a', 5)
    r.detectSnapshot('a', 2)
    r.concernDone('a')
    expect(snaps.at(-1)).toMatchObject({ done: 1, total: 2, found: 5, fixed: 3, current: 'js/eslint (haiku)' })
  })
})
