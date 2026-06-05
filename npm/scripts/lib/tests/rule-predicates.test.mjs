import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { RULE_PREDICATES } from '../rule-predicates.mjs'
import { collectAutoRuleFacts } from '../../auto-rules.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('repoUrlMarker', () => {
  test('matches abie repo url', () => {
    expect(
      RULE_PREDICATES.repoUrlMarker(
        { repository: { url: 'https://github.com/abinbevefes/x' } },
        'https://github.com/abinbevefes/'
      )
    ).toBe(true)
  })
  test('no match', () => {
    expect(
      RULE_PREDICATES.repoUrlMarker({ repository: 'https://github.com/other/x' }, 'https://github.com/abinbevefes/')
    ).toBe(false)
  })
})

describe('depInAnyPackageJson', () => {
  test('знаходить пакет у вкладеному package.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'sub'))
      await writeJson(join(dir, 'sub', 'package.json'), { dependencies: { mssql: '^1' } })
      expect(await RULE_PREDICATES.depInAnyPackageJson(dir, ['mssql'])).toBe(true)
      expect(await RULE_PREDICATES.depInAnyPackageJson(dir, ['pg'])).toBe(false)
    })
  })
})

describe('nestedPackageWithoutVite', () => {
  test('вкладений package.json без vite → true', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'app'))
      await writeJson(join(dir, 'app', 'package.json'), { devDependencies: {} })
      expect(await RULE_PREDICATES.nestedPackageWithoutVite(dir)).toBe(true)
    })
  })
  test('вкладений з vite → false', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await ensureDir(join(dir, 'app'))
      await writeJson(join(dir, 'app', 'package.json'), { devDependencies: { vite: '^5' } })
      expect(await RULE_PREDICATES.nestedPackageWithoutVite(dir)).toBe(false)
    })
  })
})

describe('content-предикати через facts', () => {
  test('gqlTaggedTemplate бачить gql-літерал', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.js'), 'const q = gql`{ x }`', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(RULE_PREDICATES.gqlTaggedTemplate(facts)).toBe(true)
    })
  })
  test('hasuraConfigMarker бачить config.yaml', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'config.yaml'), 'metadata_directory: metadata\n', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(RULE_PREDICATES.hasuraConfigMarker(facts)).toBe(true)
    })
  })
  test('jsBunDbSignal: import sql з bun', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'db.js'), 'import { sql } from "bun"', 'utf8')
      const facts = await collectAutoRuleFacts(dir)
      expect(await RULE_PREDICATES.jsBunDbSignal(dir, facts)).toBe(true)
    })
  })
})
