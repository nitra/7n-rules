/**
 * Тести `n-cursor graph` (`dispatcher/graph.mjs`). FS ін'єктується — без диска.
 */
import { describe, expect, test } from 'vitest'

import {
  classifyArtifact,
  deriveGraph,
  deriveStatus,
  parseIdList,
  renderGraph,
  runGraphCli,
  scanGraph
} from '../graph.mjs'

describe('classifyArtifact', () => {
  test('plain-артефакти', () => {
    expect(classifyArtifact('B01-schema.plan.md')).toEqual({ stem: 'B01-schema', kind: 'plan' })
    expect(classifyArtifact('B02-cache-store.claim.md')).toEqual({ stem: 'B02-cache-store', kind: 'claim' })
    expect(classifyArtifact('B01-schema.fact.md')).toEqual({ stem: 'B01-schema', kind: 'fact' })
  })
  test('qid-артефакти ask/ans', () => {
    expect(classifyArtifact('B02-parser.ask-q1.md')).toEqual({ stem: 'B02-parser', kind: 'ask', qid: 'q1' })
    expect(classifyArtifact('B02-parser.ans-q1.md')).toEqual({ stem: 'B02-parser', kind: 'ans', qid: 'q1' })
  })
  test('чуже → null', () => {
    expect(classifyArtifact('readme.md')).toBe(null)
    expect(classifyArtifact('B01.txt')).toBe(null)
  })
})

describe('parseIdList', () => {
  test('[A, B] → масив', () => {
    expect(parseIdList('[B01, B02]')).toEqual(['B01', 'B02'])
    expect(parseIdList('[]')).toEqual([])
    expect(parseIdList(null)).toEqual([])
  })
})

describe('deriveStatus', () => {
  const done = new Set(['B01'])
  test('fact done/failed', () => {
    expect(deriveStatus({ hasFact: true, factStatus: 'done', dependsOn: [], asks: [], answered: [] }, done)).toBe(
      'done'
    )
    expect(deriveStatus({ hasFact: true, factStatus: 'failed', dependsOn: [], asks: [], answered: [] }, done)).toBe(
      'failed'
    )
  })
  test('claim + відкрите питання → awaiting-human', () => {
    expect(deriveStatus({ hasFact: false, hasClaim: true, asks: ['q1'], answered: [], dependsOn: [] }, done)).toBe(
      'awaiting-human'
    )
  })
  test('claim + питання закрите → in_progress', () => {
    expect(deriveStatus({ hasFact: false, hasClaim: true, asks: ['q1'], answered: ['q1'], dependsOn: [] }, done)).toBe(
      'in_progress'
    )
  })
  test('depends done → ready; інакше blocked', () => {
    expect(deriveStatus({ hasFact: false, hasClaim: false, asks: [], answered: [], dependsOn: ['B01'] }, done)).toBe(
      'ready'
    )
    expect(deriveStatus({ hasFact: false, hasClaim: false, asks: [], answered: [], dependsOn: ['B09'] }, done)).toBe(
      'blocked'
    )
  })
})

describe('deriveGraph', () => {
  test('ланцюг: B01 done → B02 ready', () => {
    const nodes = [
      { id: 'B01', hasFact: true, factStatus: 'done', hasClaim: false, asks: [], answered: [], dependsOn: [] },
      { id: 'B02', hasFact: false, hasClaim: false, asks: [], answered: [], dependsOn: ['B01'] }
    ]
    const g = deriveGraph(nodes)
    expect(g.find(n => n.id === 'B02').status).toBe('ready')
  })
})

/**
 * Фейкова FS для одного графа `g`: файли + (опц.) вміст.
 * @param {string[]} files назви файлів у nodes/
 * @param {Record<string, string>} [contents] вміст за назвою
 * @returns {{ readdir: (d: string) => string[], readFile: (f: string) => string }} ін'єкції
 */
function fakeFs(files, contents = {}) {
  const readdir = dir => {
    if (dir.endsWith('nodes')) return files
    if (dir.endsWith('graphs')) return ['g']
    return []
  }
  return { readdir, readFile: file => contents[file.split('/').pop()] ?? '---\n---' }
}

describe('scanGraph + runGraphCli', () => {
  test('групує файли у вузли з полями', () => {
    const fs = fakeFs(
      ['B01-schema.plan.md', 'B01-schema.fact.md', 'B02-parser.plan.md', 'B02-parser.claim.md', 'B02-parser.ask-q1.md'],
      {
        'B01-schema.plan.md': '---\nid: B01\ndependsOn: []\nowner: { type: human }\n---',
        'B01-schema.fact.md': '---\nstatus: done\n---',
        'B02-parser.plan.md': '---\nid: B02\ndependsOn: [B01]\nowner: { type: llm }\n---'
      }
    )
    const nodes = scanGraph('/root', 'g', fs)
    const b2 = nodes.find(n => n.id === 'B02')
    expect(b2.dependsOn).toEqual(['B01'])
    expect(b2.hasClaim).toBe(true)
    expect(b2.asks).toEqual(['q1'])
    expect(nodes.find(n => n.id === 'B01').hasFact).toBe(true)
  })

  test('runGraphCli status → 0, друкує позицію', () => {
    const out = []
    const fs = fakeFs(['B01-schema.plan.md'], { 'B01-schema.plan.md': '---\nid: B01\ndependsOn: []\n---' })
    const code = runGraphCli(['status'], { cwd: '/root', ...fs, log: m => out.push(m) })
    expect(code).toBe(0)
    expect(out.join('\n')).toMatch(/граф g/)
    expect(out.join('\n')).toMatch(/B01/)
  })

  test('невідома підкоманда → usage + 1', () => {
    expect(runGraphCli(['bogus'], { cwd: '/root', readdir: () => [], log: () => {} })).toBe(1)
  })
})

describe('renderGraph', () => {
  test('порожньо → повідомлення', () => {
    expect(renderGraph('g', [])).toContain('не знайдено')
  })
})
