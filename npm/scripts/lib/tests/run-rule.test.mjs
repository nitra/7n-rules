/**
 * Тести `runRule`: check concerns, policy concerns (без реального conftest).
 *
 * Concern-модель (2026-06-28): правила мають <concern>/concern.json + main.mjs.
 * applies()-gate видалено з runRule (spec 2026-06-28 §VI).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runRule, runTemplateSubsetConcern } from '../run-rule.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

/**
 * Будує concern-dir у tmp з concern.json + main.mjs.
 * @param {string} ruleDir абсолютний шлях до rule dir
 * @param {string} concernName ім'я concern
 * @param {string} body вміст main.mjs
 * @param {object} [meta] concern.json поля (окрім $schema)
 */
async function writeConcern(ruleDir, concernName, body, meta = { check: true }) {
  const concernDir = join(ruleDir, concernName)
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), {
    $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
    ...meta
  })
  await writeFile(join(concernDir, 'main.mjs'), body, 'utf8')
}

/**
 * Будує концерн із `template/<basename>.snippet.yml` і повертає шляхи.
 */
async function buildPolicyConcern(dir, basename, snippetYaml) {
  const concernAbsDir = join(dir, 'policy', 'c')
  await ensureDir(join(concernAbsDir, 'template'))
  await writeFile(join(concernAbsDir, 'template', `${basename}.snippet.yml`), snippetYaml, 'utf8')
  return { concernAbsDir, target: { check: 'template', files: { single: basename } } }
}

/**
 * Мінімальна CheckableRule-заготовка для тестів.
 * @param {string} id
 * @param {Array<{name: string, dir: string, check?: boolean, policy?: object}>} concerns
 */
function makeRule(id, concerns) {
  return { id, concerns }
}

describe('runRule — check concerns', () => {
  test('всі concerns запускаються', async () => {
    await withTmpDir(async dir => {
      const ruleDir = join(dir, 'rules', 'rego')
      await writeConcern(ruleDir, 'a', 'export async function main() { return 0 }')
      await writeConcern(ruleDir, 'b', 'export async function main() { return 0 }')
      const rule = makeRule('rego', [
        { name: 'a', dir: join(ruleDir, 'a'), check: true },
        { name: 'b', dir: join(ruleDir, 'b'), check: true }
      ])
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })

  test('concern без main() → пропускається (не кидає)', async () => {
    await withTmpDir(async dir => {
      const ruleDir = join(dir, 'rules', 'text')
      await writeConcern(ruleDir, 'noop', 'export const helper = 42')
      const rule = makeRule('text', [{ name: 'noop', dir: join(ruleDir, 'noop'), check: true }])
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(0)
    })
  })
})

describe('runRule — exit-код агрегується', () => {
  test('1, якщо хоча б один JS-concern повернув ненульовий', async () => {
    await withTmpDir(async dir => {
      const ruleDir = join(dir, 'rules', 'mix')
      await writeConcern(ruleDir, 'a', 'export async function main() { return 0 }')
      await writeConcern(ruleDir, 'b', 'export async function main() { return 1 }')
      const rule = makeRule('mix', [
        { name: 'a', dir: join(ruleDir, 'a'), check: true },
        { name: 'b', dir: join(ruleDir, 'b'), check: true }
      ])
      const code = await runRule(rule, join(dir, 'rules'), new Map())
      expect(code).toBe(1)
    })
  })
})

describe('runRule — policy concerns', () => {
  test('required single file відсутній → exit 1 (без conftest)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const concernDir = join(rulesDir, 'mypol', 'check')
      await ensureDir(concernDir)
      await writeJson(join(concernDir, 'concern.json'), {
        $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
        policy: {
          files: { single: '__nonexistent_xyz__.json', required: true },
          missingMessage: 'test: файл відсутній'
        }
      })
      const rule = makeRule('mypol', [
        {
          name: 'check',
          dir: concernDir,
          policy: {
            files: { single: '__nonexistent_xyz__.json', required: true },
            missingMessage: 'test: файл відсутній'
          }
        }
      ])
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(1)
    })
  })

  test('optional single file відсутній → exit 0 (без conftest)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const concernDir = join(rulesDir, 'mypol2', 'check')
      await ensureDir(concernDir)
      await writeJson(join(concernDir, 'concern.json'), {
        $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
        policy: { files: { single: '__nonexistent_xyz__.json', required: false } }
      })
      const rule = makeRule('mypol2', [
        {
          name: 'check',
          dir: concernDir,
          policy: { files: { single: '__nonexistent_xyz__.json', required: false } }
        }
      ])
      const code = await runRule(rule, rulesDir, new Map())
      expect(code).toBe(0)
    })
  })
})

describe('runTemplateSubsetConcern — snippet-driven (check:"template")', () => {
  const SNIPPET = `name: npm-publish
jobs:
  release-publish:
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: JS-DevTools/npm-publish@v4.1.5
        with:
          package: npm/package.json
`

  test('actual ⊇ snippet (зайві кроки/поля, інший порядок) → code 0', async () => {
    await withTmpDir(async dir => {
      const { concernAbsDir, target } = await buildPolicyConcern(dir, 'wf.yml', SNIPPET)
      const actualPath = join(dir, 'wf.yml')
      await writeFile(
        actualPath,
        `name: npm-publish
jobs:
  release-publish:
    permissions: { id-token: write, contents: write }
    steps:
      - name: Extra lint
        run: echo hi
      - uses: JS-DevTools/npm-publish@v4.1.5
        with: { package: npm/package.json }
      - name: Checkout
        uses: actions/checkout@v6
        with: { persist-credentials: true, fetch-depth: 0 }
`,
        'utf8'
      )
      const code = await runTemplateSubsetConcern(concernAbsDir, target, [actualPath], 'npm-module', 'c')
      expect(code).toBe(0)
    })
  })

  test('legacy-форма (job publish, без release-publish) → code 1', async () => {
    await withTmpDir(async dir => {
      const { concernAbsDir, target } = await buildPolicyConcern(dir, 'wf.yml', SNIPPET)
      const actualPath = join(dir, 'wf.yml')
      await writeFile(
        actualPath,
        `name: npm-publish
jobs:
  publish:
    permissions: { contents: read, id-token: write }
    steps:
      - uses: JS-DevTools/npm-publish@v4.1.5
        with: { package: npm/package.json }
`,
        'utf8'
      )
      const code = await runTemplateSubsetConcern(concernAbsDir, target, [actualPath], 'npm-module', 'c')
      expect(code).toBe(1)
    })
  })

  test('немає сніпета для таргета → пропуск, code 0', async () => {
    await withTmpDir(async dir => {
      const concernAbsDir = join(dir, 'policy', 'empty')
      await ensureDir(concernAbsDir)
      const target = { check: 'template', files: { single: 'wf.yml' } }
      const code = await runTemplateSubsetConcern(concernAbsDir, target, [join(dir, 'wf.yml')], 'r', 'empty')
      expect(code).toBe(0)
    })
  })
})
