/**
 * Тести CLI скілів: list, normalize, buildPrompt, runSkillsCli.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'

import { buildSkillPrompt, listSkillIds, normalizeSkillId, runSkillsCli } from './skills-cli.mjs'

describe('normalizeSkillId', () => {
  test('n-lint → lint', () => {
    expect(normalizeSkillId('n-lint')).toBe('lint')
  })

  test('lint без змін', () => {
    expect(normalizeSkillId('lint')).toBe('lint')
  })
})

describe('listSkillIds / buildSkillPrompt', () => {
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

    expect(() => buildSkillPrompt(skillsRoot, 'missing', 'x', root)).toThrow(/Unknown skill.*lint/)
  })
})

describe('runSkillsCli', () => {
  test('list виводить id скілів', async () => {
    const root = join(tmpdir(), `skills-cli-run-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const lines = []
    const code = await runSkillsCli(['list'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines).toEqual(['Available skills:', '- fix'])
  })

  test('skill <id> — промпт на stdout', async () => {
    const root = join(tmpdir(), `skills-cli-id-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'taze'), { recursive: true })
    writeFileSync(join(skillsRoot, 'taze', 'SKILL.md'), '# Taze\n')

    const lines = []
    const code = await runSkillsCli(['taze'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('# Taze')
  })

  test('skill <id> "task"', async () => {
    const root = join(tmpdir(), `skills-cli-task-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'lint'), { recursive: true })
    writeFileSync(join(skillsRoot, 'lint', 'SKILL.md'), '# Lint\n')

    const lines = []
    const code = await runSkillsCli(['lint', 'run', 'lint'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('run lint')
  })

  test('cursor без skill — помилка', async () => {
    const root = join(tmpdir(), `skills-cli-cursor-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = await runSkillsCli(['cursor'], {
      packageRoot: root,
      projectDir: root,
      log: () => {},
      logError: line => errors.push(line)
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/Skill name is required/)
  })

  test('невідома підкоманда — usage', async () => {
    const root = join(tmpdir(), `skills-cli-usage-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = await runSkillsCli(['nope'], {
      packageRoot: root,
      projectDir: root,
      log: () => {},
      logError: line => errors.push(line)
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/skill list/)
  })
})
