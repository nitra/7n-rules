/**
 * Тести B1 mt-tail (Фаза B): кластеризація хвоста, сигнатура/імʼя вузла, авторство
 * task.md/a.md за контрактом graph.md, materializeTail з інʼєкціями (fail-open,
 * ідемпотентність) — без реального MT і без диска.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  buildAgentFlag,
  buildCheckCommand,
  buildTaskMd,
  clusterTail,
  ensureNodeExecutor,
  fixNodeName,
  fixNodeSignature,
  materializeTail
} from '../mt-tail.mjs'

const V = (ruleId, concernId, file) => (file === undefined ? { ruleId, concernId } : { ruleId, concernId, file })
const CREATED = '2026-07-11T10:00:00Z'
const RE_SIG = /^[0-9a-f]{8}$/
const RE_NODE_NAME = /^lint-fix-n-ci4-app-vue-[0-9a-f]{8}$/

/**
 * Інʼєкції з in-memory ФС для materializeTail.
 * @param {{ ok?: boolean, existing?: Set<string> }} [opts] опції
 * @returns {{ deps: object, writes: Map<string,string>, mkdirs: string[] }} інʼєкції + журнал
 */
function fakeDeps({ ok = true, existing = new Set() } = {}) {
  const writes = new Map()
  const mkdirs = []
  const deps = {
    preflight: () => (ok ? { ok: true } : { ok: false, reason: 'нема .mt.json' }),
    exists: p => existing.has(p),
    mkdir: p => {
      mkdirs.push(p)
    },
    write: (p, c) => {
      writes.set(p, c)
    }
  }
  return { deps, writes, mkdirs }
}

describe('clusterTail', () => {
  test('групує за rule×concern, files унікальні й відсортовані', () => {
    const clusters = clusterTail([
      V('n-ci4', 'app-vue', 'b.vue'),
      V('n-ci4', 'app-vue', 'a.vue'),
      V('n-ci4', 'app-vue', 'a.vue'), // дубль
      V('test', 'location', 'x.spec.mjs')
    ])
    expect(clusters).toEqual([
      { rule: 'n-ci4', concern: 'app-vue', files: ['a.vue', 'b.vue'] },
      { rule: 'test', concern: 'location', files: ['x.spec.mjs'] }
    ])
  })

  test('whole-repo порушення без file → порожній files', () => {
    expect(clusterTail([V('changelog', 'consistency')])).toEqual([
      { rule: 'changelog', concern: 'consistency', files: [] }
    ])
  })
})

describe('fixNodeSignature / fixNodeName', () => {
  test('сигнатура стабільна й не залежить від порядку files', () => {
    const a = fixNodeSignature({ rule: 'r', concern: 'c', files: ['a', 'b'] })
    const b = fixNodeSignature({ rule: 'r', concern: 'c', files: ['b', 'a'] })
    expect(a).toBe(b)
    expect(a).toMatch(RE_SIG)
  })

  test('різні кластери → різні сигнатури', () => {
    expect(fixNodeSignature({ rule: 'r', concern: 'c', files: ['a'] })).not.toBe(
      fixNodeSignature({ rule: 'r', concern: 'c', files: ['b'] })
    )
  })

  test('імʼя: префікс + slug + сигнатура, kebab-безпечне', () => {
    const name = fixNodeName({ rule: 'n-ci4', concern: 'app-vue', files: ['a.vue'] })
    expect(name).toMatch(RE_NODE_NAME)
  })
})

