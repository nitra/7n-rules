/**
 * Тести для skills/taze/js/orchestrate.mjs:
 *   - buildDependencyPrompt: промпт містить пакет/версії, лише кроки 4-6;
 *   - callRunner: pi (текст через deps.out) vs cursor/codex (return/throw);
 *   - formatReport: детермінований markdown-звіт;
 *   - backupWorkspacePackageFiles/cleanupBackups: реальні tmp-файли;
 *   - findCargoManifests: інжектований spawnFn;
 *   - findPyprojectManifest/backupUvManifest/cleanupUvBackups: реальні tmp-файли;
 *   - runTazeOrchestrator: повна ітерація з усіма інжектами (без реальних bunx/cargo/uv/LLM).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  backupCargoManifests,
  backupUvManifest,
  backupWorkspacePackageFiles,
  buildCargoDependencyPrompt,
  buildDependencyPrompt,
  buildUvDependencyPrompt,
  callRunner,
  cleanupBackups,
  cleanupCargoBackups,
  cleanupUvBackups,
  findCargoManifests,
  findPyprojectManifest,
  formatReport,
  runTazeOrchestrator
} from '../orchestrate.mjs'

/** Порожній `rust`-блок звіту (без знайдених Cargo.toml) для `formatReport`-тестів npm-гілки. */
const NO_RUST = { manifests: [], processed: false, skippedReason: null, minorPatch: 0, results: [] }

const NETWORK_ERROR_RE = /network error/
const NOT_IN_WORKTREE_RE = /не в ізольованому worktree/

/** Заглушка `log`/`copyFile`/`rm` для тестів, де побічний ефект не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід/файлову дію */
}

/**
 * Fake spawnFn для bunx/bun/find/git — усі команди «успішні»; `git rev-parse
 * --show-toplevel` повертає шлях під `.worktrees/`, щоб пройти
 * `assertRunningInWorktree` (сам preflight перевіряється окремо нижче).
 * @param {string} cmd бінарник
 * @returns {{ status: number, stdout: string, stderr: string }} fake spawnSync-результат
 */
