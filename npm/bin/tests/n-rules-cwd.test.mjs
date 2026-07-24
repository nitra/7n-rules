/**
 * Тести helper-функцій `../n-rules.js`, які читають/пишуть за bare `cwd()` (з `node:process`)
 * без параметра-override (`syncSkills`, `syncCommands`, `syncPiSkills`, `syncClaudeMd`,
 * `syncAgentsMd`, `listProjectSkillDirNames`, …).
 *
 * `process.chdir` у тестах заборонено (`no-process-chdir` конвенція — лінт-перевірка сканує
 * буквальний виклик `process.chdir(`). Замість цього тут мокається САМ модуль `node:process`
 * (`vi.mock`, з реальними іншими експортами через `vi.importActual`), підмінюючи лише `cwd`
 * на функцію, що повертає поточний tmp-каталог тесту (`cwdState.current`, `vi.hoisted`).
 * Це не мутує глобальний `process.cwd()` жодного разу — увесь інший код процесу (і паралельні
 * тестові файли) бачать реальний `cwd()` без змін; підміняється лише той один імпортований
 * імпорт `cwd` усередині `n-rules.js` для цього тестового файлу.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ensureDir, withTmpDir, writeJson } from '../../scripts/utils/test-helpers.mjs'

const cwdState = vi.hoisted(() => ({ current: process.cwd() }))

vi.mock('node:process', async () => {
  const actual = await vi.importActual('node:process')
  return { ...actual, cwd: () => cwdState.current }
})

// `runSync` (case '' у runCli) статично імпортує ці три модулі — мокаються, щоб тест
// `runSync` не робив реальний self-upgrade/bun-install/мережевий Claude-config sync;
// решта кроків `runSync` (readConfig, syncManagedRuleFiles, syncSkills/Commands/PiSkills,
// syncClaudeMd/AgentsMd, syncGitignoreWorktree) лишаються реальними — безпечно, бо cwd мокається.
const upgradeNRulesToLatestAndBunInstallMock = vi.fn(async (_projectRoot, bundledPackageRoot) => bundledPackageRoot)
const syncClaudeConfigMock = vi.fn(async () => ({
  settings: false,
  cursorHooks: false,
  commands: [],
  adrHook: false,
  adrNormalizeHook: false,
  adrHookLib: [],
  gitignoreAdr: false,
  piExtension: false,
  rtkPiExtension: false
}))
const syncSetupBunDepsActionMock = vi.fn(async () => ({ destPath: '.github/actions/setup-bun-deps/action.yml' }))

vi.mock('../../scripts/upgrade-n-rules-and-install.mjs', () => ({
  upgradeNRulesToLatestAndBunInstall: upgradeNRulesToLatestAndBunInstallMock
}))
vi.mock('../../scripts/sync-claude-config.mjs', () => ({ syncClaudeConfig: syncClaudeConfigMock }))
vi.mock('../../scripts/sync-setup-bun-deps-action.mjs', () => ({
  syncSetupBunDepsAction: syncSetupBunDepsActionMock
}))

const {
  buildClaudeSkillsSectionLines,
  buildSkillBulletItems,
  listProjectSkillDirNames,
  migrateLegacyConfigIfNeeded,
  migrateLegacyManagedRuleFilenames,
  readConfig,
  removeOrphanLocalPiSkillDirs,
  removeOrphanLocalSkillCommandFiles,
  runSync,
  syncAgentsMd,
  syncClaudeMd,
  syncCommands,
  syncLocalOnlyPiSkills,
  syncLocalOnlySkillCommands,
  syncPiSkills,
  syncSkills
} = await import('../n-rules.js')

afterEach(() => {
  cwdState.current = process.cwd()
})

/** Мінімальний skill-фікстур `skills/<id>/` (SKILL.md + main.json) під tmp bundledSkillsDir. */
async function writeFixtureSkill(bundledSkillsDir, id, { worktree = false, requireRoot = false } = {}) {
  const dir = join(bundledSkillsDir, id)
  await ensureDir(dir)
  await writeJson(join(dir, 'main.json'), { worktree, requireRoot })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: n-${id}\ndescription: >-\n  опис скілу ${id}\n---\n\n# n-${id}\n\nІнструкції.\n`,
    'utf8'
  )
}

