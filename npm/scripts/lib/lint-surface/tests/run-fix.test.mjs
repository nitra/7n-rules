import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
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
  "  return { violations: [{ reason: 'not-done', message: 'out.txt=' + (v || 'absent') }] }",
  '}',
  ''
].join('\n')

/**
 * Створює тестовий concern-detector у тимчасовій теці.
 * @param {string} dir Корінь тимчасової теки.
 * @param {string} body Вихідний код `main.mjs` детектора.
 * @param {object} [concernExtra] Додаткові поля concern.json (напр. `{ fixability: 'structural' }`).
 * @returns {Promise<string>} Абсолютний шлях до теки `rules`.
 */
async function seedConcern(dir, body = DETECTOR, concernExtra = {}) {
  const concernDir = join(dir, 'rules', 'probe', 'check')
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), { lint: { scope: 'full', glob: ['**/*'] }, ...concernExtra })
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

/**
 * Worker, що записує 'done' у out.txt (закриває детектор на першому rung-у).
 * @param {unknown} _violations Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {void}
 */
function writeDoneWorker(_violations, ctx) {
  const p = join(ctx.cwd, 'out.txt')
  ctx.recordWrite(p)
  writeFileSync(p, 'done')
}

/**
 * Worker, що завжди пише 'wrong' (ніколи не задовольняє детектор → rollback щораз).
 * @param {unknown} _v Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {void}
 */
function writeWrongWorker(_v, ctx) {
  const p = join(ctx.cwd, 'out.txt')
  ctx.recordWrite(p)
  writeFileSync(p, 'wrong')
}

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
        log: () => {
          /* no-op logger */
        },
        deps: {
          ladder: ONE_RUNG,
          workerFor: () => () => {
            called = true
          }
        }
      })
      expect(code).toBe(0)
      expect(called).toBe(false)
    })
  })

  test('worker закриває на першому rung → 0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const worker = writeDoneWorker
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
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
        log: () => {
          /* no-op logger */
        },
        deps: {
          ladder: ONE_RUNG,
          t0For: () => t0,
          workerFor: () => () => {
            /* no-op worker */
          }
        }
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
      const worker = writeWrongWorker
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
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
      const worker = (_v, ctx) => {
        const p = join(ctx.cwd, 'out.txt')
        observed.push({ tier: ctx.tier, before: existsSync(p) ? readFileSync(p, 'utf8') : 'absent' })
        ctx.recordWrite(p)
        writeFileSync(p, ctx.tier === 'cloud-min' ? 'done' : 'degraded')
      }
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
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
      const worker = (_v, ctx) => {
        feedbacks.push(ctx.feedback ?? null)
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, ctx.tier === 'cloud-min' ? 'done' : 'x')
      }
      await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: TWO_RUNG, workerFor: () => worker }
      })
      expect(feedbacks[0]).toBeNull() // local-min: feedback:false → ctx.feedback undefined → `?? null`
      expect(feedbacks[1]).toMatchObject({ previousModel: 'fake/min' }) // cloud-min: feedback:true
    })
  })
})

describe('runFixPipeline — fixability gate', () => {
  test('fixability=structural → LLM-ladder пропущено, worker не викликається, порушення лишається', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, DETECTOR, { fixability: 'structural' })
      // out.txt відсутній → детектор порушено; worker закрив би, але gate не має його викликати.
      let called = false
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: {
          ladder: ONE_RUNG,
          workerFor: () => (v, ctx) => {
            called = true
            writeDoneWorker(v, ctx)
          }
        }
      })
      expect(called).toBe(false)
      expect(code).toBe(1)
    })
  })

  test('fixability=code (дефолт) → gate пропускає, worker відпрацьовує як звичайно', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir) // без fixability → code
      let called = false
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: {
          ladder: ONE_RUNG,
          workerFor: () => (v, ctx) => {
            called = true
            writeDoneWorker(v, ctx)
          }
        }
      })
      expect(called).toBe(true)
      expect(code).toBe(0)
    })
  })
})

/**
 * Детектор, що рахує власні виклики у `detect-calls.txt` (по одному символу за виклик) —
 * дозволяє перевірити, скільки разів реально викликано `lint()` за весь fix-прогін.
 */
const COUNTING_DETECTOR = [
  "import { existsSync, readFileSync, appendFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'export function lint(ctx) {',
  "  appendFileSync(join(ctx.cwd, 'detect-calls.txt'), 'x')",
  "  const p = join(ctx.cwd, 'out.txt')",
  "  const v = existsSync(p) ? readFileSync(p, 'utf8') : ''",
  "  if (v === 'done') return { violations: [] }",
  "  return { violations: [{ reason: 'not-done', message: 'out.txt=' + (v || 'absent') }] }",
  '}',
  ''
].join('\n')

