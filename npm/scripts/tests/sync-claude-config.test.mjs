/**
 * Тести sync-claude-config: merge-логіка settings.json, опт-аут,
 * синхронізація slash-команд і ADR Stop-hook'ів.
 *
 * Управлений хук пакета зараз — PostToolUse (`@nitra/cursor post-tool-use-fix`).
 * Legacy Stop-hook (`@nitra/cursor stop-hook`) усе ще ідентифікується як managed,
 * щоб при оновленні старих інсталяцій автоматично прибиратись.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ADR_GITIGNORE_SNIPPET_REL,
  ADR_HOOK_COMMAND_MARKER,
  LEGACY_STOP_HOOK_COMMAND_MARKER,
  MANAGED_HOOK_COMMAND_MARKER,
  mergeAllowList,
  mergeCursorHooksConfig,
  mergeHooks,
  mergeSettings,
  removeOrphanAdrHookLib,
  syncAdrHookLibScripts,
  syncClaudeConfig,
  syncGitignoreAdrFragment
} from '../sync-claude-config.mjs'
import { withTmpCwd, writeJson } from '../utils/test-helpers.mjs'

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
  await mkdir(join(cwdAbs, TEMPLATE_REL, 'hooks', 'lib'), { recursive: true })
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'hooks', 'lib', 'tooling-only.sh'),
    tpl.toolingOnlyLib ?? '#!/usr/bin/env bash\nis_tooling_only_change() { return 1; }\n',
    'utf8'
  )
  const settings = tpl.settings ?? {
    permissions: { allow: ['Bash(bun *)'] },
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix', timeout: 300 }]
        }
      ]
    }
  }
  await writeFile(
    join(cwdAbs, TEMPLATE_REL, 'settings.template.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8'
  )
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
  const gitignoreSnippet =
    tpl.gitignoreSnippet ??
    `node_modules/
dist/
*.secret

# @nitra/cursor (adr) — локальні артефакти Stop-hook, не коміти
.claude/hooks/*.log
.claude/hooks/.normalize-state
.claude/hooks/.normalize.lock
`
  await mkdir(join(pkgRoot, 'rules/adr/js/templates/hooks'), { recursive: true })
  await writeFile(join(pkgRoot, ADR_GITIGNORE_SNIPPET_REL), gitignoreSnippet, 'utf8')
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
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix' }]
        }
      ]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix --updated' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.PostToolUse).toHaveLength(1)
    expect(merged.PostToolUse[0].hooks[0].command).toBe('npx --no @nitra/cursor post-tool-use-fix --updated')
  })

  test('зберігає користувацькі групи поряд з managed', () => {
    const existing = {
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo my-custom-hook' }] }]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.PostToolUse).toHaveLength(2)
    expect(merged.PostToolUse[0].hooks[0].command).toBe('echo my-custom-hook')
    expect(merged.PostToolUse[1].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
  })

  test('legacy Stop-hook (`@nitra/cursor stop-hook`) видаляється навіть якщо темплейт уже не має події Stop', () => {
    const existing = {
      Stop: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook' }]
        }
      ]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.Stop).toBeUndefined()
    expect(merged.PostToolUse).toHaveLength(1)
  })

  test('зберігає користувацькі groups в Stop, навіть коли темплейт переніс managed у PostToolUse', () => {
    const existing = {
      Stop: [
        // legacy managed — має зникнути
        { matcher: '', hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook' }] },
        // користувацька — має лишитись
        { matcher: '', hooks: [{ type: 'command', command: 'echo user-stop' }] }
      ]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.Stop).toHaveLength(1)
    expect(merged.Stop[0].hooks[0].command).toBe('echo user-stop')
    expect(merged.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
  })

  test('не чіпає чужі події, яких немає в темплейті і які не містять managed-маркера', () => {
    const existing = {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
    }
    const merged = mergeHooks(existing, {})
    expect(merged.PreToolUse).toEqual(existing.PreToolUse)
  })

  test('LEGACY_STOP_HOOK_COMMAND_MARKER експортовано як константа', () => {
    expect(LEGACY_STOP_HOOK_COMMAND_MARKER).toBe('@nitra/cursor stop-hook')
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
  test('створює settings.json із managed PostToolUse групою', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      expect(result.settings).toBe(true)
      expect(result.commands).toEqual([])
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      expect(settings.hooks.PostToolUse[0].matcher).toBe('Edit|Write|MultiEdit')
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
      expect(settings.hooks.PostToolUse[0].hooks[0].timeout).toBe(300)
      expect(settings.hooks.Stop).toBeUndefined()
    })
  })

  test('міграція: існуючий legacy Stop-hook видаляється; PostToolUse додається', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeJson('.claude/settings.json', {
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook', timeout: 60 }]
            }
          ]
        }
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.hooks.Stop).toBeUndefined()
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
    })
  })

  test('зберігає користувацькі permissions і користувацькі групи у Stop при повторному синку', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeJson('.claude/settings.json', {
        permissions: { allow: ['Bash(git *)'], deny: ['WebFetch(domain:evil.com)'] },
        hooks: {
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user-stop-hook' }] }]
        }
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      expect(settings.permissions.allow).toEqual(['Bash(git *)', 'Bash(bun *)'])
      expect(settings.permissions.deny).toEqual(['WebFetch(domain:evil.com)'])
      // User Stop entry preserved
      expect(settings.hooks.Stop).toHaveLength(1)
      expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo user-stop-hook')
      // Managed PostToolUse added
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
    })
  })

  test('повторний sync ідемпотентний: managed PostToolUse група не дублюється', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile('.claude/settings.json', 'utf8'))
      const managedCount = settings.hooks.PostToolUse.filter(g =>
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
        adrNormalizeHook: false,
        adrHookLib: [],
        gitignoreAdr: false,
        piExtension: false
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
      // ADR не в Stop і взагалі немає події Stop
      expect(settings.hooks.Stop).toBeUndefined()
    })
  })

  test('з правилом "adr": дописує канонічний фрагмент у .gitignore', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })
      expect(result.gitignoreAdr).toBe(true)
      const gi = await readFile('.gitignore', 'utf8')
      expect(gi).toContain('.claude/hooks/*.log')
      expect(gi).toContain('.claude/hooks/.normalize-state')
      expect(gi).toContain('# @nitra/cursor (adr)')
    })
  })

  test('syncGitignoreAdrFragment: повторний виклик не дублює рядки', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const first = await syncGitignoreAdrFragment(cwdAbs, pkgRoot)
      const second = await syncGitignoreAdrFragment(cwdAbs, pkgRoot)
      expect(first.written).toBe(true)
      expect(second.written).toBe(false)
      const gitignoreContent = await readFile('.gitignore', 'utf8')
      const lines = gitignoreContent.split('\n').filter(l => l.includes('.claude/hooks'))
      expect(lines.filter(l => l.includes('*.log')).length).toBe(1)
    })
  })

  test('без правила "adr": .gitignore не змінюється', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['text']
      })
      expect(result.gitignoreAdr).toBe(false)
      expect(await readFile('.gitignore', 'utf8')).toBe('node_modules/\n')
    })
  })

  test('з правилом "adr": копіюються обидва hook-скрипти і ADR-групи додаються у Stop, managed fix — у PostToolUse', async () => {
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
      // ADR групи у Stop event
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
      // Managed fix hook — у PostToolUse, не у Stop
      const fixGroup = settings.hooks.PostToolUse.find(g =>
        g.hooks?.some(h => h.command?.includes(MANAGED_HOOK_COMMAND_MARKER))
      )
      expect(fixGroup).toBeTruthy()
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
      // Stop взагалі не має managed entries — отже або відсутній, або має лише user-entries
      const hasAdr = (settings.hooks.Stop ?? []).some(g =>
        g.hooks?.some(h => h.command?.includes(ADR_HOOK_COMMAND_MARKER))
      )
      const hasNormalize = (settings.hooks.Stop ?? []).some(g =>
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

  test('з правилом "adr": копіює .claude/hooks/lib/*.sh без exec-біта', async () => {
    await withTmpCwd(async cwdAbs => {
      const libBody = '#!/usr/bin/env bash\nis_tooling_only_change() { return 1; }\n'
      const pkgRoot = await setupTemplate(cwdAbs, { toolingOnlyLib: libBody })
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })
      expect(result.adrHookLib).toEqual(['.claude/hooks/lib/tooling-only.sh'])
      const libDest = join(cwdAbs, '.claude/hooks/lib/tooling-only.sh')
      expect(existsSync(libDest)).toBe(true)
      expect(await readFile(libDest, 'utf8')).toBe(libBody)
      // Source-only — execute-bit не виставляємо (на відміну від caller-скриптів).
      // accessSync(X_OK) кидає коли файл невиконуваний — це й контракт.
      const { accessSync, constants: fsConst } = await import('node:fs')
      let executable = true
      try {
        accessSync(libDest, fsConst.X_OK)
      } catch {
        executable = false
      }
      expect(executable).toBe(false)
    })
  })

  test('повторний sync — lib-файли перезаписуються (idempotent)', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs, { toolingOnlyLib: '#!/usr/bin/env bash\n# v1\n' })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      // Користувач "псує" lib-файл; пакет має його повернути.
      await writeFile(join(cwdAbs, '.claude/hooks/lib/tooling-only.sh'), '# tampered\n', 'utf8')
      await writeFile(join(cwdAbs, 'pkg/.claude-template/hooks/lib/tooling-only.sh'), '#!/usr/bin/env bash\n# v2\n', 'utf8')
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      expect(await readFile(join(cwdAbs, '.claude/hooks/lib/tooling-only.sh'), 'utf8')).toBe(
        '#!/usr/bin/env bash\n# v2\n'
      )
    })
  })

  test('видалення "adr" з rules: .claude/hooks/lib/ прибирається з диска', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      expect(existsSync(join(cwdAbs, '.claude/hooks/lib/tooling-only.sh'))).toBe(true)
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: []
      })
      expect(result.adrHookLib).toEqual([])
      expect(existsSync(join(cwdAbs, '.claude/hooks/lib'))).toBe(false)
    })
  })

  test('syncAdrHookLibScripts: повертає [] якщо темплейту lib/ нема', async () => {
    await withTmpCwd(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      // Видаляємо lib-каталог із темплейту — sync має тихо повернути порожній масив.
      const { rm } = await import('node:fs/promises')
      await rm(join(cwdAbs, TEMPLATE_REL, 'hooks', 'lib'), { recursive: true, force: true })
      const written = await syncAdrHookLibScripts(cwdAbs, join(pkgRoot, '.claude-template'))
      expect(written).toEqual([])
      expect(existsSync(join(cwdAbs, '.claude/hooks/lib'))).toBe(false)
    })
  })

  test('removeOrphanAdrHookLib: no-op коли теки нема', async () => {
    await withTmpCwd(async cwdAbs => {
      const result = await removeOrphanAdrHookLib(cwdAbs)
      expect(result).toEqual({ removed: false, path: '' })
    })
  })

  test('source helper із capture-decisions.sh без помилок (bash 3.2 fixture)', async () => {
    await withTmpCwd(async cwdAbs => {
      const captureBody = `#!/usr/bin/env bash
set -eu
LOG=/dev/null
log() { :; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/tooling-only.sh
. "$SCRIPT_DIR/lib/tooling-only.sh"
# Smoke: empty stdin → не tooling.
if printf '' | is_tooling_only_change "$PWD"; then
  exit 10
fi
# Smoke: docs/adr/foo.md → tooling-only (returns 0).
if ! printf 'docs/adr/foo.md\n' | is_tooling_only_change "$PWD"; then
  exit 11
fi
exit 0
`
      const pkgRoot = await setupTemplate(cwdAbs, {
        captureDecisionsSh: captureBody,
        toolingOnlyLib: await readFile(
          join(import.meta.dir, '..', '..', '.claude-template', 'hooks', 'lib', 'tooling-only.sh'),
          'utf8'
        )
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      const proc = Bun.spawn(['bash', join(cwdAbs, '.claude/hooks/capture-decisions.sh')], {
        cwd: cwdAbs,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe'
      })
      proc.stdin.end()
      const code = await proc.exited
      expect(code).toBe(0)
    })
  })
})