describe('listProjectSkillDirNames / buildSkillBulletItems / buildClaudeSkillsSectionLines (cwd-mock)', () => {
  test('повертає реальні skill-теки з .cursor/skills у tmp cwd', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'skills', 'n-fix'))
      await writeFile(
        join(dir, '.cursor', 'skills', 'n-fix', 'SKILL.md'),
        '---\nname: n-fix\ndescription: >-\n  виправляє помилки\n---\n\n# n-fix\n',
        'utf8'
      )
      await ensureDir(join(dir, '.cursor', 'skills', 'custom-no-desc'))

      const names = await listProjectSkillDirNames()
      expect(names).toEqual(['custom-no-desc', 'n-fix'])

      const bullets = await buildSkillBulletItems()
      expect(bullets).toEqual([
        { name: '- `.cursor/skills/custom-no-desc/SKILL.md`' },
        { name: '- `.cursor/skills/n-fix/SKILL.md` — виправляє помилки' }
      ])

      // buildClaudeSkillsSectionLines додає рядок "Команда: /…" лише якщо є відповідний .claude/commands/*.md
      await ensureDir(join(dir, '.claude', 'commands'))
      await writeFile(join(dir, '.claude', 'commands', 'n-fix.md'), '# n-fix\n', 'utf8')
      const lines = await buildClaudeSkillsSectionLines()
      expect(lines).toContain('## Skills')
      expect(lines.some(l => l.includes('n-fix/SKILL.md'))).toBe(true)
      expect(lines).toContain('  Команда: `/n-fix`')
      expect(lines.some(l => l.includes('custom-no-desc') && l.includes('Команда'))).toBe(false)
    })
  })
})

describe('syncClaudeMd / syncAgentsMd (cwd-mock)', () => {
  test('syncClaudeMd пише CLAUDE.md з захищеними директоріями і at-імпортами правил', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'rules'))
      await writeFile(join(dir, '.cursor', 'rules', 'n-text.mdc'), '# text\n', 'utf8')

      await syncClaudeMd(['.worktrees/', 'npm/schemas/vendor'])

      const claudeMdPath = join(dir, 'CLAUDE.md')
      expect(existsSync(claudeMdPath)).toBe(true)
      const text = await readFile(claudeMdPath, 'utf8')
      expect(text).toContain('## Захищені директорії')
      expect(text).toContain('- `.worktrees/`')
      expect(text).toContain('- `npm/schemas/vendor/`')
      expect(text).toContain('@.cursor/rules/n-text.mdc')
    })
  })

  test('syncAgentsMd перезаписує AGENTS.md за шаблоном пакету', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'rules'))
      await writeFile(join(dir, '.cursor', 'rules', 'n-text.mdc'), '# text\n', 'utf8')

      const templatePath = join(dir, 'AGENTS.template.md')
      await writeFile(
        templatePath,
        '# AGENTS\n\n{{#services}}\n{{name}}\n{{/services}}\n\n{{#skills}}\n{{name}}\n{{/skills}}\n\n{{#commands}}\n{{name}}\n{{/commands}}\n',
        'utf8'
      )

      await syncAgentsMd(templatePath)

      const agentsPath = join(dir, 'AGENTS.md')
      expect(existsSync(agentsPath)).toBe(true)
      const text = await readFile(agentsPath, 'utf8')
      expect(text).toContain('.cursor/rules/n-text.mdc')
    })
  })

  test('syncAgentsMd кидає, коли шаблон відсутній у пакеті', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await expect(syncAgentsMd(join(dir, 'no-such-template.md'))).rejects.toThrow(/Не знайдено шаблон/)
    })
  })
})