/**
 * @param {string} dir Корінь тимчасової теки.
 * @returns {number} к-сть символів у `detect-calls.txt` (= к-сть викликів `lint()`), 0 якщо файл відсутній.
 */
function detectCallCount(dir) {
  const p = join(dir, 'detect-calls.txt')
  return existsSync(p) ? readFileSync(p, 'utf8').length : 0
}

describe('runFixPipeline — standalone T0 (§8 Phase 2: merge detect+fix)', () => {
  test('standalone: apply без початкового detect — лише 1 виклик lint() (post-T0 re-detect)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, COUNTING_DETECTOR)
      const t0 = [
        {
          id: 'standalone-write-done',
          standalone: true,
          test: () => false, // навмисно false — доводить, що test() ігнорується для standalone
          apply: (_v, ctx) => {
            writeFileSync(join(ctx.cwd, 'out.txt'), 'done')
            return { touchedFiles: [join(ctx.cwd, 'out.txt')], message: 'standalone wrote done' }
          }
        }
      ]
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, t0For: () => t0 }
      })
      expect(code).toBe(0)
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('done')
      expect(detectCallCount(dir)).toBe(1) // лише post-T0 re-detect, без початкового detect
    })
  })

  test('еквівалентний non-standalone T0 (той самий concern) — 2 виклики lint() (detect + re-detect)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, COUNTING_DETECTOR)
      const t0 = [
        {
          id: 'normal-write-done',
          test: violations => violations.some(v => v.reason === 'not-done'),
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
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, t0For: () => t0 }
      })
      expect(code).toBe(0)
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('done')
      expect(detectCallCount(dir)).toBe(2) // початковий detect (виявляє not-done) + post-T0 re-detect
    })
  })

  test('standalone на вже чистому concern — apply-noop, 1 виклик lint(), code=0', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, COUNTING_DETECTOR)
      writeFileSync(join(dir, 'out.txt'), 'done')
      let applyCalled = false
      const t0 = [
        {
          id: 'standalone-noop',
          standalone: true,
          test: () => false,
          apply: () => {
            applyCalled = true
            return { touchedFiles: [] } // ідемпотентний no-op на вже чистому файлі
          }
        }
      ]
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, t0For: () => t0 }
      })
      expect(code).toBe(0)
      expect(applyCalled).toBe(true) // apply() викликається безумовно (ідемпотентно), навіть на чистому concern-і
      expect(detectCallCount(dir)).toBe(1)
    })
  })

  test('мішаний набір (standalone + звичайний патерн) — НЕ standalone, початковий detect лишається', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, COUNTING_DETECTOR)
      const t0 = [
        { id: 'standalone-one', standalone: true, test: () => false, apply: () => ({ touchedFiles: [] }) },
        {
          id: 'normal-two',
          test: violations => violations.some(v => v.reason === 'not-done'),
          apply: (_v, ctx) => {
            writeFileSync(join(ctx.cwd, 'out.txt'), 'done')
            return { touchedFiles: [join(ctx.cwd, 'out.txt')] }
          }
        }
      ]
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, t0For: () => t0 }
      })
      expect(code).toBe(0)
      expect(detectCallCount(dir)).toBe(2) // мішаний набір → не standalone-eligible, звичайний потік
    })
  })
})

describe('runFixPipeline — ProgressReporter (spec 2026-07-03)', () => {
  test('не-TTY: ⏱-зведення на закриття концерну з тикером знайдено/виправлено', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const lines = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        isTTY: false,
        log: s => lines.push(s),
        deps: { ladder: ONE_RUNG, workerFor: () => writeDoneWorker }
      })
      expect(code).toBe(0)
      const ticker = lines.find(l => l.includes('⏱'))
      expect(ticker).toContain('1/1 концернів')
      expect(ticker).toContain('знайдено 1')
      expect(ticker).toContain('виправлено 1')
    })
  })

  test('не-TTY: чистий концерн — ⏱ 1/1 без порушень', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      writeFileSync(join(dir, 'out.txt'), 'done')
      const lines = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        isTTY: false,
        log: s => lines.push(s),
        deps: { ladder: ONE_RUNG, workerFor: () => () => {} }
      })
      expect(code).toBe(0)
      const ticker = lines.find(l => l.includes('⏱'))
      expect(ticker).toContain('1/1 концернів')
      expect(ticker).toContain('знайдено 0')
    })
  })
})
