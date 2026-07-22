import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeShape, capProbeOutput, probeModule } from '../lib/runtime-probe.mjs'

const CAP = 600

describe('runtime-probe.mjs', () => {
  describe('describeShape', () => {
    it('describes primitives and null', () => {
      expect(describeShape('text')).toBe('string')
      expect(describeShape(42)).toBe('number')
      expect(describeShape(true)).toBe('boolean')
      expect(describeShape(null)).toBe('null')
    })

    it('describes an array of objects with nested shapes', () => {
      const value = [
        { file: 'a.mjs', mutants: [{ line: 1, col: 2, mutantType: 'X' }] },
        { file: 'b.mjs', mutants: [] }
      ]
      const shape = describeShape(value)
      expect(shape).toContain('Array(2) of')
      expect(shape).toContain('file: string')
      expect(shape).toContain('mutants: Array(1)')
    })

    it('truncates long key lists with an ellipsis', () => {
      const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
      const shape = describeShape(wide)
      expect(shape).toContain('…')
      expect(shape).not.toContain('k15')
    })

    it('collapses to a bare marker at depth 0', () => {
      expect(describeShape([[1]], 0)).toBe('Array(1)')
      expect(describeShape({ a: 1 }, 0)).toBe('Object')
    })
  })

  describe('capProbeOutput', () => {
    it('returns short output unchanged', () => {
      const short = JSON.stringify({ ok: true })
      expect(capProbeOutput(short)).toBe(short)
    })

    it('replaces an oversized JSON output with a shape-summary', () => {
      const big = JSON.stringify(
        Array.from({ length: 200 }, (_, i) => ({ file: `f${i}.mjs`, mutants: [{ line: i, col: 1 }] }))
      )
      const capped = capProbeOutput(big)
      expect(capped.length).toBeLessThanOrEqual(CAP)
      expect(capped).toContain('[shape-summary')
      expect(capped).toContain(`~${big.length} chars`)
      expect(capped).toContain('Array(200) of')
      expect(capped).toContain('file: string')
    })

    it('falls back to a string shape for oversized non-JSON output', () => {
      const capped = capProbeOutput('x'.repeat(2000))
      expect(capped.length).toBeLessThanOrEqual(CAP)
      expect(capped).toContain('[shape-summary')
      expect(capped).toContain('string')
    })

    it('keeps the summary itself within the cap even for very wide shapes', () => {
      const wide = JSON.stringify([
        Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`longPropertyName${i}`, 'v'.repeat(40)]))
      ])
      const capped = capProbeOutput(wide)
      expect(capped.length).toBeLessThanOrEqual(CAP)
    })
  })

  describe('probeModule (integration, child process)', () => {
    it('caps oversized outputs, limits entries per export and caps oversized constants', { timeout: 30_000 }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'probe-test-'))
      const modPath = join(dir, 'big.mjs')
      writeFileSync(
        modPath,
        [
          'export function bigArray() {',
          "  return Array.from({ length: 300 }, (_, i) => ({ file: 'f' + i, mutants: [{ line: i, col: 1 }] }))",
          '}',
          'export function echo(x) { return x }',
          "export const BIG_CONST = 'y'.repeat(5000)",
          ''
        ].join('\n')
      )
      try {
        const results = probeModule(modPath, ['bigArray', 'echo', 'BIG_CONST'])

        expect(results.bigArray.length).toBeLessThanOrEqual(12)
        for (const entry of results.bigArray) {
          expect(entry.output.length).toBeLessThanOrEqual(CAP)
          expect(entry.output).toContain('[shape-summary')
          expect(entry.output).toContain('Array(300) of')
        }

        expect(results.echo.length).toBeLessThanOrEqual(12)
        expect(results.echo.some(e => !e.output.includes('[shape-summary'))).toBe(true)

        expect(results.BIG_CONST.constant.length).toBeLessThanOrEqual(CAP)
        expect(results.BIG_CONST.constant).toContain('[shape-summary')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it(
      'runs the probe child in an empty tmp cwd so relative file reads cannot leak project files',
      { timeout: 30_000 },
      () => {
        const dir = mkdtempSync(join(tmpdir(), 'probe-test-'))
        const modPath = join(dir, 'canary.mjs')
        // package.json існує в cwd тест-процесу (npm/) — якби probe успадковував
        // цю cwd, відносний readFileSync затягнув би вміст файлу проєкту у вихід
        writeFileSync(
          modPath,
          [
            "import { readFileSync } from 'node:fs'",
            'export function readCanary() {',
            "  try { return readFileSync('package.json', 'utf8') } catch { return 'no-canary' }",
            '}',
            ''
          ].join('\n')
        )
        try {
          const results = probeModule(modPath, ['readCanary'])
          expect(results.readCanary.length).toBeGreaterThan(0)
          for (const entry of results.readCanary) {
            expect(entry.output).toBe('"no-canary"')
          }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    )
  })
})
