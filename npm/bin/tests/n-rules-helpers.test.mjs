/**
 * Юніт-тести чистих/near-pure helper-функцій `../n-rules.js`, які тепер експортовані
 * (мінімальна мех. правка `export`) саме для прямого імпорту в тестах — після рефакторингу
 * CLI dispatch за `isRunAsCli` guard імпорт файлу більше не виконує реальний CLI.
 *
 * Конвенція репо: `withTmpDir`/`writeJson`/`ensureDir` з `../../scripts/utils/test-helpers.mjs`,
 * реальні tmp-директорії замість мокання внутрішньої логіки (див. `scripts/tests/*.test.mjs`).
 * `process.chdir` заборонено (`no-process-chdir` конвенція) — функції, що читають/пишуть за
 * bare `cwd()` без параметра (`listProjectSkillDirNames`, `syncClaudeMd`, `syncAgentsMd`), тут
 * навмисно НЕ викликаються з мутацією файлової системи; лише ті, що безпечні read-only
 * у реальному робочому каталозі тестового процесу (`npm/`), де очікувано відсутні артефакти.
 */
import { describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { env } from 'node:process'

import { ensureDir, withTmpDir, writeJson } from '../../scripts/utils/test-helpers.mjs'

import {
  aggregateRuleSources,
  buildClaudeSkillsSectionLines,
  buildSkillBulletItems,
  captureOutput,
  describeRootGuardedAction,
  discoverBundledRuleNames,
  discoverBundledSkillNames,
  errorMessage,
  expectedManagedRuleBasenames,
  extractSkillDescription,
  formatClaudeCommandFrontmatter,
  formatPiSkillFrontmatter,
  listProjectSkillDirNames,
  listRuleNamesPerDir,
  logRemovedManagedItems,
  managedSkillDirName,
  migrateLegacyManagedRuleFilenames,
  normalizeRuleName,
  normalizeSkillId,
  printLintHelp,
  readBundledRuleContent,
  readBundledVersionAt,
  readRootPackageJsonSafe,
  ReexecHandoff,
  reexecIfPackageVersionChanged,
  removeOrphanLocalSkillCommandFiles,
  removeOrphanManagedCommandFiles,
  removeOrphanManagedPiSkillDirs,
  removeOrphanManagedRuleFiles,
  removeOrphanManagedSkillDirs,
  runSyncStep,
  skillDescriptionSafeForMarkdownInline,
  sortConfigIdArrays,
  syncManagedRuleFiles
} from '../n-rules-cli.mjs'

const MISSING_RULES_DIR_RE = /Не знайдено каталог правил/
const EMPTY_RULES_DIR_RE = /немає підкаталогів з main.mdc/
const MISSING_RULE_MAIN_MDC_RE = /Немає файлу ghost\/main\.mdc/

describe('normalizeRuleName', () => {
  test('шлях з .mdc → чистий id', () => {
    expect(normalizeRuleName('npm/rules/text/text.mdc')).toBe('text')
  })
  test("лише ім'я файлу з .mdc", () => {
    expect(normalizeRuleName('text.mdc')).toBe('text')
  })
  test('без .mdc — без змін', () => {
    expect(normalizeRuleName('text')).toBe('text')
  })
  test('пробіли навколо — обрізаються', () => {
    expect(normalizeRuleName('  text.mdc  ')).toBe('text')
  })
})

describe('sortConfigIdArrays', () => {
  test('сортує відомі ключі-масиви за алфавітом', () => {
    const out = sortConfigIdArrays({
      rules: ['text', 'bun', 'adr'],
      skills: ['taze', 'fix'],
      'disable-rules': ['z', 'a'],
      other: ['z', 'a']
    })
    expect(out.rules).toEqual(['adr', 'bun', 'text'])
    expect(out.skills).toEqual(['fix', 'taze'])
    expect(out['disable-rules']).toEqual(['a', 'z'])
    // невідомий ключ не чіпаємо
    expect(out.other).toEqual(['z', 'a'])
  })
  test('не мутує вхідний обʼєкт', () => {
    const input = { rules: ['b', 'a'] }
    const out = sortConfigIdArrays(input)
    expect(input.rules).toEqual(['b', 'a'])
    expect(out.rules).toEqual(['a', 'b'])
  })
  test('пропускає відсутні/не-масив значення', () => {
    const out = sortConfigIdArrays({ skills: 'not-an-array' })
    expect(out.skills).toBe('not-an-array')
  })
})

describe('normalizeSkillId', () => {
  test('прибирає префікс n-', () => {
    expect(normalizeSkillId('n-fix')).toBe('fix')
  })
  test('без префікса — без змін', () => {
    expect(normalizeSkillId('fix')).toBe('fix')
  })
  test('обрізає пробіли й шлях', () => {
    expect(normalizeSkillId('  n-fix  ')).toBe('fix')
  })
})

describe('managedSkillDirName', () => {
  test('додає префікс n- для id без префікса', () => {
    expect(managedSkillDirName('fix')).toBe('n-fix')
  })
  test('нормалізує подвійний виклик (n-fix лишається n-fix)', () => {
    expect(managedSkillDirName('n-fix')).toBe('n-fix')
  })
})

describe('extractSkillDescription', () => {
  test('витягує багаторядковий description: >-', () => {
    const text = `---\nname: n-fix\ndescription: >-\n  Перший рядок\n  другий рядок\n---\n\n# n-fix\n`
    expect(extractSkillDescription(text)).toBe('Перший рядок другий рядок')
  })
  test('без frontmatter — null', () => {
    expect(extractSkillDescription('# no frontmatter here')).toBeNull()
  })
  test('frontmatter без description: >- — null', () => {
    const text = `---\nname: n-fix\n---\n`
    expect(extractSkillDescription(text)).toBeNull()
  })
})

describe('skillDescriptionSafeForMarkdownInline', () => {
  test('замінює <id> на {id}', () => {
    expect(skillDescriptionSafeForMarkdownInline('rule <id> тут')).toBe('rule {id} тут')
  })
  test('без <id> — без змін', () => {
    expect(skillDescriptionSafeForMarkdownInline('без плейсхолдера')).toBe('без плейсхолдера')
  })
})

describe('formatClaudeCommandFrontmatter', () => {
  test('з текстом опису', () => {
    const out = formatClaudeCommandFrontmatter('опис скілу')
    expect(out).toContain('description: >-')
    expect(out).toContain('опис скілу')
    expect(out.startsWith('---\n')).toBe(true)
  })
  test('порожній опис — fallback текст', () => {
    const out = formatClaudeCommandFrontmatter('')
    expect(out).toContain('Див. SKILL.md у каталозі скілу в .cursor/skills.')
  })
})

describe('formatPiSkillFrontmatter', () => {
  test('містить name і description', () => {
    const out = formatPiSkillFrontmatter('n-fix', 'опис скілу')
    expect(out).toContain('name: n-fix')
    expect(out).toContain('опис скілу')
  })
  test('порожній опис — fallback текст', () => {
    const out = formatPiSkillFrontmatter('n-fix', '')
    expect(out).toContain('Див. SKILL.md у каталозі скілу в .cursor/skills.')
  })
})

describe('expectedManagedRuleBasenames', () => {
  test('мапить rule id на n-<id>.mdc', () => {
    const set = expectedManagedRuleBasenames(['text', 'npm/rules/ga/ga.mdc'])
    expect(set).toEqual(new Set(['n-text.mdc', 'n-ga.mdc']))
  })
})

describe('errorMessage', () => {
  test('Error → message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  test('не-Error → String(value)', () => {
    expect(errorMessage('просто рядок')).toBe('просто рядок')
    expect(errorMessage(42)).toBe('42')
  })
})

