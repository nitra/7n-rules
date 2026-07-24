/**
 * CLI запуску скілів пакета `@7n/rules` без синку правил у проєкт.
 *
 * Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета (або кешу `npx`).
 * Промпт збирає інструкцію скілу + контекст поточного CWD (`package.json`, `tsconfig.json`,
 * `.n-rules.json`) — далі stdout або виконання через один з раннерів: вбудований
 * pi-агент, чи зовнішній ACP-агент. `cursor`/`codex` — через `@7n/llm-lib/acp`
 * (napi-міст до `llm_lib::acp`, без власного JSON-RPC у JS); deprecated
 * `claude` — окремий JS-шим (`./lib/acp-runner.mjs`), бо Rust-крейт його не моделює.
 *
 * `skill <runner> taze` — виняток із загального шляху "весь SKILL.md одним промптом":
 * делегує в `../skills/taze/js/orchestrate.mjs`, який детерміновано (без LLM) робить
 * бекап/масовий bump/diff/прибирання і лише по одному ОБМЕЖЕНОМУ виклику `<runner>`
 * на кожен major-пакет — замість одного величезного непрозорого ходу на весь монорепо
 * (той, single-shot, раніше зависав без діагностики; per-пакет виклики успадковують
 * власний timeout раннера, і падіння одного пакета не втрачає прогрес по інших).
 *
 * Підтримувані формати:
 *   `npx \@7n/rules skill list`
 *   `npx \@7n/rules skill taze`
 *   `npx \@7n/rules skill pi taze` — виконати через вбудований pi-агент (рекомендовано)
 *   `npx \@7n/rules skill pi taze "онови залежності"`
 *   `npx \@7n/rules skill cursor taze` — Cursor CLI через ACP (`cursor-agent acp`)
 *   `npx \@7n/rules skill codex taze` — Codex через ACP (napi-міст `@7n/llm-lib/acp`, Rust спавнить `npx \@agentclientprotocol/codex-acp`)
 *   `npx \@7n/rules skill claude taze` — deprecated: Claude Code через ACP-адаптер
 */

import { runAcpAgent } from '@7n/llm-lib/acp'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import { runAcpRunner } from './lib/acp-runner.mjs'
import { readSkillMetaRaw, skillTier } from './lib/skill-meta.mjs'

/** Виконавці скіла. `pi` — вбудований (рекомендований); `cursor`/`codex`/`claude` — зовнішні ACP-агенти (`claude` — deprecated). */
const RUNNERS = new Set(['pi', 'cursor', 'codex', 'claude'])

/**
 * Раннери, що йдуть через зовнішнього ACP-агента, і чи deprecated (друкує попередження
 * перед запуском). `cursor`/`codex` — napi-міст `@7n/llm-lib/acp`; `claude` — окремий
 * JS-шим `runAcpRunner` (Rust-крейт `llm_lib::acp` `claude` не моделює).
 */
const ACP_RUNNERS = {
  claude: { deprecated: true },
  cursor: { deprecated: false },
  codex: { deprecated: false }
}

const USAGE_LINES = [
  'Usage:',
  '  npx @7n/rules skill list',
  '  npx @7n/rules skill <skill-id> ["task"]',
  '  npx @7n/rules skill pi <skill-id> ["task"]      # вбудований pi-агент (рекомендовано)',
  '  npx @7n/rules skill cursor <skill-id> ["task"]  # Cursor CLI через ACP',
  '  npx @7n/rules skill codex <skill-id> ["task"]   # Codex через ACP-адаптер',
  '  npx @7n/rules skill claude <skill-id> ["task"]  # deprecated',
  '',
  'Skill id: каталог у пакеті (lint, taze, …) або з префіксом n- (n-lint → lint).'
]

/**
 * @param {string} name ім'я скілу з CLI або каталогу `.cursor/skills/n-*`
 * @returns {string} id каталогу в `npm/skills/<id>/`
 */
export function normalizeSkillId(name) {
  if (!name || typeof name !== 'string') {
    return ''
  }
  return name.startsWith('n-') ? name.slice(2) : name
}

/**
 * @param {string} skillsRoot абсолютний шлях до `skills/` пакета
 * @returns {string[]} відсортовані id скілів, що мають `SKILL.md`
 */
export function listSkillIds(skillsRoot) {
  if (!existsSync(skillsRoot)) {
    return []
  }

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(join(skillsRoot, name, 'SKILL.md')))
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * @param {string} skillsRoot абсолютний шлях до `skills/` пакета
 * @param {string} skillId нормалізований id (без префікса n-)
 * @returns {string} шлях до `SKILL.md` скілу
 */
function getSkillMdPath(skillsRoot, skillId) {
  return join(skillsRoot, skillId, 'SKILL.md')
}

/**
 * @param {string} path шлях до файлу
 * @returns {string | null} вміст файлу або `null`, якщо файлу немає
 */
