/**
 * Тести sync-claude-config: merge-логіка settings.json, опт-аут, копіювання
 * `npm/CLAUDE.md` лише за наявності `npm/`.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  MANAGED_HOOK_COMMAND_MARKER,
  mergeAllowList,
  mergeHooks,
  mergeSettings,
  syncClaudeConfig
} from '../scripts/sync-claude-config.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

const TEMPLATE_REL = 'pkg/.claude-template'

/**
 * Створює мінімальний bundled-пакет із `.claude-template/` всередині, повертає
 * абсолютний шлях, який очікує `syncClaudeConfig` як `bundledPackageRoot`.
 * @param {string} cwdAbs корінь тимчасового проєкту
 * @param {object} [tpl] перевизначення вмісту темплейтів
 * @returns {Promise<string>} абсолютний шлях до bundledPackageRoot
 */
async function setupTemplate(cwdAbs, tpl = {}) {
  const pkgRoot = join(cwdAbs, 'pkg')
  await mkdir(join(cwdAbs, TEMPLATE_REL, 'commands'), { recursive: true })
  const settings = tpl.settings ?? {
    permissions: { allow: ['Bash(bun *)'] },
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook' }]
        }
      ]
    }
  }
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'settings.template.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8'
  )
  await writeFile(join(cwdAbs, TEMPLATE_REL, 'npm-CLAUDE.md'), tpl.npmClaudeMd ?? '# npm scoped\n', 'utf8')
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'commands', 'n-check.md'),
    tpl.commandNCheck ?? '# n-check stub\n',
    'utf8'
  )
  return pkgRoot
}

describe('mergeAllowList', () => {
  test('union без дублікатів, порядок: спочатку існуючі', () => {
    expect(mergeAllowList(['Bash(git *)', 'Bash(bun *)'], ['Bash(bun *)', 'Bash(npx *)'])).toEqual([
      'Bash(git *)',
      'Bash(bun *)',
      'Bash(npx *)'
    ])
  })

  test('обробляє undefined по обидва боки', () => {
    expect(mergeAllowList(undefined, ['x'])).toEqual(['x'])
    expect(mergeAllowList(['x'])).toEqual(['x'])
    expect(mergeAllowList()).toEqual([])
  })
})

describe('mergeHooks', () => {
  test('видаляє managed-групу і вставляє актуальну з темплейту', () => {
    const existing = {
      Stop: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook' }]
        }
      ]
    }
    const fromTemplate = {
      Stop: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook --updated' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.Stop).toHaveLength(1)
    expect(merged.Stop[0].hooks[0].command).toBe('npx --no @nitra/cursor stop-hook --updated')
  })

  test('зберігає користувацькі групи поряд з managed', () => {
    const existing = {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo my-custom-hook' }] }]
    }
    const fromTemplate = {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook' }] }]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.Stop).toHaveLength(2)
    expect(merged.Stop[0].hooks[0].command).toBe('echo my-custom-hook')
    expect(merged.Stop[1].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
  })

  test('не чіпає події, яких немає в темплейті', () => {
    const existing = {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
    }
    const merged = mergeHooks(existing, {})
    expect(merged.PreToolUse).toEqual(existing.PreToolUse)
  })
})

describe('mergeSettings', () => {
  test('зберігає сторонні поля верхнього рівня', () => {
    const existing = { model: 'opus', extra: 42 }
    const template = { permissions: { allow: ['Bash(bun *)'] } }
    const merged = mergeSettings(existing, template)
    expect(merged.model).toBe('opus')
    expect(merged.extra).toBe(42)
    expect(merged.permissions?.allow).toEqual(['Bash(bun *)'])
  })

  test('зберігає інші ключі permissions крім allow', () => {
    const existing = { permissions: { allow: ['x'], deny: ['y'] } }
    const template = { permissions: { allow: ['z'] } }
    const merged = mergeSettings(existing, template)
    expect(merged.permissions?.allow).toEqual(['x', 'z'])
    expect(merged.permissions?.deny).toEqual(['y'])
  })
})

describe('syncClaudeConfig (інтеграція)', () => {
  test('створює settings.json + npm/CLAUDE.md + slash-команди', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await ensureDir('npm')
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      expect(result.settings).toBe(true)
      expect(result.npmClaudeMd).toBe(true)
      expect(result.commands).toEqual(['.claude/commands/n-check.md'])
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
      expect(await readFile('npm/CLAUDE.md', 'utf8')).toBe('# npm scoped\n')
      expect(await readFile('.claude/commands/n-check.md', 'utf8')).toBe('# n-check stub\n')
    })
  })

  test('пропускає npm/CLAUDE.md, якщо немає каталогу npm/', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      expect(result.npmClaudeMd).toBe(false)
      expect(existsSync(join(cwdAbs, 'npm/CLAUDE.md'))).toBe(false)
    })
  })

  test('зберігає користувацькі permissions і hooks при повторному синку', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeJson('.claude/settings.json', {
        permissions: { allow: ['Bash(git *)'], deny: ['WebFetch(domain:evil.com)'] },
        hooks: {
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user-hook' }] }]
        }
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.permissions.allow).toEqual(['Bash(git *)', 'Bash(bun *)'])
      expect(settings.permissions.deny).toEqual(['WebFetch(domain:evil.com)'])
      expect(settings.hooks.Stop).toHaveLength(2)
      expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo user-hook')
      expect(settings.hooks.Stop[1].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
    })
  })

  test('повторний sync ідемпотентний: managed-група не дублюється', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const stopHooks = settings.hooks.Stop
      const managedCount = stopHooks.filter(g =>
        g.hooks?.some(h => h.command?.includes(MANAGED_HOOK_COMMAND_MARKER))
      ).length
      expect(managedCount).toBe(1)
      expect(settings.permissions.allow).toEqual(['Bash(bun *)'])
    })
  })

  test('опт-аут через enabled=false', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: false })
      expect(result).toEqual({ settings: false, npmClaudeMd: false, commands: [] })
      expect(existsSync(join(cwdAbs, '.claude/settings.json'))).toBe(false)
    })
  })
})
