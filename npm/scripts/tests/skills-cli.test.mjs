/**
 * Тести CLI скілів: list, normalize, buildPrompt, runSkillsCli.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import { describe, expect, test } from 'vitest'

import {
  buildSkillPrompt,
  listSkillIds,
  normalizeSkillId,
  resolveBundledPackageRoot,
  runSkillsCli
} from '../skills-cli.mjs'

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
    expect(normalizeSkillId(/** @type {string} */)).toBe('')
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

  test('buildSkillPrompt включає tsconfig.json і .n-rules.json якщо існують', () => {
    const root = join(tmpdir(), `skills-cli-ctx-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')
    writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n')
    writeFileSync(join(root, '.n-rules.json'), '{"rules":{}}\n')

    const prompt = buildSkillPrompt(skillsRoot, 'fix', '', root)
    expect(prompt).toContain('tsconfig.json')
    expect(prompt).toContain('.n-rules.json')
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
      log: line => {
        lines.push(line)
      }
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
      log: line => {
        lines.push(line)
      }
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
      log: line => {
        lines.push(line)
      }
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
      log: () => {
        /* stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      }
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(SKILL_NAME_REQUIRED_RE)
  })

  test('порожній argv → usage + exit 1', async () => {
    const root = join(tmpdir(), `skills-cli-empty-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = await runSkillsCli([], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* noop: stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      }
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(USAGE_HINT_RE)
  })

  test('невідома підкоманда — usage', async () => {
    const root = join(tmpdir(), `skills-cli-usage-${Date.now()}`)
    mkdirSync(join(root, 'skills'), { recursive: true })

    const errors = []
    const code = await runSkillsCli(['nope'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      }
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(USAGE_HINT_RE)
  })

  test('pi runner: викликає runPiAgentSkill і повертає 0 при ok', async () => {
    const root = join(tmpdir(), `skills-cli-pi-ok-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'taze'), { recursive: true })
    writeFileSync(join(skillsRoot, 'taze', 'SKILL.md'), '# Taze\n')
    writeFileSync(join(skillsRoot, 'taze', 'main.json'), '{ "worktree": true, "tier": "avg" }')

    const calls = []
    const code = await runSkillsCli(['pi', 'n-taze', 'онови'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        // no-op: тест не перевіряє звичайний лог
      },
      deps: {
        runPiAgentSkill: (prompt, opts) => {
          calls.push({ prompt, opts })
          return Promise.resolve({ ok: true, telemetry: {}, error: null })
        }
      }
    })

    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].prompt).toContain('# Taze')
    expect(calls[0].prompt).toContain('онови')
    expect(calls[0].opts.skillId).toBe('taze')
    expect(calls[0].opts.tier).toBe('avg')
    expect(calls[0].opts.cwd).toBe(root)
  })

  test('pi runner: дефолт tier=max за відсутності main.json', async () => {
    const root = join(tmpdir(), `skills-cli-pi-def-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    let seenTier
    await runSkillsCli(['pi', 'fix'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        // no-op: тест не перевіряє звичайний лог
      },
      deps: {
        runPiAgentSkill: (_prompt, opts) => {
          seenTier = opts.tier
          return Promise.resolve({ ok: true, telemetry: {}, error: null })
        }
      }
    })

    expect(seenTier).toBe('max')
  })

  test('pi runner: error → exit 1 + logError', async () => {
    const root = join(tmpdir(), `skills-cli-pi-err-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const errors = []
    const code = await runSkillsCli(['pi', 'fix'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        // no-op: тест перевіряє лише logError
      },
      logError: line => {
        errors.push(line)
      },
      deps: {
        runPiAgentSkill: () => Promise.resolve({ ok: false, telemetry: null, error: 'модель не знайдена: x/y' })
      }
    })

    expect(code).toBe(1)
    expect(errors.join('\n')).toContain('модель не знайдена')
  })

  test('claude runner: deprecated-warning + ACP-раннер отримує prompt', async () => {
    const root = join(tmpdir(), `skills-cli-claude-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const errors = []
    const calls = []
    const code = await runSkillsCli(['claude', 'fix'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* noop: stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      },
      deps: {
        runAcpRunner: (kind, prompt) => {
          calls.push({ kind, prompt })
          return Promise.resolve(0)
        }
      }
    })

    expect(code).toBe(0)
    expect(errors.join('\n')).toContain('[deprecated]')
    expect(errors.join('\n')).toContain('claude')
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('claude')
    expect(calls[0].prompt).toContain('# Fix')
  })

  test('cursor runner: без deprecated-warning, делегує в runAcpRunner', async () => {
    const root = join(tmpdir(), `skills-cli-cursor-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const errors = []
    const calls = []
    const code = await runSkillsCli(['cursor', 'fix'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* noop: stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      },
      deps: {
        runAcpRunner: (kind, prompt, projectDir) => {
          calls.push({ kind, prompt, projectDir })
          return Promise.resolve(0)
        }
      }
    })

    expect(code).toBe(0)
    expect(errors.join('\n')).not.toContain('[deprecated]')
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('cursor')
    expect(calls[0].projectDir).toBe(root)
  })

  test('codex runner: без deprecated-warning, делегує в runAcpRunner', async () => {
    const root = join(tmpdir(), `skills-cli-codex-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const errors = []
    const calls = []
    const code = await runSkillsCli(['codex', 'fix'], {
      packageRoot: root,
      projectDir: root,
      log: () => {
        /* noop: stdout не перевіряється в цьому тесті */
      },
      logError: line => {
        errors.push(line)
      },
      deps: {
        runAcpRunner: (kind, prompt, projectDir) => {
          calls.push({ kind, prompt, projectDir })
          return Promise.resolve(1)
        }
      }
    })

    expect(code).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('codex')
    expect(errors.join('\n')).not.toContain('[deprecated]')
  })

  test('cursor runner: без CLI у PATH (реальний runAcpRunner) → кидає', async () => {
    const root = join(tmpdir(), `skills-cli-cursor-path-${Date.now()}`)
    const skillsRoot = join(root, 'skills')
    mkdirSync(join(skillsRoot, 'fix'), { recursive: true })
    writeFileSync(join(skillsRoot, 'fix', 'SKILL.md'), '# Fix\n')

    const errors = []
    const prevPath = env.PATH
    env.PATH = join(tmpdir(), 'empty-path-isolated')
    let code
    try {
      code = await runSkillsCli(['cursor', 'fix'], {
        packageRoot: root,
        projectDir: root,
        log: () => {
          /* noop: stdout не перевіряється в цьому тесті */
        },
        logError: line => {
          errors.push(line)
        }
      })
    } finally {
      env.PATH = prevPath
    }

    expect(code).toBe(1)
    expect(errors.join('\n')).toContain('cursor-agent')
  })
})
