/**
 * Тести автодетекту правил/skills для `.n-cursor.json` за `auto-rules.md`.
 */
import { describe, expect, test } from 'bun:test'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'
import { writeFile } from 'node:fs/promises'

import {
  detectAutoRulesAndSkills,
  detectLegacyRuleIds,
  mergeConfigWithAutoDetected,
  migrateRuleIds
} from '../scripts/auto-rules.mjs'

const ALL_RULES = [
  'abie',
  'bun',
  'capacitor',
  'changelog',
  'docker',
  'ga',
  'graphql',
  'hasura',
  'image-avif',
  'image-compress',
  'js-lint',
  'js-mssql',
  'js-bun-db',
  'js-run',
  'k8s',
  'nginx-default-tpl',
  'npm-module',
  'style-lint',
  'text',
  'vue'
]

const ALL_SKILLS = ['abie-kustomize', 'fix', 'lint']

/**
 * @returns {Promise<Awaited<ReturnType<typeof detectAutoRulesAndSkills>>>} результат виявлення правил з поточної директорії
 */
async function detectAutoRulesInCwd() {
  return detectAutoRulesAndSkills({
    root: process.cwd(),
    availableRules: ALL_RULES,
    availableSkills: ALL_SKILLS,
    packageJsonParsed: JSON.parse(await Bun.file('package.json').text())
  })
}

describe('detectAutoRulesAndSkills', () => {
  test('додає правила/skills за ознаками проєкту', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'sample',
        repository: 'https://github.com/abinbevefes/example.git'
      })
      await ensureDir('.github/workflows')
      await ensureDir('npm')
      await ensureDir('k8s')
      await ensureDir('src')
      await writeFile('capacitor.config.json', '{}\n', 'utf8')
      await writeFile('Dockerfile', 'FROM oven/bun:alpine\n', 'utf8')
      await writeFile('default.conf', 'server {}\n', 'utf8')
      await writeFile('src/app.js', 'export const x = 1\n', 'utf8')
      await writeFile('src/query.js', 'const q = gql`query { ping }`\n', 'utf8')
      await writeFile('src/App.vue', '<script setup>const a = 1</script>\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules).toEqual([
        'abie',
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
        'style-lint',
        'text',
        'vue'
      ])
      expect(actual.skills).toEqual(['abie-kustomize', 'fix', 'lint'])
    })
  })

  test('додає js-bun-db при pg у dependencies', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'pg-app',
        dependencies: {
          pg: '^8.13.0'
        }
      })
      await ensureDir('src')
      await writeFile('src/app.js', 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає js-bun-db при pg-format у dependencies', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'pg-format-app',
        dependencies: {
          'pg-format': '^1.0.4'
        }
      })
      await ensureDir('src')
      await writeFile('src/app.js', 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає js-bun-db при імпорті sql з bun', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'sql-app' })
      await writeFile('db.ts', 'import { sql } from "bun"\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-bun-db')).toBe(true)
    })
  })

  test('додає hasura, коли config.yaml містить metadata_directory: metadata', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'hasura-app' })
      await ensureDir('hasura')
      await writeFile(
        'hasura/config.yaml',
        'version: 3\nendpoint: http://localhost:8080\nmetadata_directory: metadata\n',
        'utf8'
      )

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('hasura')).toBe(true)
    })
  })

  test('не додає hasura для config.yaml без маркера', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'plain-yaml-app' })
      await writeFile('config.yaml', 'foo: bar\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('hasura')).toBe(false)
    })
  })

  test('додає js-run для вкладеного package.json без vite у devDependencies', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'root' })
      await ensureDir('services/api')
      await writeJson('services/api/package.json', {
        name: 'api',
        devDependencies: { typescript: '^5.0.0' }
      })

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-run')).toBe(true)
    })
  })

  test('не додає js-run, коли вкладений package.json має vite у devDependencies', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'root' })
      await ensureDir('apps/web')
      await writeJson('apps/web/package.json', {
        name: 'web',
        devDependencies: { vite: '^5.0.0' }
      })

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-run')).toBe(false)
    })
  })

  test('не додає js-run, якщо є лише кореневий package.json', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'root' })

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-run')).toBe(false)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: image-compress додається разом з bun, image-avif — разом з vue', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'app' })
      await ensureDir('src')
      await writeFile('src/App.vue', '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('vue')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(true)
      expect(actual.rules.includes('image-avif')).toBe(true)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: image-avif НЕ додається без vue, image-compress — додається', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'app' })
      await ensureDir('src')
      await writeFile('src/app.js', 'export const x = 1\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
      expect(actual.rules.includes('image-compress')).toBe(true)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules vue → image-avif теж не додається', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'app' })
      await ensureDir('src')
      await writeFile('src/App.vue', '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRulesAndSkills({
        root: process.cwd(),
        availableRules: ALL_RULES,
        availableSkills: ALL_SKILLS,
        packageJsonParsed: { name: 'app' },
        disableRules: ['vue']
      })

      expect(actual.rules.includes('vue')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
    })
  })

  test('AUTO_RULE_DEPENDENCIES: disable-rules image-compress → image-avif теж не додається', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'app' })
      await ensureDir('src')
      await writeFile('src/App.vue', '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRulesAndSkills({
        root: process.cwd(),
        availableRules: ALL_RULES,
        availableSkills: ALL_SKILLS,
        packageJsonParsed: { name: 'app' },
        disableRules: ['image-compress']
      })

      expect(actual.rules.includes('vue')).toBe(true)
      expect(actual.rules.includes('image-compress')).toBe(false)
      expect(actual.rules.includes('image-avif')).toBe(false)
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
