import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

import { probeFetchCalls, probeHelpers, probeTimeVariants } from '../lib/runtime-probe.mjs'

const dir = mkdtempSync(join(tmpdir(), 'probe-extra-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('probeFetchCalls', () => {
  test('перехоплює url/init реальних fetch-викликів експортів', () => {
    const mod = join(dir, 'fetcher.mjs')
    writeFileSync(
      mod,
      "export async function load(id) {\n  const r = await fetch('https://api.test/items/' + id, { method: 'GET' })\n  return r.json()\n}\n"
    )
    const res = probeFetchCalls(mod, ['load'])
    expect(res.load).toBeDefined()
    expect(JSON.stringify(res.load)).toContain('https://api.test/items/')
  })

  test('модуль з помилкою імпорту → порожній результат без крешу', () => {
    const mod = join(dir, 'broken-fetch.mjs')
    writeFileSync(mod, "throw new Error('boot fail')\n")
    const res = probeFetchCalls(mod, ['x'])
    expect(res).toEqual({})
  })
})

describe('probeTimeVariants', () => {
  test('прогін час-залежного експорту повертає обʼєкт без крешу', () => {
    const mod = join(dir, 'clock.mjs')
    writeFileSync(mod, 'export function greeting() {\n  return new Date().getHours() < 12 ? "morning" : "later"\n}\n')
    const res = probeTimeVariants(mod, ['greeting'])
    expect(typeof res).toBe('object')
    expect(res).not.toBeNull()
  })
})

describe('probeHelpers', () => {
  test('повертає shape внутрішніх хелперів через тимчасовий реекспорт', () => {
    const mod = join(dir, 'helpers.mjs')
    writeFileSync(
      mod,
      'function pad(x) {\n  return String(x).padStart(2, "0")\n}\nexport function fmt(h, m) {\n  return pad(h) + ":" + pad(m)\n}\n'
    )
    const res = probeHelpers(mod, ['pad'])
    expect(JSON.stringify(res)).toContain('pad')
  })
})
