import { vi, describe, it, expect, beforeEach } from 'vitest'
import { getFailingTests, buildFixTestsPrompt, fixFailingTests } from '../fix/fix-tests.mjs'
import * as fs from 'node:fs'
import { findTestRules } from '../fix/gen-tests.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  // vitest-shim.mjs (імпортується з fix-tests.mjs) пише shim-конфіг у tmp
  mkdirSync: vi.fn()
}))
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/7n-fix-test'),
  rm: vi.fn().mockResolvedValue()
}))
vi.mock('node:os', () => ({ tmpdir: vi.fn(() => '/tmp'), homedir: vi.fn(() => '/tmp/home') }))
vi.mock('node:path', () => ({
  join: vi.fn((...args) => args.join('/')),
  relative: vi.fn((base, full) => full.replace(base + '/', '')),
  dirname: vi.fn(p => p.split('/').slice(0, -1).join('/'))
}))
vi.mock('@7n/rules/rules/test/coverage/lib/llm.mjs', async importOriginal => {
  const actual = await importOriginal()
  return { callText: vi.fn(), MEMORY_ERROR_RE: actual.MEMORY_ERROR_RE }
})
vi.mock('../fix/gen-tests.mjs', () => ({
  findTestRules: vi.fn().mockReturnValue(null)
}))

const mockDir = '/proj'

const mockVitestResult = {
  numTotalTestSuites: 2,
  numFailedTestSuites: 1,
  testResults: [
    {
      name: '/proj/src/foo.test.mjs',
      status: 'failed',
      assertionResults: [
        {
          ancestorTitles: ['foo'],
          title: 'should return bar',
          status: 'failed',
          failureMessages: ['AssertionError: expected 1 to equal 2\n  at foo.test.mjs:5:10']
        }
      ]
    },
    {
      name: '/proj/src/ok.test.mjs',
      status: 'passed',
      assertionResults: []
    }
  ]
}

describe('getFailingTests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when outputFile does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = await getFailingTests(mockDir)
    expect(result).toEqual([])
  })

  it('returns failing files with errors parsed from JSON', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockVitestResult))

    const result = await getFailingTests(mockDir)

    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('src/foo.test.mjs')
    expect(result[0].errors).toHaveLength(1)
    expect(result[0].errors[0]).toContain('foo > should return bar')
    expect(result[0].errors[0]).toContain('AssertionError')
  })

  it('excludes passed test files', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockVitestResult))

    const result = await getFailingTests(mockDir)
    expect(result.every(f => f.file !== 'src/ok.test.mjs')).toBe(true)
  })

  it('returns empty array when JSON is empty', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ testResults: [] }))
    const result = await getFailingTests(mockDir)
    expect(result).toEqual([])
  })

  it('returns empty array on JSON parse error', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('not-json')
    const result = await getFailingTests(mockDir)
    expect(result).toEqual([])
  })
})

describe('buildFixTestsPrompt', () => {
  it('includes failing file names and errors', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const prompt = buildFixTestsPrompt([{ file: 'src/foo.test.mjs', errors: ['foo > bar:\nAssertionError'] }], mockDir)
    expect(prompt).toContain('src/foo.test.mjs')
    expect(prompt).toContain('AssertionError')
  })

  it('includes instructions to return full file content with file markers', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const prompt = buildFixTestsPrompt([{ file: 'x.test.mjs', errors: ['err'] }], mockDir)
    expect(prompt).toContain('<!-- file:')
    expect(prompt).toContain('ПОВНИЙ вміст')
    expect(prompt).toContain('source-файли не чіпай')
  })

  it('includes TypeScript and env mocking rules', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const prompt = buildFixTestsPrompt([{ file: 'x.test.mjs', errors: ['err'] }], mockDir)
    expect(prompt).toContain('as Type')
    expect(prompt).toContain('vi.mocked(fn)')
    expect(prompt).toContain('vi.stubEnv')
    expect(prompt).toContain('beforeAll, afterAll')
  })

  it('includes current test file content when file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValueOnce("import { vi } from 'vitest'")
    const prompt = buildFixTestsPrompt([{ file: 'src/foo.test.mjs', errors: ['err'] }], mockDir)
    expect(prompt).toContain("import { vi } from 'vitest'")
    expect(prompt).toContain('Поточний тест-файл')
  })

  it('handles multiple failing files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const prompt = buildFixTestsPrompt(
      [
        { file: 'a.test.mjs', errors: ['err1'] },
        { file: 'b.test.mjs', errors: ['err2'] }
      ],
      mockDir
    )
    expect(prompt).toContain('a.test.mjs')
    expect(prompt).toContain('b.test.mjs')
  })

  it('includes project test rules when findTestRules returns content', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(findTestRules).mockReturnValueOnce('## Правила\n- тести у tests/ директорії')
    const prompt = buildFixTestsPrompt([{ file: 'x.test.mjs', errors: ['err'] }], '/proj')
    expect(prompt).toContain('Конвенції тестів цього проєкту')
    expect(prompt).toContain('тести у tests/ директорії')
  })
})

