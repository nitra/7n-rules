/**
 * Тести для skills/taze/js/orchestrate.mjs:
 *   - callRunner: pi (текст через deps.out) vs cursor/codex (return/throw);
 *   - formatReport: детермінований markdown-звіт (npm-гілка + екосистеми провайдерів);
 *   - loadPluginTazeProviders: handler-модулі плагінів → валідні провайдери, битий плагін → warning+пропуск;
 *   - runTazeOrchestrator: повна ітерація з інжектованими провайдерами (без реальних bunx/cargo/LLM);
 *   - реекспорти bringChangesBackToOriginal/removeAutoCreatedWorktree: спільний
 *     набір `describeAutoWorktreeBridge` (scripts/utils/tests/auto-worktree-suite.mjs).
 */
import { describe, expect, test } from 'vitest'

import { describeAutoWorktreeBridge } from '../../../../scripts/utils/tests/auto-worktree-suite.mjs'
import {
  bringChangesBackToOriginal,
  callRunner,
  formatReport,
  loadPluginTazeProviders,
  removeAutoCreatedWorktree,
  runTazeOrchestrator
} from '../orchestrate.mjs'

const NOT_IN_WORKTREE_RE = /не в ізольованому worktree/

/** Заглушка `log`/`copyFile`/`rm` для тестів, де побічний ефект не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід/файлову дію */
}

/**
 * Fake spawnFn для bunx/bun/git — усі команди «успішні»; `git rev-parse
 * --show-toplevel` повертає шлях під `.worktrees/`, щоб пройти
 * `assertRunningInWorktree` (сам preflight перевіряється окремо нижче).
 * @param {string} cmd бінарник
 * @returns {{ status: number, stdout: string, stderr: string }} fake spawnSync-результат
 */
function fakeSpawn(cmd) {
  if (cmd === 'git') return { status: 0, stdout: '/repo/.worktrees/main-taze\n', stderr: '' }
  return { status: 0, stdout: '', stderr: '' }
}

/**
 * Fake EcosystemProvider для тестів оркестратора — усі кроки записуються в
 * `steps`, поведінка керується `overrides`.
 * @param {string} id ідентифікатор провайдера
 * @param {string[]} steps масив-акумулятор викликаних кроків (мутується)
 * @param {object} [overrides] перекриття окремих методів/полів
 * @returns {object} провайдер
 */
function fakeProvider(id, steps, overrides = {}) {
  return {
    id,
    title: `Екосистема ${id}`,
    manifestNoun: `${id}.toml`,
    skillSection: `${id}-гілкою SKILL.md`,
    detect: () => {
      steps.push(`${id}:detect`)
      return [`${id}.toml`]
    },
    available: () => {
      steps.push(`${id}:available`)
      return { ok: true, reason: null }
    },
    backup: () => {
      steps.push(`${id}:backup`)
      return Promise.resolve()
    },
    bump: () => {
      steps.push(`${id}:bump`)
      return Promise.resolve()
    },
    diff: () => {
      steps.push(`${id}:diff`)
      return Promise.resolve({ major: [], minorPatch: 0, totalChanged: 0 })
    },
    promptFor: entry => `prompt:${id}:${entry.pkg}`,
    cleanup: () => {
      steps.push(`${id}:cleanup`)
      return Promise.resolve()
    },
    ...overrides
  }
}

describe('callRunner', () => {
  test('pi: перехоплює текст через deps.out, повертає ok/error з runAgentSkill', async () => {
    const calls = []
    const result = await callRunner('pi', 'do it', '/tmp/project', {
      runAgentSkill: (prompt, opts) => {
        calls.push({ prompt, opts })
        opts.deps.out('сумісно')
        return { ok: true, telemetry: {}, error: null }
      }
    })
    expect(result).toEqual({ ok: true, text: 'сумісно', error: null })
    expect(calls).toHaveLength(1)
    expect(calls[0].opts.skillId).toBe('taze')
    expect(calls[0].opts.cwd).toBe('/tmp/project')
  })

  test('cursor/codex: успіх — return тексту напряму', async () => {
    const result = await callRunner('codex', 'do it', '/tmp/project', {
      runAcpAgent: (kind, prompt, cwd) => {
        expect(kind).toBe('codex')
        expect(cwd).toBe('/tmp/project')
        return 'зрефакторено'
      }
    })
    expect(result).toEqual({ ok: true, text: 'зрефакторено', error: null })
  })

  test('cursor/codex: помилка — ok:false, текст помилки', async () => {
    const result = await callRunner('cursor', 'do it', '/tmp/project', {
      runAcpAgent: () => {
        throw new Error('acp: idle-timeout')
      }
    })
    expect(result).toEqual({ ok: false, text: '', error: 'acp: idle-timeout' })
  })
})

