/**
 * Генерація Storybook CSF3 `.stories.*` для непокритих Vue-компонентів
 * (fix-шлях концерну `coverage` правила `test`, \`npx \@7n/rules lint test\`):
 * single-shot LLM на компонент, валідація через Storybook vitest-проєкт
 * самого споживача.
 *
 * Простіше за per-export пайплайн gen-tests.mjs: Vue SFC — одна одиниця
 * (один компонент), тож природна грануля генерації — один story-файл.
 *
 * Валідація жене `bunx vitest run --project=storybook <story>` (browser mode,
 * Playwright) у корені споживача — лише коли той декларує vitest у
 * package.json. Без vitest story все одно записується best-effort з
 * попередженням (graceful degradation, як у gen-tests.mjs).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'

import { callText, MEMORY_ERROR_RE } from '@7n/rules/rules/test/coverage/lib/llm.mjs'

// `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічний import
// (top-level await) — той самий патерн, що `rules/js/eslint/fix-worker.mjs`.
const { budgetFor } = await import('@7n/llm-lib/prompt-budget')
const { startChain } = await import('@7n/llm-lib/chain')

const MAX_SRC_BYTES = 6000
const STORY_MAX_ATTEMPTS = 5
const CODE_BLOCK_RE = /```(?:vue|js|javascript|mjs|ts|typescript)?\n([\s\S]*?)```/
const SCRIPT_LANG_TS_RE = /<script[^>]*\blang\s*=\s*["']ts["'][^>]*>/
const VUE_EXT_RE = /\.vue$/
const FRONTMATTER_RE = /^---[\s\S]*?---\n/

/**
 * Знаходить n-test.mdc правила проєкту, піднімаючись від dir (максимум 4 рівні).
 * Дубльовано з gen-tests.mjs (не імпортовано) — імпорт затягнув би його
 * per-export пайплайн (classify-exports, ast-analyze, runtime-probe) заради
 * ~12-рядкового helper-а.
 * @param {string} dir корінь проєкту
 * @returns {string|null} текст правил або null
 */
