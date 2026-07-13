/**
 * Тести автодетекту правил для `.n-rules.json` за `rules/<rule>/auto.md`.
 * Тести для скілів — у `auto-skills.test.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { platform } from 'node:process'
import { ensureDir, withTmpDir, writeJson } from '../utils/test-helpers.mjs'
import { chmod, readFile, writeFile } from 'node:fs/promises'

import {
  collectAutoRuleFacts,
  detectAutoRules,
  detectLegacyRuleIds,
  isMonorepoPackage,
  mergeConfigWithAutoDetected,
  migrateRuleIds
} from '../auto-rules.mjs'

const ALL_RULES = [
  'abie',
  'adr',
  'bun',
  'capacitor',
  'changelog',
  'docker',
  'efes',
  'ga',
  'graphql',
  'hasura',
  'image-avif',
  'image-compress',
  'js',
  'js-mssql',
  'js-bun-db',
  'js-bun-redis',
  'js-run',
  'k8s',
  'nginx-default-tpl',
  'npm-module',
  'rust',
  'security',
  'style',
  'tauri',
  'test',
  'text',
  'vue'
]

/**
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @returns {Promise<Awaited<ReturnType<typeof detectAutoRules>>>} результат виявлення правил з директорії
 */
async function detectAutoRulesInCwd(dir) {
  return detectAutoRules({
    root: dir,
    availableRules: ALL_RULES,
    packageJsonParsed: JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  })
}