describe('formatReport', () => {
  test('порожні ecosystems → лише заголовок і нульовий підсумок', () => {
    const report = formatReport({ ecosystems: [] })
    expect(report).toContain('## taze: підсумок')
    expect(report).toContain('Всього змінено:** 0')
    expect(report).not.toContain('###')
  })

  test('екосистема з manifests, але пропущена (тулчейн відсутній)', () => {
    const report = formatReport({
      minorPatch: 0,
      totalChanged: 0,
      results: [],
      ecosystems: [
        {
          title: 'Rust-крейти',
          manifestNoun: 'Cargo.toml',
          skillSection: 'Rust-гілкою SKILL.md',
          manifests: ['Cargo.toml', 'crates/foo/Cargo.toml'],
          processed: false,
          skippedReason: 'cargo-edit не встановлено',
          error: null,
          minorPatch: 0,
          results: []
        }
      ]
    })
    expect(report).toContain('### Rust-крейти')
    expect(report).toContain('⏭ Пропущено (cargo-edit не встановлено)')
    expect(report).toContain('Cargo.toml, crates/foo/Cargo.toml')
    expect(report).toContain('Всього змінено:** 0')
  })

  test('оброблені екосистеми — окремий підрахунок у "Всього змінено"', () => {
    const report = formatReport({
      minorPatch: 1,
      totalChanged: 1,
      results: [],
      ecosystems: [
        {
          title: 'Rust-крейти',
          manifestNoun: 'Cargo.toml',
          skillSection: 'Rust-гілкою SKILL.md',
          manifests: ['Cargo.toml'],
          processed: true,
          skippedReason: null,
          error: null,
          minorPatch: 2,
          results: [{ pkg: 'genai', manifest: 'Cargo.toml', from: '0.4', to: '0.5', ok: true, error: null }]
        },
        {
          title: 'Python-пакети (uv)',
          manifestNoun: 'pyproject.toml',
          skillSection: 'Python-гілкою SKILL.md',
          manifests: ['pyproject.toml'],
          processed: true,
          skippedReason: null,
          error: null,
          minorPatch: 3,
          results: [{ pkg: 'typer', manifest: 'pyproject.toml', from: '0.19.1', to: '0.27.0', ok: true, error: null }]
        }
      ]
    })
    expect(report).toContain('### Rust-крейти')
    expect(report).toContain('✅ `genai` (Cargo.toml): 0.4 → 0.5')
    expect(report).toContain('### Python-пакети (uv)')
    expect(report).toContain('✅ `typer` (pyproject.toml): 0.19.1 → 0.27.0')
    // 2+1 (rust) + 3+1 (python) = 7 — npm-гілка тепер теж окрема екосистема-плагін.
    expect(report).toContain('Всього змінено:** 7')
  })

  test('екосистема без manifests — тиша (жодної згадки)', () => {
    const report = formatReport({
      minorPatch: 0,
      totalChanged: 0,
      results: [],
      ecosystems: [
        {
          title: 'Python-пакети (uv)',
          manifestNoun: 'pyproject.toml',
          skillSection: 'Python-гілкою SKILL.md',
          manifests: [],
          processed: false,
          skippedReason: null,
          error: null,
          minorPatch: 0,
          results: []
        }
      ]
    })
    expect(report).not.toContain('Python')
  })

  test('екосистема з провалом — секція з помилкою', () => {
    const report = formatReport({
      minorPatch: 0,
      totalChanged: 0,
      results: [],
      ecosystems: [
        {
          title: 'Rust-крейти',
          manifestNoun: 'Cargo.toml',
          skillSection: 'Rust-гілкою SKILL.md',
          manifests: ['Cargo.toml'],
          processed: false,
          skippedReason: null,
          error: 'cargo update → exit 101: registry unreachable',
          minorPatch: 0,
          results: []
        }
      ]
    })
    expect(report).toContain('### Rust-крейти')
    expect(report).toContain('❌ Провал (cargo update → exit 101: registry unreachable)')
  })
})