function findTestRules(dir) {
  let current = dir
  for (let i = 0; i < 4; i++) {
    const candidate = join(current, '.cursor/rules/n-test.mdc')
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8').replace(FRONTMATTER_RE, '').trim()
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * Читає source-файл і обрізає до prompt-бюджету.
 * @param {string} absPath абсолютний шлях source
 * @returns {string} сніпет source або порожній рядок
 */
function readSourceSnippet(absPath) {
  if (!existsSync(absPath)) return ''
  const content = readFileSync(absPath, 'utf8')
  return content.length > MAX_SRC_BYTES ? `${content.slice(0, MAX_SRC_BYTES)}\n...(truncated)` : content
}

/**
 * Витягує перший fenced-блок коду з текстового виводу LLM.
 * @param {string} text вивід LLM
 * @returns {string} витягнутий код або порожній рядок
 */
function extractCode(text) {
  const m = CODE_BLOCK_RE.exec(text)
  return m ? m[1].trim() : ''
}

/**
 * Виявляє `<script lang="ts">`/`<script setup lang="ts">` — визначає розширення story.
 * @param {string} content source SFC
 * @returns {'ts'|'js'} мова скрипта
 */
function detectScriptLang(content) {
  return SCRIPT_LANG_TS_RE.test(content) ? 'ts' : 'js'
}

/**
 * Імʼя компонента з шляху `.vue`-файлу (basename без розширення).
 * @param {string} file відносний шлях source
 * @returns {string} імʼя компонента
 */
function componentBaseName(file) {
  const base = file.split('/').pop() ?? file
  return base.replace(VUE_EXT_RE, '')
}

/**
 * Шлях story-файлу поряд із компонентом (конвенція Storybook — не `tests/`).
 * @param {string} file відносний шлях `.vue`-source
 * @param {'ts'|'js'} lang мова скрипта
 * @returns {string} відносний шлях `.stories.<ext>`
 */
function storyFilePath(file, lang) {
  const lastSlash = file.lastIndexOf('/')
  const dir = lastSlash === -1 ? '' : file.slice(0, lastSlash)
  const name = componentBaseName(file)
  return dir ? `${dir}/${name}.stories.${lang}` : `${name}.stories.${lang}`
}

/**
 * Будує промпт генерації story для одного Vue-компонента.
 * @param {{file: string, pct: number}} fileInfo непокритий `.vue`-файл
 * @param {string} dir корінь проєкту
 * @returns {{prompt: string, storyRelPath: string, lang: 'ts'|'js'}} промпт і резолвлені шляхи
 */
function buildStoryPrompt(fileInfo, dir) {
  const { file } = fileInfo
  const absPath = join(dir, file)
  const content = readSourceSnippet(absPath)
  const lang = detectScriptLang(content)
  const name = componentBaseName(file)
  const storyRelPath = storyFilePath(file, lang)
  const componentFileName = file.split('/').pop() ?? file
  const testRules = findTestRules(dir)

  const prompt = [
    `Напиши Storybook CSF3 story-файл \`${storyRelPath}\` для Vue-компонента \`${file}\`.`,
    `Компонент: \`${name}\`, файл поряд: \`./${componentFileName}\``,
    '',
    'Правила (СУВОРО):',
    `- Перший рядок: import ${name} from './${componentFileName}'`,
    `- default export: { title: "<логічний шлях за структурою тек>", component: ${name} }`,
    '- Щонайменше один named export-story (наприклад Default) з `args`, що відповідають РЕАЛЬНИМ props компонента (defineProps/props option) — не вигадуй неіснуючі props',
    '- Формат CSF3 (Component Story Format 3) — БЕЗ legacy `storiesOf`, БЕЗ default function-based формату',
    `- Файл ${lang === 'ts' ? 'TypeScript — типізуй Meta/StoryObj через @storybook/vue3' : 'чистий JavaScript — без TS-синтаксису (as Type, generics)'}`,
    `- Поверни лише код у \`\`\`${lang} … \`\`\``,
    ...(testRules ? ['', '## Конвенції проєкту:', testRules] : []),
    '',
    `Source (${file}):`,
    '```vue',
    content || '(недоступно)',
    '```'
  ]
    .filter(Boolean)
    .join('\n')

  return { prompt, storyRelPath, lang }
}

/**
 * Обгортає базовий промпт фідбеком помилок Storybook-vitest для retry.
 * @param {string} basePrompt початковий story-промпт
 * @param {string} prevCode попередній код story
 * @param {string} errors вивід помилок vitest
 * @param {number} attempt номер поточної спроби
 * @returns {string} текст retry-промпту
 */
function buildStoryRetryPrompt(basePrompt, prevCode, errors, attempt) {
  return [
    basePrompt,
    '',
    '---',
    `## Спроба ${attempt}: попередній story-файл не пройшов Storybook vitest (browser mode)`,
    '',
    'Твій попередній варіант:',
    '```',
    prevCode,
    '```',
    '',
    'Помилки:',
    '```',
    errors,
    '```',
    '',
    'Поверни виправлений story-файл у ```… ```'
  ].join('\n')
}

/**
 * Чи декларує package.json проєкту vitest (dependencies або devDependencies).
 * @param {string} dir корінь проєкту
 * @returns {boolean} true якщо vitest оголошено
 */
function hasVitestDep(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return Boolean(pkg.devDependencies?.vitest) || Boolean(pkg.dependencies?.vitest)
  } catch {
    return false
  }
}

/**
 * Валідує записаний story-файл через Storybook vitest-проєкт самого споживача
 * (`bunx vitest run --project=storybook`, browser mode, Playwright). Жене лише
 * коли споживач декларує vitest у package.json — без нього browser mode
 * неможливий (bundled-vitest shim колишнього `\@7n/test` не переносився).
 * @param {string} dir корінь проєкту
 * @param {string} storyRelPath відносний шлях story-файлу (від dir)
 * @returns {{validated: boolean, passed: boolean, errors: string}} результат валідації
 */
function runStoryValidate(dir, storyRelPath) {
  if (!hasVitestDep(dir)) {
    // споживач без vitest — Playwright/Storybook-валідація неможлива
    return { validated: false, passed: true, errors: '' }
  }
  const result = spawnSync('bunx', ['vitest', 'run', '--project=storybook', '--reporter=verbose', storyRelPath], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: process.env
  })
  if (result.status === 0) return { validated: true, passed: true, errors: '' }
  const out = (result.stdout ?? '') + (result.stderr ?? '')
  return { validated: true, passed: false, errors: out.slice(0, 3000) }
}

