import { describe, expect, test } from 'vitest'

import pythonDocFilesExtractor, { extractFactsPython } from '../extractors.mjs'

const pyPath = 'src/service.py'

describe('extractFactsPython', () => {
  test('module та public def docstring-и стають дослівними facts', () => {
    const facts = extractFactsPython(
      `"""Повертає статус сервісу."""

def health():
    """Повертає готовність сервісу."""
    return 'ok'

def _helper():
    return None
`,
      pyPath
    )
    expect(facts.header).toBe('Повертає статус сервісу.')
    expect(facts.exports).toEqual([{ name: 'health', kind: 'def', desc: 'Повертає готовність сервісу.' }])
  })

  test('підтримує багаторядкові module та class docstring-и', () => {
    const facts = extractFactsPython(
      `'''Керує задачами.

Повертає стан черги.'''

class Queue:
    '''Зберігає задачі.

    Дає доступ до їхнього стану.'''
    pass
`,
      pyPath
    )
    expect(facts.header).toBe('Керує задачами.\n\nПовертає стан черги.')
    expect(facts.exports[0]).toEqual({
      name: 'Queue',
      kind: 'class',
      desc: 'Зберігає задачі.\n\nДає доступ до їхнього стану.'
    })
  })

  test('не вважає непокритий public API повною документацією', () => {
    const facts = extractFactsPython('"""Модуль."""\n\ndef health():\n    return True\n', pyPath)
    expect(facts.exports[0].desc).toBe('')
  })

  test('handler декларує Python extension', () => {
    expect(pythonDocFilesExtractor.extensions).toEqual(['.py'])
  })
})