const DEFAULT_SYNC_DESCRIPTION_RE = /Дефолтна синхронізація/
const AUTO_FIX_DESCRIPTION_RE = /авто-fix/
const VERSION_BUMP_DESCRIPTION_RE = /бампає version/
const PROJECT_MUTATION_DESCRIPTION_RE = /мутує проєкт/

describe('describeRootGuardedAction', () => {
  test.each([
    [undefined, DEFAULT_SYNC_DESCRIPTION_RE],
    ['', DEFAULT_SYNC_DESCRIPTION_RE],
    ['lint', AUTO_FIX_DESCRIPTION_RE],
    ['release', VERSION_BUMP_DESCRIPTION_RE],
    ['unknown-cmd', PROJECT_MUTATION_DESCRIPTION_RE]
  ])('%s', (cmd, re) => {
    expect(describeRootGuardedAction(cmd)).toMatch(re)
  })
})

describe('printLintHelp', () => {
  test('друкує довідку з ключовими прапорами', () => {
    const calls = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      calls.push(args.join(' '))
    })
    try {
      printLintHelp()
    } finally {
      spy.mockRestore()
    }
    const text = calls.join('\n')
    expect(text).toContain('--full')
    expect(text).toContain('--no-fix')
    expect(text).toContain('--repo-wide')
    expect(text).toContain('npx @7n/rules lint')
  })
})