describe('syncSkills / syncCommands / syncPiSkills (cwd-mock, реальні фікстур-скіли)', () => {
  test('копіює worktree+requireRoot skill у .cursor/skills, .claude/commands, .pi/skills', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      const bundledSkillsDir = join(dir, 'src-skills')
      await writeFixtureSkill(bundledSkillsDir, 'fix', { worktree: true })
      await writeFixtureSkill(bundledSkillsDir, 'taze', { requireRoot: true })

      const skillsResult = await syncSkills(['fix', 'taze'], bundledSkillsDir, null)
      expect(skillsResult).toEqual({ success: 2, fail: 0 })
      expect(existsSync(join(dir, '.cursor', 'skills', 'n-fix', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(dir, '.cursor', 'skills', 'n-taze', 'SKILL.md'))).toBe(true)
      // main.json не копіюється в проєкт (лише метадані для CLI).
      expect(existsSync(join(dir, '.cursor', 'skills', 'n-fix', 'main.json'))).toBe(false)

      const cmdResult = await syncCommands(['fix', 'taze'], bundledSkillsDir)
      expect(cmdResult).toEqual({ success: 2, fail: 0 })
      expect(existsSync(join(dir, '.claude', 'commands', 'n-fix.md'))).toBe(true)
      const cmdText = await readFile(join(dir, '.claude', 'commands', 'n-fix.md'), 'utf8')
      expect(cmdText).toContain('опис скілу fix')

      const piResult = await syncPiSkills(['fix', 'taze'], bundledSkillsDir)
      expect(piResult).toEqual({ success: 2, fail: 0 })
      expect(existsSync(join(dir, '.pi', 'skills', 'n-fix', 'SKILL.md'))).toBe(true)
    })
  })

  test('syncSkills: відсутній srcDir у пакеті → fail: 1', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      const bundledSkillsDir = join(dir, 'src-skills')
      await ensureDir(bundledSkillsDir)
      await writeFixtureSkill(bundledSkillsDir, 'real-one')
      const result = await syncSkills(['real-one', 'ghost'], bundledSkillsDir, null)
      expect(result).toEqual({ success: 1, fail: 1 })
    })
  })

  test('syncCommands: порожній configSkills або відсутній bundledSkillsDir → рано повертає нулі', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      expect(await syncCommands([], join(dir, 'anything'))).toEqual({ success: 0, fail: 0 })
      expect(await syncCommands(['x'], join(dir, 'no-such-dir'))).toEqual({ success: 0, fail: 0 })
    })
  })

  test('syncLocalOnlySkillCommands створює .claude/commands/<dir>.md для локального (не керованого) скілу', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'skills', 'local-only'))
      await writeFile(
        join(dir, '.cursor', 'skills', 'local-only', 'SKILL.md'),
        '---\nname: local-only\ndescription: >-\n  локальний скіл\n---\n\n# local-only\n',
        'utf8'
      )
      const result = await syncLocalOnlySkillCommands([])
      expect(result).toEqual({ success: 1, fail: 0 })
      const text = await readFile(join(dir, '.claude', 'commands', 'local-only.md'), 'utf8')
      expect(text).toContain('локальний скіл')
    })
  })

  test('syncLocalOnlySkillCommands: немає .cursor/skills у cwd → {success:0, fail:0}', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      expect(await syncLocalOnlySkillCommands([])).toEqual({ success: 0, fail: 0 })
    })
  })

  test('syncLocalOnlyPiSkills створює .pi/skills/<dir>/SKILL.md для локального скілу', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'skills', 'local-only'))
      await writeFile(
        join(dir, '.cursor', 'skills', 'local-only', 'SKILL.md'),
        '---\nname: local-only\ndescription: >-\n  локальний pi-скіл\n---\n\n# local-only\n',
        'utf8'
      )
      const result = await syncLocalOnlyPiSkills([])
      expect(result).toEqual({ success: 1, fail: 0 })
      expect(existsSync(join(dir, '.pi', 'skills', 'local-only', 'SKILL.md'))).toBe(true)
    })
  })

  test('removeOrphanLocalSkillCommandFiles видаляє .claude/commands/<dir>.md для зниклого локального скілу', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      const commandsDir = join(dir, '.claude', 'commands')
      await ensureDir(commandsDir)
      await writeFile(join(commandsDir, 'gone.md'), '# gone\n', 'utf8')
      await writeFile(join(commandsDir, 'n-managed.md'), '# managed\n', 'utf8') // n-префікс — не чіпаємо тут
      // .cursor/skills/gone відсутній і не в managedDirNames → сирота
      const removed = await removeOrphanLocalSkillCommandFiles(commandsDir, [])
      expect(removed).toEqual(['gone.md'])
      expect(existsSync(join(commandsDir, 'n-managed.md'))).toBe(true)
    })
  })

  test('removeOrphanLocalPiSkillDirs видаляє .pi/skills/<dir> для зниклого локального скілу', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      const piSkillsDir = join(dir, '.pi', 'skills')
      await ensureDir(join(piSkillsDir, 'gone'))
      await ensureDir(join(piSkillsDir, 'n-managed'))
      const removed = await removeOrphanLocalPiSkillDirs(piSkillsDir, [])
      expect(removed).toEqual(['gone'])
      expect(existsSync(join(piSkillsDir, 'n-managed'))).toBe(true)
    })
  })
})

