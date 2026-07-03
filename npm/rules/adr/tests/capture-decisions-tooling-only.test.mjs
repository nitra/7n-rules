/**
 * Інтеграційний тест capture-decisions.sh: structural skip для tooling-only сесій +
 * матриця capture-бекендів (`CAPTURE_DECISIONS_BACKEND`: pi/claude/cursor-agent/auto).
 * Запускає реальний bash-скрипт; дефолтний backend `pi` без бінарника на PATH
 * і без `node_modules/.bin/pi` виходить мовчки. Розрізнюємо по логу + фактом
 * створення `docs/adr/*.md`.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const WROTE_LINE_RE = /wrote: (.+)$/mu
const ADR_FILENAME_RE = /^\d{6}-\d{4}-тестова-назва\.md$/u
const LEGACY_DATE_PREFIX_RE = /^\d{8}-/u

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '.claude-template', 'hooks', 'capture-decisions.sh')

/**
 * Build a JSONL transcript with given tool_use edits.
 * @param {Array<{name: string, file: string}>} edits масив правок
 * @returns {string} jsonl content
 */
function transcriptJsonl(edits) {
  return edits
    .map(e =>
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: e.name, input: { file_path: e.file } }]
        }
      })
    )
    .join('\n')
}

/**
 * Створює fake-виконуваний `pi`: читає stdin, за потреби фіксує факт виклику
 * (`markerFile`) і отримані прапори (`flagsFile`, по рядку на аргумент через
 * `printf '%s\n' "$@"`), пише `output` у stdout (порожній рядок — імітація
 * empty response від pi).
 * @param {string} scriptPath абсолютний шлях виконуваного файлу
 * @param {{ output?: string, flagsFile?: string, markerFile?: string }} [opts] опції
 * @returns {Promise<void>}
 */
async function writeFakePi(scriptPath, { output = '', flagsFile, markerFile } = {}) {
  await mkdir(dirname(scriptPath), { recursive: true })
  const lines = ['#!/usr/bin/env bash']
  if (markerFile) lines.push(`: > '${markerFile}'`)
  if (flagsFile) lines.push(`printf '%s\\n' "$@" > '${flagsFile}'`)
  lines.push('cat >/dev/null')
  if (output) lines.push(`printf '%s' '${output.replaceAll("'", String.raw`'\''`)}'`)
  await writeFile(scriptPath, `${lines.join('\n')}\n`, 'utf8')
  await chmod(scriptPath, 0o755)
}

/**
 * Run capture-decisions.sh in tmp cwd with empty PATH-сегмент для LLM CLI.
 * @param {string} dir абсолютний шлях тимчасової директорії (CLAUDE_PROJECT_DIR + cwd для spawn)
 * @param {string} payload JSON stdin для скрипта (`{transcript_path, session_id}`)
 * @param {Record<string, string>} [extraEnv] додаткові ENV
 * @returns {{exitCode: number, log: string, adrFiles: string[]}} результат прогону
 */
function runCaptureHook(dir, payload, extraEnv = {}) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: payload,
    cwd: dir,
    env: {
      // Тільки системні шляхи без `claude`/`cursor-agent`.
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: dir,
      HOME: env.HOME,
      LANG: env.LANG ?? 'C.UTF-8',
      LC_ALL: env.LC_ALL ?? 'C.UTF-8',
      ...extraEnv
    },
    encoding: 'utf8'
  })
  const logPath = join(dir, '.claude/hooks/capture-decisions.log')
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const adrDir = join(dir, 'docs/adr')
  const adrFiles = existsSync(adrDir) ? readdirSync(adrDir) : []
  return { exitCode: result.status ?? -1, log, adrFiles }
}

