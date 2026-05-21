/**
 * Тести CLI скілів: list, normalize, buildPrompt.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'

import {
  buildSkillPrompt,
  listSkillIds,
  mapClaudeFirstArgv,
  normalizeSkillId,
  runClaudeFirstSkillsCli,
  runSkillsCli
} from './skills-cli.mjs'

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

    expect(() => buildSkillPrompt(skillsRoot, 'missing', 'x', root)).toThrow(
      /Unknown skill.*lint/
    )
  })
})

describe('mapClaudeFirstArgv', () => {
  test('taze → claude taze', () => {
    const root = join(tmpdir(), `map-claude-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'taze'), { recursive: true })
    writeFileSync(join(skillsRoot, 'taze', 'SKILL.md'), '# Taze\n')

    expect(mapClaudeFirstArgv(['taze', 'go'], skillsRoot)).toEqual(['claude', 'taze', 'go'])
    expect(mapClaudeFirstArgv(['list'], skillsRoot)).toEqual(['list'])
  })

  test('невідомий id', () => {
    const root = join(tmpdir(), `map-claude-bad-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })
    expect(mapClaudeFirstArgv(['nope'], join(root, 'skills'))[0]).toBe('__invalid_claude_first__')
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
    expect(lines.some(l => l.includes('- fix'))).toBe(true)
  })

  test('скорочення skill <id> без prompt', async () => {
    const root = join(tmpdir(), `skills-cli-short-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const lines = []
    const code = await runSkillsCli(['fix', 'sync rules'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('sync rules')
  })

  test('runClaudeFirstSkillsCli: prompt lint', async () => {
    const root = join(tmpdir(), `claude-first-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'lint'), { recursive: true })
    writeFileSync(join(skillsRoot, 'lint', 'SKILL.md'), '# Lint\n')

    const lines = []
    const code = await runClaudeFirstSkillsCli(['prompt', 'lint', 'go'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('go')
  })

  test('prompt повертає зібраний промпт', async () => {
    const root = join(tmpdir(), `skills-cli-prompt-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'lint'), { recursive: true })
    writeFileSync(join(skillsRoot, 'lint', 'SKILL.md'), '# Lint skill\n')
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}\n')

    const lines = []
    const code = await runSkillsCli(['prompt', 'lint', 'run lint'], {
      packageRoot: root,
      projectDir: root,
      log: line => lines.push(line)
    })

    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('run lint')
    expect(lines.join('\n')).toContain('Lint skill')
    expect(lines.join('\n')).toContain('demo')
  })
})