describe('migrateLegacyManagedRuleFilenames (cwd-mock, sanity — функція вже param-based)', () => {
  test('не залежить від cwd(): dir передається явно', async () => {
    await withTmpDir(async dir => {
      cwdState.current = join(dir, 'unrelated-cwd')
      const rulesDir = join(dir, 'rules-dir')
      await ensureDir(rulesDir)
      await writeFile(join(rulesDir, 'nitra-old.mdc'), '# old\n', 'utf8')
      await migrateLegacyManagedRuleFilenames(rulesDir)
      expect(existsSync(join(rulesDir, 'n-old.mdc'))).toBe(true)
    })
  })
})

describe('migrateLegacyConfigIfNeeded (cwd-mock)', () => {
  test('перейменовує legacy nitra-cursor.json → .n-rules.json і виправляє $schema', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await ensureDir(join(dir, '.cursor', 'rules'))
      await writeFile(join(dir, '.cursor', 'rules', 'nitra-bun.mdc'), '# bun\n', 'utf8')
      await writeJson(join(dir, 'nitra-cursor.json'), {
        $schema: 'https://unpkg.com/@nitra/cursor/schemas/n-rules.json',
        rules: ['bun']
      })

      await migrateLegacyConfigIfNeeded()

      expect(existsSync(join(dir, 'nitra-cursor.json'))).toBe(false)
      expect(existsSync(join(dir, '.n-rules.json'))).toBe(true)
      expect(existsSync(join(dir, '.cursor', 'rules', 'n-bun.mdc'))).toBe(true)
      const config = JSON.parse(await readFile(join(dir, '.n-rules.json'), 'utf8'))
      expect(config.$schema).toBe('https://unpkg.com/@7n/rules/schemas/n-rules.json')
    })
  })

  test('.n-rules.json уже існує → нічого не робить', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await writeJson(join(dir, '.n-rules.json'), { rules: [] })
      await writeJson(join(dir, 'nitra-cursor.json'), { rules: ['ignored'] })
      await migrateLegacyConfigIfNeeded()
      // legacy файл лишається неторкнутим, коли цільовий .n-rules.json вже є
      expect(existsSync(join(dir, 'nitra-cursor.json'))).toBe(true)
    })
  })

  test('без .n-rules.json і без legacy-файлів — тихо повертається', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await expect(migrateLegacyConfigIfNeeded()).resolves.toBeUndefined()
      expect(existsSync(join(dir, '.n-rules.json'))).toBe(false)
    })
  })
})

/**
 * Мінімальний фікстур-пакет (`rules/<id>/main.mdc`, порожній `skills/`, `AGENTS.template.md`,
 * `package.json`) — імітує встановлений `@7n/rules` для `readConfig`/`runSync`.
 */
