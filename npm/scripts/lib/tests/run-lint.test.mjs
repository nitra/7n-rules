import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runLint, selectLintEntries } from '../run-lint.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

/**
 * Структура lintConcernsByRule для тестів selectLintEntries.
 * @type {Record<string, import('../concern-meta.mjs').ConcernMeta[]>}
 */
const CONCERNS_BY_RULE = {
  docker: [{ name: 'lint', dir: '/x/docker/lint', check: false, lint: { scope: 'full', glob: ['**/Dockerfile*'] } }],
  js: [
    { name: 'eslint', dir: '/x/js/eslint', check: false, lint: { scope: 'per-file', glob: ['**/*.{js,mjs}'] } },
    { name: 'jscpd_duplicates', dir: '/x/js/jscpd', check: false, lint: { scope: 'full', glob: ['**/*.{js,mjs}'] } }
  ],
  k8s: [{ name: 'manifests', dir: '/x/k8s/manifests', check: false, lint: { scope: 'full', glob: ['k8s/**/*.yaml'] } }],
  php: [{ name: 'check', dir: '/x/php/check', check: false, lint: { scope: 'full', glob: ['**/*.php'] } }],
  rust: [{ name: 'check', dir: '/x/rust/check', check: false, lint: { scope: 'full', glob: ['**/*.rs'] } }],
  style: [{ name: 'lint', dir: '/x/style/lint', check: false, lint: { scope: 'per-file', glob: ['**/*.{css,scss}'] } }],
  ga: [
    { name: 'workflows', dir: '/x/ga/workflows', check: false, lint: { scope: 'full', glob: ['.github/workflows/**'] } }
  ],
  adr: []
}
const ignoreLog = _text => {}

describe('selectLintEntries', () => {
  test('default (full=false) → лише per-file concerns, алфавітно', () => {
    const entries = selectLintEntries(CONCERNS_BY_RULE, false, ['docker', 'ga', 'js', 'k8s', 'php', 'rust', 'style'])
    expect(entries.map(e => `${e.ruleId}/${e.concern.name}`)).toEqual(['js/eslint', 'style/lint'])
  })

  test('full=true → per-file + full concerns, алфавітно', () => {
    const entries = selectLintEntries(CONCERNS_BY_RULE, true, ['docker', 'ga', 'js', 'k8s', 'php', 'rust', 'style'])
    expect(entries.map(e => `${e.ruleId}/${e.concern.name}`)).toEqual([
      'docker/lint',
      'ga/workflows',
      'js/eslint',
      'js/jscpd_duplicates',
      'k8s/manifests',
      'php/check',
      'rust/check',
      'style/lint'
    ])
  })

  test('ігнорує правила, не активовані у enabledRuleIds', () => {
    const entries = selectLintEntries(CONCERNS_BY_RULE, true, ['js'])
    expect(entries.map(e => `${e.ruleId}/${e.concern.name}`)).toEqual(['js/eslint', 'js/jscpd_duplicates'])
  })
})

/**
 * Будує тимчасовий rulesDir з одним full lint-concern-ом.
 * Concern записує отримані (files, opts) у sidecar-файл probe.json.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} шлях до rulesDir
 */
async function seedProbeRule(dir) {
  const rulesDir = join(dir, 'rules')
  const concernDir = join(rulesDir, 'probe', 'check')
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), {
    $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
    lint: { scope: 'full', glob: ['**/*'] }
  })
  await writeFile(
    join(concernDir, 'main.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      'export function lint(files, cwd = process.cwd(), opts = {}) {',
      "  writeFileSync(join(cwd, 'probe.json'), JSON.stringify({ filesUndefined: files === undefined, readOnly: opts.readOnly === true }))",
      '  return 0',
      '}',
      ''
    ].join('\n'),
    'utf8'
  )
  return rulesDir
}

describe('runLint — прокидання осей', () => {
  test('full + readOnly → lint(undefined, cwd, {readOnly:true})', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['probe'] })
      const code = await runLint({ full: true, readOnly: true, cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { readFileSync } = await import('node:fs')
      expect(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'))).toEqual({
        filesUndefined: true,
        readOnly: true
      })
    })
  })

  test('unscoped linter-фаза не запускає правило поза .n-cursor.json', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      await writeJson(join(dir, '.n-cursor.json'), { rules: [] })
      const code = await runLint({ full: true, readOnly: true, cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'probe.json'))).toBe(false)
    })
  })

  test('unscoped linter-фаза не запускає правило з disable-rules', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['probe'], 'disable-rules': ['probe'] })
      const code = await runLint({ full: true, readOnly: true, cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'probe.json'))).toBe(false)
    })
  })
})

describe('runLint — verbose', () => {
  test('--verbose логує concern, scope, glob і кількість файлів', async () => {
    await withTmpDir(async dir => {
      const rulesDir = join(dir, 'rules')
      const concernDir = join(rulesDir, 'probe', 'check')
      await mkdir(concernDir, { recursive: true })
      await writeJson(join(concernDir, 'concern.json'), {
        $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json',
        lint: { scope: 'per-file', glob: ['**/*.mjs'] }
      })
      await writeFile(join(concernDir, 'main.mjs'), 'export function lint() { return 0 }\n', 'utf8')
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['probe'] })

      const logs = []
      await runLint({ full: true, verbose: true, cwd: dir, rulesDir, log: s => logs.push(s) })
      const verboseLine = logs.find(l => l.includes('probe/check'))
      expect(verboseLine).toBeDefined()
      expect(verboseLine).toContain('per-file')
      expect(verboseLine).toContain('**/*.mjs')
    })
  })
})

describe('runLint — scoped (`lint <rule…>`)', () => {
  test('названий concern з lint() → лінтер whole-repo (files=undefined)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      // rules задано → scoped: проганяє ТІЛЬКИ probe; кастомний rulesDir → конформність skip
      const code = await runLint({ rules: ['probe'], cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { readFileSync } = await import('node:fs')
      expect(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'))).toEqual({
        filesUndefined: true,
        readOnly: false
      })
    })
  })

  test('названий rule без lint-поверхні → лінтер не викликається', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      // 'adr' відсутнє у tmp-rulesDir (нема lint concern) → probe.json не пишеться
      const code = await runLint({ rules: ['adr'], cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'probe.json'))).toBe(false)
    })
  })
})
