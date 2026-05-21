/**
 * CLI запуску скілів пакета `@nitra/cursor` без синку правил у проєкт.
 *
 * Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета (або кешу `npx`).
 * Промпт збирає інструкцію скілу + контекст поточного CWD (`package.json`, `tsconfig.json`,
 * `.n-cursor.json`) — далі stdout або делегування в `cursor-agent` / `claude`.
 *
 * Підтримувані формати:
 *   `npx @nitra/cursor skill list`
 *   `npx @nitra/cursor skill taze`
 *   `npx @nitra/cursor skill cursor taze`
 *   `npx @nitra/cursor skill cursor taze "онови залежності"`
 *   `npx @nitra/cursor skill claude taze` — те саме через Claude Code CLI
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

const RUNNERS = new Set(['cursor', 'claude'])

const USAGE_LINES = [
  'Usage:',
  '  npx @nitra/cursor skill list',
  '  npx @nitra/cursor skill <skill-id> ["task"]',
  '  npx @nitra/cursor skill cursor <skill-id> ["task"]',
  '  npx @nitra/cursor skill claude <skill-id> ["task"]',
  '',
  'Skill id: каталог у пакеті (lint, taze, …) або з префіксом n- (n-lint → lint).'
]

/**
 * @param {string} name ім'я бінарника
 * @returns {boolean} чи знайдено бінарник у PATH
 */
function isBinaryInPath(name) {
  const probe = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf8' })
  return probe.status === 0
}

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
  const nCursorJson = readIfExists(join(projectDir, '.n-cursor.json'))

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
    nCursorJson ? `## .n-cursor.json\n\n\`\`\`json\n${nCursorJson}\n\`\`\`` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * @param {'claude' | 'cursor'} kind який LLM CLI запускати
 * @param {string} prompt промпт для передачі у stdin
 * @param {string} projectDir робочий каталог дочірнього процесу
 * @returns {number} exit code дочірнього процесу
 */
function runLlmCli(kind, prompt, projectDir) {
  if (kind === 'claude') {
    if (!isBinaryInPath('claude')) {
      throw new Error('`claude` not found in PATH. Install Claude Code CLI or use `skill cursor`.')
    }

    const result = spawnSync('claude', ['-p'], {
      input: prompt,
      cwd: projectDir,
      stdio: ['pipe', 'inherit', 'inherit'],
      encoding: 'utf8'
    })
    return result.status ?? 1
  }

  if (!isBinaryInPath('cursor-agent')) {
    throw new Error('`cursor-agent` not found in PATH. Install Cursor CLI or use `skill claude`.')
  }

  const result = spawnSync('cursor-agent', ['-p'], {
    input: prompt,
    cwd: projectDir,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8'
  })
  return result.status ?? 1
}

/**
 * Корінь пакета `@nitra/cursor` (каталог з `skills/`, `rules/`, …).
 * @param {string} [fromModuleUrl] для тестів — `import.meta.url`, відносно якого шукати корінь
 * @returns {string} абсолютний шлях до кореня пакета
 */
export function resolveBundledPackageRoot(fromModuleUrl = import.meta.url) {
  return join(dirname(fileURLToPath(fromModuleUrl)), '..')
}

/**
 * @param {string[]} argv аргументи після `skill` у `n-cursor`
 * @param {{ packageRoot?: string, projectDir?: string, log?: (line: string) => void, logError?: (line: string) => void }} [options] перевизначення кореня пакета, каталогу проєкту та функцій виводу (для тестів)
 * @returns {number} exit code
 */
export function runSkillsCli(argv, options = {}) {
  const log = options.log ?? (line => console.log(line))
  const logError = options.logError ?? (line => console.error(line))
  const packageRoot = options.packageRoot ?? resolveBundledPackageRoot()
  const skillsRoot = join(packageRoot, 'skills')
  const projectDir = options.projectDir ?? cwd()

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
      return runLlmCli(/** @type {'claude' | 'cursor'} */ (first), prompt, projectDir)
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