function fakeSpawn(cmd) {
  if (cmd === 'git') return { status: 0, stdout: '/repo/.worktrees/main-taze\n', stderr: '' }
  return { status: 0, stdout: '', stderr: '' }
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

describe('buildCargoDependencyPrompt', () => {
  test('містить крейт, маніфест і версії', () => {
    const prompt = buildCargoDependencyPrompt({
      manifest: 'llm-lib/crates/llm-cascade/Cargo.toml',
      pkg: 'genai',
      from: '0.4',
      to: '0.5'
    })
    expect(prompt).toContain('genai')
    expect(prompt).toContain('llm-lib/crates/llm-cascade/Cargo.toml')
    expect(prompt).toContain('0.4 → 0.5')
    expect(prompt).toContain('crates.io')
    expect(prompt).toContain('cargo clippy')
  })

  test('не згадує детерміновані кроки 1-3/7/8 (лише 4-6)', () => {
    const prompt = buildCargoDependencyPrompt({ manifest: 'Cargo.toml', pkg: 'serde', from: '1', to: '2' })
    expect(prompt).not.toContain('cargo upgrade')
  })
})

describe('buildUvDependencyPrompt', () => {
  test('містить пакет, маніфест і версії', () => {
    const prompt = buildUvDependencyPrompt({
      manifest: 'pyproject.toml',
      pkg: 'typer',
      from: '0.19.1',
      to: '0.27.0'
    })
    expect(prompt).toContain('typer')
    expect(prompt).toContain('pyproject.toml')
    expect(prompt).toContain('0.19.1 → 0.27.0')
    expect(prompt).toContain('pypi.org')
    expect(prompt).toContain('rg -n --type py')
  })

  test('не змішує з Rust/npm-командами інших гілок', () => {
    const prompt = buildUvDependencyPrompt({ manifest: 'pyproject.toml', pkg: 'httpx', from: '0.27.0', to: '1.0.0' })
    expect(prompt).not.toContain('cargo')
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
  test('без major-оновлень, без Cargo.toml', () => {
    const report = formatReport({ minorPatch: 5, totalChanged: 5, results: [], rust: NO_RUST })
    expect(report).toContain('Оновлено (minor/patch):** 5')
    expect(report).toContain('Major-оновлення:** 0')
    expect(report).not.toContain('Rust-крейти')
  })

  test('з успішним і провальним npm-оновленням', () => {
    const report = formatReport({
      minorPatch: 2,
      totalChanged: 4,
      results: [
        { pkg: 'react', workspace: '.', from: '^17.0.0', to: '^18.0.0', ok: true, error: null },
        { pkg: 'vite', workspace: 'npm', from: '4.0.0', to: '5.0.0', ok: false, error: 'timeout' }
      ],
      rust: NO_RUST
    })
    expect(report).toContain('✅ `react` (.): ^17.0.0 → ^18.0.0')
    expect(report).toContain('❌ `vite` (npm): 4.0.0 → 5.0.0 — timeout')
    expect(report).toContain('Всього змінено:** 4')
  })

  test('Cargo.toml знайдено, але Rust-гілку пропущено (cargo-edit відсутній)', () => {
    const report = formatReport({
      minorPatch: 0,
      totalChanged: 0,
      results: [],
      rust: {
        manifests: ['Cargo.toml', 'llm-lib/crates/llm-cascade/Cargo.toml'],
        processed: false,
        skippedReason: 'cargo-edit не встановлено',
        minorPatch: 0,
        results: []
      }
    })
    expect(report).toContain('⏭ Пропущено (cargo-edit не встановлено)')
    expect(report).toContain('Cargo.toml, llm-lib/crates/llm-cascade/Cargo.toml')
    expect(report).toContain('Всього змінено:** 0')
  })

  test('Rust-гілку оброблено — окремий підрахунок у "Всього змінено"', () => {
    const report = formatReport({
      minorPatch: 1,
      totalChanged: 1,
      results: [],
      rust: {
        manifests: ['llm-lib/crates/llm-cascade/Cargo.toml'],
        processed: true,
        skippedReason: null,
        minorPatch: 2,
        results: [
          {
            pkg: 'genai',
            manifest: 'llm-lib/crates/llm-cascade/Cargo.toml',
            from: '0.4',
            to: '0.5',
            ok: true,
            error: null
          }
        ]
      }
    })
    expect(report).toContain('### Rust-крейти')
    expect(report).toContain('✅ `genai` (llm-lib/crates/llm-cascade/Cargo.toml): 0.4 → 0.5')
    // 1 (npm totalChanged) + 2 (rust minorPatch) + 1 (rust major-результат) = 4
    expect(report).toContain('Всього змінено:** 4')
  })

  test('pyproject.toml знайдено, але Python-гілку пропущено (uv відсутній)', () => {
    const report = formatReport({
      minorPatch: 0,
      totalChanged: 0,
      results: [],
      rust: NO_RUST,
      python: {
        manifests: ['pyproject.toml'],
        processed: false,
        skippedReason: '`uv` не встановлено',
        minorPatch: 0,
        results: []
      }
    })
    expect(report).toContain('### Python-пакети (uv)')
    expect(report).toContain('⏭ Пропущено (`uv` не встановлено)')
    expect(report).toContain('pyproject.toml')
    expect(report).toContain('Всього змінено:** 0')
  })

  test('Python-гілку оброблено — окремий підрахунок у "Всього змінено"', () => {
    const report = formatReport({
      minorPatch: 1,
      totalChanged: 1,
      results: [],
      rust: NO_RUST,
      python: {
        manifests: ['pyproject.toml'],
        processed: true,
        skippedReason: null,
        minorPatch: 3,
        results: [{ pkg: 'typer', manifest: 'pyproject.toml', from: '0.19.1', to: '0.27.0', ok: true, error: null }]
      }
    })
    expect(report).toContain('### Python-пакети (uv)')
    expect(report).toContain('✅ `typer` (pyproject.toml): 0.19.1 → 0.27.0')
    // 1 (npm totalChanged) + 3 (python minorPatch) + 1 (python major-результат) = 5
    expect(report).toContain('Всього змінено:** 5')
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

describe('backupCargoManifests + cleanupCargoBackups', () => {
  test('бекапить кожен Cargo.toml + спільний кореневий Cargo.lock, прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]', 'utf8')
      await writeFile(join(dir, 'Cargo.lock'), 'version = 4', 'utf8')
      await ensureDir(join(dir, 'crates/foo'))
      await writeFile(join(dir, 'crates/foo/Cargo.toml'), '[package]\nname = "foo"', 'utf8')

      const manifests = ['Cargo.toml', 'crates/foo/Cargo.toml']
      await backupCargoManifests(dir, manifests)
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'crates/foo/Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(true)

      await cleanupCargoBackups(dir, manifests)
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'crates/foo/Cargo.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(false)
    })
  })

  test('без Cargo.lock — бекапить лише Cargo.toml, не падає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]', 'utf8')
      await backupCargoManifests(dir, ['Cargo.toml'])
      expect(existsSync(join(dir, 'Cargo.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'Cargo.lock.taze-bak'))).toBe(false)
    })
  })
})

describe('findCargoManifests', () => {
  test('парсить stdout find у список шляхів', () => {
    const found = findCargoManifests('/repo', {
      spawnFn: () => ({ status: 0, stdout: './Cargo.toml\n./llm-lib/crates/llm-cascade/Cargo.toml\n', stderr: '' })
    })
    expect(found).toEqual(['./Cargo.toml', './llm-lib/crates/llm-cascade/Cargo.toml'])
  })

  test('порожній stdout → порожній список', () => {
    expect(findCargoManifests('/repo', { spawnFn: () => ({ status: 0, stdout: '', stderr: '' }) })).toEqual([])
  })
})

describe('findPyprojectManifest', () => {
  test('pyproject.toml існує → список з одним записом', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      expect(findPyprojectManifest(dir)).toEqual(['pyproject.toml'])
    })
  })

  test('pyproject.toml відсутній → порожній список', async () => {
    await withTmpDir(dir => {
      expect(findPyprojectManifest(dir)).toEqual([])
    })
  })
})

