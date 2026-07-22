import { describe, expect, test, vi } from 'vitest'

import provider from '../provider.mjs'

vi.mock('../fix/assess-need.mjs', () => ({
  assessNeed: vi.fn(files => Promise.resolve(files.map(f => ({ ...f, needsTests: true, reason: '' }))))
}))
vi.mock('../fix/gen-tests.mjs', () => ({
  generateTests: vi.fn(() => Promise.resolve({ touchedFiles: ['/p/tests/a.test.mjs'] }))
}))
vi.mock('../fix/gen-stories.mjs', () => ({
  generateStories: vi.fn(() => Promise.resolve({ touchedFiles: ['/p/src/A.stories.js'] }))
}))
vi.mock('../fix/coverage-fix.mjs', () => ({
  fixSurvivedMutants: vi.fn(() => Promise.resolve({ fixed: [], failed: [], touchedFiles: ['/p/tests/b.test.mjs'] }))
}))
vi.mock('../fix/fix-tests.mjs', () => ({
  fixFailingTests: vi.fn(() => Promise.resolve({ count: 0, fixed: 0, remaining: 0, touchedFiles: [] }))
}))

const CTX = { recordWrite: vi.fn(), model: 'm', tier: 'cloud-min', timeoutMs: 60_000 }

describe('fix-hooks провайдера — делегація у fix-модулі', () => {
  test('generateTests: assess-need → gen-tests, повертає touchedFiles', async () => {
    const res = await provider.generateTests({ cwd: '/p', files: [{ file: 'src/a.mjs', pct: 10 }], ctx: CTX })
    expect(res.touchedFiles).toEqual(['/p/tests/a.test.mjs'])
    const { generateTests } = await import('../fix/gen-tests.mjs')
    expect(generateTests).toHaveBeenCalledWith(
      [expect.objectContaining({ file: 'src/a.mjs', needsTests: true })],
      '/p',
      expect.objectContaining({ recordWrite: CTX.recordWrite, deadlineAt: expect.any(Number) })
    )
  })

  test('generateTests: порожній список → без імпорту fix-модулів', async () => {
    expect(await provider.generateTests({ cwd: '/p', files: [], ctx: CTX })).toEqual({ touchedFiles: [] })
  })

  test('generateStories: делегує з recordWrite/deadline', async () => {
    const res = await provider.generateStories({ cwd: '/p', files: [{ file: 'src/A.vue', pct: 0 }], ctx: CTX })
    expect(res.touchedFiles).toEqual(['/p/src/A.stories.js'])
  })

  test('generateStories: порожній список → no-op', async () => {
    expect(await provider.generateStories({ cwd: '/p', files: [], ctx: CTX })).toEqual({ touchedFiles: [] })
  })

  test('fixSurvived: прокидає ladder ctx-поля у fixSurvivedMutants', async () => {
    const res = await provider.fixSurvived({ cwd: '/p', survived: [{ file: 'a.js', mutants: [{}] }], ctx: CTX })
    expect(res.touchedFiles).toEqual(['/p/tests/b.test.mjs'])
    const { fixSurvivedMutants } = await import('../fix/coverage-fix.mjs')
    expect(fixSurvivedMutants).toHaveBeenCalledWith(
      [{ file: 'a.js', mutants: [{}] }],
      '/p',
      expect.objectContaining({ model: 'm', tier: 'cloud-min', timeoutMs: 60_000, recordWrite: CTX.recordWrite })
    )
  })

  test('fixSurvived: порожній survived → no-op', async () => {
    expect(await provider.fixSurvived({ cwd: '/p', survived: [], ctx: CTX })).toEqual({ touchedFiles: [] })
  })

  test('fixFailingTests: делегує з model/recordWrite/deadline', async () => {
    const res = await provider.fixFailingTests({ cwd: '/p', ctx: CTX })
    expect(res).toEqual({ touchedFiles: [] })
    const { fixFailingTests } = await import('../fix/fix-tests.mjs')
    expect(fixFailingTests).toHaveBeenCalledWith(
      '/p',
      expect.objectContaining({ model: 'm', recordWrite: CTX.recordWrite, deadlineAt: expect.any(Number) })
    )
  })

  test('ctx без timeoutMs → deadlineAt null', async () => {
    const { fixFailingTests } = await import('../fix/fix-tests.mjs')
    vi.mocked(fixFailingTests).mockClear()
    await provider.fixFailingTests({ cwd: '/p', ctx: { recordWrite: vi.fn() } })
    expect(vi.mocked(fixFailingTests).mock.calls[0][1].deadlineAt).toBeNull()
  })
})
