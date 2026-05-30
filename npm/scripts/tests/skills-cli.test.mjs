/**
 * Тести CLI скілів: list, normalize, buildPrompt, runSkillsCli.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'

import { buildSkillPrompt, listSkillIds, normalizeSkillId, resolveBundledPackageRoot, runSkillsCli } from '../skills-cli.mjs'

const UNKNOWN_SKILL_RE = /Unknown skill.*lint/
const SKILL_NAME_REQUIRED_RE = /Skill name is required/
const USAGE_HINT_RE = /skill list/

describe('normalizeSkillId', () => {
  test('n-lint → lint', () => {
    expect(normalizeSkillId('n-lint')).toBe('lint')
  })

  test('lint без змін', () => {
    expect(normalizeSkillId('lint')).toBe('lint')
  })

  test('порожній рядок → порожній рядок', () => {
    expect(normalizeSkillId('')).toBe('')
  })

  test('null/undefined → порожній рядок', () => {
    expect(normalizeSkillId(/** @type {string} */ (null))).toBe('')
    expect(normalizeSkillId(/** @type {string} */ (undefined))).toBe('')
  })
})

describe('resolveBundledPackageRoot', () => {
  test('повертає абсолютний шлях до кореня пакета (npm/)', () => {
    const root = resolveBundledPackageRoot()
    expect(root).toBeTruthy()
    expect(typeof root).toBe('string')
  })
})

describe('listSkillIds / buildSkillPrompt', () => {
  test('директорія не існує → порожній масив', () => {
    expect(listSkillIds('/nonexistent/skills/dir')).toEqual([])
  })

  test('лише каталоги з SKILL.md', () => {
    const root = join(tmpdir(), `skills-cli-test-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'alpha'), { recursive: true })
    mkdirSync(join(skillsRoot, 'beta'), { recursive: true })
    mkdirSync(join(skillsRoot, 'empty'), { recursive: true })
    writeFileSync(join(skillsRoot, 'alpha', 'SKILL.md'), '# Alpha\n')
    writeFileSync(join(skillsRoot, 'beta', 'SKILL.md'), '# Beta\n')

    expect(listSkillIds(skillsRoot)).toEqual(['alpha', 'beta'])

    const prompt = buildSkillPrompt(skillsRoot, 'n-alpha', 'do work', root)
    expect(prompt).toContain('# Task')
    expect(prompt).toContain('do work')
    expect(prompt).toContain('# Alpha')
  })

  test('невідомий скіл — помилка з переліком', () => {
    const root = join(tmpdir(), `skills-cli-unknown-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'lint'), { recursive: true })
    writeFileSync(join(skillsRoot, 'lint', 'SKILL.md'), '# Lint\n')

    expect(() => buildSkillPrompt(skillsRoot, 'missing', 'x', root)).toThrow(UNKNOWN_SKILL_RE)
  })

  test('buildSkillPrompt включає tsconfig.json і .n-cursor.json якщо існують', () => {
    const root = join(tmpdir(), `skills-cli-ctx-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')
    writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n')
    writeFileSync(join(root, '.n-cursor.json'), '{"rules":{}}\n')

    const prompt = buildSkillPrompt(skillsRoot, 'fix', '', root)
    expect(prompt).toContain('tsconfig.json')
    expect(prompt).toContain('.n-cursor.json')
  })
})

describe('runSkillsCli', () => {
  test('list виводить id скілів', () => {
    const root = join(tmpdir(), `skills-cli-run-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const lines = []
    const code = runSkillsCli(['list'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines).toEqual(['Available skills:', '- fix'])
  })

  test('skill <id> — промпт на stdout', () => {
    const root = join(tmpdir(), `skills-cli-id-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'taze'), { recursive: true })
    writeFileSync(join(skillsRoot, 'taze', 'SKILL.md'), '# Taze\n')

    const lines = []
    const code = runSkillsCli(['taze'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('# Taze')
  })

  test('skill <id> "task"', () => {
    const root = join(tmpdir(), `skills-cli-task-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'lint'), { recursive: true })
    writeFileSync(join(skillsRoot, 'lint', 'SKILL.md'), '# Lint\n')

    const lines = []
    const code = runSkillsCli(['lint', 'run', 'lint'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('run lint')
  })

  test('cursor без skill — помилка', () => {
    const root = join(tmpdir(), `skills-cli-cursor-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = runSkillsCli(['cursor'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* stdout не перевіряється в цьому тесті */
      },
      logError: line => errors.push(line)
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(SKILL_NAME_REQUIRED_RE)
  })

  test('порожній argv → usage + exit 1', () => {
    const root = join(tmpdir(), `skills-cli-empty-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = runSkillsCli([], {
      packageRoot: root,
      projectDir: root,
      log: () => {},
      logError: line => errors.push(line)
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(USAGE_HINT_RE)
  })

  test('невідома підкоманда — usage', () => {
    const root = join(tmpdir(), `skills-cli-usage-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = runSkillsCli(['nope'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* stdout не перевіряється в цьому тесті */
      },
      logError: line => errors.push(line)
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(USAGE_HINT_RE)
  })
})