describe('backupUvManifest + cleanupUvBackups', () => {
  test('бекапить pyproject.toml + uv.lock, прибирає після', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      await writeFile(join(dir, 'uv.lock'), 'version = 1', 'utf8')

      await backupUvManifest(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(true)

      await cleanupUvBackups(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(false)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(false)
    })
  })

  test('без uv.lock — бекапить лише pyproject.toml, не падає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]', 'utf8')
      await backupUvManifest(dir)
      expect(existsSync(join(dir, 'pyproject.toml.taze-bak'))).toBe(true)
      expect(existsSync(join(dir, 'uv.lock.taze-bak'))).toBe(false)
    })
  })
})

describe('runTazeOrchestrator', () => {
  test('поза .worktrees/ — кидає до будь-якої мутації, не викликає bunx', async () => {
    const bunxCalls = []
    await expect(
      runTazeOrchestrator({
        cwd: '/Users/dev/repo',
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: cmd => {
            if (cmd === 'git') return { status: 0, stdout: '/Users/dev/repo\n', stderr: '' }
            if (cmd === 'bunx') bunxCalls.push(cmd)
            return fakeSpawn(cmd)
          }
        }
      })
    ).rejects.toThrow(NOT_IN_WORKTREE_RE)
    expect(bunxCalls).toHaveLength(0)
  })

  test('без major-оновлень — callRunner не викликається, є звіт', async () => {
    const calls = []
    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 3, totalChanged: 3, comparedWorkspaces: 1 }),
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
  })

  test('ітерує по кожному major-запису обраним раннером, збирає результати', async () => {
    const calls = []
    const major = [
      { workspace: '.', pkg: 'react', from: '^17.0.0', to: '^18.0.0' },
      { workspace: 'npm', pkg: 'vite', from: '4.0.0', to: '5.0.0' }
    ]

    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'cursor',
      log: noop,
      deps: {
        spawnFn: fakeSpawn,
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major, minorPatch: 1, totalChanged: 3, comparedWorkspaces: 2 }),
        callRunner: (runner, prompt, cwd) => {
          calls.push({ runner, prompt, cwd })
          return prompt.includes('vite')
            ? { ok: false, text: '', error: 'idle-timeout' }
            : { ok: true, text: 'ok', error: null }
        }
      }
    })

    expect(calls).toHaveLength(2)
    expect(calls.every(c => c.runner === 'cursor' && c.cwd === '/tmp/project')).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({ pkg: 'react', ok: true })
    expect(result.results[1]).toMatchObject({ pkg: 'vite', ok: false, error: 'idle-timeout' })
    expect(result.report).toContain('❌ `vite`')
  })

  test('кидає з exit-кодом+stderr, якщо детермінована команда провалилась', async () => {
    await expect(
      runTazeOrchestrator({
        cwd: '/tmp/project',
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: cmd => (cmd === 'bunx' ? { status: 1, stdout: '', stderr: 'network error' } : fakeSpawn(cmd)),
          getMonorepoPackageRootDirs: () => ['.'],
          copyFile: noop,
          rm: noop
        }
      })
    ).rejects.toThrow(NETWORK_ERROR_RE)
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
          collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 })
        }
      })

      expect(result.ok).toBe(true)
      expect(existsSync(join(dir, 'package.json.taze-bak'))).toBe(false)
    })
  })

  test('Rust: Cargo.toml знайдено, cargo-edit відсутній → пропущено, npm-гілку не зачіпає', async () => {
    const cargoCalls = []
    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'pi',
      log: noop,
      deps: {
        spawnFn: cmd => {
          if (cmd === 'find') return { status: 0, stdout: './Cargo.toml\n', stderr: '' }
          if (cmd === 'cargo') {
            cargoCalls.push(cmd)
            return { status: 1, stdout: '', stderr: 'no such command: `upgrade`' }
          }
          return fakeSpawn(cmd)
        },
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 })
      }
    })

    // Лише перевірка версії (`cargo upgrade --version`) — сам upgrade/update не викликається.
    expect(cargoCalls).toHaveLength(1)
    expect(result.ok).toBe(true)
    expect(result.rustResults).toEqual([])
    expect(result.report).toContain('⏭ Пропущено')
    expect(result.report).toContain('cargo-edit')
  })

  test('Rust: cargo-edit доступний — bump/diff/ітерація по кожному major-крейту', async () => {
    const cargoCommands = []
    const runnerCalls = []
    const major = [{ manifest: 'llm-lib/crates/llm-cascade/Cargo.toml', pkg: 'genai', from: '0.4', to: '0.5' }]

    const result = await runTazeOrchestrator({
      cwd: '/tmp/project',
      runner: 'codex',
      log: noop,
      deps: {
        spawnFn: cmd => {
          if (cmd === 'find')
            return { status: 0, stdout: './Cargo.toml\n./llm-lib/crates/llm-cascade/Cargo.toml\n', stderr: '' }
          if (cmd === 'cargo') {
            cargoCommands.push(cmd)
            return { status: 0, stdout: '', stderr: '' }
          }
          return fakeSpawn(cmd)
        },
        getMonorepoPackageRootDirs: () => ['.'],
        copyFile: noop,
        rm: noop,
        collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
        collectCargoDiff: (cwd, manifests) => {
          expect(manifests).toEqual(['./Cargo.toml', './llm-lib/crates/llm-cascade/Cargo.toml'])
          return { major, minorPatch: 1, totalChanged: 2, comparedManifests: 2 }
        },
        callRunner: (runner, prompt, cwd) => {
          runnerCalls.push({ runner, prompt, cwd })
          return { ok: true, text: 'сумісно', error: null }
        }
      }
    })

    // cargo upgrade --version (перевірка) + cargo upgrade --incompatible allow + cargo update.
    expect(cargoCommands).toHaveLength(3)
    expect(runnerCalls).toHaveLength(1)
    expect(runnerCalls[0].runner).toBe('codex')
    expect(runnerCalls[0].prompt).toContain('genai')
    expect(result.ok).toBe(true)
    expect(result.rustResults).toEqual([{ ...major[0], ok: true, text: 'сумісно', error: null }])
    expect(result.report).toContain('### Rust-крейти')
    expect(result.report).toContain('✅ `genai`')
  })

  test('Python: pyproject.toml знайдено, uv відсутній → пропущено, npm/rust-гілку не зачіпає', async () => {
    const uvCalls = []
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\ndependencies = []', 'utf8')

      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'pi',
        log: noop,
        deps: {
          spawnFn: cmd => {
            if (cmd === 'uv') {
              uvCalls.push(cmd)
              return { status: 1, stdout: '', stderr: 'command not found: uv' }
            }
            return fakeSpawn(cmd)
          },
          getMonorepoPackageRootDirs: () => ['.'],
          copyFile: noop,
          rm: noop,
          collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 })
        }
      })

      // Лише перевірка версії (`uv --version`) — bump-цикл не викликається.
      expect(uvCalls).toHaveLength(1)
      expect(result.ok).toBe(true)
      expect(result.pythonResults).toEqual([])
      expect(result.report).toContain('### Python-пакети (uv)')
      expect(result.report).toContain('⏭ Пропущено')
    })
  })

  test('Python: uv доступний — bump/diff/ітерація по кожному major-пакету', async () => {
    const runnerCalls = []
    const bumpCalls = []
    const major = [{ manifest: 'pyproject.toml', pkg: 'typer', from: '0.19.1', to: '0.27.0' }]

    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\ndependencies = ["typer>=0.19.1"]', 'utf8')

      const result = await runTazeOrchestrator({
        cwd: dir,
        runner: 'codex',
        log: noop,
        deps: {
          spawnFn: fakeSpawn,
          getMonorepoPackageRootDirs: () => ['.'],
          copyFile: noop,
          rm: noop,
          collectTazeDiff: () => ({ major: [], minorPatch: 0, totalChanged: 0, comparedWorkspaces: 1 }),
          bumpUvDependencies: (...args) => {
            bumpCalls.push(args)
          },
          collectUvDiff: cwd => {
            expect(cwd).toBe(dir)
            return { major, minorPatch: 1, totalChanged: 2, comparedManifests: 1 }
          },
          callRunner: (runner, prompt, cwd) => {
            runnerCalls.push({ runner, prompt, cwd })
            return { ok: true, text: 'сумісно', error: null }
          }
        }
      })

      expect(bumpCalls).toHaveLength(1)
      expect(runnerCalls).toHaveLength(1)
      expect(runnerCalls[0].runner).toBe('codex')
      expect(runnerCalls[0].prompt).toContain('typer')
      expect(result.ok).toBe(true)
      expect(result.pythonResults).toEqual([{ ...major[0], ok: true, text: 'сумісно', error: null }])
      expect(result.report).toContain('### Python-пакети (uv)')
      expect(result.report).toContain('✅ `typer`')
    })
  })
})
