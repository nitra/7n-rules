import { vi, describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { generateStories } from '../fix/gen-stories.mjs'
import { callText } from '@7n/rules/rules/test/coverage/lib/llm.mjs'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn()
}))
vi.mock('node:path', () => ({
  join: vi.fn((...a) => a.join('/')),
  relative: vi.fn((base, full) => (full.startsWith(base + '/') ? full.slice(base.length + 1) : full)),
  dirname: vi.fn(p => p.split('/').slice(0, -1).join('/'))
}))
// runStoryValidate спавнить реальний сабпроцес лише коли тест НЕ передає opts.validateStory —
// у більшості кейсів валідацію інжектимо напряму; spawnSync — запас для тесту
// дефолтного runStoryValidate.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '', stderr: '' })
}))
vi.mock('@7n/rules/rules/test/coverage/lib/llm.mjs', async importOriginal => {
  const actual = await importOriginal()
  return { callText: vi.fn(), MEMORY_ERROR_RE: actual.MEMORY_ERROR_RE }
})

const mockDir = '/proj'
const CSF3_CODE =
  "```js\nimport Card from './Card.vue'\nexport default { component: Card }\nexport const Default = {}\n```"

describe('generateStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false) // немає n-test.mdc за замовч.
    vi.mocked(readFileSync).mockReturnValue('<template><div /></template>\n')
  })

  it('does nothing for an empty file list', async () => {
    const result = await generateStories([], mockDir)
    expect(callText).not.toHaveBeenCalled()
    expect(result).toEqual({ touchedFiles: [] })
  })

  it('writes a validated story next to the component and returns touchedFiles', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    const result = await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(writeFileSync).toHaveBeenCalledWith(
      '/proj/src/Card.stories.js',
      expect.stringContaining("import Card from './Card.vue'"),
      'utf8'
    )
    expect(validateStory).toHaveBeenCalledWith(mockDir, 'src/Card.stories.js')
    expect(rmSync).not.toHaveBeenCalled()
    expect(result.touchedFiles).toEqual(['/proj/src/Card.stories.js'])
  })

  it('calls recordWrite before writing the story file', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })
    const calls = []
    const recordWrite = vi.fn(() => {
      calls.push('record')
    })
    vi.mocked(writeFileSync).mockImplementation(() => {
      calls.push('write')
    })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory, recordWrite })

    expect(recordWrite).toHaveBeenCalledWith('/proj/src/Card.stories.js')
    expect(calls).toEqual(['record', 'write'])
  })

  it('uses .stories.ts for <script setup lang="ts">', async () => {
    vi.mocked(existsSync).mockImplementation(p => !String(p).includes('n-test.mdc'))
    vi.mocked(readFileSync).mockReturnValue('<script setup lang="ts">defineProps<{x:number}>()</script>\n')
    vi.mocked(callText).mockResolvedValue(
      "```ts\nimport Card from './Card.vue'\nexport default { component: Card }\n```"
    )
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(writeFileSync).toHaveBeenCalledWith('/proj/src/Card.stories.ts', expect.any(String), 'utf8')
  })

  it('includes project n-test.mdc conventions in the prompt when present', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation(p =>
      String(p).includes('n-test.mdc') ? '---\ntitle: x\n---\n## Правила\n- тест поряд' : '<template />'
    )
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    const prompt = vi.mocked(callText).mock.calls[0][0]
    expect(prompt).toContain('тест поряд')
  })

  it('retries with vitest error feedback and eventually succeeds', async () => {
    vi.mocked(callText).mockResolvedValueOnce(CSF3_CODE).mockResolvedValueOnce(CSF3_CODE)
    const validateStory = vi
      .fn()
      .mockReturnValueOnce({ validated: true, passed: false, errors: 'render error: missing prop' })
      .mockReturnValueOnce({ validated: true, passed: true, errors: '' })

    const result = await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(callText).toHaveBeenCalledTimes(2)
    expect(validateStory).toHaveBeenCalledTimes(2)
    const retryPrompt = vi.mocked(callText).mock.calls[1][0]
    expect(retryPrompt).toContain('render error: missing prop')
    expect(result.touchedFiles).toEqual(['/proj/src/Card.stories.js'])
  })

  it('removes the file on failed validation before retry', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: false, errors: 'fail' })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(rmSync).toHaveBeenCalledWith('/proj/src/Card.stories.js', { force: true })
  })

  it('gives up after STORY_MAX_ATTEMPTS failed validations', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: false, errors: 'always fails' })

    const result = await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(callText).toHaveBeenCalledTimes(5)
    expect(validateStory).toHaveBeenCalledTimes(5)
    expect(result.touchedFiles).toEqual([])
  })

  it('writes without validation when validation is unavailable (validated: false)', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: false, passed: true, errors: '' })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(callText).toHaveBeenCalledTimes(1) // жодного retry — прийнято одразу
    expect(rmSync).not.toHaveBeenCalled()
  })

  it('retries when the LLM returns no valid default export', async () => {
    vi.mocked(callText).mockResolvedValueOnce('no code fences here').mockResolvedValueOnce(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, { validateStory })

    expect(callText).toHaveBeenCalledTimes(2)
    const retryPrompt = vi.mocked(callText).mock.calls[1][0]
    expect(retryPrompt).toContain('default export')
  })

  it('propagates memory-guard errors without retrying', async () => {
    const memErr = new Error('omlx memory guard: prefill would require too much RAM')
    vi.mocked(callText).mockRejectedValue(memErr)

    await expect(generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, {})).rejects.toThrow(memErr.message)

    expect(callText).toHaveBeenCalledTimes(1)
  })

  it('stops after STORY_MAX_ATTEMPTS on repeated LLM errors (non-memory)', async () => {
    vi.mocked(callText).mockRejectedValue(new Error('rate limited'))

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, {})

    expect(callText).toHaveBeenCalledTimes(5)
  })

  it('falls back to the real runStoryValidate (no vitest dep → validated:false) when no validateStory injected', async () => {
    // package.json проєкту не існує (existsSync=false) → hasVitestDep=false →
    // runStoryValidate повертає validated:false — записано без валідації.
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)

    await generateStories([{ file: 'src/Card.vue', pct: 0 }], mockDir, {})

    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(callText).toHaveBeenCalledTimes(1)
  })

  it('processes multiple files independently, each as its own chain unit', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    await generateStories(
      [
        { file: 'src/Card.vue', pct: 0 },
        { file: 'src/Button.vue', pct: 20 }
      ],
      mockDir,
      { validateStory }
    )

    expect(callText).toHaveBeenCalledTimes(2)
    expect(validateStory).toHaveBeenCalledWith(mockDir, 'src/Card.stories.js')
    expect(validateStory).toHaveBeenCalledWith(mockDir, 'src/Button.stories.js')
  })

  it('stops starting new files after deadlineAt', async () => {
    vi.mocked(callText).mockResolvedValue(CSF3_CODE)
    const validateStory = vi.fn().mockReturnValue({ validated: true, passed: true, errors: '' })

    const result = await generateStories(
      [
        { file: 'src/Card.vue', pct: 0 },
        { file: 'src/Button.vue', pct: 20 }
      ],
      mockDir,
      { validateStory, deadlineAt: Date.now() - 1 }
    )

    expect(callText).not.toHaveBeenCalled()
    expect(result.touchedFiles).toEqual([])
  })
})
