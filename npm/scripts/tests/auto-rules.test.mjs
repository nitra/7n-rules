/**
 * Тести автодетекту правил для `.n-cursor.json` за `rules/<rule>/auto.md`.
 * Тести для скілів — у `auto-skills.test.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { ensureDir, withTmpDir, writeJson } from '../utils/test-helpers.mjs'
import { readFile, writeFile } from 'node:fs/promises'

import { detectAutoRules, detectLegacyRuleIds, mergeConfigWithAutoDetected, migrateRuleIds } from '../auto-rules.mjs'

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
  'js-lint',
  'js-mssql',
  'js-bun-db',
  'js-bun-redis',
  'js-run',
  'k8s',
  'nginx-default-tpl',
  'npm-module',
  'rust',
  'security',
  'style-lint',
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
        'js-lint',
        'k8s',
        'nginx-default-tpl',
        'npm-module',
        'security',
        'style-lint',
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
      await writeFile(join(dir, 'hasura/config.yaml'),
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

  test('AUTO_RULE_DEPENDENCIES: image-compress додається разом з bun, image-avif — разом з vue', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('vue')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(true)
      expect(actual.rules.includes('image-avif')).toBe(true)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: image-avif НЕ додається без vue, image-compress — додається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/app.js'), 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd(dir)

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
      expect(actual.rules.includes('image-compress')).toBe(true)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRules({
        root: dir,
        availableRules: ALL_RULES,
        packageJsonParsed: { name: 'app' },
        disableRules: ['vue']
      })

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules image-compress → image-avif теж не додається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'app' })
      await ensureDir(join(dir, 'src'))
      await writeFile(join(dir, 'src/App.vue'), '<script setup></script>\n', 'utf8')

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
})

describe('mergeConfigWithAutoDetected', () => {
  test('поважає disable-rules і disable-skills', () => {
    const merged = mergeConfigWithAutoDetected({
      config: {
        rules: ['text'],
        skills: ['lint'],
        'disable-rules': ['js-lint'],
        'disable-skills': ['fix']
      },
      detectedRules: ['js-lint', 'bun', 'text'],
      detectedSkills: ['fix', 'lint']
    })

    expect(merged.rules).toEqual(['text', 'bun'])
    expect(merged.skills).toEqual(['lint'])
    expect(merged['disable-rules']).toEqual(['js-lint'])
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