describe('discoverBundledRuleNames', () => {
  test('повертає відсортовані id тек з main.mdc', () => {
    return withTmpDir(async dir => {
      await ensureDir(join(dir, 'b'))
      await ensureDir(join(dir, 'a'))
      await writeJson(join(dir, 'a', 'main.mdc.json'), {}) // сторонній файл, не заважає
      await ensureDir(join(dir, 'no-mdc'))
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'a', 'main.mdc'), '# a\n', 'utf8')
      await fs.writeFile(join(dir, 'b', 'main.mdc'), '# b\n', 'utf8')
      const names = await discoverBundledRuleNames(dir)
      expect(names).toEqual(['a', 'b'])
    })
  })

  test('відсутній каталог → throws', async () => {
    await expect(discoverBundledRuleNames('/no/such/dir/definitely')).rejects.toThrow(MISSING_RULES_DIR_RE)
  })

  test('каталог без валідних правил → throws', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'empty-subdir'))
      await expect(discoverBundledRuleNames(dir)).rejects.toThrow(EMPTY_RULES_DIR_RE)
    })
  })
})

describe('discoverBundledSkillNames', () => {
  test('відсутній каталог → []', async () => {
    expect(await discoverBundledSkillNames('/no/such/skills/dir')).toEqual([])
  })

  test('виключає підкаталоги з префіксом n- і крапкою', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'fix'))
      await ensureDir(join(dir, 'n-legacy'))
      await ensureDir(join(dir, '.hidden'))
      const names = await discoverBundledSkillNames(dir)
      expect(names).toEqual(['fix'])
    })
  })
})

describe('migrateLegacyManagedRuleFilenames', () => {
  test('перейменовує nitra-*.mdc → n-*.mdc, коли цілі ще нема', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'nitra-foo.mdc'), '# foo\n', 'utf8')
      await migrateLegacyManagedRuleFilenames(dir)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'nitra-foo.mdc'))).toBe(false)
      expect(existsSync(join(dir, 'n-foo.mdc'))).toBe(true)
    })
  })

  test('видаляє застарілий nitra-*.mdc, коли n-*.mdc вже існує', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'nitra-foo.mdc'), '# old\n', 'utf8')
      await fs.writeFile(join(dir, 'n-foo.mdc'), '# new\n', 'utf8')
      await migrateLegacyManagedRuleFilenames(dir)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'nitra-foo.mdc'))).toBe(false)
      expect(existsSync(join(dir, 'n-foo.mdc'))).toBe(true)
    })
  })

  test('відсутній каталог — тихо повертається', async () => {
    await expect(migrateLegacyManagedRuleFilenames('/no/such/rules/dir')).resolves.toBeUndefined()
  })
})

