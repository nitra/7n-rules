/**
 * Тести anchored-edit (Фаза A2): якорі, рендер, атомарне застосування правок,
 * tool-фабрика read_anchored/edit_anchored з fs-інжекціями (без pi і без диска).
 */

import { describe, expect, test, vi } from 'vitest'
import { applyAnchoredEdits, createAnchoredTools, lineAnchor, renderAnchored } from '../lib/anchored-edit.mjs'

const RE_ANCHOR = /^[0-9a-z]{3}$/

/**
 * Мінімальний defineTool-стаб: повертає дефініцію як є.
 * @param {object} def tool-дефініція
 * @returns {object} та сама дефініція
 */
const defineTool = def => def

/**
 * Хелпер: перший text-блок tool-результату як рядок.
 * @param {{ content: Array<{ text: string }> }} res tool-результат
 * @returns {string} текст відповіді
 */
const textOf = res => res.content[0].text

describe('lineAnchor / renderAnchored', () => {
  test('якір: 3 base36-символи, детермінований, чутливий до вмісту', () => {
    const a = lineAnchor('const x = 1')
    expect(a).toMatch(RE_ANCHOR)
    expect(lineAnchor('const x = 1')).toBe(a)
    expect(lineAnchor('const x = 2')).not.toBe(a)
  })

  test('renderAnchored: формат "якір|номер|текст", нумерація з 1, діапазон включний', () => {
    const content = 'a\nb\nc'
    const all = renderAnchored(content).split('\n')
    expect(all).toHaveLength(3)
    expect(all[0]).toBe(`${lineAnchor('a')}|1|a`)
    expect(renderAnchored(content, { from: 2, to: 2 })).toBe(`${lineAnchor('b')}|2|b`)
    expect(renderAnchored(content, { from: 2, to: 99 }).split('\n')).toHaveLength(2)
  })
})

describe('applyAnchoredEdits', () => {
  const content = 'one\ntwo\nthree'

  test('заміна рядка (включно з багаторядковою) і видалення через null', () => {
    const r1 = applyAnchoredEdits(content, [{ anchor: lineAnchor('two'), line: 2, newText: 'TWO\nTWO2' }])
    expect(r1).toEqual({ ok: true, content: 'one\nTWO\nTWO2\nthree' })
    const r2 = applyAnchoredEdits(content, [{ anchor: lineAnchor('two'), line: 2, newText: null }])
    expect(r2).toEqual({ ok: true, content: 'one\nthree' })
  })

  test('кілька правок застосовуються знизу вгору — номери не зсуваються', () => {
    const r = applyAnchoredEdits(content, [
      { anchor: lineAnchor('one'), line: 1, newText: '1a\n1b' },
      { anchor: lineAnchor('three'), line: 3, newText: '3' }
    ])
    expect(r).toEqual({ ok: true, content: '1a\n1b\ntwo\n3' })
  })

  test('stale anchor → атомарна відмова: жодна правка не застосована', () => {
    const r = applyAnchoredEdits(content, [
      { anchor: lineAnchor('one'), line: 1, newText: 'OK' },
      { anchor: 'zzz', line: 2, newText: 'BAD' }
    ])
    expect(r.ok).toBe(false)
    expect(r.stale).toHaveLength(1)
    expect(r.stale[0].line).toBe(2)
    expect(r.stale[0].reason).toContain('stale anchor')
  })

  test('рядок поза файлом і дубль-рядок у правках — відмова з причиною', () => {
    const out = applyAnchoredEdits(content, [{ anchor: 'aaa', line: 9, newText: 'x' }])
    expect(out.ok).toBe(false)
    expect(out.stale[0].reason).toContain('не існує')
    const dup = applyAnchoredEdits(content, [
      { anchor: lineAnchor('one'), line: 1, newText: 'x' },
      { anchor: lineAnchor('one'), line: 1, newText: 'y' }
    ])
    expect(dup.ok).toBe(false)
    expect(dup.stale[0].reason).toContain('двічі')
  })
})

describe('createAnchoredTools (fs-інжекції)', () => {
  /**
   * Створює пару tools над in-memory «файлом».
   * @param {string|null} initial початковий вміст (null — файл не існує)
   * @returns {{ readTool: object, editTool: object, written: () => string|null }} tools + доступ до запису
   */
  function makeTools(initial) {
    let disk = initial
    const fs = {
      existsSync: () => disk !== null,
      readFileSync: () => disk,
      writeFileSync: (_p, c) => {
        disk = c
      }
    }
    const { readTool, editTool } = createAnchoredTools({ cwd: '/proj', defineTool, fs })
    return { readTool, editTool, written: () => disk }
  }

  test('read_anchored: anchored-рядки; неіснуючий файл → структурована помилка', () => {
    const { readTool } = makeTools('alpha\nbeta')
    expect(textOf(readTool.execute('t1', { path: 'f.mjs' }))).toBe(
      `${lineAnchor('alpha')}|1|alpha\n${lineAnchor('beta')}|2|beta`
    )
    const missing = makeTools(null)
    expect(textOf(missing.readTool.execute('t2', { path: 'nope.mjs' }))).toContain('не існує')
  })

  test('edit_anchored: валідні якорі → запис; stale → відмова без запису', () => {
    const t = makeTools('alpha\nbeta')
    const ok = t.editTool.execute('t3', {
      path: 'f.mjs',
      edits: [{ anchor: lineAnchor('beta'), line: 2, newText: 'BETA' }]
    })
    expect(JSON.parse(textOf(ok))).toEqual({ ok: true, applied: 1 })
    expect(t.written()).toBe('alpha\nBETA')

    const stale = t.editTool.execute('t4', {
      path: 'f.mjs',
      edits: [{ anchor: 'zzz', line: 1, newText: 'X' }]
    })
    expect(JSON.parse(textOf(stale)).error).toContain('stale anchors')
    expect(t.written()).toBe('alpha\nBETA')
  })

  test('edit_anchored: неіснуючий файл і порожні edits → структуровані помилки', () => {
    const missing = makeTools(null)
    expect(textOf(missing.editTool.execute('t5', { path: 'x.mjs', edits: [{ anchor: 'aaa', line: 1 }] }))).toContain(
      'не існує'
    )
    const t = makeTools('a')
    expect(textOf(t.editTool.execute('t6', { path: 'f.mjs', edits: [] }))).toContain('порожній')
  })

  test('newText відсутній у правці → трактується як видалення (null-нормалізація)', () => {
    const t = makeTools('a\nb')
    const res = t.editTool.execute('t7', { path: 'f.mjs', edits: [{ anchor: lineAnchor('a'), line: 1 }] })
    expect(JSON.parse(textOf(res)).ok).toBe(true)
    expect(t.written()).toBe('b')
  })

  test('tool-схеми: імена і обовʼязкові параметри стабільні (контракт для write-guard/промпта)', () => {
    const { readTool, editTool } = makeTools('a')
    expect(readTool.name).toBe('read_anchored')
    expect(editTool.name).toBe('edit_anchored')
    expect(editTool.parameters.required).toEqual(['path', 'edits'])
  })

  test('гарантія vi доступна', () => {
    expect(vi.isMockFunction(vi.fn())).toBe(true)
  })
})