describe('detectAutoRules', () => {
  test('додає правила за ознаками проєкту', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'sample',
        repository: 'https://github.com/abinbevefes/example.git'
      })
      await ensureDir(join(dir, '.github/workflows'))
      await ensureDir(join(dir, 'npm'))
      await ensureDir(join(dir, 'k8s'))
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'capacitor.config.json'), '{}\n', 'utf8')
      await writeFile(join(dir, 'Dockerfile'), 'FROM oven/bun:alpine\n', 'utf8')
      await writeFile(join(dir, 'default.conf'), 'server {}\n', 'utf8')
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')
      await writeFile(join(dir, 'src/query.js'), 'const q = gql`query { ping }`\n', 'utf8')
      await writeFile(join(dir, 'src/App.vue'), '<script setup>const a = 1</script>\n', 'utf8')
      await writeFile(join(dir, 'src/logo.png'), 'x', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules).toEqual([
        'abie',
        'adr',
        'bun',
        'capacitor',
        'changelog',
        'docker',
        'ga',
        'graphql',
        'image-avif',
        'image-compress',
        'js',
        'k8s',
        'nginx-default-tpl',
        'npm-module',
        'security',
        'style',
        'test',
        'text',
        'vue'
      ])
    })
  })

  test('додає js-bun-db при pg у dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'pg-app',
        dependencies: {
          pg: '^8.13.0'
        }
      })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає js-bun-db при pg-format у dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'pg-format-app',
        dependencies: {
          'pg-format': '^1.0.4'
        }
      })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає js-bun-db при імпорті sql з bun', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'sql-app' })
      await writeFile(join(dir, 'db.ts'), 'import { sql } from "bun"\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає js-bun-redis при ioredis у dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'ioredis-app',
        dependencies: { ioredis: '^5.4.0' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-redis')).toBe(true)
    })
  })

  test('додає js-bun-redis при node-redis у dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'node-redis-app',
        dependencies: { 'node-redis': '^4.7.0' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-redis')).toBe(true)
    })
  })

  test('не додає js-bun-redis, якщо redis-залежностей немає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'no-redis-app',
        dependencies: { lodash: '^4.17.21' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-bun-redis')).toBe(false)
    })
  })

  test('додає hasura, коли config.yaml містить metadata_directory: metadata', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'hasura-app' })
      await ensureDir(join(dir, 'hasura'))
      await writeFile(
        join(dir, 'hasura/config.yaml'),
        'version: 3\nendpoint: http://localhost:8080\nmetadata_directory: metadata\n',
        'utf8'
      )

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('hasura')).toBe(true)
    })
  })

  test('не додає hasura для config.yaml без маркера', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'plain-yaml-app' })
      await writeFile(join(dir, 'config.yaml'), 'foo: bar\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('hasura')).toBe(false)
    })
  })

  test('додає js-run для вкладеного package.json без vite у devDependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'services/api'))
      await writeJson(join(dir, 'services/api/package.json'), {
        name: 'api',
        devDependencies: { typescript: '^5.0.0' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-run')).toBe(true)
    })
  })

  test('не додає js-run, коли вкладений package.json має vite у devDependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'apps/web'))
      await writeJson(join(dir, 'apps/web/package.json'), {
        name: 'web',
        devDependencies: { vite: '^5.0.0' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-run')).toBe(false)
    })
  })

  test('не додає js-run, якщо є лише кореневий package.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('js-run')).toBe(false)
    })
  })

  test('glob-активація: репо із зображенням → image-compress (і image-avif разом з vue)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')
      await writeFile(join(dir, 'src/logo.png'), 'x', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('vue')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(true)
      expect(actual.rules.includes('image-avif')).toBe(true)
    })
  })

  test('glob-активація: bun-репо без зображень → image-compress і image-avif відсутні', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('bun')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('glob-активація: зображення без vue → image-compress є, image-avif немає', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/logo.svg'), '<svg></svg>\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-compress')).toBe(true)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')
      await writeFile(join(dir, 'src/logo.png'), 'x', 'utf8')

      const actual = await detectAutoRules({
        root: dir,
        availableRules: ALL_RULES,
        packageJsonParsed: { name: 'app' },
        disableRules: ['vue']
      })

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-compress')).toBe(true)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules image-compress → image-avif теж не додається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')
      await writeFile(join(dir, 'src/logo.png'), 'x', 'utf8')

      const actual = await detectAutoRules({
        root: dir,
        availableRules: ALL_RULES,
        packageJsonParsed: { name: 'app' },
        disableRules: ['image-compress']
      })

      expect(actual.rules.includes('vue')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('додає efes за repository з github.com/efes-cloud', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'efes-app',
        repository: 'https://github.com/efes-cloud/example.git'
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('efes')).toBe(true)
    })
  })

  test('додає efes для repository як обʼєкт з url у git+https формі', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'efes-app',
        repository: { type: 'git', url: 'git+https://github.com/efes-cloud/example.git' }
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('efes')).toBe(true)
    })
  })

  test('не додає efes для стороннього repository', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'other-app',
        repository: 'https://github.com/some-other-org/example.git'
      })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('efes')).toBe(false)
    })
  })

  test('додає "rust" коли в дереві є Cargo.toml', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'rust-app' })
      await ensureDir(join(dir, 'src-tauri'))
      await writeFile(join(dir, 'src-tauri/Cargo.toml'), '[package]\nname = "x"\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('rust')).toBe(true)
    })
  })

  test('НЕ додає "rust" коли Cargo.toml відсутній', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'js-only' })

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('rust')).toBe(false)
    })
  })

  test('tauri детектиться за @tauri-apps/api у dependencies', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app', dependencies: { '@tauri-apps/api': '^2' } })
      const { rules } = await detectAutoRules({
        root: dir,
        availableRules: ALL_RULES,
        packageJsonParsed: { name: 'app', dependencies: { '@tauri-apps/api': '^2' } }
      })
      expect(rules).toContain('tauri')
    })
  })
})

