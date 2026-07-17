/**
 * Тести для skills/taze/js/orchestrate.mjs:
 *   - buildDependencyPrompt: промпт містить пакет/версії, лише кроки 4-6;
 *   - callRunner: pi (текст через deps.out) vs cursor/codex (return/throw);
 *   - formatReport: детермінований markdown-звіт;
 *   - backupWorkspacePackageFiles/cleanupBackups: реальні tmp-файли;
 *   - findCargoManifests: інжектований spawnFn;
 *   - runTazeOrchestrator: повна ітерація з усіма інжектами (без реальних bunx/LLM).
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
  findCargoManifests,
  formatReport,
  runTazeOrchestrator
} from '../orchestrate.mjs'

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
  test('без major-оновлень', () => {
    const report = formatReport({ minorPatch: 5, totalChanged: 5, results: [], rustCrates: [] })
    expect(report).toContain('Оновлено (minor/patch):** 5')
    expect(report).toContain('Major-оновлення:** 0')
    expect(report).not.toContain('Rust-крейти')
  })

  test('з успішним і провальним major-оновленням + rust-крейтами', () => {
    const report = formatReport({
      minorPatch: 2,
      totalChanged: 4,
      results: [
        { pkg: 'react', workspace: '.', from: '^17.0.0', to: '^18.0.0', ok: true, error: null },
        { pkg: 'vite', workspace: 'npm', from: '4.0.0', to: '5.0.0', ok: false, error: 'timeout' }
      ],
      rustCrates: ['Cargo.toml', 'llm-lib/crates/llm-cascade/Cargo.toml']
    })
    expect(report).toContain('✅ `react` (.): ^17.0.0 → ^18.0.0')
    expect(report).toContain('❌ `vite` (npm): 4.0.0 → 5.0.0 — timeout')
    expect(report).toContain('Rust-крейти (2)')
    expect(report).toContain('Всього змінено:** 4')
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
})
