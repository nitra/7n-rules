/**
 * Тести run-v8r.mjs: відсутній каталог схем (→2), помилка spawn (→1),
 * ненульовий exitCode з stdout/stderr (lines 44-48, 60-62, 66-73).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

vi.mock('../../../../scripts/utils/spawn-async.mjs', async () => {
  const actual = await vi.importActual('../../../../scripts/utils/spawn-async.mjs')
  return { ...actual, spawnAsync: vi.fn(actual.spawnAsync) }
})

const { runV8rWithGlobs } = await import('../main.mjs')
const { spawnAsync } = await import('../../../../scripts/utils/spawn-async.mjs')

describe('runV8rWithGlobs — error paths', () => {
  afterEach(() => vi.clearAllMocks())

  test('existsSync → false → повертає 2 і пише в stderr (lines 44-48)', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stderr.write = origErr
    }
    expect(result).toEqual({ code: 2, detail: '' })
    expect(errChunks.join('')).toContain('каталог схем')
  })

  test('spawnAsync spawn-помилка → повертає 1 і пише в stderr (lines 60-62)', async () => {
    vi.mocked(spawnAsync).mockRejectedValueOnce(new Error('mock spawn ENOENT'))
    const errChunks = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stderr.write = origErr
    }
    expect(result).toEqual({ code: 1, detail: '' })
    expect(errChunks.join('')).toContain('mock spawn ENOENT')
  })

  test('exitCode=1, verbose → виводить raw stdout і stderr, повертає exitCode', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: 'validation error output\n',
      stderr: 'v8r stderr msg\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    const outChunks = []
    const errChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    const origErr = process.stderr.write.bind(process.stderr)
    process.stdout.write = chunk => {
      outChunks.push(String(chunk))
      return true
    }
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.json'], true)
    } finally {
      process.stdout.write = origOut
      process.stderr.write = origErr
    }
    expect(result.code).toBe(1)
    expect(outChunks.join('')).toContain('validation error output')
    expect(errChunks.join('')).toContain('v8r stderr msg')
  })

  test('exitCode=1 без verbose, ajv-деталь у stdout / ✖-заголовок+ℹ-шум у stderr (реальний v8r-розклад при schema violation) → detail з обох потоків без ℹ-шуму', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: "docs/layers.json# must NOT have additional properties, found additional property 'unknownField'\n",
      stderr: 'ℹ Processing docs/layers.json\nℹ Pre-warming the cache\n✖ docs/layers.json is invalid\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    const outChunks = []
    const errChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    const origErr = process.stderr.write.bind(process.stderr)
    process.stdout.write = chunk => {
      outChunks.push(String(chunk))
      return true
    }
    process.stderr.write = chunk => {
      errChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stdout.write = origOut
      process.stderr.write = origErr
    }
    expect(result).toEqual({
      code: 1,
      detail:
        "docs/layers.json# must NOT have additional properties, found additional property 'unknownField'\n✖ docs/layers.json is invalid"
    })
    expect(outChunks.join('')).toBe(`${result.detail}\n`)
    expect(errChunks.join('')).toBe('')
  })

  test('exitCode ≠ 0/98, уся детальна причина у stderr, stdout порожній ("не знайдено схему") → detail не порожній', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: '',
      stderr: 'ℹ Processing weird.json\n✖ Could not find a schema to validate weird.json\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    let result
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      result = await runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result).toEqual({ code: 1, detail: '✖ Could not find a schema to validate weird.json' })
  })

  test('exitCode=1 без stdout/stderr → повертає exitCode без виводу (line 73)', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    const outChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => {
      outChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.json'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result).toEqual({ code: 1, detail: '' })
    expect(outChunks.join('')).toBe('')
  })

  test('exitCode=1, деталь — лише ajv schema-compile-помилка (несправна зовнішня схема, реальний розклад azure-pipelines.yml) → code примусово 0, ⚠-попередження замість ✖-порушення', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: '',
      stderr:
        'ℹ Processing azure-pipelines.yml\n' +
        'ℹ Validating azure-pipelines.yml against schema from https://raw.githubusercontent.com/microsoft/azure-pipelines-vscode/master/service-schema.json ...\n' +
        '✖ Invalid regular expression: /^[^\\/~\\^\\: \\[\\]\\\\]+(\\/[^\\/~\\^\\: \\[\\]\\\\]+)*$/u: Invalid escape\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    const outChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => {
      outChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.yml'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result).toEqual({ code: 0, detail: '' })
    const printed = outChunks.join('')
    expect(printed).toContain('⚠ run-v8r: зовнішня схема не компілюється в ajv')
    expect(printed).toContain('Invalid regular expression')
  })

  test('exitCode=1, ✔-успіхи інших файлів того ж batch-виклику по glob-у ПЕРЕД ajv schema-compile-помилкою (реальний розклад: bunx n-rules lint --no-fix --full, **/*.yml матчить кілька yml-файлів за один виклик v8r) → все одно code примусово 0, ✔-рядки не трактуються як genuine-помилка', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: '',
      stderr:
        '✔ .github/actions/setup-bun-deps/action.yml is valid\n' +
        '✔ .github/workflows/run-nexus-schema.yml is valid\n' +
        '✔ .github/workflows/sync-to-azure.yml is valid\n' +
        '✔ .graphqlrc.yml is valid\n' +
        '✖ Invalid regular expression: /^[^\\/~\\^\\: \\[\\]\\\\]+(\\/[^\\/~\\^\\: \\[\\]\\\\]+)*$/u: Invalid escape\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    const outChunks = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => {
      outChunks.push(String(chunk))
      return true
    }
    let result
    try {
      result = await runV8rWithGlobs(['**/*.yml'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result).toEqual({ code: 0, detail: '' })
    const printed = outChunks.join('')
    expect(printed).toContain('⚠ run-v8r: зовнішня схема не компілюється в ajv')
    expect(printed).not.toContain('is valid')
  })

  test('exitCode=1, ajv schema-compile-рядок ЗМІШАНИЙ з genuine validation-помилкою в тому ж batch → лишається без змін (не маскуємо реальну проблему)', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: "other.yml# must NOT have additional properties, found additional property 'unknownField'\n",
      stderr:
        '✖ Invalid regular expression: /^[^\\/~\\^\\: \\[\\]\\\\]+(\\/[^\\/~\\^\\: \\[\\]\\\\]+)*$/u: Invalid escape\n' +
        '✖ other.yml is invalid\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    let result
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      result = await runV8rWithGlobs(['**/*.yml'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result.code).toBe(1)
    expect(result.detail).toContain('Invalid regular expression')
    expect(result.detail).toContain('other.yml is invalid')
  })

  test('exitCode=1, ✔-успіхи ЗМІШАНІ з genuine validation-помилкою (без ajv schema-compile) → лишається без змін, ✔-фільтр не ковтає реальну проблему', async () => {
    vi.mocked(spawnAsync).mockResolvedValueOnce({
      stdout: "other.yml# must NOT have additional properties, found additional property 'unknownField'\n",
      stderr: '✔ ok.yml is valid\n✖ other.yml is invalid\n',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false
    })
    let result
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      result = await runV8rWithGlobs(['**/*.yml'])
    } finally {
      process.stdout.write = origOut
    }
    expect(result.code).toBe(1)
    expect(result.detail).toContain('other.yml is invalid')
  })
})
