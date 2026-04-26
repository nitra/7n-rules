/**
 * Тести автодетекту правил/skills для `.n-cursor.json` за `auto-rules.md`.
 */
import { describe, expect, test } from 'bun:test'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'
import { writeFile } from 'node:fs/promises'

import { detectAutoRulesAndSkills, mergeConfigWithAutoDetected } from '../scripts/auto-rules.mjs'

const ALL_RULES = [
  'abie',
  'bun',
  'capacitor',
  'docker',
  'ga',
  'graphql',
  'js-lint',
  'js-pino',
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
        'docker',
        'ga',
        'graphql',
        'js-lint',
        'js-pino',
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

  test('не додає js-pino для монорепо з vue і tempo', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        workspaces: ['apps/*']
      })
      await ensureDir('tempo')
      await ensureDir('apps/web')
      await writeFile('apps/web/main.js', 'console.log(1)\n', 'utf8')
      await writeFile('apps/web/App.vue', '<script setup></script>\n', 'utf8')

      const actual = await detectAutoRulesInCwd()

      expect(actual.rules.includes('js-pino')).toBe(false)
      expect(actual.rules.includes('js-lint')).toBe(true)
      expect(actual.rules.includes('vue')).toBe(true)
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
})
