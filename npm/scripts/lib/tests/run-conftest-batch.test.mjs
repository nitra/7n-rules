import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildConftestArgs, runConftestBatch } from '../run-conftest-batch.mjs'
import { withBinRemovedFromPath, withTmpDir } from '../../utils/test-helpers.mjs'

describe('buildConftestArgs', () => {
  test('emits base args without --data when tmpDataFile null', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json'],
      extraArgs: [],
      tmpDataFile: null
    })
    expect(args).toEqual(['test', '/a.json', '-p', '/p', '--namespace', 'demo.demo', '--output', 'json', '--no-color'])
  })

  test('inserts --data <tmpfile> when tmpDataFile provided', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json'],
      extraArgs: [],
      tmpDataFile: '/test-tmp/data.json'
    })
    expect(args).toEqual([
      'test',
      '/a.json',
      '-p',
      '/p',
      '--namespace',
      'demo.demo',
      '--data',
      '/test-tmp/data.json',
      '--output',
      'json',
      '--no-color'
    ])
  })

  test('appends extraArgs at the end (existing convention)', () => {
    const args = buildConftestArgs({
      policyAbs: '/p',
      namespace: 'demo.demo',
      files: ['/a.json', '/b.json'],
      extraArgs: ['--combine'],
      tmpDataFile: null
    })
    expect(args).toEqual([
      'test',
      '/a.json',
      '/b.json',
      '-p',
      '/p',
      '--namespace',
      'demo.demo',
      '--output',
      'json',
      '--no-color',
      '--combine'
    ])
  })
})

describe('runConftestBatch', () => {
  test('кидає коли conftest відсутній у PATH (lines 39, 91)', async () => {
    await withBinRemovedFromPath('conftest', async () => {
      await withTmpDir(async dir => {
        const fakeFile = join(dir, 'a.json')
        writeFileSync(fakeFile, '{}')
        await expect(() =>
          runConftestBatch({ files: [fakeFile], policyDirRel: 'abie/base_deployment_preem', namespace: 'abie.base_deployment_preem' })
        ).toThrow('conftest не знайдено')
      })
    })
  })

  test('кидає коли rego-каталог не знайдено (line 100)', async () => {
    await withTmpDir(async dir => {
      const fakeFile = join(dir, 'a.json')
      writeFileSync(fakeFile, '{}')
      expect(() =>
        runConftestBatch({ files: [fakeFile], policyDirRel: 'nonexistent-rule/nonexistent-policy', namespace: 'x.y' })
      ).toThrow('rego-каталог не знайдено')
    })
  })
})
