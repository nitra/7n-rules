import { vi, describe, it, expect, beforeEach } from 'vitest'
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))
vi.mock('node:path', () => ({
  join: vi.fn((...args) => args.join('/')),
  basename: vi.fn((p, ext) => {
    const base = p.split('/').pop()
    return ext ? base.replace(ext, '') : base
  }),
  dirname: vi.fn(p => p.substring(0, p.lastIndexOf('/')))
}))

const mockMutant = {
  file: 'src/test.js',
  line: 10,
  col: 5,
  mutantType: 'if-statement',
  original: 'a === 1',
  replacement: 'a === 2'
}
const mockCwd = '/project/root'

describe('buildUserPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a string containing file info', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('line1\nline2\n')
    vi.mocked(execFileSync).mockReturnValue('2 days ago')
    const prompt = buildUserPrompt(mockMutant, mockCwd)
    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('src/test.js')
    expect(prompt).toContain('a === 1')
    expect(prompt).toContain('a === 2')
  })

  it('should handle missing source file gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(execFileSync).mockReturnValue('')
    const prompt = buildUserPrompt(mockMutant, mockCwd)
    expect(typeof prompt).toBe('string')
  })

  it('should handle git failure gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('code')
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('no git')
    })
    const prompt = buildUserPrompt(mockMutant, mockCwd)
    expect(prompt).toContain('no git history')
  })
})

describe('SYSTEM_PROMPT', () => {
  it('should contain required classifier instructions', () => {
    expect(SYSTEM_PROMPT).toContain('mutation testing classifier')
    expect(SYSTEM_PROMPT).toContain('worth-testing')
    expect(SYSTEM_PROMPT).toContain('equivalent')
    expect(SYSTEM_PROMPT).toContain('glue')
  })
})