describe('mergeConfigWithAutoDetected', () => {
  test('поважає disable-rules і disable-skills', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text'],
        skills: ['lint'],
        'disable-rules': ['js'],
        'disable-skills': ['fix']
      },
      detectedRules: ['js', 'bun', 'text'],
      detectedSkills: ['fix', 'lint']
    })

    expect(merged.rules).toEqual(['text', 'bun'])
    expect(merged.skills).toEqual(['lint'])
    expect(merged['disable-rules']).toEqual(['js'])
    expect(merged['disable-skills']).toEqual(['fix'])
  })

  test('міграція legacy `image` у `rules` → `image-compress` + `image-avif`', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text', 'image', 'vue'],
        skills: ['lint']
      },
      detectedRules: [],
      detectedSkills: []
    })

    expect(merged.rules).toEqual(['text', 'image-compress', 'image-avif', 'vue'])
  })

  test('міграція legacy `image` у `disable-rules` → обидва наступники вимкнено', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text'],
        skills: [],
        'disable-rules': ['image']
      },
      detectedRules: ['image-compress', 'image-avif'],
      detectedSkills: []
    })

    expect(merged['disable-rules']).toEqual(['image-compress', 'image-avif'])
    expect(merged.rules).toEqual(['text'])
  })

  test('legacy `image` поряд з вже наявним `image-compress` дедуплікується', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['image-compress', 'image'],
        skills: []
      },
      detectedRules: [],
      detectedSkills: []
    })

    expect(merged.rules).toEqual(['image-compress', 'image-avif'])
  })
})

describe('migrateRuleIds / detectLegacyRuleIds', () => {
  test('migrateRuleIds замінює `image` на пару наступників, зберігаючи порядок', () => {
    expect(migrateRuleIds(['text', 'image', 'vue'])).toEqual(['text', 'image-compress', 'image-avif', 'vue'])
  })

  test('migrateRuleIds дедуплікує, якщо новий id вже у списку', () => {
    expect(migrateRuleIds(['image-compress', 'image', 'image-avif'])).toEqual(['image-compress', 'image-avif'])
  })

  test('migrateRuleIds не чіпає актуальні id', () => {
    expect(migrateRuleIds(['bun', 'text', 'vue'])).toEqual(['bun', 'text', 'vue'])
  })

  test('detectLegacyRuleIds повертає лише id з RULE_MIGRATIONS', () => {
    expect(detectLegacyRuleIds(['image', 'bun', 'image-compress'])).toEqual(['image'])
    expect(detectLegacyRuleIds(['bun', 'text'])).toEqual([])
  })
})

describe('isMonorepoPackage', () => {
  test('null → false', () => {
    expect(isMonorepoPackage(null)).toBe(false)
  })

  test('масив → false', () => {
    expect(isMonorepoPackage([])).toBe(false)
  })

  test('рядок → false', () => {
    // @ts-expect-error
    expect(isMonorepoPackage('string')).toBe(false)
  })

  test('workspaces — масив з елементами → true', () => {
    expect(isMonorepoPackage({ workspaces: ['packages/*'] })).toBe(true)
  })

  test('workspaces — порожній масив → false', () => {
    expect(isMonorepoPackage({ workspaces: [] })).toBe(false)
  })

  test('workspaces — обʼєкт з packages → true', () => {
    expect(isMonorepoPackage({ workspaces: { packages: ['packages/*'] } })).toBe(true)
  })

  test('workspaces — обʼєкт з порожнім packages → false', () => {
    expect(isMonorepoPackage({ workspaces: { packages: [] } })).toBe(false)
  })

  test('workspaces — рядок → false', () => {
    expect(isMonorepoPackage({ workspaces: 'packages/*' })).toBe(false)
  })

  test('без workspaces → false', () => {
    expect(isMonorepoPackage({ name: 'x' })).toBe(false)
  })
})

describe('collectAutoRuleFacts — hasTempoDir і hasRegoFile', () => {
  test('tempo/ директорія → hasTempoDir: true (line 286)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'tempo'))
      const facts = await collectAutoRuleFacts(dir)
      expect(facts.hasTempoDir).toBe(true)
    })
  })

  test('.rego файл → hasRegoFile: true (line 329)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'policy.rego'), 'package main\n', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(facts.hasRegoFile).toBe(true)
    })
  })
})

describe('mergeConfigWithAutoDetected — skills', () => {
  test('новий скіл з detectedSkills додається', () => {
    const merged = mergeConfigWithAutoDetected({
      config: { rules: [], skills: ['n-lint'] },
      detectedRules: [],
      detectedSkills: ['n-fix']
    })
    expect(merged.skills).toContain('n-fix')
  })
})