describe('readRootPackageJsonSafe', () => {
  test('читає package.json поточного тестового процесу (реальний, read-only)', async () => {
    const pkg = await readRootPackageJsonSafe()
    // Тестовий процес vitest стартує з cwd=npm/, де завжди є package.json.
    expect(pkg).not.toBeNull()
    expect(typeof pkg).toBe('object')
  })
})

describe('readBundledVersionAt', () => {
  test('читає version з package.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { version: '1.2.3' })
      expect(await readBundledVersionAt(dir)).toBe('1.2.3')
    })
  })
  test('відсутній package.json → null', async () => {
    await withTmpDir(async dir => {
      expect(await readBundledVersionAt(dir)).toBeNull()
    })
  })
  test('некоректний JSON → null', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'package.json'), '{ not json', 'utf8')
      expect(await readBundledVersionAt(dir)).toBeNull()
    })
  })
  test('version не рядок → null', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { version: 123 })
      expect(await readBundledVersionAt(dir)).toBeNull()
    })
  })
})

describe('aggregateRuleSources / listRuleNamesPerDir', () => {
  test('ядро виграє дублікати, mixin-теки плагіна потрапляють у extras', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      const coreDir = join(dir, 'core-rules')
      const pluginDir = join(dir, 'plugin-rules')
      await ensureDir(join(coreDir, 'a'))
      await ensureDir(join(coreDir, 'b'))
      await fs.writeFile(join(coreDir, 'a', 'main.mdc'), '# a core\n', 'utf8')
      await fs.writeFile(join(coreDir, 'b', 'main.mdc'), '# b core\n', 'utf8')

      await ensureDir(join(pluginDir, 'a')) // дублікат id "a" — mixin, не власник
      await fs.writeFile(join(pluginDir, 'a', 'main.mdc'), '# a plugin dup\n', 'utf8')
      await ensureDir(join(pluginDir, 'c')) // нове правило від плагіна
      await fs.writeFile(join(pluginDir, 'c', 'main.mdc'), '# c plugin\n', 'utf8')
      await ensureDir(join(pluginDir, 'd')) // mixin-only (без main.mdc), ключ mixin-теки — 'd'
      await fs.writeFile(join(pluginDir, 'd', 'concern.mdc'), '# concern\n', 'utf8')

      const { names, sources, extras } = await aggregateRuleSources([coreDir, pluginDir])

      expect(names.toSorted()).toEqual(['a', 'b', 'c'])
      expect(sources.get('a')).toBe(coreDir)
      expect(sources.get('b')).toBe(coreDir)
      expect(sources.get('c')).toBe(pluginDir)

      // collectMixinDirs використовує як ключ власне імʼя каталогу ('d'), а не id, який він доповнює.
      expect(extras.get('d')).toEqual([join(pluginDir, 'd')])
      // Дублікат main.mdc у плагіні для чужого id ('a') — теж mixin, ключ тут — сам id.
      expect(extras.get('a')).toEqual([join(pluginDir, 'a')])
      // 'c' — власне правило плагіна (sources.get('c') === pluginDir), тому НЕ mixin.
      expect(extras.has('c')).toBe(false)
    })
  })

  test('listRuleNamesPerDir: ядро відсутнє → throws; плагін відсутній → []', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      const coreDir = join(dir, 'core-rules')
      await ensureDir(join(coreDir, 'a'))
      await fs.writeFile(join(coreDir, 'a', 'main.mdc'), '# a\n', 'utf8')
      const missingPluginDir = join(dir, 'no-such-plugin-rules')

      const perDir = await listRuleNamesPerDir([coreDir, missingPluginDir])
      expect(perDir[0]).toEqual(['a'])
      expect(perDir[1]).toEqual([])
    })
  })

  test('listRuleNamesPerDir: ядро (перший елемент) відсутнє → throws', async () => {
    await expect(listRuleNamesPerDir(['/no/such/core/rules/dir'])).rejects.toThrow(MISSING_RULES_DIR_RE)
  })
})