describe('loadPluginTazeProviders', () => {
  const validProvider = {
    id: 'python-uv',
    title: 'Python-пакети (uv)',
    manifestNoun: 'pyproject.toml',
    skillSection: 'Python-гілкою SKILL.md',
    detect: () => [],
    available: () => ({ ok: true, reason: null }),
    backup: () => Promise.resolve(),
    bump: () => Promise.resolve(),
    diff: () => Promise.resolve({ major: [], minorPatch: 0, totalChanged: 0 }),
    promptFor: () => '',
    cleanup: () => Promise.resolve()
  }

  test('handler-модуль плагіна → валідний провайдер', async () => {
    const providers = await loadPluginTazeProviders('/repo', noop, {
      readNRulesConfigLite: () => ({ plugins: undefined }),
      resolvePlugins: () => [],
      getHandlers: () => [{ pluginName: '@7n/rules-lang-python', modulePath: '/repo/node_modules/p/provider.mjs' }],
      importModule: () => Promise.resolve({ default: validProvider })
    })
    expect(providers).toEqual([validProvider])
  })

  test('битий плагін (невалідна форма) → warning і пропуск, не провал', async () => {
    const logs = []
    const providers = await loadPluginTazeProviders(
      '/repo',
      line => {
        logs.push(line)
      },
      {
        readNRulesConfigLite: () => ({ plugins: undefined }),
        resolvePlugins: () => [],
        getHandlers: () => [
          { pluginName: '@7n/rules-lang-broken', modulePath: '/repo/broken.mjs' },
          { pluginName: '@7n/rules-lang-python', modulePath: '/repo/ok.mjs' }
        ],
        importModule: url =>
          url.includes('broken')
            ? Promise.resolve({ default: { id: 'x' } })
            : Promise.resolve({ default: validProvider })
      }
    )
    expect(providers).toEqual([validProvider])
    expect(logs.some(l => l.includes('@7n/rules-lang-broken'))).toBe(true)
  })

  test('без handlers → порожній список', async () => {
    const providers = await loadPluginTazeProviders('/repo', noop, {
      readNRulesConfigLite: () => ({ plugins: [] }),
      resolvePlugins: () => [],
      getHandlers: () => []
    })
    expect(providers).toEqual([])
  })
})