async function buildFixturePackageRoot(root) {
  await ensureDir(join(root, 'rules', 'text'))
  await writeFile(join(root, 'rules', 'text', 'main.mdc'), '# text rule\n', 'utf8')
  await ensureDir(join(root, 'skills'))
  await writeFile(
    join(root, 'AGENTS.template.md'),
    '# AGENTS\n\n{{#services}}\n{{name}}\n{{/services}}\n\n{{#skills}}\n{{name}}\n{{/skills}}\n\n{{#commands}}\n{{name}}\n{{/commands}}\n',
    'utf8'
  )
  // Навмисно НЕМАЄ package.json/bin/n-rules.js під цим коренем — версія відрізнятиметься
  // від реальної встановленої (readBundledVersionAt поверне null), тож
  // reexecIfPackageVersionChanged рано вийде (startVersion || installedVersion falsy).
}

describe('readConfig (cwd-mock, фікстур bundledRulesDir/bundledSkillsDir)', () => {
  test('немає .n-rules.json у cwd → створює дефолтний конфіг автоаналізом', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      const bundledRulesDir = join(dir, 'rules')
      const bundledSkillsDir = join(dir, 'skills')

      const config = await readConfig({ bundledRulesDir, bundledSkillsDir })

      expect(config.$schema).toBe('https://unpkg.com/@7n/rules/schemas/n-rules.json')
      expect(Array.isArray(config.rules)).toBe(true)
      expect(Array.isArray(config.skills)).toBe(true)
      expect(existsSync(join(dir, '.n-rules.json'))).toBe(true)
    })
  })

  test('існуючий .n-rules.json з валідним rules — нормалізується (sortConfigIdArrays, $schema)', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      const bundledRulesDir = join(dir, 'rules')
      const bundledSkillsDir = join(dir, 'skills')
      await writeJson(join(dir, '.n-rules.json'), {
        $schema: 'https://outdated.example/schema.json',
        rules: ['text']
      })

      const config = await readConfig({ bundledRulesDir, bundledSkillsDir })

      expect(config.$schema).toBe('https://unpkg.com/@7n/rules/schemas/n-rules.json')
      expect(config.rules).toContain('text')
    })
  })

  test('rules не масив → TypeError', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      const bundledRulesDir = join(dir, 'rules')
      const bundledSkillsDir = join(dir, 'skills')
      await writeJson(join(dir, '.n-rules.json'), { rules: 'not-an-array' })

      await expect(readConfig({ bundledRulesDir, bundledSkillsDir })).rejects.toThrow(/має бути масивом рядків/)
    })
  })

  test('некоректний JSON у .n-rules.json → throws', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      const bundledRulesDir = join(dir, 'rules')
      const bundledSkillsDir = join(dir, 'skills')
      await writeFile(join(dir, '.n-rules.json'), '{ broken', 'utf8')

      await expect(readConfig({ bundledRulesDir, bundledSkillsDir })).rejects.toThrow(/Невірний JSON/)
    })
  })
})

describe('runSync (cwd-mock, upgrade/syncClaudeConfig/syncSetupBunDepsAction мокаються)', () => {
  test('повний happy-path прогін без існуючого .n-rules.json', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      upgradeNRulesToLatestAndBunInstallMock.mockResolvedValueOnce(dir)

      await expect(runSync()).resolves.toBeUndefined()

      expect(upgradeNRulesToLatestAndBunInstallMock).toHaveBeenCalledWith(dir, expect.any(String))
      expect(syncSetupBunDepsActionMock).toHaveBeenCalled()
      expect(syncClaudeConfigMock).toHaveBeenCalled()
      expect(existsSync(join(dir, '.n-rules.json'))).toBe(true)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
    })
  })

  test('happy-path з явним rules:["text"] у .n-rules.json — синхронізує .cursor/rules/n-text.mdc', async () => {
    await withTmpDir(async dir => {
      cwdState.current = dir
      await buildFixturePackageRoot(dir)
      await writeJson(join(dir, '.n-rules.json'), { rules: ['text'] })
      upgradeNRulesToLatestAndBunInstallMock.mockResolvedValueOnce(dir)

      await runSync()

      expect(existsSync(join(dir, '.cursor', 'rules', 'n-text.mdc'))).toBe(true)
    })
  })
})