describe('removeOrphanManagedRuleFiles', () => {
  test('видаляє лише n-*.mdc поза конфігом, інші файли не чіпає', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'n-a.mdc'), '# a\n', 'utf8')
      await fs.writeFile(join(dir, 'n-b.mdc'), '# b\n', 'utf8')
      await fs.writeFile(join(dir, 'custom.mdc'), '# custom\n', 'utf8')
      const removed = await removeOrphanManagedRuleFiles(dir, ['a'])
      expect(removed).toEqual(['n-b.mdc'])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'n-a.mdc'))).toBe(true)
      expect(existsSync(join(dir, 'n-b.mdc'))).toBe(false)
      expect(existsSync(join(dir, 'custom.mdc'))).toBe(true)
    })
  })
  test('відсутній каталог → []', async () => {
    expect(await removeOrphanManagedRuleFiles('/no/such/rules/dir', [])).toEqual([])
  })
})

describe('removeOrphanManagedSkillDirs', () => {
  test('видаляє n-* каталоги поза конфігом', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'n-a'))
      await ensureDir(join(dir, 'n-b'))
      await ensureDir(join(dir, 'custom'))
      const removed = await removeOrphanManagedSkillDirs(dir, ['a'])
      expect(removed).toEqual(['n-b'])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'n-a'))).toBe(true)
      expect(existsSync(join(dir, 'n-b'))).toBe(false)
      expect(existsSync(join(dir, 'custom'))).toBe(true)
    })
  })
  test('відсутній каталог → []', async () => {
    expect(await removeOrphanManagedSkillDirs('/no/such/skills/dir', [])).toEqual([])
  })
})

describe('removeOrphanManagedCommandFiles', () => {
  test('видаляє n-*.md поза конфігом', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, 'n-a.md'), '# a\n', 'utf8')
      await fs.writeFile(join(dir, 'n-b.md'), '# b\n', 'utf8')
      await fs.writeFile(join(dir, 'custom.md'), '# custom\n', 'utf8')
      const removed = await removeOrphanManagedCommandFiles(dir, ['a'])
      expect(removed).toEqual(['n-b.md'])
    })
  })
  test('відсутній каталог → []', async () => {
    expect(await removeOrphanManagedCommandFiles('/no/such/commands/dir', [])).toEqual([])
  })
})

describe('removeOrphanManagedPiSkillDirs', () => {
  test('видаляє n-* каталоги поза конфігом', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'n-a'))
      await ensureDir(join(dir, 'n-b'))
      const removed = await removeOrphanManagedPiSkillDirs(dir, ['a'])
      expect(removed).toEqual(['n-b'])
    })
  })
  test('відсутній каталог → []', async () => {
    expect(await removeOrphanManagedPiSkillDirs('/no/such/pi-skills/dir', [])).toEqual([])
  })
})

describe('removeOrphanLocalSkillCommandFiles', () => {
  test('відсутній commandsDir → [] (без звернення до cwd-залежного listProjectSkillDirNames)', async () => {
    expect(await removeOrphanLocalSkillCommandFiles('/no/such/commands/dir', [])).toEqual([])
  })
})

describe('cwd()-залежні read-only helpers (реальний cwd тестового процесу — npm/, без .cursor/skills)', () => {
  test('listProjectSkillDirNames повертає [] коли .cursor/skills відсутній у cwd', async () => {
    expect(await listProjectSkillDirNames()).toEqual([])
  })
  test('buildSkillBulletItems повертає [] коли немає skill-директорій', async () => {
    expect(await buildSkillBulletItems()).toEqual([])
  })
  test('buildClaudeSkillsSectionLines повертає [] коли немає skill-директорій', async () => {
    expect(await buildClaudeSkillsSectionLines()).toEqual([])
  })
})

