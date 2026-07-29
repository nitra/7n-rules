/**
 * Оркестраційні тести batch-хвиль `normalizePipeline` (LLM-стадії: edge-judge,
 * kind-judge, gen-MADR, gen-merge) — раніше покриті лише окремим A/B-прогоном,
 * без автоматизованих тестів. `submitBatchImpl` інжектується (як у
 * docgen-wave-batch/docgen-files-batch) — кожна хвиля відповідає за
 * customId-префіксом (`dd:`/`dc:`/`kind:`/`gen:`/`merge:`).
 */
import { describe, expect, test, vi } from 'vitest'
import { normalizePipeline } from '../normalize-pipeline.mjs'

const fakeChainFactory = () => ({ end: vi.fn() })

/**
 * Фейковий `submitBatchImpl`: маршрутизує відповідь за префіксом `customId`
 * (до першого `:`) через передану мапу `responders` (префікс → `(customId) => {ok}|{error}`).
 * @param {Record<string, (customId: string) => {ok?: string, error?: string}>} responders мапа префікс→відповідь
 * @returns {(model: string, items: Array<object>) => Promise<Array<object>>} fake submitBatch
 */
function fakeSubmitBatch(responders) {
  return vi.fn((model, items) =>
    Promise.resolve(
      items.map(item => {
        const prefix = item.customId.split(':')[0]
        const r = responders[prefix]?.(item.customId) ?? { error: `no responder for ${item.customId}` }
        return { customId: item.customId, ...r }
      })
    )
  )
}

// `260101-1200-`-префікс — обов'язковий для madrDate() fallback (без captured:
// поля дата виводиться лише з timestamp-префікса імені файлу; без нього
// assembleMadr() дає порожню **Date:** і validateMadr() коректно відхиляє MADR).
const draft = (file, title, body) => ({ file: `260101-1200-${file}`, body: `## ADR ${title}\n\n${body}` })

const KIND_STANDALONE = JSON.stringify({ kind: 'standalone', reason: 'real decision' })
const GEN_OK = JSON.stringify({
  context: 'Проблема X.',
  options: ['A', 'B'],
  chosen: 'B',
  rationale: 'простіше',
  good: ['менше коду'],
  bad: [],
  more: 'file.mjs'
})
const EDGE_SAME = JSON.stringify({ same: true, confidence: 0.9, reason: 'дублікат' })
const EDGE_DIFFERENT = JSON.stringify({ same: false, confidence: 0.9, reason: 'різні теми' })
const MERGE_OK = 'Додатковий контекст щодо Y.'

describe('normalizePipeline — одинокий standalone-драфт', () => {
  test('kind-judge → rewrite → gen-MADR: рівно 2 batch-виклики (kind-хвиля, gen-хвиля)', async () => {
    const drafts = [draft('a.md', 'Рішення А', '## Decision Outcome\nChosen option: "X", because Y.')]
    const submitBatchImpl = fakeSubmitBatch({
      kind: () => ({ ok: KIND_STANDALONE }),
      gen: () => ({ ok: GEN_OK })
    })

    const { operations, stats } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(submitBatchImpl).toHaveBeenCalledTimes(2) // kind-хвиля + gen-хвиля; edge-хвиля порожня (нема ребер)
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({ op: 'rewrite', file: drafts[0].file })
    expect(operations[0].content).toContain('Chosen option: "B", because простіше.')
    expect(stats.failures).toBe(0)
    expect(stats.madrInvalid).toBe(0)
  })
})

describe('normalizePipeline — no-decision гейт', () => {
  test('делейт без жодного LLM-виклику', async () => {
    const drafts = [draft('a.md', 'Незавершене', '## Decision Outcome\nне обрано, сесія обірвалась.')]
    const submitBatchImpl = vi.fn()

    const { operations } = await normalizePipeline(drafts, [], { submitBatchImpl, chainFactory: fakeChainFactory })

    expect(submitBatchImpl).not.toHaveBeenCalled()
    expect(operations).toEqual([
      { op: 'delete', file: drafts[0].file, reason: 'рішення не прийняте (transcript обірвався)' }
    ])
  })
})

describe('normalizePipeline — кластер draft↔draft (edge-judge same)', () => {
  test('дублікат-драфти → anchor rewrite + інший merge-anchor', async () => {
    const body = '## Decision Outcome\nChosen option: "X", because Y.'
    const drafts = [
      draft('a.md', 'Спільна тема одна', body),
      draft('b.md', 'Спільна тема одна доповнена ще довшим текстом', `${body}\n\nдодатковий контекст для довшого тіла`)
    ]
    const submitBatchImpl = fakeSubmitBatch({
      dd: () => ({ ok: EDGE_SAME }),
      gen: () => ({ ok: GEN_OK }),
      merge: () => ({ ok: MERGE_OK })
    })

    const { operations } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    const rewrite = operations.find(o => o.op === 'rewrite')
    const merge = operations.find(o => o.op === 'merge-into')
    expect(rewrite.file).toBe(drafts[1].file) // довший body — anchor
    expect(merge.file).toBe(drafts[0].file)
    expect(merge.additions).toContain(MERGE_OK)
  })

  test('різні драфти (edge-judge different) → обидва standalone, без кластера', async () => {
    const body = '## Decision Outcome\nChosen option: "X", because Y.'
    const drafts = [
      draft('a.md', 'Спільна тема одна', body),
      draft('b.md', 'Спільна тема одна варіант', `${body}\n\nінший контент про геть інше`)
    ]
    const submitBatchImpl = fakeSubmitBatch({
      dd: () => ({ ok: EDGE_DIFFERENT }),
      kind: () => ({ ok: KIND_STANDALONE }),
      gen: () => ({ ok: GEN_OK })
    })

    const { operations } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(operations.filter(o => o.op === 'rewrite')).toHaveLength(2)
  })
})