describe('fixFailingTests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns count=0 when no failures', async () => {
    const result = await fixFailingTests(mockDir, { failures: [] })
    expect(result).toEqual({ count: 0, fixed: 0, remaining: 0, touchedFiles: [] })
  })

  it('calls callTextFn and writes fixed file when response contains code', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ testResults: [] }))

    const fixedCode = "import { vi } from 'vitest'\nit('works', () => {})"
    const mockCallTextFn = vi.fn().mockResolvedValue(`<!-- file: src/foo.test.mjs -->\n\`\`\`js\n${fixedCode}\n\`\`\``)
    const failures = [{ file: 'src/foo.test.mjs', errors: ['err'] }]

    await fixFailingTests(mockDir, { failures, callTextFn: mockCallTextFn })

    expect(mockCallTextFn).toHaveBeenCalledOnce()
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('foo.test.mjs'),
      expect.stringContaining(fixedCode),
      'utf8'
    )
  })

  it('falls back to single unnamed code block when one file is being fixed', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ testResults: [] }))

    const fixedCode = "it('ok', () => {})"
    const mockCallTextFn = vi.fn().mockResolvedValue(`\`\`\`js\n${fixedCode}\n\`\`\``)
    const failures = [{ file: 'src/foo.test.mjs', errors: ['err'] }]

    await fixFailingTests(mockDir, { failures, callTextFn: mockCallTextFn })

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('foo.test.mjs'),
      expect.stringContaining(fixedCode),
      'utf8'
    )
  })

  it('returns correct fixed/remaining counts when all tests pass after fix', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ testResults: [] }))

    const failures = [
      { file: 'a.test.mjs', errors: ['err'] },
      { file: 'b.test.mjs', errors: ['err'] }
    ]
    const mockCallTextFn = vi
      .fn()
      .mockResolvedValue(
        '<!-- file: a.test.mjs -->\n```js\nit("ok",()=>{})\n```\n' +
          '<!-- file: b.test.mjs -->\n```js\nit("ok",()=>{})\n```'
      )

    const result = await fixFailingTests(mockDir, { failures, callTextFn: mockCallTextFn })

    expect(result.count).toBe(2)
    expect(result.fixed).toBe(2)
    expect(result.remaining).toBe(0)
  })

  it('reports remaining failures when pi cannot fix all', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        testResults: [
          {
            name: '/proj/b.test.mjs',
            status: 'failed',
            assertionResults: [
              {
                ancestorTitles: [],
                title: 'still failing',
                status: 'failed',
                failureMessages: ['err']
              }
            ]
          }
        ]
      })
    )

    const failures = [
      { file: 'a.test.mjs', errors: ['err'] },
      { file: 'b.test.mjs', errors: ['err'] }
    ]
    const mockCallTextFn = vi
      .fn()
      .mockResolvedValue(
        '<!-- file: a.test.mjs -->\n```js\nit("ok",()=>{})\n```\n' +
          '<!-- file: b.test.mjs -->\n```js\nit("ok",()=>{})\n```'
      )

    const result = await fixFailingTests(mockDir, { failures, callTextFn: mockCallTextFn })

    expect(result.count).toBe(2)
    expect(result.fixed).toBe(1)
    expect(result.remaining).toBe(1)
  })

  it('stops and reports error when callTextFn throws', async () => {
    const mockCallTextFn = vi.fn().mockRejectedValue(new Error('pi timeout'))
    const failures = [{ file: 'src/foo.test.mjs', errors: ['err'] }]

    const result = await fixFailingTests(mockDir, { failures, callTextFn: mockCallTextFn })

    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(result.remaining).toBe(1)
  })
})
