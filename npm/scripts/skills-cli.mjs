/**
 * CLI запуску скілів пакета `@7n/rules` без синку правил у проєкт.
 *
 * Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета (або кешу `npx`).
 * Промпт збирає інструкцію скілу + контекст поточного CWD (`package.json`, `tsconfig.json`,
 * `.n-rules.json`) — далі stdout або виконання через один з раннерів: вбудований
 * pi-агент, чи зовнішній CLI (`cursor`, `codex`, `claude`) через ACP (`@7n/llm-lib/acp`) —
 * особистою підпискою, без argv/stdin-транспорту.
 *
 * Підтримувані формати:
 *   `npx \@7n/rules skill list`
 *   `npx \@7n/rules skill taze`
 *   `npx \@7n/rules skill pi taze` — виконати через вбудований pi-агент (рекомендовано)
 *   `npx \@7n/rules skill pi taze "онови залежності"`
 *   `npx \@7n/rules skill cursor taze` — зовнішній Cursor CLI через ACP (`agent acp`)
 *   `npx \@7n/rules skill codex taze` — зовнішній Codex CLI через ACP-міст
 *   `npx \@7n/rules skill claude taze` — зовнішній Claude Code CLI через ACP-міст
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

import { readSkillMetaRaw, skillTier } from './lib/skill-meta.mjs'

/** Виконавці скіла. `pi` — вбудований (рекомендований); `cursor`/`codex`/`claude` — зовнішні CLI через ACP. */
const RUNNERS = new Set(['pi', 'cursor', 'codex', 'claude'])

const USAGE_LINES = [
  'Usage:',
  '  npx @7n/rules skill list',
  '  npx @7n/rules skill <skill-id> ["task"]',
  '  npx @7n/rules skill pi <skill-id> ["task"]      # вбудований pi-агент (рекомендовано)',
  '  npx @7n/rules skill cursor <skill-id> ["task"]  # зовнішній Cursor CLI (ACP)',
  '  npx @7n/rules skill codex <skill-id> ["task"]   # зовнішній Codex CLI (ACP)',
  '  npx @7n/rules skill claude <skill-id> ["task"]  # зовнішній Claude Code CLI (ACP)',
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
 * Делегує виконання скіла у зовнішній CLI (`cursor`, `codex`, `claude`) через ACP
 * (`@7n/llm-lib/acp`) — особистою підпискою по stdio/JSON-RPC, без argv/stdin-тексту.
 * Дозвіл на tool call ACP-агент отримує напряму від клієнта (автоматичне підтвердження в
 * `runAcpAgent`), тож жодного локального allowlist-обходу (`--force` тощо) не треба —
 * на відміну від старого non-interactive `-p`/`exec` транспорту.
 * @param {'claude' | 'cursor' | 'codex'} kind який ACP-агент запускати
 * @param {string} prompt промпт для `session/prompt`
 * @param {string} projectDir робочий каталог сесії агента
 * @param {{ runAcpAgent?: (kind: string, prompt: string, opts?: object) => Promise<number> }} deps інжекти для тестів
 * @returns {Promise<number>} exit code (0 — `stopReason === 'end_turn'`)
 */
async function runLlmCli(kind, prompt, projectDir, deps = {}) {
  let runAcpAgent = deps.runAcpAgent
  if (runAcpAgent === undefined || runAcpAgent === null) {
    const acpModule = await import('@7n/llm-lib/acp')
    runAcpAgent = acpModule.runAcpAgent
  }
  return runAcpAgent(kind, prompt, { cwd: projectDir })
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
      const task = rest.join(' ')
      const prompt = buildSkillPrompt(skillsRoot, second, task, projectDir)
      if (first === 'pi') {
        return await runPiRunner(prompt, second, skillsRoot, projectDir, logError, deps)
      }
      return await runLlmCli(/** @type {'claude' | 'cursor' | 'codex'} */ (first), prompt, projectDir, deps)
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
