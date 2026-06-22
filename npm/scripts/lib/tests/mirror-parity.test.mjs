/**
 * Тести parity дзеркала правил (`lib/mirror-parity.mjs`):
 *  - юніт: `findMirrorDrift` ловить розбіжність mirror↔канон у tmp-фікстурі;
 *  - live-гард: на самому репо `.cursor/rules/n-*.mdc` == inlined-канон (дрейфу нема).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../utils/test-helpers.mjs'
import { findMirrorDrift, listManagedMirrors } from '../mirror-parity.mjs'

/** Корінь репо від цього тесту: tests → lib → scripts → npm → <root>. */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

/**
 * Готує tmp-репо з одним керованим дзеркалом і його каноном.
 * @param {string} dir корінь tmp
 * @param {string} canonical вміст канону
 * @param {string} mirror вміст дзеркала
 * @returns {Promise<void>}
 */
async function seed(dir, canonical, mirror) {
  await mkdir(join(dir, '.cursor/rules'), { recursive: true })
  await mkdir(join(dir, 'npm/rules/x'), { recursive: true })
  await writeFile(join(dir, 'npm/rules/x/main.mdc'), canonical)
  await writeFile(join(dir, '.cursor/rules/n-x.mdc'), mirror)
}

describe('findMirrorDrift', () => {
  test('mirror == канон (без шаблонів) → без дрейфу', async () => {
    await withTmpDir(async dir => {
      await seed(dir, '# rule x\nтіло\n', '# rule x\nтіло\n')
      expect(await findMirrorDrift(dir)).toEqual([])
    })
  })
  test('mirror ≠ канон → дрейф [x]', async () => {
    await withTmpDir(async dir => {
      await seed(dir, '# rule x\nновий рядок\n', '# rule x\nстарий рядок\n')
      expect(await findMirrorDrift(dir)).toEqual(['x'])
    })
  })
  test('дзеркало без канону пропускається (не дрейф)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.cursor/rules'), { recursive: true })
      await writeFile(join(dir, '.cursor/rules/n-external.mdc'), 'external\n')
      expect(listManagedMirrors(dir)).toEqual([])
      expect(await findMirrorDrift(dir)).toEqual([])
    })
  })
})

describe('live parity (цей репо)', () => {
  test('.cursor/rules/n-*.mdc == inlined-канон (нема дрейфу)', async () => {
    expect(await findMirrorDrift(REPO_ROOT)).toEqual([])
  })
})