describe('capture-decisions.sh — structural tooling-only skip', () => {
  test('tooling-only: лише `.cspell.json` → skip, нічого в docs/adr/', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, '.cspell.json') }]))
      const { log, adrFiles } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12345' }))
      expect(log).toContain('skipping ADR capture: tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('tooling-only: лише docs/adr/ + CHANGELOG → skip', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Write', file: join(dir, 'docs/adr/20260520-101010-foo.md') },
          { name: 'Edit', file: join(dir, 'CHANGELOG.md') }
        ])
      )
      const { log, adrFiles } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12346' }))
      expect(log).toContain('tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('non-tooling: правка `src/foo.ts` → НЕ skip (хук іде до LLM-логіки)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Edit', file: join(dir, 'src/foo.ts') },
          { name: 'Edit', file: join(dir, '.cspell.json') }
        ])
      )
      const { log } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12347' }))
      // Без pi (дефолтний backend) хук доходить до вибору бекенду і виходить з "pi not found".
      // НЕ повинно містити tooling-only skip.
      expect(log).not.toContain('tooling-only session')
      expect(log).toContain('pi not found')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп навіть для чистого tooling', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, '.cspell.json') }]))
      const { exitCode, log } = runCaptureHook(
        dir,
        JSON.stringify({ transcript_path: tpath, session_id: 'abc12348' }),
        { ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0' }
      )
      expect(exitCode).toBe(0)
      expect(log).not.toContain('tooling-only session')
    })
  })

  test('CAPTURE_DECISIONS_BACKEND=claude: LLM-відповідь записується у файл з YYMMDD-HHMM-префіксом, pi не викликається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      await mkdir(join(dir, 'bin'), { recursive: true })
      const fakeClaude = join(dir, 'bin', 'claude')
      await writeFile(
        fakeClaude,
        [
          '#!/usr/bin/env bash',
          'cat >/dev/null',
          String.raw`printf '## ADR Тестова назва\n\n## Context and Problem Statement\nТест.\n'`,
          ''
        ].join('\n'),
        'utf8'
      )
      await chmod(fakeClaude, 0o755)
      // Fake pi поряд у PATH — має лишитись невикликаним, бо BACKEND=claude примусовий.
      const piMarker = join(dir, 'pi-invoked.marker')
      await writeFakePi(join(dir, 'bin', 'pi'), { markerFile: piMarker })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { log, adrFiles } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12349' }), {
        PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
        CAPTURE_DECISIONS_BACKEND: 'claude'
      })

      expect(log).toContain('using claude CLI')
      expect(log).toContain('wrote:')
      expect(existsSync(piMarker)).toBe(false)
      const writtenPath = log.match(WROTE_LINE_RE)?.[1]
      expect(writtenPath).toBeTruthy()
      expect(existsSync(writtenPath)).toBe(true)
      const fileName = writtenPath?.slice(writtenPath.lastIndexOf('/') + 1) ?? ''
      expect(adrFiles).toContain(fileName)
      expect(fileName).toMatch(ADR_FILENAME_RE)
      expect(fileName).not.toMatch(LEGACY_DATE_PREFIX_RE)
    })
  })

  test('дефолтний backend pi: fake pi у node_modules/.bin отримує герметичні прапори, відповідь записується у файл', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const flagsFile = join(dir, 'pi-flags.txt')
      await writeFakePi(join(dir, 'node_modules', '.bin', 'pi'), {
        output: '## ADR Тестова назва\n\n## Context and Problem Statement\nТест.\n',
        flagsFile
      })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { log, adrFiles } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12350' }), {
        CAPTURE_DECISIONS_PI_MODEL: 'omlx/test-model'
      })

      expect(log).toContain('using pi (model: omlx/test-model)')
      const flags = readFileSync(flagsFile, 'utf8').trim().split('\n')
      expect(flags).toEqual([
        '-p',
        '--no-session',
        '--mode',
        'text',
        '--no-tools',
        '--no-context-files',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--offline',
        '--model',
        'omlx/test-model'
      ])
      expect(log).toContain('wrote:')
      const writtenPath = log.match(WROTE_LINE_RE)?.[1]
      expect(writtenPath).toBeTruthy()
      const fileName = writtenPath?.slice(writtenPath.lastIndexOf('/') + 1) ?? ''
      expect(adrFiles).toContain(fileName)
      expect(fileName).toMatch(ADR_FILENAME_RE)
    })
  })

  test('дефолтний backend pi: порожня відповідь → exit 0, log "empty response from pi", draft не створюється', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      await writeFakePi(join(dir, 'node_modules', '.bin', 'pi'), { output: '' })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { exitCode, log, adrFiles } = runCaptureHook(
        dir,
        JSON.stringify({ transcript_path: tpath, session_id: 'abc12351' }),
        { CAPTURE_DECISIONS_PI_MODEL: 'omlx/test-model' }
      )

      expect(exitCode).toBe(0)
      expect(log).toContain('empty response from pi')
      expect(adrFiles).toEqual([])
    })
  })

  test('дефолтний backend pi: без CAPTURE_DECISIONS_PI_MODEL/N_LOCAL_MIN_MODEL → миттєвий skip, fake pi не викликається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const piMarker = join(dir, 'pi-invoked.marker')
      await writeFakePi(join(dir, 'node_modules', '.bin', 'pi'), { markerFile: piMarker })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { exitCode, log } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12352' }))

      expect(exitCode).toBe(0)
      expect(log).toContain('no local model configured')
      expect(existsSync(piMarker)).toBe(false)
    })
  })

  test('CAPTURE_DECISIONS_BACKEND=auto без pi (нема моделі) → fallback на fake claude, лог фіксує обраний бекенд', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      await mkdir(join(dir, 'bin'), { recursive: true })
      const fakeClaude = join(dir, 'bin', 'claude')
      await writeFile(
        fakeClaude,
        [
          '#!/usr/bin/env bash',
          'cat >/dev/null',
          String.raw`printf '## ADR Тестова назва\n\n## Context and Problem Statement\nТест.\n'`,
          ''
        ].join('\n'),
        'utf8'
      )
      await chmod(fakeClaude, 0o755)
      // pi у node_modules/.bin присутній, але без моделі — try_pi має провалитись за доступністю.
      await writeFakePi(join(dir, 'node_modules', '.bin', 'pi'), { output: 'unused' })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { log } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'abc12353' }), {
        PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
        CAPTURE_DECISIONS_BACKEND: 'auto'
      })

      expect(log).toContain('no local model configured')
      expect(log).toContain('using claude CLI')
      expect(log).toContain('wrote:')
    })
  })

  test('CAPTURE_DECISIONS_BACKEND=auto: fake pi повертає порожню відповідь → exit 0, fake claude НЕ викликається', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      await mkdir(join(dir, 'bin'), { recursive: true })
      const claudeMarker = join(dir, 'claude-invoked.marker')
      const fakeClaude = join(dir, 'bin', 'claude')
      await writeFile(fakeClaude, ['#!/usr/bin/env bash', `: > '${claudeMarker}'`, 'cat >/dev/null', ''].join('\n'), 'utf8')
      await chmod(fakeClaude, 0o755)
      await writeFakePi(join(dir, 'node_modules', '.bin', 'pi'), { output: '' })

      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { exitCode, log, adrFiles } = runCaptureHook(
        dir,
        JSON.stringify({ transcript_path: tpath, session_id: 'abc12354' }),
        {
          PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
          CAPTURE_DECISIONS_BACKEND: 'auto',
          CAPTURE_DECISIONS_PI_MODEL: 'omlx/test-model'
        }
      )

      expect(exitCode).toBe(0)
      expect(log).toContain('empty response from pi')
      expect(existsSync(claudeMarker)).toBe(false)
      expect(adrFiles).toEqual([])
    })
  })
})

describe('capture-decisions.sh — ADR_HOOKS_SKIP (оркестраторні сесії)', () => {
  test('ADR_HOOKS_SKIP=1 → exit 0, silent skip: без docs/adr, без лог-файлу', async () => {
    await withTmpDir(async dir => {
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { exitCode, log, adrFiles } = runCaptureHook(
        dir,
        JSON.stringify({ transcript_path: tpath, session_id: 'skip001' }),
        { ADR_HOOKS_SKIP: '1' }
      )
      expect(exitCode).toBe(0)
      expect(log).toBe('')
      expect(adrFiles).toEqual([])
      // Гвард — до mkdir ADR_DIR/LOG_DIR: docs/adr/ навіть не створюється (не лише порожній).
      expect(existsSync(join(dir, 'docs/adr'))).toBe(false)
      expect(existsSync(join(dir, '.claude/hooks'))).toBe(false)
    })
  })
})
