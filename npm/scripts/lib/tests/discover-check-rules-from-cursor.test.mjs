import { describe, expect, test } from 'vitest'

import { discoverCheckRulesFromCursorRules, mdcBasenameToCheckId } from '../discover-check-rules-from-cursor.mjs'

describe('mdcBasenameToCheckId', () => {
  test('n- prefix strips to rule id', () => {
    expect(mdcBasenameToCheckId('n-bun.mdc')).toBe('bun')
  })

  test('non-managed basename keeps full stem', () => {
    expect(mdcBasenameToCheckId('conftest.mdc')).toBe('conftest')
  })
})

describe('discoverCheckRulesFromCursorRules', () => {
  test('returns ids in mdc file order intersected with available', () => {
    const available = ['bun', 'ga', 'text']
    const mdc = ['n-ga.mdc', 'conftest.mdc', 'n-bun.mdc', 'n-text.mdc']
    expect(discoverCheckRulesFromCursorRules(available, mdc)).toEqual(['ga', 'bun', 'text'])
  })

  test('skips mdc without check script in package', () => {
    expect(discoverCheckRulesFromCursorRules(['bun'], ['conftest.mdc', 'n-bun.mdc'])).toEqual(['bun'])
  })

  test('dedupes duplicate ids from multiple mdc mapping to same id', () => {
    expect(discoverCheckRulesFromCursorRules(['bun'], ['n-bun.mdc', 'n-bun.mdc'])).toEqual(['bun'])
  })

  test('empty mdc list yields empty result', () => {
    expect(discoverCheckRulesFromCursorRules(['bun'], [])).toEqual([])
  })
})
