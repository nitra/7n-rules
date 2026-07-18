/**
 * Тести для skills/taze/js/orchestrate.mjs:
 *   - buildDependencyPrompt: промпт містить пакет/версії, лише кроки 4-6;
 *   - callRunner: pi (текст через deps.out) vs cursor/codex (return/throw);
 *   - formatReport: детермінований markdown-звіт (npm-гілка + екосистеми провайдерів);
 *   - backupWorkspacePackageFiles/cleanupBackups: реальні tmp-файли;
 *   - loadPluginTazeProviders: handler-модулі плагінів → валідні провайдери, битий плагін → warning+пропуск;
 *   - runTazeOrchestrator: повна ітерація з інжектованими провайдерами (без реальних bunx/cargo/LLM).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  backupWorkspacePackageFiles,
  buildDependencyPrompt,
  callRunner,
  cleanupBackups,
  formatReport,
  loadPluginTazeProviders,
  runTazeOrchestrator
} from '../orchestrate.mjs'

const NETWORK_ERROR_RE = /network error/
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

describe('buildDependencyPrompt', () => {
  test('містить пакет, воркспейс і версії', () => {
    const prompt = buildDependencyPrompt({ workspace: 'npm', pkg: 'react', from: '^17.0.0', to: '^18.0.0' })
    expect(prompt).toContain('react')
    expect(prompt).toContain('npm')
    expect(prompt).toContain('^17.0.0 → ^18.0.0')
  })

  test('не згадує детерміновані кроки 1-3/7/8 (лише 4-6)', () => {
    const prompt = buildDependencyPrompt({ workspace: '.', pkg: 'vite', from: '4.0.0', to: '5.0.0' })
    expect(prompt).toContain('breaking changes')
    expect(prompt).toContain('CHANGELOG')
    expect(prompt).not.toContain('bunx taze')
  })
})

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
  test('без major-оновлень, без екосистем', () => {
    const report = formatReport({ minorPatch: 5, totalChanged: 5, results: [] })
    expect(report).toContain('Оновлено (minor/patch):** 5')
    expect(report).toContain('Major-оновлення:** 0')
    expect(report).not.toContain('###')
  })

  test('з успішним і провальним npm-оновленням', () => {
    const report = formatReport({
      minorPatch: 2,
      totalChanged: 4,
      results: [
        { pkg: 'react', workspace: '.', from: '^17.0.0', to: '^18.0.0', ok: true, error: null },
        { pkg: 'vite', workspace: 'npm', from: '4.0.0', to: '5.0.0', ok: false, error: 'timeout' }
      ]
    })
    expect(report).toContain('✅ `react` (.): ^17.0.0 → ^18.0.0')
    expect(report).toContain('❌ `vite` (npm): 4.0.0 → 5.0.0 — timeout')
    expect(report).toContain('Всього змінено:** 4')
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
    // 1 (npm) + 2+1 (rust) + 3+1 (python) = 8
    expect(report).toContain('Всього змінено:** 8')
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

describe('backupWorkspacePackageFiles + cleanupBackups', () => {
  test('бекапить package.json кожного воркспейсу і прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      await ensureDir(join(dir, 'pkg-a'))
      await writeFile(join(dir, 'pkg-a/package.json'), '{}', 'utf8')

      const workspaces = await backupWorkspacePackageFiles(dir, {
        getMonorepoPackageRootDirs: () => ['.', 'pkg-a']
      })
      expect(workspaces).toEqual(['.', 'pkg-a'])
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'pkg-a/package.json.taze-bak'))).toBe(true)

      await cleanupBackups(dir, workspaces)
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'pkg-a/package.json.taze-bak'))).toBe(false)
    })
  })

  test('пропускає воркспейс без package.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const workspaces = await backupWorkspacePackageFiles(dir, {
        getMonorepoPackageRootDirs: () => ['.', 'no-package-json']
      })
      expect(workspaces).toEqual(['.'])
    })
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
  test('поза .worktrees/ — сам створює worktree (npx @7n/mt + bun install) і продовжує там', async () => {
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
          return fakeSpawn(cmd)
        },
        ecosystemProviders: []
      }
    })
    expect(calls).toContain('npx @7n/mt worktree create main-taze n-taze: worktree-only skill')
    expect(calls.some(c => c.startsWith('bun install'))).toBe(true)
    expect(result.ok).toBe(true)
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

  test('без major-оновлень і провайдерів — callRunner не викликається, є звіт', async () => {
    const calls = []
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: fakeSpawn,
          getMonorepoPackageRootDirs: () => ['.'],
          copyFile: noop,
          rm: noop,
          collectTazeDiff: () => ({ major: [], minorPatch: 3, totalChanged: 3, comparedWorkspaces: 1 }),
          ecosystemProviders: [],
          callRunner: (...args) => {
            calls.push(args)
            return { ok: true, text: '', error: null }
          }
        }
      })

      expect(calls).toHaveLength(0)
      expect(result.ok).toBe(true)
      expect(result.report).toContain('Оновлено (minor/patch):** 3')
      expect(result.results).toEqual([])
      expect(result.ecosystems).toEqual([])
    })
  })

  test('ітерує по кожному major-запису обраним раннером, збирає результати', async () => {
    const calls = []
    const major = [
      { workspace: '.', pkg: 'react', from: '^17.0.0', to: '^18.0.0' },
      { workspace: 'npm', pkg: 'vite', from: '4.0.0', to: '5.0.0' }
    ]

    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'cursor',
        log: noop,
        deps: {
          spawnFn: fakeSpawn,
          getMonorepoPackageRootDirs: () => ['.'],
          copyFile: noop,
          rm: noop,
          collectTazeDiff: () => ({ major, minorPatch: 1, totalChanged: 3, comparedWorkspaces: 2 }),
          ecosystemProviders: [],
          callRunner: (runner, prompt, cwd) => {
            calls.push({ runner, prompt, cwd })
            return prompt.includes('vite')
              ? { ok: false, text: '', error: 'idle-timeout' }
              : { ok: true, text: 'ok', error: null }
          }
        }
      })

      expect(calls).toHaveLength(2)
      expect(calls.every(c => c.runner === 'cursor' && c.cwd === dir)).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.results).toHaveLength(2)
      expect(result.results[0]).toMatchObject({ pkg: 'react', ok: true })
      expect(result.results[1]).toMatchObject({ pkg: 'vite', ok: false, error: 'idle-timeout' })
      expect(result.report).toContain('❌ `vite`')
    })
  })

  test('кидає з exit-кодом+stderr, якщо детермінована npm-команда провалилась', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      await expect(
        runTazeOrchestrator({
          cwd: dir,
          runner: 'pi',
          log: noop,
          deps: {
            spawnFn: cmd => (cmd === 'bunx' ? { status: 1, stdout: '', stderr: 'network error' } : fakeSpawn(cmd)),
            getMonorepoPackageRootDirs: () => ['.'],
            copyFile: noop,
            rm: noop,
            ecosystemProviders: []
          }
        })
      ).rejects.toThrow(NETWORK_ERROR_RE)
    })
  })

  test('реальний бекап/прибирання через tmp-каталог (не лише інжекти)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }), 'utf8')

      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: fakeSpawn,
          collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
          ecosystemProviders: []
        }
      })

      expect(result.ok).toBe(true)
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(false)
    })
  })

  test('без кореневого package.json — npm-гілка тихо пропускається, bunx/bun не викликаються, провайдери працюють', async () => {
    const npmCommands = []
    const steps = []
    const major = [{ manifest: 'py.toml', pkg: 'typer', from: '0.19.1', to: '0.27.0' }]

    await withTmpDir(async dir => {
      // package.json НЕ створюємо — чисто-Python репо.
      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: cmd => {
            if (cmd === 'bunx' || cmd === 'bun') npmCommands.push(cmd)
            return fakeSpawn(cmd)
          },
          ecosystemProviders: [
            fakeProvider('py', steps, {
              diff: () => Promise.resolve({ major, minorPatch: 1, totalChanged: 2 })
            })
          ],
          callRunner: () => ({ ok: true, text: 'сумісно', error: null })
        }
      })

      expect(npmCommands).toHaveLength(0)
      expect(steps).toContain('py:cleanup')
      expect(result.ok).toBe(true)
      // npm-рядків у звіті немає (тиша), екосистема — є.
      expect(result.report).not.toContain('Оновлено (minor/patch):** 0\n- **Major-оновлення')
      expect(result.report).toContain('### Екосистема py')
      expect(result.report).toContain('✅ `typer`')
      expect(result.report).toContain('Всього змінено:** 2')
    })
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
})
