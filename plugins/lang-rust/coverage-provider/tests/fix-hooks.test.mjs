import { describe, expect, test, vi } from 'vitest'

vi.mock('@7n/llm-lib/agent-fix', () => ({
  runAgentFix: vi.fn(() => Promise.resolve({ touchedFiles: ['/p/src/lib.rs'] }))
}))
vi.mock('@7n/llm-lib/model-tiers', () => ({ CLOUD_MAX: 'cloud/max' }))

const { generateRustTests, fixRustSurvived } = await import('../fix-hooks.mjs')
const { runAgentFix } = await import('@7n/llm-lib/agent-fix')

const CTX = { recordWrite: vi.fn(), tier: 'cloud-min', timeoutMs: 60_000 }

describe('fix-hooks — делегація у runAgentFix', () => {
  test('generateRustTests: ladder ctx-поля і фільтр .rs', async () => {
    const res = await generateRustTests({
      cwd: '/p',
      files: [
        { file: 'src/lib.rs', pct: 10 },
        { file: 'src/app.mjs', pct: 0 }
      ],
      ctx: CTX
    })
    expect(res.touchedFiles).toEqual(['/p/src/lib.rs'])
    expect(runAgentFix).toHaveBeenCalledWith(
      'test',
      expect.stringContaining('src/lib.rs'),
      '/p',
      expect.objectContaining({ tier: 'cloud-min', recordWrite: CTX.recordWrite, targetFiles: ['src/lib.rs'] })
    )
  })

  test('generateRustTests: без .rs-файлів → no-op без сесії', async () => {
    vi.mocked(runAgentFix).mockClear()
    expect(await generateRustTests({ cwd: '/p', files: [{ file: 'a.py', pct: 0 }], ctx: CTX })).toEqual({
      touchedFiles: []
    })
    expect(runAgentFix).not.toHaveBeenCalled()
  })

  test('fixRustSurvived: сесія по survived-групах, помилка не кидається', async () => {
    vi.mocked(runAgentFix).mockResolvedValueOnce({ error: 'timeout', touchedFiles: [] })
    const res = await fixRustSurvived({
      cwd: '/p',
      survived: [
        { file: 'src/lib.rs', mutants: [{ line: 6, mutantType: 'FnValue', original: 'main', replacement: '()' }] }
      ],
      ctx: CTX
    })
    expect(res).toEqual({ touchedFiles: [] })
  })
})
