import { describe, expect, test } from 'bun:test'

import { formatDurationMs, formatTimingSummary } from '../timing-summary.mjs'

const FIX_BUN_OK_RE = /fix-bun\s+1\.2s$/
const FIX_GA_FAIL_RE = /fix-ga\s+3\.5s\s+❌$/
const FIX_JS_LINT_OK_RE = /fix-js-lint\s+0\.8s$/
const TOTAL_55_RE = /total\s+5\.5s$/

describe('formatDurationMs', () => {
  test('0ms → 0.0s', () => {
    expect(formatDurationMs(0)).toBe('0.0s')
  })

  test('1200ms → 1.2s', () => {
    expect(formatDurationMs(1200)).toBe('1.2s')
  })

  test('12345ms → 12.3s (округлення до десятої)', () => {
    expect(formatDurationMs(12_345)).toBe('12.3s')
  })

  test('відʼємні значення обрізаються до 0', () => {
    expect(formatDurationMs(-50)).toBe('0.0s')
  })
})

describe('formatTimingSummary', () => {
  test('порожній список → порожній рядок', () => {
    expect(formatTimingSummary('Fix timing', [])).toBe('')
  })

  test('один запис без падіння — без маркера ❌', () => {
    const out = formatTimingSummary('Fix timing', [{ id: 'fix-bun', ms: 1200, ok: true }])
    expect(out).toContain('⏱  Fix timing:')
    expect(out).toContain('fix-bun')
    expect(out).toContain('1.2s')
    expect(out).not.toContain('❌')
    expect(out).toContain('total')
  })

  test('кілька записів, один впав — ❌ лише на ньому, total = сума', () => {
    const out = formatTimingSummary('Fix timing', [
      { id: 'fix-bun', ms: 1200, ok: true },
      { id: 'fix-ga', ms: 3500, ok: false },
      { id: 'fix-js-lint', ms: 800, ok: true }
    ])
    const lines = out.trim().split('\n')
    expect(lines[0]).toBe('⏱  Fix timing:')
    expect(lines[1]).toMatch(FIX_BUN_OK_RE)
    expect(lines[2]).toMatch(FIX_GA_FAIL_RE)
    expect(lines[3]).toMatch(FIX_JS_LINT_OK_RE)
    expect(lines.at(-1)).toMatch(TOTAL_55_RE)
  })

  test('зберігає порядок запуску (не сортує)', () => {
    const out = formatTimingSummary('Lint timing', [
      { id: 'lint-text', ms: 100, ok: true },
      { id: 'lint-ga', ms: 200, ok: true }
    ])
    const lines = out.trim().split('\n')
    expect(lines[1]).toContain('lint-text')
    expect(lines[2]).toContain('lint-ga')
  })

  test('заголовок підставляється з аргументу', () => {
    const out = formatTimingSummary('Lint timing', [{ id: 'lint-ga', ms: 100, ok: true }])
    expect(out).toContain('⏱  Lint timing:')
  })

  test(String.raw`кінчається на \n`, () => {
    const out = formatTimingSummary('Fix timing', [{ id: 'fix-ga', ms: 100, ok: true }])
    expect(out.endsWith('\n')).toBe(true)
  })
})