/**
 * Перетворює LLM-виняток на loop-control стан (дзеркалить gen-tests.mjs —
 * memory-guard помилки пробиваються нагору, решта retry/stop).
 * @param {Error} error спійманий LLM-виняток
 * @param {number} attempt номер поточної спроби
 * @returns {{stop: boolean, lastErrors: string|null}} loop-control стан
 */
function resolveStoryCallFailure(error, attempt) {
  if (MEMORY_ERROR_RE.test(error.message ?? '')) throw error
  console.error(`  ✗ LLM помилка (спроба ${attempt}): ${error.message}`)
  if (attempt >= STORY_MAX_ATTEMPTS) return { stop: true, lastErrors: null }
  return { stop: false, lastErrors: `LLM error: ${error.message}` }
}

/**
 * Записує згенерований код (з recordWrite-реєстрацією) і валідує; при
 * проваленій валідації файл прибирається — невдала спроба не залишає
 * поламаної story.
 * @param {string} dir корінь проєкту
 * @param {string} storyRelPath відносний шлях story
 * @param {string} code згенерований код story
 * @param {typeof runStoryValidate} validateFn функція валідації
 * @param {((absPath: string) => void)|null} recordWrite реєстрація запису для rollback ladder-а
 * @returns {{absStoryPath: string, validated: boolean, passed: boolean, errors: string}} результат запису+валідації
 */
function writeAndValidateStory(dir, storyRelPath, code, validateFn, recordWrite) {
  const absStoryPath = join(dir, storyRelPath)
  mkdirSync(dirname(absStoryPath), { recursive: true })
  recordWrite?.(absStoryPath)
  writeFileSync(absStoryPath, code + '\n', 'utf8')
  const result = validateFn(dir, storyRelPath)
  if (result.validated && !result.passed) rmSync(absStoryPath, { force: true })
  return { absStoryPath, ...result }
}

/**
 * Форматує суфікс "(спроба N)" для success-логу (без вкладеного шаблону).
 * @param {number} attempt номер спроби
 * @returns {string} форматований суфікс
 */
function formatAttemptSuffix(attempt) {
  return ` (спроба ${attempt})`
}

/**
 * Одна LLM-спроба: виклик моделі, витяг коду, перевірка форми. Повертає
 * `{code}` при успіху, `{retry: {lastCode, lastErrors}}` для продовження циклу
 * або `{stop: true}` щоб здатись на цьому файлі.
 * @param {string} prompt промпт цієї спроби
 * @param {import('./gen-tests.mjs').PiCallFn} callTextFn cloud LLM-виклик
 * @param {string} dir корінь проєкту
 * @param {number} attempt номер поточної спроби
 * @returns {Promise<{code: string}|{retry: {lastCode: string|null, lastErrors: string}}|{stop: true}>} результат спроби
 */
async function runStoryAttempt(prompt, callTextFn, dir, attempt) {
  let resp
  try {
    resp = await callTextFn(prompt, { cwd: dir, maxTokens: budgetFor('single-file').maxTokens })
  } catch (error) {
    const failure = resolveStoryCallFailure(error, attempt)
    if (failure.stop) return { stop: true }
    return { retry: { lastCode: null, lastErrors: failure.lastErrors } }
  }

  const code = extractCode(resp)
  if (!code || !code.includes('export default')) {
    return {
      retry: {
        lastCode: code || null,
        lastErrors: 'Story-файл має містити default export з `component`. Поверни лише код у ```… ```'
      }
    }
  }
  return { code }
}

/**
 * Генерує, валідує (run → feedback retry) і записує один story-файл.
 * @param {{file: string, pct: number}} fileInfo непокритий `.vue`-файл
 * @param {string} dir корінь проєкту
 * @param {import('./gen-tests.mjs').PiCallFn} callTextFn cloud LLM-виклик
 * @param {typeof runStoryValidate} validateFn інʼєкція валідації (для тестів)
 * @param {((absPath: string) => void)|null} recordWrite реєстрація запису для rollback ladder-а
 * @returns {Promise<string|null>} шлях записаної story або null
 */