function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * @param {string} skillsRoot абсолютний шлях до `skills/` пакета
 * @param {string} rawSkillName ім'я скілу з CLI (можливо з префіксом n-)
 * @param {string} task текст завдання для скілу
 * @param {string} [projectDir] корінь цільового проєкту (типово — CWD)
 * @returns {string} промпт: інструкція скілу + контекст поточного проєкту
 */
export function buildSkillPrompt(skillsRoot, rawSkillName, task, projectDir = cwd()) {
  const skillId = normalizeSkillId(rawSkillName)
  const skillPath = getSkillMdPath(skillsRoot, skillId)

  if (!skillId || !existsSync(skillPath)) {
    const available = listSkillIds(skillsRoot).join(', ')
    throw new Error(`Unknown skill "${rawSkillName}". Available skills: ${available || '(none)'}`)
  }

  const skill = readFileSync(skillPath, 'utf8')
  const packageJson = readIfExists(join(projectDir, 'package.json'))
  const tsconfig = readIfExists(join(projectDir, 'tsconfig.json'))
  const nCursorJson =
    readIfExists(join(projectDir, '.n-rules.json')) ?? readIfExists(join(projectDir, '.n-cursor.json'))

  return [
    '# Task',
    task || 'Execute the skill instructions for this project.',
    '',
    '# Skill',
    skill,
    '',
    '# Current project',
    `Directory: ${projectDir}`,
    '',
    packageJson ? `## package.json\n\n\`\`\`json\n${packageJson}\n\`\`\`` : '',
    tsconfig ? `## tsconfig.json\n\n\`\`\`json\n${tsconfig}\n\`\`\`` : '',
    nCursorJson ? `## .n-rules.json\n\n\`\`\`json\n${nCursorJson}\n\`\`\`` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Виконує скіл через вбудований pi-агент (рекомендований шлях). Модель — з тиру скіла
 * (`main.json.tier`, дефолт `max`); `cwd` = каталог виклику (worktree, за потреби,
 * створює сам скіл за SKILL.md-preflight). Pi вантажиться lazy.
 * @param {string} prompt готовий `buildSkillPrompt`
 * @param {string} rawSkillName ім'я скілу з CLI (можливо з префіксом n-)
 * @param {string} skillsRoot абсолютний шлях до `skills/` пакета
 * @param {string} projectDir робочий каталог сесії (= каталог виклику)
 * @param {(line: string) => void} logError вивід помилок
 * @param {{ runPiAgentSkill?: (prompt: string, opts?: object) => Promise<{ ok: boolean, error: string|null }> }} deps інжекти для тестів
 * @returns {Promise<number>} exit code (0 — ok)
 */
async function runPiRunner(prompt, rawSkillName, skillsRoot, projectDir, logError, deps = {}) {
  const skillId = normalizeSkillId(rawSkillName)
  const tier = skillTier(readSkillMetaRaw(join(skillsRoot, skillId)))
  let runPiAgentSkill = deps.runPiAgentSkill
  if (runPiAgentSkill === undefined || runPiAgentSkill === null) {
    const piAgentSkillModule = await import('@7n/llm-lib/agent-skill')
    runPiAgentSkill = piAgentSkillModule.runAgentSkill
  }
  const result = await runPiAgentSkill(prompt, { skillId, tier, cwd: projectDir })
  if (result.error) {
    logError(result.error)
  }
  return result.ok ? 0 : 1
}

/**
 * Делегує виконання скіла зовнішньому ACP-агенту. `cursor`/`codex` — через
 * `@7n/llm-lib/acp` (napi-міст до `llm_lib::acp`: спавн, `session/prompt`,
 * автоапрув дозволів — усе в Rust, без JSON-RPC у JS). `claude` — deprecated
 * JS-шим `runAcpRunner` (Rust його не моделює); буде прибрано (мігруй на `skill pi`).
 * На відміну від колишнього стрімінгу по чанках, napi-шлях повертає повний текст
 * лише по завершенню ходу — Rust-функція не стрімить проміжні токени в JS.
 * @param {'claude' | 'cursor' | 'codex'} kind якого ACP-агента запускати
 * @param {string} prompt промпт скіла
 * @param {string} projectDir робочий каталог агента
 * @param {(line: string) => void} logError вивід попередження/помилок
 * @param {{ runAcpRunner?: typeof runAcpRunner, runAcpAgent?: typeof runAcpAgent, out?: (chunk: string) => void }} [deps] інжекти для тестів
 * @returns {Promise<number>} exit code (0 — успіх, 1 — інакше)
 */
async function runLlmCli(kind, prompt, projectDir, logError, deps = {}) {
  const runner = ACP_RUNNERS[kind]

  if (runner.deprecated) {
    logError(`[deprecated] skill ${kind} → use 'skill pi'; зовнішній ACP-агент буде прибрано`)
  }

  if (kind === 'claude') {
    const runAcp = deps.runAcpRunner ?? runAcpRunner
    return runAcp(kind, prompt, projectDir, logError)
  }

  const runNativeAcp = deps.runAcpAgent ?? runAcpAgent
  const out = deps.out ?? (chunk => stdout.write(chunk))

  try {
    out(await runNativeAcp(kind, prompt, projectDir))
    return 0
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/**
 * Виконує `taze` через оркестратор (`../skills/taze/js/orchestrate.mjs`) замість
 * загального одноходового шляху — детерміновані кроки без LLM (бекап/bump/diff/
 * прибирання) + по одному обмеженому виклику обраного `runner` на кожен major-пакет.
 * @param {'pi' | 'cursor' | 'codex'} runner раннер для per-пакетних викликів
 * @param {string} projectDir корінь проєкту (де лежить package.json)
 * @param {(line: string) => void} log вивід прогресу/звіту
 * @param {(line: string) => void} logError вивід помилок
 * @param {{ runTazeOrchestrator?: (opts: object) => Promise<{ ok: boolean, report: string }> }} [deps] інжект для тестів
 * @returns {Promise<number>} exit code (0 — усі major-пакети ok)
 */
async function runTazeOrchestratorCli(runner, projectDir, log, logError, deps = {}) {
  let orchestrate = deps.runTazeOrchestrator
  if (!orchestrate) {
    const orchestrateModule = await import('../skills/taze/js/orchestrate.mjs')
    orchestrate = orchestrateModule.runTazeOrchestrator
  }
  try {
    const result = await orchestrate({ cwd: projectDir, runner, log, deps })
    return result.ok ? 0 : 1
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/**
 * Корінь пакета `@7n/rules` (каталог з `skills/`, `rules/`, …).
 * @param {string} [fromModuleUrl] для тестів — `import.meta.url`, відносно якого шукати корінь
 * @returns {string} абсолютний шлях до кореня пакета
 */
export function resolveBundledPackageRoot(fromModuleUrl = import.meta.url) {
  return join(dirname(fileURLToPath(fromModuleUrl)), '..')
}

/**
 * Чи `argv` (аргументи після `skill`) резолвиться в JS-оркестрований
 * worktree-only `taze`-шлях (`runTazeOrchestratorCli`) — той самий критерій,
 * що й нижче в `runSkillsCli`. Використовується `n-rules.js`, щоб не мутувати
 * root `package.json` (self-upgrade `@7n/rules`) ДО власного worktree-гейту
 * оркестратора: той сам створює worktree і перевіряє чистоту дерева
 * (`ensureRunningInWorktree`, `requireCleanTree: true`) — мутація package.json
 * прямо перед цим викликом примусово провалила б auto-create там, де дерево
 * інакше було б чисте.
 * @param {string[]} argv аргументи після `skill`
 * @returns {boolean} `true`, якщо запуск піде через `runTazeOrchestratorCli`
 */
export function isTazeOrchestratorSkillArgs(argv) {
  const [first, second] = argv
  return RUNNERS.has(first) && first !== 'claude' && normalizeSkillId(second) === 'taze'
}

/**
 * @param {string[]} argv аргументи після `skill` у `n-rules`
 * @param {{ packageRoot?: string, projectDir?: string, log?: (line: string) => void, logError?: (line: string) => void, deps?: { runPiAgentSkill?: (prompt: string, opts?: object) => Promise<{ ok: boolean, error: string|null }> } }} [options] перевизначення кореня пакета, каталогу проєкту, функцій виводу та інжектів (для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runSkillsCli(argv, options = {}) {
  const log = options.log ?? (line => console.log(line))
  const logError = options.logError ?? (line => console.error(line))
  const packageRoot = options.packageRoot ?? resolveBundledPackageRoot()
  const skillsRoot = join(packageRoot, 'skills')
  const projectDir = options.projectDir ?? cwd()
  const deps = options.deps ?? {}

  const [first, second, ...rest] = argv
  const skillIds = listSkillIds(skillsRoot)

  try {
    if (!first) {
      logError(USAGE_LINES.join('\n'))
      return 1
    }

    if (first === 'list') {
      log('Available skills:')
      for (const id of skillIds) {
        log(`- ${id}`)
      }
      return 0
    }

    if (RUNNERS.has(first)) {
      if (!second) {
        throw new Error(`Skill name is required after "${first}"`)
      }
      if (first !== 'claude' && normalizeSkillId(second) === 'taze') {
        return await runTazeOrchestratorCli(
          /** @type {'pi' | 'cursor' | 'codex'} */ (first),
          projectDir,
          log,
          logError,
          deps
        )
      }
      const task = rest.join(' ')
      const prompt = buildSkillPrompt(skillsRoot, second, task, projectDir)
      if (first === 'pi') {
        return await runPiRunner(prompt, second, skillsRoot, projectDir, logError, deps)
      }
      return await runLlmCli(/** @type {'claude' | 'cursor' | 'codex'} */ (first), prompt, projectDir, logError, deps)
    }

    if (skillIds.includes(normalizeSkillId(first))) {
      const task = [second, ...rest].filter(Boolean).join(' ')
      log(buildSkillPrompt(skillsRoot, first, task, projectDir))
      return 0
    }

    logError(USAGE_LINES.join('\n'))
    return 1
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    return 1
  }
}
