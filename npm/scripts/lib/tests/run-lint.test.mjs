import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runLint, selectLintRules } from '../run-lint.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

const META = {
  docker: { lint: 'full' },
  js: { lint: 'per-file' },
  k8s: { lint: 'full' },
  php: { lint: 'full' },
  rust: { lint: 'full' },
  'style': { lint: 'per-file' },
  ga: { lint: 'full' },
  adr: {}
}
const ignoreLog = text => text

describe('selectLintRules', () => {
  test('default (full=false) → лише per-file правила, алфавітно', () => {
    expect(
      selectLintRules(META, false, ['docker', 'ga', 'js', 'k8s', 'php', 'rust', 'style'])
    ).toEqual(['js', 'style'])
  })
  test('full=true → per-file + full, алфавітно', () => {
    expect(
      selectLintRules(META, true, ['docker', 'ga', 'js', 'k8s', 'php', 'rust', 'style'])
    ).toEqual(['docker', 'ga', 'js', 'k8s', 'php', 'rust', 'style'])
  })
  test('ігнорує правила, не активовані у .n-cursor.json', () => {
    expect(selectLintRules(META, true, ['js'])).toEqual(['js'])
  })
})

/**
 * Будує тимчасовий rulesDir з одним full-правилом, чий `main.mjs::lint` записує отримані
 * (files, opts) у sidecar-файл — щоб перевірити прокидання осей full/readOnly. Entrypoint —
 * єдиний `main.mjs` (канон ADR 2026-06-21).
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} шлях до rulesDir
 */
async function seedProbeRule(dir) {
  const rulesDir = join(dir, 'rules')
  const probeDir = join(rulesDir, 'probe')
  await mkdir(probeDir, { recursive: true })
  await writeJson(join(probeDir, 'meta.json'), { lint: 'full' })
  await writeFile(
    join(probeDir, 'main.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      'export function run() { return 0 }',
      'export function lint(files, cwd, opts = {}) {',
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

describe('runLint — scoped (`lint <rule…>`)', () => {
  test('названe правило з main.mjs::lint → лінтер whole-repo (files=undefined)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      // rules задано → scoped: проганяє лінтер ТІЛЬКИ probe; кастомний rulesDir → конформність skip.
      const code = await runLint({ rules: ['probe'], cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { readFileSync } = await import('node:fs')
      expect(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'))).toEqual({
        filesUndefined: true,
        readOnly: false
      })
    })
  })

  test('названe правило без лінт-поверхні → лінтер не викликається (конформність-only)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedProbeRule(dir)
      // 'adr' відсутнє у tmp-rulesDir (нема meta.lint) → linterIds порожній, probe.json не пишеться.
      const code = await runLint({ rules: ['adr'], cwd: dir, rulesDir, log: ignoreLog })
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'probe.json'))).toBe(false)
    })
  })
})
