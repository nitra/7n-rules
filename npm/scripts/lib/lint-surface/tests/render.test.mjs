/**
 * Прямі тести JS-фасаду `render.mjs`: `renderViolations` делегує в native
 * (R1 фази 7, `crates/rules-core/src/lint_render.rs` — точний формат і
 * parity звірені в `lint-render-native-parity.test.mjs`, тут — лише сам факт
 * делегування й контракт функції), `renderDiagnostics` лишається чистою
 * JS-реалізацією (не портована, doc-комент `crates/rules-core/src/lint_render.rs`
 * — scope R1 обмежений violations, не diagnostics).
 */
import { describe, expect, test } from 'vitest'

import { renderDiagnostics, renderViolations } from '../render.mjs'

describe('renderViolations (фасад над native render_violations)', () => {
  test('порожній вхід → порожній рядок', () => {
    expect(renderViolations([])).toBe('')
  })

  test('групує за rule/concern і форматує error-порушення з file', () => {
    const violations = [{ ruleId: 'probe', concernId: 'check', reason: 'missing', message: 'no file', file: 'a/b.txt' }]
    expect(renderViolations(violations)).toBe(
      'probe/check — 1 порушення:\n  ❌ probe/check → a/b.txt (missing): no file\n'
    )
  })

  test('warn-severity → інша марка, без file-сегмента', () => {
    const violations = [
      { ruleId: 'probe', concernId: 'check', reason: 'deprecated', message: 'old api', severity: 'warn' }
    ]
    expect(renderViolations(violations)).toBe('probe/check — 1 порушення:\n  ⚠ probe/check (deprecated): old api\n')
  })
})

describe('renderDiagnostics', () => {
  test('порожній вхід → порожній рядок', () => {
    expect(renderDiagnostics([])).toBe('')
  })

  test('warn-рівень → ⚠, info-рівень → ℹ', () => {
    const diagnostics = [
      { level: 'warn', message: 'обережно' },
      { level: 'info', message: 'просто інфо' }
    ]
    expect(renderDiagnostics(diagnostics)).toBe('  ⚠ обережно\n  ℹ просто інфо\n')
  })
})
