/**
 * Тести sync-claude-config: merge-логіка settings.json, опт-аут,
 * синхронізація slash-команд і ADR Stop-hook'ів.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ADR_HOOK_COMMAND_MARKER,
  MANAGED_HOOK_COMMAND_MARKER,
  mergeAllowList,
  mergeCursorHooksConfig,
  mergeHooks,
  mergeSettings,
  syncClaudeConfig
} from './sync-claude-config.mjs'
import { withTmpCwd, writeJson } from './utils/test-helpers.mjs'

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
  await mkdir(join(cwdAbs, TEMPLATE_REL, 'hooks'), { recursive: true })
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
  await writeFile(join(cwdAbs, TEMPLATE_REL, 'commands', 'n-check.md'), tpl.commandNCheck ?? '# n-check stub\n', 'utf8')
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'hooks', 'capture-decisions.sh'),
    tpl.captureDecisionsSh ?? '#!/usr/bin/env bash\nexit 0\n',
    'utf8'
  )
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'hooks', 'normalize-decisions.sh'),
    tpl.normalizeDecisionsSh ?? '#!/usr/bin/env bash\nexit 0\n',
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

describe('mergeCursorHooksConfig', () => {
  test('додає ADR stop hooks і зберігає користувацькі entries', () => {
    const merged = mergeCursorHooksConfig(
      {
        version: 1,
        hooks: {
          stop: [{ command: 'echo user-stop' }],
          afterFileEdit: [{ command: 'echo edit' }]
        }
      },
      { includeAdrHook: true }
    )
    expect(merged.hooks?.afterFileEdit).toEqual([{ command: 'echo edit' }])
    expect(merged.hooks?.stop).toHaveLength(3)
    expect(merged.hooks?.stop?.[0].command).toBe('echo user-stop')
    expect(merged.hooks?.stop?.[1].command).toContain('.claude/hooks/capture-decisions.sh')
    expect(merged.hooks?.stop?.[2].command).toContain('.claude/hooks/normalize-decisions.sh')
  })

  test('видаляє managed ADR stop hooks, коли правило вимкнене', () => {
    const withAdr = mergeCursorHooksConfig(undefined, { includeAdrHook: true })
    const merged = mergeCursorHooksConfig(withAdr, { includeAdrHook: false })
    expect(merged.hooks).toBeUndefined()
    expect(merged.version).toBe(1)
  })
})

describe('syncClaudeConfig (інтеграція)', () => {
  test('створює settings.json + slash-команди', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      expect(result.settings).toBe(true)
      expect(result.commands).toEqual(['.claude/commands/n-check.md'])
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
      expect(await readFile('.claude/commands/n-check.md', 'utf8')).toBe('# n-check stub\n')
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
      expect(result).toEqual({
        settings: false,
        cursorHooks: false,
        commands: [],
        adrHook: false,
        adrNormalizeHook: false
      })
      expect(existsSync(join(cwdAbs, '.claude/settings.json'))).toBe(false)
    })
  })

  test('без правила "adr": ADR-hook не копіюється і не з\'являється у settings.json', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['bun', 'text']
      })
      expect(result.adrHook).toBe(false)
      expect(existsSync(join(cwdAbs, '.claude/hooks/capture-decisions.sh'))).toBe(false)
      expect(result.cursorHooks).toBe(false)
      expect(existsSync(join(cwdAbs, '.cursor/hooks.json'))).toBe(false)
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const hasAdr = settings.hooks.Stop.some(g => g.hooks?.some(h => h.command?.includes(ADR_HOOK_COMMAND_MARKER)))
      expect(hasAdr).toBe(false)
    })
  })

  test('з правилом "adr": копіюються обидва hook-скрипти і додаються managed-групи у Stop', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs, {
        captureDecisionsSh: '#!/usr/bin/env bash\necho adr-capture\n',
        normalizeDecisionsSh: '#!/usr/bin/env bash\necho adr-normalize\n'
      })
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr', 'text']
      })
      expect(result.adrHook).toBe(true)
      expect(result.adrNormalizeHook).toBe(true)
      expect(result.cursorHooks).toBe(true)
      expect(await readFile('.claude/hooks/capture-decisions.sh', 'utf8')).toBe(
        '#!/usr/bin/env bash\necho adr-capture\n'
      )
      expect(await readFile('.claude/hooks/normalize-decisions.sh', 'utf8')).toBe(
        '#!/usr/bin/env bash\necho adr-normalize\n'
      )
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const cursorHooks = JSON.parse(await readFile('.cursor/hooks.json', 'utf8'))
      expect(cursorHooks.hooks.stop).toHaveLength(2)
      expect(cursorHooks.hooks.stop[0].command).toContain('.claude/hooks/capture-decisions.sh')
      expect(cursorHooks.hooks.stop[0].timeout).toBe(180)
      expect(cursorHooks.hooks.stop[1].command).toContain('.claude/hooks/normalize-decisions.sh')
      expect(cursorHooks.hooks.stop[1].timeout).toBe(600)
      const captureGroup = settings.hooks.Stop.find(g =>
        g.hooks?.some(h => h.command?.includes(ADR_HOOK_COMMAND_MARKER))
      )
      expect(captureGroup).toBeTruthy()
      expect(captureGroup.hooks[0].timeout).toBe(180)
      const normalizeGroup = settings.hooks.Stop.find(g =>
        g.hooks?.some(h => h.command?.includes('.claude/hooks/normalize-decisions.sh'))
      )
      expect(normalizeGroup).toBeTruthy()
      expect(normalizeGroup.hooks[0].async).toBe(true)
      expect(normalizeGroup.hooks[0].timeout).toBe(600)
      const lintGroup = settings.hooks.Stop.find(g =>
        g.hooks?.some(h => h.command?.includes(MANAGED_HOOK_COMMAND_MARKER))
      )
      expect(lintGroup).toBeTruthy()
    })
  })

  test('видалення "adr" з rules: ADR managed-група прибирається з settings, скрипт лишається на диску', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })
      expect(existsSync(join(cwdAbs, '.claude/hooks/capture-decisions.sh'))).toBe(true)
      expect(existsSync(join(cwdAbs, '.claude/hooks/normalize-decisions.sh'))).toBe(true)
      await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: []
      })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const cursorHooks = JSON.parse(await readFile('.cursor/hooks.json', 'utf8'))
      const hasAdr = settings.hooks.Stop.some(g => g.hooks?.some(h => h.command?.includes(ADR_HOOK_COMMAND_MARKER)))
      const hasNormalize = settings.hooks.Stop.some(g =>
        g.hooks?.some(h => h.command?.includes('.claude/hooks/normalize-decisions.sh'))
      )
      expect(hasAdr).toBe(false)
      expect(hasNormalize).toBe(false)
      expect(cursorHooks.hooks).toBeUndefined()
      // Скрипти лишаються — користувач прибирає вручну, щоб не втратити кастомізації.
      expect(existsSync(join(cwdAbs, '.claude/hooks/capture-decisions.sh'))).toBe(true)
      expect(existsSync(join(cwdAbs, '.claude/hooks/normalize-decisions.sh'))).toBe(true)
    })
  })

  test('повторний sync з "adr" не дублює managed ADR-групи (capture + normalize)', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const cursorHooks = JSON.parse(await readFile('.cursor/hooks.json', 'utf8'))
      const captureCount = settings.hooks.Stop.filter(g =>
        g.hooks?.some(h => h.command?.includes(ADR_HOOK_COMMAND_MARKER))
      ).length
      const normalizeCount = settings.hooks.Stop.filter(g =>
        g.hooks?.some(h => h.command?.includes('.claude/hooks/normalize-decisions.sh'))
      ).length
      expect(captureCount).toBe(1)
      expect(normalizeCount).toBe(1)
      const cursorCaptureCount = cursorHooks.hooks.stop.filter(h =>
        h.command?.includes('.claude/hooks/capture-decisions.sh')
      ).length
      const cursorNormalizeCount = cursorHooks.hooks.stop.filter(h =>
        h.command?.includes('.claude/hooks/normalize-decisions.sh')
      ).length
      expect(cursorCaptureCount).toBe(1)
      expect(cursorNormalizeCount).toBe(1)
    })
  })
})
