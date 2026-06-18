/**
 * Юніт-тести детермінованих частин ADR-конвеєра (без LLM): retrieval, гейти,
 * валідатори. LLM-стадії (edge/kind/gen) покриті інтеграційним A/B-прогоном.
 */
import { describe, expect, it } from 'vitest'
import {
  buildEdges,
  draftTitle,
  isNoDecision,
  jaccard,
  tokenize,
  validateMadr
} from '../normalize-pipeline.mjs'

describe('tokenize / jaccard', () => {
  it('відкидає стоп-слова, timestamp-префікс і короткі токени', () => {
    const t = tokenize('260607-2151-маршрутизація-локальних-моделей-pi-vs-ollama.md')
    expect(t.has('маршрутизація')).toBe(true)
    expect(t.has('моделей')).toBe(true)
    expect(t.has('vs')).toBe(false) // < 3 символів
    expect(t.has('260607')).toBe(false) // timestamp зрізано
  })

  it('jaccard: однакові=1, диз’юнктні=0', () => {
    expect(jaccard(tokenize('alpha beta'), tokenize('alpha beta'))).toBe(1)
    expect(jaccard(tokenize('alpha beta'), tokenize('gamma delta'))).toBe(0)
  })
})

describe('draftTitle', () => {
  it('пріоритет рядку "## ADR <title>" навіть якщо раніше є контент-заголовок', () => {
    const body = '## Фінальна таблиця\n\n## ADR Інверсія керування у docgen\n\n## Context'
    expect(draftTitle(body)).toBe('Інверсія керування у docgen')
  })

  it('повертає "" коли нема ні ADR-рядка, ні не-MADR h1 (caller бере імʼя файлу)', () => {
    expect(draftTitle('## report\n\n## summary\n\n## Reason')).toBe('')
  })
})

describe('isNoDecision (харднінг #1)', () => {
  it(String.raw`ловить "не обрано" у Decision Outcome (кирилиця, без \b)`, () => {
    const body = '## Decision Outcome\nChosen option: не обрано, because transcript обірвався.'
    expect(isNoDecision(body)).toBe(true)
  })

  it('ловить "рішення не прийнято"', () => {
    expect(isNoDecision('## Decision Outcome\nРішення не прийнято — сесія завершилась.')).toBe(true)
  })

  it('false для нормального прийнятого рішення', () => {
    expect(isNoDecision('## Decision Outcome\nChosen option: "X", because Y.')).toBe(false)
  })

  it('false коли нема секції Decision Outcome', () => {
    expect(isNoDecision('# Title\n\n## Context\nне обрано тут не рахується')).toBe(false)
  })
})

describe('validateMadr (gen-gate)', () => {
  const good = `---
type: ADR
title: Заголовок
description: Суть рішення.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement
текст

## Considered Options
- опція

## Decision Outcome
Chosen option: "X", because Y.

## More Information
файли`

  it('ok для валідного MADR з OKF frontmatter', () => {
    expect(validateMadr(good).ok).toBe(true)
  })

  it('ловить відсутній OKF type: ADR (немає frontmatter)', () => {
    const noFm = good.replace(/^---[\s\S]*?---\n\n/, '')
    const r = validateMadr(noFm)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('missing OKF type: ADR frontmatter')
  })

  it('ловить session: (залишений з чернетки)', () => {
    const r = validateMadr(good.replace('type: ADR\n', 'type: ADR\nsession: abc\n'))
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('leaked session: field')
  })

  it('ловить code-fence обгортку', () => {
    expect(validateMadr('```md\n' + good + '\n```').ok).toBe(false)
  })

  it('ловить відсутні MADR-заголовки', () => {
    const r = validateMadr('---\ntype: ADR\n---\n# T\n\n**Status:** Accepted\n**Date:** 2026-06-07\n\n## Context and Problem Statement\nx')
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('missing heading ## Decision Outcome')
  })
})

describe('buildEdges (retrieval)', () => {
  it('кластеризує лексично схожі драфти, ігнорує несхожі', () => {
    const drafts = [
      { file: 'a.md', body: '## ADR inputs.md обєднано в task.md' },
      { file: 'b.md', body: '## ADR граф задач: злиття inputs.md в task.md' },
      { file: 'c.md', body: '## ADR зміна шрифту редактора zed' }
    ]
    const { dd } = buildEdges(drafts, [])
    // a~b мають спільні токени (inputs, task, md), c — окремий
    expect(dd).toContainEqual([0, 1])
    expect(dd.find(([i, j]) => i === 2 || j === 2)).toBeUndefined()
  })
})
