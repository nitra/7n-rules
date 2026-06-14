import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runLint, selectLintRules } from '../orchestrate.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const META = {
  'js-lint': { lint: 'per-file' },
  'js-lint-ci': { lint: 'full' },
  'style-lint': { lint: 'per-file' },
  ga: { lint: 'full' },
  adr: {}
}

describe('selectLintRules', () => {
  test('default (full=false) → лише per-file правила, алфавітно', () => {
    expect(selectLintRules(META, false)).toEqual(['js-lint', 'style-lint'])
  })
  test('full=true → per-file + full, алфавітно', () => {
    expect(selectLintRules(META, true)).toEqual(['ga', 'js-lint', 'js-lint-ci', 'style-lint'])
  })
})

/**
 * Будує тимчасовий rulesDir з одним full-правилом, чий lint.mjs записує отримані
 * (files, opts) у sidecar-файл — щоб перевірити прокидання осей full/readOnly.
 * @param {string} dir tmp-корінь
 * @returns {Promise<string>} шлях до rulesDir
 */
async function seedProbeRule(dir) {
  const rulesDir = join(dir, 'rules')
  const probeDir = join(rulesDir, 'probe', 'js')
  await mkdir(probeDir, { recursive: true })
  await writeJson(join(rulesDir, 'probe', 'meta.json'), { lint: 'full' })
  await writeFile(
    join(probeDir, 'lint.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
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
      const code = await runLint({ full: true, readOnly: true, cwd: dir, rulesDir, log: () => {} })
      expect(code).toBe(0)
      const { readFileSync } = await import('node:fs')
      expect(JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'))).toEqual({
        filesUndefined: true,
        readOnly: true
      })
    })
  })
})
