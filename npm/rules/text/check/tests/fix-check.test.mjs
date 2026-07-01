/**
 * Тести T0-codemod `fix-check.mjs`. Реальні fix-прогони (markdownlint/shellcheck/dotenv)
 * зав'язані на зовнішні тули + git (перевірено e2e); тут — контракт патернів: test-предикати
 * (кожен реагує лише на свій reason).
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-check.mjs'

const byId = id => patterns.find(p => p.id === id)

describe('text/check fix patterns', () => {
  test('три патерни: markdownlint / shellcheck / dotenv', () => {
    expect(patterns.map(p => p.id)).toEqual(['text-markdownlint-fix', 'text-shellcheck-fix', 'text-dotenv-fix'])
  })

  test('кожен реагує лише на свій reason', () => {
    expect(byId('text-markdownlint-fix').test([{ reason: 'markdownlint', message: 'm' }])).toBe(true)
    expect(byId('text-shellcheck-fix').test([{ reason: 'shellcheck', message: 'm' }])).toBe(true)
    expect(byId('text-dotenv-fix').test([{ reason: 'dotenv-linter', message: 'm' }])).toBe(true)
    // крос-негатив
    expect(byId('text-markdownlint-fix').test([{ reason: 'shellcheck', message: 'm' }])).toBe(false)
    expect(byId('text-shellcheck-fix').test([{ reason: 'cspell', message: 'm' }])).toBe(false)
    expect(byId('text-dotenv-fix').test([{ reason: 'v8r', message: 'm' }])).toBe(false)
  })

  test('cspell/v8r (без fix-режиму) не тригерять жоден патерн', () => {
    for (const p of patterns) {
      expect(p.test([{ reason: 'cspell', message: 'm' }])).toBe(false)
      expect(p.test([{ reason: 'v8r', message: 'm' }])).toBe(false)
    }
  })
})