describe('mergeConfigWithAutoDetected — відсів неактуальних (available)', () => {
  test('прибирає rules/skills, яких немає у пакеті, і повертає їх у pruned', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text', 'flow', 'bun'],
        skills: ['lint', 'fix', 'fix-tests']
      },
      detectedRules: [],
      detectedSkills: [],
      availableRules: ['text', 'bun', 'vue'],
      availableSkills: ['lint', 'worktree']
    })

    expect(merged.rules).toEqual(['text', 'bun'])
    expect(merged.skills).toEqual(['lint'])
    expect(merged.pruned).toEqual({ rules: ['flow'], skills: ['fix', 'fix-tests'] })
  })

  test('без available нічого не прибирає і pruned відсутній', () => {
    const merged = mergeConfigWithAutoDetected({
      config: { rules: ['text', 'flow'], skills: ['lint', 'fix'] },
      detectedRules: [],
      detectedSkills: []
    })

    expect(merged.rules).toEqual(['text', 'flow'])
    expect(merged.skills).toEqual(['lint', 'fix'])
    expect(merged.pruned).toBeUndefined()
  })

  test('усі id актуальні → pruned відсутній', () => {
    const merged = mergeConfigWithAutoDetected({
      config: { rules: ['text'], skills: ['lint'] },
      detectedRules: [],
      detectedSkills: [],
      availableRules: ['text', 'bun'],
      availableSkills: ['lint', 'worktree']
    })

    expect(merged.pruned).toBeUndefined()
  })

  test('не чіпає disable-rules/disable-skills навіть якщо їх немає у пакеті', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text'],
        skills: ['lint'],
        'disable-rules': ['flow'],
        'disable-skills': ['fix']
      },
      detectedRules: [],
      detectedSkills: [],
      availableRules: ['text'],
      availableSkills: ['lint']
    })

    expect(merged['disable-rules']).toEqual(['flow'])
    expect(merged['disable-skills']).toEqual(['fix'])
    expect(merged.pruned).toBeUndefined()
  })
})

describe('detectAutoRules — workspace без devDependencies (line 217)', () => {
  test('вкладений package.json без devDependencies → packageJsonLacksViteDevDependency: true', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'root',
        workspaces: ['packages/app']
      })
      await ensureDir(join(dir, 'packages/app'))
      await writeJson(join(dir, 'packages/app/package.json'), { name: 'app' })
      const result = await detectAutoRules({
        root: dir,
        availableRules: ALL_RULES,
        packageJsonParsed: { name: 'root', workspaces: ['packages/app'] }
      })
      expect(result.rules.includes('js-run')).toBe(true)
    })
  })
})

describe('catch-блоки при помилці readdir (lines 195, 245, 546)', () => {
  test('collectAutoRuleFacts — readdir кидає у піддиректорії (line 546)', async () => {
    // chmod 0o000 не блокує readdir під Windows — сценарій нерелевантний, пропускаємо.
    if (platform === 'win32') {
      return
    }
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'baddir'))
      await chmod(join(dir, 'baddir'), 0o000)
      try {
        const facts = await collectAutoRuleFacts(dir)
        expect(facts).toBeDefined()
      } finally {
        await chmod(join(dir, 'baddir'), 0o755)
      }
    })
  })

  test('detectAutoRules — readdir кидає в піддиректорії (lines 195, 245)', async () => {
    // chmod 0o000 не блокує readdir під Windows — сценарій нерелевантний, пропускаємо.
    if (platform === 'win32') {
      return
    }
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'baddir'))
      await chmod(join(dir, 'baddir'), 0o000)
      try {
        const result = await detectAutoRules({ root: dir, availableRules: ALL_RULES, packageJsonParsed: null })
        expect(result).toBeDefined()
      } finally {
        await chmod(join(dir, 'baddir'), 0o755)
      }
    })
  })

  test('packageJsonLacksViteDevDependency — невалідний JSON → catch (line 221)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg', 'package.json'), '{ not json', 'utf8')
      const result = await detectAutoRules({ root: dir, availableRules: ALL_RULES, packageJsonParsed: null })
      expect(result).toBeDefined()
    })
  })
})