async function generateOneStory(fileInfo, dir, callTextFn, validateFn, recordWrite) {
  const { file } = fileInfo
  const { prompt: basePrompt, storyRelPath } = buildStoryPrompt(fileInfo, dir)

  let lastCode = null
  let lastErrors = null

  for (let attempt = 1; attempt <= STORY_MAX_ATTEMPTS; attempt++) {
    const prompt =
      lastErrors && lastCode ? buildStoryRetryPrompt(basePrompt, lastCode, lastErrors, attempt) : basePrompt

    const outcome = await runStoryAttempt(prompt, callTextFn, dir, attempt)
    if (outcome.stop) return null
    if (outcome.retry) {
      console.log(`    ${file} ✗ спроба ${attempt} невдала → retry`)
      lastCode = outcome.retry.lastCode ?? lastCode
      lastErrors = outcome.retry.lastErrors
      continue
    }

    const { absStoryPath, validated, passed, errors } = writeAndValidateStory(
      dir,
      storyRelPath,
      outcome.code,
      validateFn,
      recordWrite
    )
    if (!validated) {
      console.log(`  ⚠ ${relative(dir, absStoryPath)}: vitest не задекларовано — записано без валідації`)
      return absStoryPath
    }
    if (passed) {
      const suffix = attempt > 1 ? formatAttemptSuffix(attempt) : ''
      console.log(`  ✓ Записано: ${relative(dir, absStoryPath)}${suffix}`)
      return absStoryPath
    }

    console.log(`    ${file} ✗ storybook vitest fail (спроба ${attempt}/${STORY_MAX_ATTEMPTS})`)
    lastCode = outcome.code
    lastErrors = errors
  }

  console.log(`  ⚠ ${file}: ${STORY_MAX_ATTEMPTS} спроб вичерпано — story не записано`)
  return null
}

/**
 * Генерує `.stories.*` для списку непокритих Vue-компонентів.
 * Кожен файл — окрема chain-одиниця (tracing/бюджет, паритет з generateTests).
 * @param {Array<{file: string, pct: number}>} files непокриті `.vue`-файли
 * @param {string} dir корінь проєкту
 * @param {{
 *   callText?: import('./gen-tests.mjs').PiCallFn,
 *   validateStory?: typeof runStoryValidate,
 *   makeChain?: typeof startChain,
 *   recordWrite?: (absPath: string) => void,
 *   deadlineAt?: number|null
 * }} [opts] опції генерації (recordWrite — реєстрація записів для rollback ladder-а;
 *   deadlineAt — epoch-ms дедлайн, новий файл після нього не стартує)
 * @returns {Promise<{touchedFiles: string[]}>} абсолютні шляхи записаних story-файлів
 */
export async function generateStories(files, dir, opts = {}) {
  if (files.length === 0) return { touchedFiles: [] }

  const callTextFn = opts.callText ?? callText
  const validateFn = opts.validateStory ?? runStoryValidate
  const makeChain = opts.makeChain ?? startChain
  const recordWrite = opts.recordWrite ?? null

  console.log(`\n🎨 Генерую Storybook stories для ${files.length} Vue-компонентів...\n`)

  const touchedFiles = []
  for (const fileInfo of files) {
    if (opts.deadlineAt && Date.now() >= opts.deadlineAt) break
    console.log(`  → ${fileInfo.file} (${fileInfo.pct.toFixed(1)}%)`)
    const chain = makeChain({ kind: 'story-generate', unit: fileInfo.file, cwd: dir })
    const chainedCloud = (prompt, callOpts = {}) => callTextFn(prompt, { ...callOpts, chain })
    let failed = null
    try {
      const written = await generateOneStory(fileInfo, dir, chainedCloud, validateFn, recordWrite)
      if (written) touchedFiles.push(written)
    } catch (error) {
      failed = String(error.message ?? error).slice(0, 200)
      throw error
    } finally {
      chain.end({ outcome: failed ? 'fail' : 'success', extra: failed ? { error: failed } : {} })
    }
  }
  return { touchedFiles }
}
