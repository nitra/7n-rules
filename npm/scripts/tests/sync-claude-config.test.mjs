/**
 * Тести sync-claude-config: merge-логіка settings.json, опт-аут,
 * синхронізація slash-команд і ADR Stop-hook'ів.
 *
 * Управлений хук пакета зараз — PostToolUse (`npx --no \@7n/rules hook --post-tool-use`).
 * Legacy-команди (`stop-hook`, `post-tool-use-check`, `post-tool-use-fix`) усе ще
 * ідентифікуються як managed, щоб при оновленні старих інсталяцій автоматично прибиратись.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ADR_GITIGNORE_SNIPPET_REL,
  ADR_HOOK_COMMAND_MARKER,
  LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER,
  LEGACY_STOP_HOOK_COMMAND_MARKER,
  MANAGED_HOOK_COMMAND_MARKER,
  mergeAllowList,
  mergeCursorHooksConfig,
  mergeHooks,
  mergeSettings,
  removeOrphanAdrHookLib,
  RTK_CLAUDE_HOOK_COMMAND_MARKER,
  RTK_CURSOR_HOOK_COMMAND_MARKER,
  RTK_PI_EXTENSION_FILE,
  syncAdrHookLibScripts,
  syncAdrHookScript,
  syncClaudeCommands,
  syncClaudeConfig,
  syncClaudeSettings,
  syncGitignoreAdrFragment
} from '../sync-claude-config.mjs'
import { withTmpDir, writeJson } from '../utils/test-helpers.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

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
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use', timeout: 300 }]
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

# @7n/rules (adr) — локальні артефакти Stop-hook, не коміти
.claude/hooks/*.log
.claude/hooks/.normalize-state
.claude/hooks/.normalize.lock
`
  await mkdir(join(pkgRoot, 'rules/adr/js/templates/hooks'), { recursive: true })
  await writeFile(join(pkgRoot, ADR_GITIGNORE_SNIPPET_REL), gitignoreSnippet, 'utf8')
  await mkdir(join(pkgRoot, '.pi-template/extensions'), { recursive: true })
  await writeFile(
    join(pkgRoot, '.pi-template/extensions', RTK_PI_EXTENSION_FILE),
    tpl.rtkPiExtensionTs ?? '// rtk pi-extension stub\n',
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
  test('видаляє managed-групу (у т.ч. legacy `post-tool-use-check`) і вставляє актуальну з темплейту', () => {
    const existing = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          // legacy detect-команда з попередніх релізів — managed, має замінитись
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-check' }]
        }
      ]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use' }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.PostToolUse).toHaveLength(1)
    expect(merged.PostToolUse[0].hooks[0].command).toBe('npx --no @7n/rules hook --post-tool-use')
  })

  test('зберігає користувацькі групи поряд з managed', () => {
    const existing = {
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo my-custom-hook' }] }]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use' }]
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
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use' }]
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
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use' }]
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

  test('LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER експортовано як константа', () => {
    expect(LEGACY_POST_TOOL_USE_FIX_HOOK_COMMAND_MARKER).toBe('@nitra/cursor post-tool-use-fix')
  })

  test('legacy мутуюча група `post-tool-use-fix` видаляється, лишається лише detect-only з темплейту', () => {
    // Сценарій nitra/task: стара fix-група лежить поруч із новою detect-only після попереднього ресинку
    const existing = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix', timeout: 300 }]
        },
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use', timeout: 300 }]
        }
      ]
    }
    const fromTemplate = {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use', timeout: 300 }]
        }
      ]
    }
    const merged = mergeHooks(existing, fromTemplate)
    expect(merged.PostToolUse).toHaveLength(1)
    expect(merged.PostToolUse[0].hooks[0].command).toBe('npx --no @7n/rules hook --post-tool-use')
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

  test('прибирає legacy `post-tool-use-fix` групу при ресинку на detect-only hook', () => {
    const existing = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [{ type: 'command', command: 'npx --no @nitra/cursor post-tool-use-fix', timeout: 300 }]
          }
        ]
      }
    }
    const template = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [{ type: 'command', command: 'npx --no @7n/rules hook --post-tool-use', timeout: 300 }]
          }
        ]
      }
    }
    const merged = mergeSettings(existing, template)
    expect(merged.hooks?.PostToolUse).toHaveLength(1)
    expect(merged.hooks?.PostToolUse?.[0].hooks[0].command).toBe('npx --no @7n/rules hook --post-tool-use')
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

  test('local-ai: додає rtk preToolUse entry і зберігає користувацькі entries', () => {
    const merged = mergeCursorHooksConfig(
      {
        version: 1,
        hooks: { preToolUse: [{ command: 'echo user-pre-tool-use' }] }
      },
      { includeLocalAiHook: true }
    )
    expect(merged.hooks?.preToolUse).toHaveLength(2)
    expect(merged.hooks?.preToolUse?.[0].command).toBe('echo user-pre-tool-use')
    expect(merged.hooks?.preToolUse?.[1].command).toContain(RTK_CURSOR_HOOK_COMMAND_MARKER)
    expect(merged.hooks?.preToolUse?.[1].matcher).toBe('Shell')
  })

  test('local-ai: повторний merge не дублює rtk entry; вимкнення прибирає його', () => {
    const withRtk = mergeCursorHooksConfig(undefined, { includeLocalAiHook: true })
    const again = mergeCursorHooksConfig(withRtk, { includeLocalAiHook: true })
    expect(again.hooks?.preToolUse?.filter(e => e.command.includes(RTK_CURSOR_HOOK_COMMAND_MARKER))).toHaveLength(1)
    const disabled = mergeCursorHooksConfig(again, { includeLocalAiHook: false })
    expect(disabled.hooks).toBeUndefined()
  })

  test('adr і local-ai співіснують у різних подіях', () => {
    const merged = mergeCursorHooksConfig(undefined, { includeAdrHook: true, includeLocalAiHook: true })
    expect(merged.hooks?.stop).toHaveLength(2)
    expect(merged.hooks?.preToolUse).toHaveLength(1)
  })
})

describe('mergeSettings (local-ai)', () => {
  test('includeLocalAiHook додає rtk-групу в PreToolUse з fail-open guard', () => {
    const template = { hooks: {} }
    const merged = mergeSettings(undefined, template, { includeLocalAiHook: true })
    expect(merged.hooks?.PreToolUse).toHaveLength(1)
    const group = merged.hooks?.PreToolUse?.[0]
    expect(group?.matcher).toBe('Bash')
    expect(group?.hooks[0].command).toContain(RTK_CLAUDE_HOOK_COMMAND_MARKER)
    expect(group?.hooks[0].command).toContain('command -v rtk')
    expect(group?.hooks[0].timeout).toBe(30)
  })

  test('вимкнення local-ai прибирає rtk-групу, користувацькі PreToolUse групи лишаються', () => {
    const template = { hooks: {} }
    const withRtk = mergeSettings(
      { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] }] } },
      template,
      { includeLocalAiHook: true }
    )
    expect(withRtk.hooks?.PreToolUse).toHaveLength(2)
    const disabled = mergeSettings(withRtk, template, { includeLocalAiHook: false })
    expect(disabled.hooks?.PreToolUse).toHaveLength(1)
    expect(disabled.hooks?.PreToolUse?.[0].hooks[0].command).toBe('echo user-pre')
  })
})

describe('syncClaudeConfig (інтеграція)', () => {
  test('створює settings.json із managed PostToolUse групою', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      expect(result.settings).toBe(true)
      expect(result.commands).toEqual([])
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      expect(settings.hooks.PostToolUse[0].matcher).toBe('Edit|Write|MultiEdit')
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
      expect(settings.hooks.PostToolUse[0].hooks[0].timeout).toBe(300)
      expect(settings.hooks.Stop).toBeUndefined()
    })
  })

  test('міграція: існуючий legacy Stop-hook видаляється; PostToolUse додається', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeJson(join(cwdAbs, '.claude/settings.json'), {
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
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      expect(settings.hooks.Stop).toBeUndefined()
      expect(settings.hooks.PostToolUse).toHaveLength(1)
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(MANAGED_HOOK_COMMAND_MARKER)
    })
  })

  test('зберігає користувацькі permissions і користувацькі групи у Stop при повторному синку', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeJson(join(cwdAbs, '.claude/settings.json'), {
        permissions: { allow: ['Bash(git *)'], deny: ['WebFetch(domain:evil.com)'] },
        hooks: {
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user-stop-hook' }] }]
        }
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
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
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true })
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const managedCount = settings.hooks.PostToolUse.filter(g =>
        g.hooks?.some(h => h.command?.includes(MANAGED_HOOK_COMMAND_MARKER))
      ).length
      expect(managedCount).toBe(1)
      expect(settings.permissions.allow).toEqual(['Bash(bun *)'])
    })
  })

  test('опт-аут через enabled=false', async () => {
    await withTmpDir(async cwdAbs => {
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
        piExtension: false,
        rtkPiExtension: false
      })
      expect(existsSync(join(cwdAbs, '.claude/settings.json'))).toBe(false)
    })
  })

  test('без правила "adr": ADR-hook не копіюється і не з\'являється у settings.json', async () => {
    await withTmpDir(async cwdAbs => {
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
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      // ADR не в Stop і взагалі немає події Stop
      expect(settings.hooks.Stop).toBeUndefined()
    })
  })

  test('з правилом "adr": дописує канонічний фрагмент у .gitignore', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await writeFile(join(cwdAbs, '.gitignore'), 'node_modules/\n', 'utf8')
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr']
      })
      expect(result.gitignoreAdr).toBe(true)
      const gi = await readFile(join(cwdAbs, '.gitignore'), 'utf8')
      expect(gi).toContain('.claude/hooks/*.log')
      expect(gi).toContain('.claude/hooks/.normalize-state')
      expect(gi).toContain('# @7n/rules (adr)')
    })
  })

  test('syncGitignoreAdrFragment: повторний виклик не дублює рядки', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const first = await syncGitignoreAdrFragment(cwdAbs, pkgRoot)
      const second = await syncGitignoreAdrFragment(cwdAbs, pkgRoot)
      expect(first.written).toBe(true)
      expect(second.written).toBe(false)
      const gitignoreContent = await readFile(join(cwdAbs, '.gitignore'), 'utf8')
      const lines = gitignoreContent.split('\n').filter(l => l.includes('.claude/hooks'))
      expect(lines.filter(l => l.includes('*.log')).length).toBe(1)
    })
  })

  test('без правила "adr": .gitignore не змінюється', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await writeFile(join(cwdAbs, '.gitignore'), 'node_modules/\n', 'utf8')
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['text']
      })
      expect(result.gitignoreAdr).toBe(false)
      expect(await readFile(join(cwdAbs, '.gitignore'), 'utf8')).toBe('node_modules/\n')
    })
  })

  test('з правилом "adr": копіюються обидва hook-скрипти і ADR-групи додаються у Stop, managed fix — у PostToolUse', async () => {
    await withTmpDir(async cwdAbs => {
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
      expect(await readFile(join(cwdAbs, '.claude/hooks/capture-decisions.sh'), 'utf8')).toBe(
        '#!/usr/bin/env bash\necho adr-capture\n'
      )
      expect(await readFile(join(cwdAbs, '.claude/hooks/normalize-decisions.sh'), 'utf8')).toBe(
        '#!/usr/bin/env bash\necho adr-normalize\n'
      )
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
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
    await withTmpDir(async cwdAbs => {
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
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
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
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
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
    await withTmpDir(async cwdAbs => {
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
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs, { toolingOnlyLib: '#!/usr/bin/env bash\n# v1\n' })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      // Користувач "псує" lib-файл; пакет має його повернути.
      await writeFile(join(cwdAbs, '.claude/hooks/lib/tooling-only.sh'), '# tampered\n', 'utf8')
      await writeFile(
        join(cwdAbs, 'pkg/.claude-template/hooks/lib/tooling-only.sh'),
        '#!/usr/bin/env bash\n# v2\n',
        'utf8'
      )
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      expect(await readFile(join(cwdAbs, '.claude/hooks/lib/tooling-only.sh'), 'utf8')).toBe(
        '#!/usr/bin/env bash\n# v2\n'
      )
    })
  })

  test('видалення "adr" з rules: .claude/hooks/lib/ прибирається з диска', async () => {
    await withTmpDir(async cwdAbs => {
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
    await withTmpDir(async cwdAbs => {
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
    await withTmpDir(async cwdAbs => {
      const result = await removeOrphanAdrHookLib(cwdAbs)
      expect(result).toEqual({ removed: false, path: '' })
    })
  })

  test('mergeHooks — група з порожнім hooks[] не вважається managed → зберігається (line 164)', () => {
    const existing = {
      PostToolUse: [{ matcher: 'Bash', hooks: [] }]
    }
    const merged = mergeHooks(existing, {})
    expect(merged.PostToolUse).toHaveLength(1)
    expect(merged.PostToolUse[0].hooks).toEqual([])
  })

  test('syncClaudeSettings — template file відсутній → { written: false } (line 365)', async () => {
    await withTmpDir(async cwdAbs => {
      const result = await syncClaudeSettings(cwdAbs, join(cwdAbs, 'nonexistent'))
      expect(result).toEqual({ written: false, path: '' })
    })
  })

  test('syncClaudeSettings — невалідний JSON у settings.json → перезаписує шаблоном (line 328)', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await mkdir(join(cwdAbs, '.claude'), { recursive: true })
      await writeFile(join(cwdAbs, '.claude/settings.json'), 'NOT VALID JSON', 'utf8')
      const result = await syncClaudeSettings(cwdAbs, join(pkgRoot, '.claude-template'))
      expect(result.written).toBe(true)
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      expect(settings.hooks).toBeDefined()
    })
  })

  test('syncAdrHookScript — hook file відсутній → { written: false } (line 387)', async () => {
    await withTmpDir(async cwdAbs => {
      const result = await syncAdrHookScript(cwdAbs, join(cwdAbs, 'nonexistent'))
      expect(result).toEqual({ written: false, path: '' })
    })
  })

  test('syncClaudeCommands — commands dir відсутній → [] (line 582)', async () => {
    await withTmpDir(async cwdAbs => {
      const result = await syncClaudeCommands(cwdAbs, join(cwdAbs, 'nonexistent'))
      expect(result).toEqual([])
    })
  })

  test('syncClaudeCommands — копіює .md, пропускає не-.md файли (lines 588-593)', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const commandsDir = join(cwdAbs, TEMPLATE_REL, 'commands')
      await writeFile(join(commandsDir, 'n-fix.md'), '# n-fix\n', 'utf8')
      await writeFile(join(commandsDir, 'ignore.txt'), 'not a command\n', 'utf8')
      const result = await syncClaudeCommands(cwdAbs, join(pkgRoot, '.claude-template'))
      expect(result).toEqual(['.claude/commands/n-fix.md'])
      expect(existsSync(join(cwdAbs, '.claude/commands/n-fix.md'))).toBe(true)
      expect(existsSync(join(cwdAbs, '.claude/commands/ignore.txt'))).toBe(false)
    })
  })

  test('syncClaudeConfig — templateDir відсутній → всі false (line 622)', async () => {
    await withTmpDir(async cwdAbs => {
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: cwdAbs,
        enabled: true
      })
      expect(result.settings).toBe(false)
      expect(result.commands).toEqual([])
      expect(result.adrHook).toBe(false)
      expect(result.gitignoreAdr).toBe(false)
    })
  })

  test('з правилом "local-ai": rtk-група у PreToolUse, rtk entry у Cursor preToolUse, rtk.ts скопійовано', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs, { rtkPiExtensionTs: '// rtk v1\n' })
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['local-ai', 'text']
      })
      expect(result.rtkPiExtension).toBe(true)
      expect(result.cursorHooks).toBe(true)
      expect(await readFile(join(cwdAbs, '.pi/extensions/rtk.ts'), 'utf8')).toBe('// rtk v1\n')
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const rtkGroup = settings.hooks.PreToolUse.find(g =>
        g.hooks?.some(h => h.command?.includes(RTK_CLAUDE_HOOK_COMMAND_MARKER))
      )
      expect(rtkGroup).toBeTruthy()
      expect(rtkGroup.matcher).toBe('Bash')
      expect(rtkGroup.hooks[0].command).toContain('command -v rtk')
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
      expect(cursorHooks.hooks.preToolUse).toHaveLength(1)
      expect(cursorHooks.hooks.preToolUse[0].command).toContain(RTK_CURSOR_HOOK_COMMAND_MARKER)
      expect(cursorHooks.hooks.preToolUse[0].matcher).toBe('Shell')
      // ADR не вмикався — stop-подій немає
      expect(cursorHooks.hooks.stop).toBeUndefined()
    })
  })

  test('видалення "local-ai" з rules: rtk-групи прибираються, rtk.ts видаляється з диска', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['local-ai'] })
      expect(existsSync(join(cwdAbs, '.pi/extensions/rtk.ts'))).toBe(true)
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: []
      })
      expect(result.rtkPiExtension).toBe(false)
      // На відміну від ADR-скриптів rtk.ts — fully-owned vendored файл без кастомізацій, тому видаляється.
      expect(existsSync(join(cwdAbs, '.pi/extensions/rtk.ts'))).toBe(false)
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const hasRtk = (settings.hooks.PreToolUse ?? []).some(g =>
        g.hooks?.some(h => h.command?.includes(RTK_CLAUDE_HOOK_COMMAND_MARKER))
      )
      expect(hasRtk).toBe(false)
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
      expect(cursorHooks.hooks).toBeUndefined()
    })
  })

  test('повторний sync із "local-ai" не дублює rtk-групи (settings + cursor)', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['local-ai'] })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['local-ai'] })
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      const rtkCount = settings.hooks.PreToolUse.filter(g =>
        g.hooks?.some(h => h.command?.includes(RTK_CLAUDE_HOOK_COMMAND_MARKER))
      ).length
      expect(rtkCount).toBe(1)
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
      expect(cursorHooks.hooks.preToolUse.filter(e => e.command.includes(RTK_CURSOR_HOOK_COMMAND_MARKER))).toHaveLength(
        1
      )
    })
  })

  test('"adr" + "local-ai" разом: обидва набори hooks у своїх подіях', async () => {
    await withTmpDir(async cwdAbs => {
      const pkgRoot = await setupTemplate(cwdAbs)
      const result = await syncClaudeConfig({
        projectRoot: cwdAbs,
        bundledPackageRoot: pkgRoot,
        enabled: true,
        rules: ['adr', 'local-ai']
      })
      expect(result.adrHook).toBe(true)
      expect(result.rtkPiExtension).toBe(true)
      expect(result.piExtension).toBe(false) // ADR pi-extension: у fixture немає index.ts — не копіюється
      const settings = JSON.parse(await readFile(join(cwdAbs, '.claude/settings.json'), 'utf8'))
      expect(settings.hooks.Stop).toHaveLength(2)
      expect(
        settings.hooks.PreToolUse.some(g => g.hooks?.some(h => h.command?.includes(RTK_CLAUDE_HOOK_COMMAND_MARKER)))
      ).toBe(true)
      const cursorHooks = JSON.parse(await readFile(join(cwdAbs, '.cursor/hooks.json'), 'utf8'))
      expect(cursorHooks.hooks.stop).toHaveLength(2)
      expect(cursorHooks.hooks.preToolUse).toHaveLength(1)
    })
  })

  test('source helper із capture-decisions.sh без помилок (bash 3.2 fixture)', async () => {
    await withTmpDir(async cwdAbs => {
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
          join(HERE, '..', '..', '.claude-template', 'hooks', 'lib', 'tooling-only.sh'),
          'utf8'
        )
      })
      await syncClaudeConfig({ projectRoot: cwdAbs, bundledPackageRoot: pkgRoot, enabled: true, rules: ['adr'] })
      const { status } = spawnSync('bash', [join(cwdAbs, '.claude/hooks/capture-decisions.sh')], {
        cwd: cwdAbs,
        input: '',
        encoding: 'utf8'
      })
      expect(status).toBe(0)
    })
  })
})