describe('runTazeOrchestrator', () => {
  test('поза .worktrees/ — сам створює worktree, а по завершенню переносить зміни назад і прибирає worktree', async () => {
    const calls = []
    const result = await runTazeOrchestrator({
      cwd: '/Users/dev/repo',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: (cmd, args = []) => {
          calls.push([cmd, ...args].join(' '))
          if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
          if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
          return fakeSpawn(cmd)
        },
        ecosystemProviders: []
      }
    })
    expect(calls).toContain('npx @7n/mt worktree create main-taze n-taze: worktree-only skill')
    expect(calls.some(c => c.startsWith('bun install'))).toBe(true)
    expect(calls).toContain('git status --porcelain')
    expect(calls).toContain('npx @7n/mt worktree remove main-taze')
    expect(result.ok).toBe(true)
  })

  test('вже в .worktrees/ — не переносить назад і не прибирає нічого (не наш worktree)', async () => {
    const calls = []
    await runTazeOrchestrator({
      cwd: '/repo/.worktrees/main-taze',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: (cmd, args = []) => {
          calls.push([cmd, ...args].join(' '))
          return fakeSpawn(cmd)
        },
        ecosystemProviders: []
      }
    })
    expect(calls.some(c => c.startsWith('git status'))).toBe(false)
    expect(calls.some(c => c.startsWith('npx @7n/mt worktree remove'))).toBe(false)
  })

  test('поза .worktrees/ і без визначеної гілки (detached HEAD) — кидає, не створює worktree', async () => {
    const calls = []
    await expect(
      runTazeOrchestrator({
        cwd: '/Users/dev/repo',
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: (cmd, args = []) => {
            calls.push(cmd)
            if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
            if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: '\n', stderr: '' }
            return fakeSpawn(cmd)
          },
          ecosystemProviders: []
        }
      })
    ).rejects.toThrow(NOT_IN_WORKTREE_RE)
    expect(calls).not.toContain('npx')
  })

  test('без провайдерів — callRunner не викликається, є звіт і попередження', async () => {
    const calls = []
    const logs = []
    const result = await runTazeOrchestrator({
      cwd: '/repo/.worktrees/main-taze',
      runner: 'pi',
      log: line => {
        logs.push(line)
      },
      deps: {
        spawnFn: fakeSpawn,
        ecosystemProviders: [],
        callRunner: (...args) => {
          calls.push(args)
          return { ok: true, text: '', error: null }
        }
      }
    })

    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(true)
    expect(result.report).toContain('Всього змінено:** 0')
    expect(result.ecosystems).toEqual([])
    expect(logs.some(l => l.includes('Жодного taze-провайдера'))).toBe(true)
  })

  test('провайдери: повний цикл detect→available→backup→bump→diff→cleanup + виклик раннера на major', async () => {
    const steps = []
    const runnerCalls = []
    const major = [{ manifest: 'py.toml', pkg: 'typer', from: '0.19.1', to: '0.27.0' }]

    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'codex',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
        readMigrationCache: async () => null,
        writeMigrationCache: async () => {},
        ecosystemProviders: [
          fakeProvider('py', steps, {
            diff: () => {
              steps.push('py:diff')
              return Promise.resolve({ major, minorPatch: 1, totalChanged: 2 })
            }
          })
        ],
        callRunner: (runner, prompt, cwd) => {
          runnerCalls.push({ runner, prompt, cwd })
          return { ok: true, text: 'сумісно', error: null }
        }
      }
    })

    expect(steps).toEqual(['py:detect', 'py:available', 'py:backup', 'py:bump', 'py:diff', 'py:cleanup'])
    expect(runnerCalls).toHaveLength(1)
    expect(runnerCalls[0].runner).toBe('codex')
    expect(runnerCalls[0].prompt).toBe('prompt:py:typer')
    expect(result.ok).toBe(true)
    expect(result.ecosystems[0].results).toEqual([{ ...major[0], ok: true, text: 'сумісно', error: null }])
    expect(result.report).toContain('### Екосистема py')
    expect(result.report).toContain('✅ `typer`')
  })

  test('провайдер: тулчейн недоступний → skip, наступний провайдер працює', async () => {
    const steps = []
    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
        ecosystemProviders: [
          fakeProvider('rust', steps, {
            available: () => {
              steps.push('rust:available')
              return { ok: false, reason: 'cargo-edit не встановлено' }
            }
          }),
          fakeProvider('py', steps)
        ],
        callRunner: () => ({ ok: true, text: '', error: null })
      }
    })

    expect(steps).toEqual([
      'rust:detect',
      'rust:available',
      'py:detect',
      'py:available',
      'py:backup',
      'py:bump',
      'py:diff',
      'py:cleanup'
    ])
    expect(result.ok).toBe(true)
    expect(result.report).toContain('⏭ Пропущено (cargo-edit не встановлено)')
  })

  test('провайдер: виняток у bump → error у записі, інші провайдери не зупиняються, ok=false', async () => {
    const steps = []
    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
        ecosystemProviders: [
          fakeProvider('rust', steps, {
            bump: () => {
              throw new Error('cargo update → exit 101: registry unreachable')
            }
          }),
          fakeProvider('py', steps)
        ],
        callRunner: () => ({ ok: true, text: '', error: null })
      }
    })

    expect(result.ok).toBe(false)
    expect(result.ecosystems[0].error).toContain('registry unreachable')
    expect(result.report).toContain('❌ Провал')
    // py-провайдер пройшов повний цикл попри провал rust.
    expect(steps.filter(s => s.startsWith('py:'))).toEqual([
      'py:detect',
      'py:available',
      'py:backup',
      'py:bump',
      'py:diff',
      'py:cleanup'
    ])
  })

  test('кеш міграцій: знайдено запис → промпт доповнюється підсумком, повторний CHANGELOG-виклик не потрібен', async () => {
    const steps = []
    const major = [{ manifest: 'package.json', pkg: '@7n/tauri-components', from: '^0.8.0', to: '^0.11.1' }]
    const readCalls = []
    const writeCalls = []
    const runnerCalls = []

    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'cursor',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        readMigrationCache: async (pkg, from, to) => {
          readCalls.push({ pkg, from, to })
          return { notes: 'useAgent видалено → useAcpAgent', sourceRepo: '/tmp/other-repo', updatedAt: '2026-07-19T00:00:00.000Z' }
        },
        writeMigrationCache: async (...args) => {
          writeCalls.push(args)
        },
        ecosystemProviders: [
          fakeProvider('js-bun', steps, {
            diff: () => Promise.resolve({ major, minorPatch: 0, totalChanged: 1 })
          })
        ],
        callRunner: (runner, prompt, cwd) => {
          runnerCalls.push({ runner, prompt, cwd })
          return { ok: true, text: 'нічого не змінено — вже сумісно', error: null }
        }
      }
    })

    expect(readCalls).toEqual([{ pkg: '@7n/tauri-components', from: '^0.8.0', to: '^0.11.1' }])
    expect(runnerCalls[0].prompt).toContain('prompt:js-bun:@7n/tauri-components')
    expect(runnerCalls[0].prompt).toContain('/tmp/other-repo')
    expect(runnerCalls[0].prompt).toContain('useAgent видалено → useAcpAgent')
    expect(runnerCalls[0].prompt).toContain('пропусти крок 1')
    // успішний виклик оновлює кеш власним підсумком — наступний репо побачить свіжіший запис.
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][0]).toBe('@7n/tauri-components')
    expect(writeCalls[0][3].notes).toBe('нічого не змінено — вже сумісно')
    expect(result.ok).toBe(true)
  })

  test('кеш міграцій: нема запису → промпт без секції кешу, після успіху кеш записується', async () => {
    const major = [{ manifest: 'package.json', pkg: 'typer', from: '0.19.1', to: '0.27.0' }]
    const writeCalls = []
    const runnerCalls = []

    await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        readMigrationCache: async () => null,
        writeMigrationCache: async (...args) => {
          writeCalls.push(args)
        },
        ecosystemProviders: [
          fakeProvider('py', [], { diff: () => Promise.resolve({ major, minorPatch: 0, totalChanged: 1 }) })
        ],
        callRunner: (runner, prompt, cwd) => {
          runnerCalls.push({ runner, prompt, cwd })
          return { ok: true, text: 'зрефакторено use-agent.js', error: null }
        }
      }
    })

    expect(runnerCalls[0].prompt).toBe('prompt:py:typer')
    expect(writeCalls).toEqual([['typer', '0.19.1', '0.27.0', expect.objectContaining({ notes: 'зрефакторено use-agent.js' }), expect.any(Object)]])
  })

  test('SIGTERM під час прогону — рятує прогрес автоствореного worktree перед виходом', async () => {
    const calls = []
    let capturedSignalHandler = null
    let exitCode = null

    const originalOn = process.on.bind(process)
    process.on = (event, handler) => {
      if (event === 'SIGTERM') capturedSignalHandler = handler
      return originalOn(event, handler)
    }

    try {
      const resultPromise = runTazeOrchestrator({
        cwd: '/Users/dev/repo',
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: (cmd, args = []) => {
            calls.push([cmd, ...args].join(' '))
            if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
            if (cmd === 'git' && args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' }
            if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' }
            return fakeSpawn(cmd)
          },
          ecosystemProviders: [],
          exitProcessFn: code => {
            exitCode = code
          }
        }
      })

      // Симулюємо переривання ще до завершення оркестратора (signal-обробник
      // уже зареєстрований одразу після створення worktree).
      expect(capturedSignalHandler).toBeTypeOf('function')
      await capturedSignalHandler('SIGTERM')

      await resultPromise
    } finally {
      process.on = originalOn
    }

    expect(calls).toContain('npx @7n/mt worktree remove main-taze')
    expect(exitCode).toBe(1)
  })
})

describeAutoWorktreeBridge({ bringChangesBackToOriginal, removeAutoCreatedWorktree, branch: 'main-taze' })
