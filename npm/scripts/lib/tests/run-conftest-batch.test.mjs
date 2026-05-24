import { describe, expect, test } from 'bun:test'

import { buildConftestArgs } from '../run-conftest-batch.mjs'

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