describe('readBundledRuleContent', () => {
  test('читає main.mdc і дописує concern-mdc з extraRuleDirs', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      const bundledRulesDir = join(dir, 'rules')
      await ensureDir(join(bundledRulesDir, 'text'))
      await fs.writeFile(join(bundledRulesDir, 'text', 'main.mdc'), '# text rule\n', 'utf8')
      // appendDiscoveredMdcFiles шукає ПІДКАТАЛОГИ extraDir з concern.json + *.mdc всередині.
      const extraDir = join(dir, 'plugin-rules', 'text')
      const concernDir = join(extraDir, 'my-concern')
      await ensureDir(concernDir)
      await writeJson(join(concernDir, 'concern.json'), {})
      await fs.writeFile(join(concernDir, 'concern.mdc'), '# extra concern\n', 'utf8')

      const out = await readBundledRuleContent('text', bundledRulesDir, [extraDir])
      expect(out).toContain('# text rule')
      expect(out).toContain('# extra concern')
    })
  })

  test('відсутній main.mdc → throws з іменем правила', async () => {
    await withTmpDir(async dir => {
      await ensureDir(dir)
      await expect(readBundledRuleContent('ghost', dir)).rejects.toThrow(MISSING_RULE_MAIN_MDC_RE)
    })
  })
})

describe('runSyncStep', () => {
  test('повертає результат дії за успіху', async () => {
    const result = await runSyncStep('❌ ', () => 42)
    expect(result).toBe(42)
  })
  test('логує префікс+повідомлення і прокидає виняток', async () => {
    const errSpy = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errSpy.push(args.join(' '))
    })
    try {
      await expect(
        runSyncStep('❌ Опис: ', () => {
          throw new Error('бум')
        })
      ).rejects.toThrow('бум')
      expect(errSpy.join('\n')).toContain('❌ Опис: бум')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('captureOutput', () => {
  test('за fail === 0 не скидає буфер у реальний stdout', async () => {
    const writes = []
    const orig = process.stdout.write
    process.stdout.write = chunk => {
      writes.push(chunk)
      return true
    }
    try {
      const result = await captureOutput(() => {
        console.log('прихований рядок успіху')
        return { fail: 0 }
      })
      expect(result).toEqual({ fail: 0 })
      expect(writes.join('')).toBe('')
    } finally {
      process.stdout.write = orig
    }
  })

  test('за fail > 0 скидає весь буфер у реальний stdout', async () => {
    const writes = []
    const orig = process.stdout.write
    process.stdout.write = chunk => {
      writes.push(chunk)
      return true
    }
    try {
      const result = await captureOutput(() => {
        console.log('рядок з помилкою')
        return { fail: 1 }
      })
      expect(result).toEqual({ fail: 1 })
      expect(writes.join('')).toContain('рядок з помилкою')
    } finally {
      process.stdout.write = orig
    }
  })

  test('при винятку скидає буфер і прокидає помилку далі', async () => {
    const writes = []
    const orig = process.stdout.write
    process.stdout.write = chunk => {
      writes.push(chunk)
      return true
    }
    try {
      await expect(
        captureOutput(() => {
          console.log('перед падінням')
          throw new Error('крах')
        })
      ).rejects.toThrow('крах')
      expect(writes.join('')).toContain('перед падінням')
    } finally {
      process.stdout.write = orig
    }
  })
})

describe('syncManagedRuleFiles', () => {
  test('копіює правила з ruleSources/ruleExtras у rulesDir', async () => {
    await withTmpDir(async dir => {
      const fs = await import('node:fs/promises')
      const bundledRulesDir = join(dir, 'core-rules')
      await ensureDir(join(bundledRulesDir, 'text'))
      await fs.writeFile(join(bundledRulesDir, 'text', 'main.mdc'), '# text\n', 'utf8')
      const rulesDir = join(dir, 'project-rules')
      await ensureDir(rulesDir)

      const { successCount, failCount } = await syncManagedRuleFiles(['text'], bundledRulesDir, rulesDir)
      expect(successCount).toBe(1)
      expect(failCount).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(rulesDir, 'n-text.mdc'))).toBe(true)
    })
  })

  test('відсутнє правило у пакеті → failCount++', async () => {
    await withTmpDir(async dir => {
      const bundledRulesDir = join(dir, 'core-rules')
      await ensureDir(bundledRulesDir)
      const rulesDir = join(dir, 'project-rules')
      await ensureDir(rulesDir)
      const { successCount, failCount } = await syncManagedRuleFiles(['ghost'], bundledRulesDir, rulesDir)
      expect(successCount).toBe(0)
      expect(failCount).toBe(1)
    })
  })
})

describe('logRemovedManagedItems', () => {
  test('порожній список — нічого не логує', () => {
    const calls = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      calls.push(args.join(' '))
    })
    try {
      logRemovedManagedItems('правила', '.cursor/rules', [])
    } finally {
      spy.mockRestore()
    }
    expect(calls).toEqual([])
  })
  test('непорожній список — логує заголовок і кожен елемент', () => {
    const calls = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      calls.push(args.join(' '))
    })
    try {
      logRemovedManagedItems('правила', '.cursor/rules', ['n-a.mdc', 'n-b.mdc'])
    } finally {
      spy.mockRestore()
    }
    const text = calls.join('\n')
    expect(text).toContain('Видалено правила поза списком')
    expect(text).toContain('.cursor/rules/n-a.mdc')
    expect(text).toContain('.cursor/rules/n-b.mdc')
  })
})

