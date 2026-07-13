/**
 * Тести B2 mt-run-node (Фаза B): парсинг контракту вузла, tier-мапінг,
 * violation-текст, runNode/runNodeCli з інʼєкціями (без MT, без pi).
 */

import { describe, expect, test, vi } from 'vitest'
import {
  buildViolationText,
  parseNodeContract,
  recordNodeFixTelemetry,
  resolveTierLabel,
  runNode,
  runNodeCli
} from '../mt-run-node.mjs'

const TASK_MD = [
  '---',
  'schema_version: 1',
  'created_at: 2026-07-11T10:00:00Z',
  'budget_sec: 1800',
  '---',
  '',
  '## Task',
  '',
  'Виправити порушення правила `n-ci4` (concern `app-vue`), які не закрила драбина.',
  '',
  '## Done when',
  '',
  '- `n-ci4` чисте.',
  '',
  '## Check',
  '',
  'npx @7n/rules lint --no-fix --cwd ../.. n-ci4',
  '',
  '## Inputs',
  '',
  'Target-файли:',
  '- `app.vue`',
  '- `src/b.vue`',
  ''
].join('\n')

describe('parseNodeContract', () => {
  test('витягує rule з ## Check, target-файли з ## Inputs, текст задачі', () => {
    const c = parseNodeContract(TASK_MD)
    expect(c.rule).toBe('n-ci4')
    expect(c.targetFiles).toEqual(['app.vue', 'src/b.vue'])
    expect(c.taskText).toContain('Виправити порушення правила')
    expect(c.taskText).not.toContain('## Done when')
  })

  test('whole-repo маркер у Inputs → порожній targetFiles', () => {
    const md = TASK_MD.replace('- `app.vue`\n- `src/b.vue`', '- (whole-repo concern)')
    expect(parseNodeContract(md).targetFiles).toEqual([])
  })

  test('без ## Check → rule null', () => {
    expect(parseNodeContract('## Task\n\nщось\n').rule).toBeNull()
  })
})

describe('resolveTierLabel', () => {
  test('MIM/AVG/MAX → min/avg/max; невідоме → avg', () => {
    expect(resolveTierLabel('MIM')).toBe('min')
    expect(resolveTierLabel('AVG')).toBe('avg')
    expect(resolveTierLabel('MAX')).toBe('max')
    expect(resolveTierLabel('mim')).toBe('min') // case-insensitive
    expect(resolveTierLabel('')).toBe('avg') // порожнє → дефолт
    expect(resolveTierLabel('WAT')).toBe('avg')
  })
})

describe('buildViolationText', () => {
  test('несе текст задачі + перелік target-файлів', () => {
    const t = buildViolationText({ rule: 'n-ci4', targetFiles: ['a.vue'], taskText: 'полагодь X' })
    expect(t).toContain('полагодь X')
    expect(t).toContain('Target-файли: a.vue')
  })
})

describe('runNode', () => {
  test('парсить контракт і кличе fix із правильними rule/tier/cwd/targetFiles', async () => {
    const fix = vi.fn(() => Promise.resolve({ applied: true, touchedFiles: ['app.vue'], error: null }))
    const res = await runNode({
      nodeDir: '/mt/node',
      worktree: '/wt',
      mtTier: 'MAX',
      deps: { readFile: () => TASK_MD, fix }
    })
    expect(res).toEqual({ applied: true, touchedFiles: ['app.vue'], error: null })
    expect(fix).toHaveBeenCalledWith(
      expect.objectContaining({ rule: 'n-ci4', cwd: '/wt', tier: 'max', targetFiles: ['app.vue', 'src/b.vue'] })
    )
  })

  test('нема task.md → структурована помилка, fix не викликається', async () => {
    const fix = vi.fn()
    const res = await runNode({
      nodeDir: '/x',
      worktree: '/wt',
      deps: {
        readFile: () => {
          throw new Error('ENOENT')
        },
        fix
      }
    })
    expect(res.error).toContain('task.md')
    expect(fix).not.toHaveBeenCalled()
  })

  test('task.md без ## Check → помилка "не знайдено правило"', async () => {
    const res = await runNode({ nodeDir: '/x', worktree: '/wt', deps: { readFile: () => '## Task\n\nno check\n' } })
    expect(res.error).toContain('не знайдено правило')
  })
})

describe('recordNodeFixTelemetry (Фаза C)', () => {
  const okRes = {
    applied: true,
    error: null,
    telemetry: {
      edits: [{ path: 'a.vue', edits: [{ oldText: 'X', newText: 'Y' }] }],
      verifyAttempts: [{ ok: true }],
      anchoredEdits: true
    }
  }

  test('успішний фікс із правками → запис у стор (rule/rung/edits/прапорці)', async () => {
    const record = vi.fn()
    await recordNodeFixTelemetry({ rule: 'n-ci4', tier: 'max', model: 'x/y', cwd: '/wt', res: okRes, record })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        rule: 'n-ci4',
        rung: 'mt-max',
        model: 'x/y',
        edits: okRes.telemetry.edits,
        verifyAttempts: 1,
        anchoredEdits: true
      })
    )
  })

  test.each([
    ['не applied', { ...okRes, applied: false }],
    ['error', { ...okRes, error: 'boom' }],
    ['без правок', { ...okRes, telemetry: { edits: [] } }]
  ])('%s → запис не робиться', async (_label, res) => {
    const record = vi.fn()
    await recordNodeFixTelemetry({ rule: 'r', tier: 'avg', model: 'm', cwd: '/wt', res, record })
    expect(record).not.toHaveBeenCalled()
  })
})

describe('runNodeCli', () => {
  test('друкує {applied, touchedFiles} у stdout, exit 0 при успіху', async () => {
    const out = vi.fn()
    const run = vi.fn(() => Promise.resolve({ applied: true, touchedFiles: ['a'], error: null }))
    const code = await runNodeCli(['/mt/node'], { env: { MT_WORKTREE: '/wt', MT_MODEL_TIER: 'AVG' }, out, run })
    expect(code).toBe(0)
    expect(JSON.parse(out.mock.calls[0][0])).toEqual({ applied: true, touchedFiles: ['a'] })
    expect(run).toHaveBeenCalledWith({ nodeDir: '/mt/node', worktree: '/wt', mtTier: 'AVG' })
  })

  test('node-dir з MT_NODE_DIR коли argv порожній', async () => {
    const run = vi.fn(() => Promise.resolve({ applied: false, touchedFiles: [], error: null }))
    await runNodeCli([], { env: { MT_NODE_DIR: '/mt/n' }, out: vi.fn(), run })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ nodeDir: '/mt/n', worktree: '/mt/n' }))
  })

  test('помилка екзекутора → exit 1', async () => {
    const run = vi.fn(() => Promise.resolve({ applied: false, touchedFiles: [], error: 'boom' }))
    const code = await runNodeCli(['/n'], { env: {}, out: vi.fn(), run })
    expect(code).toBe(1)
  })

  test('нема node-dir → exit 1 зі структурованою помилкою', async () => {
    const out = vi.fn()
    const code = await runNodeCli([], { env: {}, out, run: vi.fn() })
    expect(code).toBe(1)
    expect(out.mock.calls[0][0]).toContain('node-dir')
  })
})
