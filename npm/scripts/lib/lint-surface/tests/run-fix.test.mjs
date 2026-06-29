import { describe, expect, test } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runFixPipeline } from '../run-fix.mjs'
import { withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

/**
 * Detector: violation поки `out.txt` !== 'done'. reason у data.path для worker-а.
 */
const DETECTOR = [
  "import { existsSync, readFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'export function lint(ctx) {',
  "  const p = join(ctx.cwd, 'out.txt')",
  "  const v = existsSync(p) ? readFileSync(p, 'utf8') : ''",
  "  if (v === 'done') return { violations: [] }",
  "  return { violations: [{ reason: 'not-done', message: `out.txt=${v || 'absent'}` }] }",
  '}',
  ''
].join('\n')

/**
 * @param {string} dir
 * @param {string} body
 */
async function seedConcern(dir, body = DETECTOR) {
  const concernDir = join(dir, 'rules', 'probe', 'check')
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), { lint: { scope: 'full', glob: ['**/*'] } })
  await writeFile(join(concernDir, 'main.mjs'), body, 'utf8')
  await writeJson(join(dir, '.n-cursor.json'), { rules: ['probe'] })
  return join(dir, 'rules')
}

/** Ladder з одним фейковим local rung-ом. */
const ONE_RUNG = [{ tier: 'local-min', model: 'fake/min', feedback: false, local: true, isAvg: false, timeoutMs: 1000 }]
const TWO_RUNG = [
  { tier: 'local-min', model: 'fake/min', feedback: false, local: true, isAvg: false, timeoutMs: 1000 },
  { tier: 'cloud-min', model: 'fake/cloud', feedback: true, local: false, isAvg: false, timeoutMs: 1000 }
]

describe('runFixPipeline — базові вердикти', () => {
  test('clean → 0, worker не викликається', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      writeFileSync(join(dir, 'out.txt'), 'done')
      let called = false
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: ONE_RUNG, workerFor: () => () => { called = true } }
      })
      expect(code).toBe(0)
      expect(called).toBe(false)
    })
  })

  test('worker закриває на першому rung → 0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const worker = async (_violations, ctx) => {
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, 'done')
      }
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: ONE_RUNG, workerFor: () => worker }
      })
      expect(code).toBe(0)
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('done')
    })
  })
})

describe('runFixPipeline — T0 permanent', () => {
  test('T0 закриває сам → worker не потрібен', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const t0 = [
        {
          id: 'write-done',
          test: () => true,
          apply: (_v, ctx) => {
            writeFileSync(join(ctx.cwd, 'out.txt'), 'done')
            return { touchedFiles: [join(ctx.cwd, 'out.txt')], message: 'wrote done' }
          }
        }
      ]
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: ONE_RUNG, t0For: () => t0, workerFor: () => () => {} }
      })
      expect(code).toBe(0)
    })
  })

  test('T0-зміни виживають rollback-у при повному провалі worker-а', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      // T0 пише 'partial' (не задовольняє), permanent.
      const t0 = [
        {
          id: 'partial',
          test: () => true,
          apply: (_v, ctx) => {
            writeFileSync(join(ctx.cwd, 'out.txt'), 'partial')
            return { touchedFiles: [join(ctx.cwd, 'out.txt')] }
          }
        }
      ]
      // Worker завжди пише 'wrong' (ніколи не задовольняє) → rollback щораз.
      const worker = async (_v, ctx) => {
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, 'wrong')
      }
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: TWO_RUNG, t0For: () => t0, workerFor: () => worker }
      })
      expect(code).toBe(1)
      // Ключове: rollback цілить у S1 (post-T0='partial'), НЕ у pre-T0 (absent).
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('partial')
    })
  })
})

describe('runFixPipeline — ladder escalation + S1 isolation', () => {
  test('local-min фейлить → cloud-min закриває; rung стартує з S1, не з degraded', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const observed = []
      const worker = async (_v, ctx) => {
        const p = join(ctx.cwd, 'out.txt')
        observed.push({ tier: ctx.tier, before: existsSync(p) ? readFileSync(p, 'utf8') : 'absent' })
        ctx.recordWrite(p)
        writeFileSync(p, ctx.tier === 'cloud-min' ? 'done' : 'degraded')
      }
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: TWO_RUNG, workerFor: () => worker }
      })
      expect(code).toBe(0)
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('done')
      // cloud-min має бачити 'absent' (S1), а не 'degraded' від local-min.
      expect(observed).toEqual([
        { tier: 'local-min', before: 'absent' },
        { tier: 'cloud-min', before: 'absent' }
      ])
    })
  })

  test('feedback від попереднього rung-а передається наступному', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const feedbacks = []
      const worker = async (_v, ctx) => {
        feedbacks.push(ctx.feedback ?? null)
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, ctx.tier === 'cloud-min' ? 'done' : 'x')
      }
      await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {},
        deps: { ladder: TWO_RUNG, workerFor: () => worker }
      })
      expect(feedbacks[0]).toBeNull() // local-min: feedback:false → ctx.feedback undefined → `?? null`
      expect(feedbacks[1]).toMatchObject({ previousModel: 'fake/min' }) // cloud-min: feedback:true
    })
  })
})