describe('buildTaskMd / buildCheckCommand / buildAgentFlag', () => {
  const cluster = { rule: 'n-ci4', concern: 'app-vue', files: ['app.vue'] }

  test('task.md несе канонічні секції graph.md і re-detect у ## Check', () => {
    const md = buildTaskMd(cluster, { createdAt: CREATED })
    expect(md).toContain('schema_version: 1')
    expect(md).toContain(`created_at: ${CREATED}`)
    expect(md).toContain('## Task')
    expect(md).toContain('## Done when')
    expect(md).toContain('## Check')
    expect(md).toContain('## Inputs')
    expect(md).toContain('npx @nitra/cursor lint --no-fix n-ci4')
    expect(md).toContain('- `app.vue`')
    expect(md).not.toContain('## Mission') // старий канон не пишемо
  })

  test('whole-repo concern → маркер замість переліку файлів', () => {
    const md = buildTaskMd({ rule: 'changelog', concern: 'consistency', files: [] }, { createdAt: CREATED })
    expect(md).toContain('(whole-repo concern)')
  })

  test('buildCheckCommand скоупить правило', () => {
    expect(buildCheckCommand(cluster)).toBe('npx @nitra/cursor lint --no-fix n-ci4')
  })

  test('a.md: агент-прапор із тиром', () => {
    expect(buildAgentFlag({ createdAt: CREATED, modelTier: 'MAX' })).toContain('model_tier: MAX')
    expect(buildAgentFlag({ createdAt: CREATED })).toContain('model_tier: AVG')
  })
})

describe('ensureNodeExecutor', () => {
  test('дописує node_executor коли відсутній', () => {
    let written = null
    const set = ensureNodeExecutor('/p', {
      exists: () => true,
      read: () => JSON.stringify({ mt_dir: './mt' }),
      write: (_p, c) => {
        written = c
      }
    })
    expect(set).toBe(true)
    expect(JSON.parse(written).node_executor).toBe('npx @nitra/cursor mt-run-node')
  })

  test('не перезаписує наявний node_executor (повага до ручного)', () => {
    const write = vi.fn()
    const set = ensureNodeExecutor('/p', {
      exists: () => true,
      read: () => JSON.stringify({ node_executor: 'custom-cmd' }),
      write
    })
    expect(set).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  test('нема .mt.json → no-op', () => {
    expect(ensureNodeExecutor('/p', { exists: () => false })).toBe(false)
  })

  test('битий .mt.json → no-op без винятку', () => {
    expect(ensureNodeExecutor('/p', { exists: () => true, read: () => '{ broken', write: vi.fn() })).toBe(false)
  })
})

describe('materializeTail', () => {
  test('fail-open: preflight не ok → materialized:false, нічого не пише, lint не падає', () => {
    const { deps, writes } = fakeDeps({ ok: false })
    const log = vi.fn()
    const res = materializeTail({ violations: [V('r', 'c', 'a')], cwd: '/p', createdAt: CREATED, log, deps })
    expect(res).toMatchObject({ materialized: false, nodes: [], reason: 'нема .mt.json' })
    expect(writes.size).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('MT-tail пропущено'))
  })

  test('створює вузол на кластер: task.md + a.md у mt/<name>/', () => {
    const { deps, writes, mkdirs } = fakeDeps()
    const res = materializeTail({
      violations: [V('n-ci4', 'app-vue', 'app.vue')],
      cwd: '/p',
      createdAt: CREATED,
      deps
    })
    expect(res.materialized).toBe(true)
    expect(res.nodes).toHaveLength(1)
    const dir = `/p/mt/${res.nodes[0]}`
    expect(mkdirs).toContain(dir)
    expect(writes.get(`${dir}/task.md`)).toContain('## Check')
    expect(writes.get(`${dir}/a.md`)).toContain('model_tier: AVG')
  })

  test('ідемпотентність: наявний вузол пропускається, не переписується', () => {
    const cluster = { rule: 'n-ci4', concern: 'app-vue', files: ['app.vue'] }
    const name = fixNodeName(cluster)
    const { deps, writes } = fakeDeps({ existing: new Set([`/p/mt/${name}`]) })
    const res = materializeTail({
      violations: [V('n-ci4', 'app-vue', 'app.vue')],
      cwd: '/p',
      createdAt: CREATED,
      deps
    })
    expect(res.nodes).toHaveLength(0)
    expect(res.skipped).toEqual([name])
    expect(writes.size).toBe(0)
  })

  test('кілька кластерів → кілька вузлів', () => {
    const { deps, writes } = fakeDeps()
    const res = materializeTail({
      violations: [V('n-ci4', 'app-vue', 'a.vue'), V('test', 'location', 'x.test.mjs')],
      cwd: '/p',
      createdAt: CREATED,
      deps
    })
    expect(res.nodes).toHaveLength(2)
    expect(writes.size).toBe(4) // 2 × (task.md + a.md)
  })
})
