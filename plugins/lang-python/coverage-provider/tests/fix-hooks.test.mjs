import { describe, expect, test, vi } from 'vitest'

vi.mock('@7n/llm-lib/agent-fix', () => ({
  runAgentFix: vi.fn(() => Promise.resolve({ touchedFiles: ['/p/tests/test_calc.py'] }))
}))
vi.mock('@7n/llm-lib/model-tiers', () => ({ CLOUD_MAX: 'cloud/max' }))

const { generatePythonTests, fixPythonSurvived, buildGenTestsPrompt, buildFixSurvivedPrompt } =
  await import('../fix-hooks.mjs')
const { runAgentFix } = await import('@7n/llm-lib/agent-fix')

const CTX = { recordWrite: vi.fn(), tier: 'cloud-min', timeoutMs: 60_000 }

describe('python fix-hooks', () => {
  test('buildGenTestsPrompt: файли, відсотки, pytest-канон', () => {
    const p = buildGenTestsPrompt([{ file: 'src/pkg/calc.py', pct: 40 }])
    expect(p).toContain('src/pkg/calc.py')
    expect(p).toContain('40.0%')
    expect(p).toContain('uv run pytest')
  })

  test('buildFixSurvivedPrompt: мутанти з рядками', () => {
    const p = buildFixSurvivedPrompt([
      { file: 'src/pkg/calc.py', mutants: [{ line: 3, original: 'a > 100', replacement: 'a >= 100' }] }
    ])
    expect(p).toContain('рядок 3')
    expect(p).toContain('a >= 100')
  })

  test('generatePythonTests: делегація з ladder ctx і фільтром .py', async () => {
    const res = await generatePythonTests({
      cwd: '/p',
      files: [
        { file: 'src/pkg/calc.py', pct: 10 },
        { file: 'src/app.mjs', pct: 0 }
      ],
      ctx: CTX
    })
    expect(res.touchedFiles).toEqual(['/p/tests/test_calc.py'])
    expect(runAgentFix).toHaveBeenCalledWith(
      'test',
      expect.stringContaining('calc.py'),
      '/p',
      expect.objectContaining({ tier: 'cloud-min', recordWrite: CTX.recordWrite, targetFiles: ['src/pkg/calc.py'] })
    )
  })

  test('fixPythonSurvived: порожній survived → no-op', async () => {
    vi.mocked(runAgentFix).mockClear()
    expect(await fixPythonSurvived({ cwd: '/p', survived: [], ctx: CTX })).toEqual({ touchedFiles: [] })
    expect(runAgentFix).not.toHaveBeenCalled()
  })

  test('помилка сесії не кидається — повертаються touchedFiles', async () => {
    vi.mocked(runAgentFix).mockResolvedValueOnce({ error: 'timeout', touchedFiles: [] })
    const res = await fixPythonSurvived({
      cwd: '/p',
      survived: [{ file: 'src/pkg/calc.py', mutants: [{ line: 1, original: 'x', replacement: 'y' }] }],
      ctx: CTX
    })
    expect(res).toEqual({ touchedFiles: [] })
  })
})