describe('normalizePipeline — draft↔clean matching', () => {
  test('confirmed clean-match → merge-existing, без gen-MADR', async () => {
    const drafts = [draft('a.md', 'існуюча функція normalize', '## Decision Outcome\nChosen option: "X", because Y.')]
    const cleanList = ['260101-0000-existuyucha-funkciya-normalize.md']
    const submitBatchImpl = fakeSubmitBatch({
      dc: () => ({ ok: EDGE_SAME }),
      merge: () => ({ ok: MERGE_OK })
    })

    const { operations } = await normalizePipeline(drafts, cleanList, {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(operations).toEqual([
      { op: 'merge-into', file: drafts[0].file, target: cleanList[0], additions: expect.stringContaining(MERGE_OK) }
    ])
  })
})

describe('normalizePipeline — tier1 → tier2 ескалація', () => {
  test('tier1 провалюється, allowCloud=true → tier2-хвиля рятує вердикт', async () => {
    const drafts = [draft('a.md', 'Рішення А', '## Decision Outcome\nChosen option: "X", because Y.')]
    let call = 0
    const submitBatchImpl = vi.fn((model, items) => {
      call++
      if (model === 'x/tier1') return Promise.resolve(items.map(i => ({ customId: i.customId, error: 'tier1 down' })))
      return Promise.resolve(
        items.map(i => ({ customId: i.customId, ok: i.customId.startsWith('kind') ? KIND_STANDALONE : GEN_OK }))
      )
    })

    const { operations, stats } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      allowCloud: true,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(call).toBeGreaterThan(2) // kind: tier1+tier2, gen: tier1+tier2
    expect(operations).toHaveLength(1)
    expect(operations[0].op).toBe('rewrite')
    expect(stats.escalations).toBeGreaterThan(0)
  })

  test('allowCloud=false → tier2-хвиля не викликається, fallback одразу', async () => {
    const drafts = [draft('a.md', 'Рішення А', '## Decision Outcome\nChosen option: "X", because Y.')]
    const submitBatchImpl = vi.fn((model, items) => {
      expect(model).toBe('x/tier1') // tier2 не мав викликатись жодного разу
      return Promise.resolve(items.map(i => ({ customId: i.customId, error: 'tier1 down' })))
    })

    const { operations } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      allowCloud: false,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    // kind fallback → standalone → rewrite-decision; gen fallback → invalid → gen-failed (не rewrite, не delete)
    expect(operations).toHaveLength(0)
  })
})

describe('normalizePipeline — fallback коли обидва тири провалились', () => {
  test('gen-MADR fallback: valid=false → операція не додається, драфт просто випадає', async () => {
    const drafts = [draft('a.md', 'Рішення А', '## Decision Outcome\nChosen option: "X", because Y.')]
    const submitBatchImpl = fakeSubmitBatch({
      kind: () => ({ ok: KIND_STANDALONE }),
      gen: () => ({ error: 'both tiers down' })
    })

    const { operations, stats } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(operations).toHaveLength(0)
    expect(stats.madrInvalid).toBe(1)
  })

  test('gen-merge fallback: канонічний заголовок без додаткового змісту', async () => {
    const drafts = [draft('a.md', 'existing normalize topic', '## Decision Outcome\nChosen option: "X", because Y.')]
    const cleanList = ['260101-0000-existing-normalize-topic.md']
    const submitBatchImpl = fakeSubmitBatch({
      dc: () => ({ ok: EDGE_SAME }),
      merge: () => ({ error: 'both tiers down' })
    })

    const { operations } = await normalizePipeline(drafts, cleanList, {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(operations[0].additions).toContain('доповнення з чернетки')
  })
})

describe('normalizePipeline — batching: один виклик на хвилю, не по драфту', () => {
  test('5 незалежних standalone-драфтів — kind-хвиля й gen-хвиля кожна викликається РІВНО раз', async () => {
    // Теми навмисно без жодного спільного токена (інакше buildEdges() дасть
    // dd-ребра за jaccard і додасть третій, edge-judge batch-виклик).
    const TOPICS = [
      'кавове обладнання перевірка',
      'мережевий протокол оновлення',
      'графічний рендер оптимізація',
      'файлова система міграція',
      'аудіо кодек стиснення'
    ]
    const drafts = TOPICS.map((topic, i) =>
      draft(`d${i}.md`, topic, '## Decision Outcome\nChosen option: "X", because Y.')
    )
    const submitBatchImpl = fakeSubmitBatch({
      kind: () => ({ ok: KIND_STANDALONE }),
      gen: () => ({ ok: GEN_OK })
    })

    const { operations } = await normalizePipeline(drafts, [], {
      submitBatchImpl,
      tier1: 'x/tier1',
      tier2: 'x/tier2',
      chainFactory: fakeChainFactory
    })

    expect(submitBatchImpl).toHaveBeenCalledTimes(2)
    expect(submitBatchImpl.mock.calls[0][1]).toHaveLength(5) // kind-хвиля: 5 items
    expect(submitBatchImpl.mock.calls[1][1]).toHaveLength(5) // gen-хвиля: 5 items
    expect(operations).toHaveLength(5)
  })
})