describe('reexecIfPackageVersionChanged / ReexecHandoff', () => {
  test('NITRA_CURSOR_REEXEC=1 → рано повертається, без читання версій', async () => {
    const prev = env.NITRA_CURSOR_REEXEC
    env.NITRA_CURSOR_REEXEC = '1'
    try {
      await expect(reexecIfPackageVersionChanged('/no/such/root', '1.0.0')).resolves.toBeUndefined()
    } finally {
      if (prev === undefined) delete env.NITRA_CURSOR_REEXEC
      else env.NITRA_CURSOR_REEXEC = prev
    }
  })

  test('однакові версії до/після — рано повертається', async () => {
    const prev = env.NITRA_CURSOR_REEXEC
    delete env.NITRA_CURSOR_REEXEC
    try {
      await withTmpDir(async dir => {
        await writeJson(join(dir, 'package.json'), { version: '1.2.3' })
        await expect(reexecIfPackageVersionChanged(dir, '1.2.3')).resolves.toBeUndefined()
      })
    } finally {
      if (prev !== undefined) env.NITRA_CURSOR_REEXEC = prev
    }
  })

  test('startVersion відсутній (null) — рано повертається', async () => {
    await expect(reexecIfPackageVersionChanged('/no/such/root', null)).resolves.toBeUndefined()
  })

  test('версії відрізняються, але новий bin/n-rules.js відсутній — рано повертається (без spawnSync)', async () => {
    const prev = env.NITRA_CURSOR_REEXEC
    delete env.NITRA_CURSOR_REEXEC
    try {
      await withTmpDir(async dir => {
        await writeJson(join(dir, 'package.json'), { version: '2.0.0' })
        // bin/n-rules.js навмисно відсутній у dir → existsSync(newBinPath) false → рано return
        await expect(reexecIfPackageVersionChanged(dir, '1.0.0')).resolves.toBeUndefined()
      })
    } finally {
      if (prev !== undefined) env.NITRA_CURSOR_REEXEC = prev
    }
  })

  test('ReexecHandoff зберігає код завершення дочірнього процесу', () => {
    const err = new ReexecHandoff(7)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ReexecHandoff')
    expect(err.code).toBe(7)
    expect(err.message).toBe('reexec-handoff')
  })
})
