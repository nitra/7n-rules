import { describe, expect, test } from 'vitest'

import { analyzeModule } from '../lib/ast-analyze.mjs'

const SAMPLE = `
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

const CACHE = new Map()

function helper(x) {
  return x + 1
}

export function readConfig(path) {
  if (env.MY_FLAG) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export const run = cmd => spawnSync(cmd)

export async function fetchData(url) {
  const r = await fetch(url)
  return r.json()
}
`

describe('analyzeModule', () => {
  test('витягує exportedNames, internalNames, envReads і usesFetch', () => {
    const a = analyzeModule(SAMPLE)
    expect(a.exportedNames).toEqual(expect.arrayContaining(['readConfig', 'run', 'fetchData']))
    expect(a.internalNames).toContain('helper')
    expect(a.envReads).toContain('MY_FLAG')
    expect(a.usesFetch).toBe(true)
  })

  test('зовнішні пакетні імпорти дають externalMocks з mockLine', () => {
    const src = "import got from 'got'\nexport const load = u => got(u)\n"
    const a = analyzeModule(src)
    expect(a.externalMocks.length).toBeGreaterThan(0)
    expect(a.externalMocks[0].pkg).toBe('got')
    expect(a.externalMocks[0].mockLine).toContain('got')
  })

  test('чистий модуль без побічних ефектів і fetch', () => {
    const a = analyzeModule('export const add = (a, b) => a + b\n')
    expect(a.hasSideEffects).toBe(false)
    expect(a.usesFetch).toBe(false)
    expect(a.envReads).toEqual([])
  })

  test('top-level виклик — сигнал side effects', () => {
    const a = analyzeModule("console.log('boot')\nexport const x = 1\n")
    expect(a.hasSideEffects).toBe(true)
  })

  test('битий синтаксис → порожній безпечний результат', () => {
    const a = analyzeModule('const = (((')
    expect(a).toEqual({
      externalMocks: [],
      exportedNames: [],
      internalNames: [],
      hasSideEffects: false,
      envReads: [],
      usesFetch: false
    })
  })

  test('TS-діалект через filename', () => {
    const a = analyzeModule('export function f(x: number): number { return x }\n', 'module.ts')
    expect(a.exportedNames).toContain('f')
  })
})

describe('analyzeModule — додаткові гілки', () => {
  test('default і namespace імпорти зовнішніх пакетів', () => {
    const src =
      "import axios from 'axios'\nimport * as yaml from 'yaml'\nexport const get = u => axios.get(u)\nexport const parse = s => yaml.parse(s)\n"
    const a = analyzeModule(src)
    const pkgs = a.externalMocks.map(m => m.pkg)
    expect(pkgs).toContain('axios')
    expect(pkgs).toContain('yaml')
  })

  test('node:-модулі не потрапляють у externalMocks', () => {
    const src = "import { join } from 'node:path'\nexport const p = a => join(a, 'b')\n"
    expect(analyzeModule(src).externalMocks).toEqual([])
  })

  test('process.env-читання без деструктуризації', () => {
    const src = 'export function flag() {\n  if (process.env.FEATURE_X) return 1\n  return 0\n}\n'
    expect(analyzeModule(src).envReads).toContain('FEATURE_X')
  })

  test('export default function має імʼя у exportedNames', () => {
    const src = 'export default function main() {\n  return 1\n}\n'
    const a = analyzeModule(src)
    expect(Array.isArray(a.exportedNames)).toBe(true)
  })

  test('клас і const-стрілки серед exportedNames', () => {
    const src = 'export class Box {}\nexport const a = 1, b = 2\n'
    const a = analyzeModule(src)
    expect(a.exportedNames).toEqual(expect.arrayContaining(['a', 'b']))
  })
})
