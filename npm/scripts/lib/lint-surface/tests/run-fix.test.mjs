import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

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
  await writeJson(join(dir, '.n-rules.json'), { rules: ['probe'] })
  return join(dir, 'rules')
}

const RE_LOCAL_TIMEOUT = /local-min.*fix timeout 50ms/
const RE_FIX_TIMEOUT = /^fix timeout/

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

/**
 * Worker, що пише 'corrupted' — стан, на якому CRASHING_DETECTOR сам кидає виняток
 * (імітує LLM, що зламав структуру файлу настільки, що детектор не може його розпарсити).
 * @param {unknown} _v Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {void}
 */
function writeCorruptedWorker(_v, ctx) {
  const p = join(ctx.cwd, 'out.txt')
  ctx.recordWrite(p)
  writeFileSync(p, 'corrupted')
}

/**
 * Worker, що закриває детектор і чесно репортує touchedFiles (FixWorkerResult).
 * @param {unknown} _v Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {{ touchedFiles: string[] }} Змінені файли worker-а.
 */
function writeDoneReportingWorker(_v, ctx) {
  const p = join(ctx.cwd, 'out.txt')
  ctx.recordWrite(p)
  writeFileSync(p, 'done')
  return { touchedFiles: [p] }
}

/**
 * Worker, що закриває детектор і повертає telemetry з правками (Фаза C, distillation).
 * @param {unknown} _v Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {{ touchedFiles: string[], telemetry: object }} Результат із телеметрією.
 */
function writeDoneTelemetryWorker(_v, ctx) {
  const p = join(ctx.cwd, 'out.txt')
  ctx.recordWrite(p)
  writeFileSync(p, 'done')
  return {
    touchedFiles: [p],
    telemetry: { edits: [{ path: p, tool: 'edit', edits: [{ oldText: 'absent', newText: 'done' }] }] }
  }
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

  test('ctx.verify (Фаза A1): item-scoped canonical вердикт доступний worker-у, verifyMax заданий', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const seen = { before: null, after: null, verifyMax: null }
      /** @type {import('../types.mjs').FixWorkerFn} */
      const worker = async (_v, ctx) => {
        seen.verifyMax = ctx.verifyMax
        seen.before = await ctx.verify({ touchedFiles: [] })
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, 'done')
        seen.after = await ctx.verify({ touchedFiles: [p] })
      }
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
      expect(seen.before.ok).toBe(false)
      expect(seen.before.output).toContain('not-done')
      expect(seen.after).toEqual({ ok: true, output: expect.any(String) })
      expect(seen.verifyMax).toBe(2) // 'fake/min' не є local-моделлю за env-тирами → cloud-гілка (2)
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

describe('runFixPipeline — MT-tail (гейт = onboarded-репо, fail-open)', () => {
  test('не-MT-репо (нема .mt.json) → жодного mt/ навіть при невиправленому хвості', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, workerFor: () => writeWrongWorker }
      })
      expect(code).toBe(1)
      // Preflight (.mt.json відсутній) → skip; fail-open, verdict не змінюється.
      expect(existsSync(join(dir, 'mt'))).toBe(false)
    })
  })

  test('Фаза C: успішний agentic-фікс пише запис у distillation-стор', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const storeDir = join(dir, 'telemetry-store')
      const prevStore = env.N_LLM_TELEMETRY_DIR
      env.N_LLM_TELEMETRY_DIR = storeDir
      try {
        const code = await runFixPipeline({
          rulesDir,
          cwd: dir,
          full: true,
          log: () => {
            /* no-op logger */
          },
          deps: { ladder: ONE_RUNG, workerFor: () => writeDoneTelemetryWorker }
        })
        expect(code).toBe(0)
        // Запис у глобальному сторі: telemetry/<rule>/open/<sig>.json
        // (ідентичний повтор не створює нового файлу — лише збільшує occurrences).
        const openDir = join(storeDir, 'probe', 'open')
        expect(existsSync(openDir)).toBe(true)
        const files = readdirSync(openDir)
        expect(files).toHaveLength(1)
        const entry = JSON.parse(readFileSync(join(openDir, files[0]), 'utf8'))
        expect(entry).toMatchObject({ rule: 'probe', rung: 'local-min', occurrences: 1, status: 'open' })
        expect(entry.edits[0].edits[0]).toEqual({ oldText: 'absent', newText: 'done' })
      } finally {
        if (prevStore === undefined) delete env.N_LLM_TELEMETRY_DIR
        else env.N_LLM_TELEMETRY_DIR = prevStore
      }
    })
  })

  test('MT-onboarded репо → матеріалізація не міняє verdict (fail-open, exit 1)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      // .mt.json робить репо onboarded; чи MT CLI резолвиться — залежить від оточення,
      // тому перевіряємо лише інваріант fail-open: MT-матеріалізація НІКОЛИ не змінює
      // verdict lint-у (детермінований re-detect лишається джерелом правди).
      await writeJson(join(dir, '.mt.json'), { mt_dir: './mt' })
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, workerFor: () => writeWrongWorker }
      })
      expect(code).toBe(1)
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

  test('worker лишає файл невалідним (canonical re-detect сам кидає) → snapshot.rollback() відновлює S1 перед перекиданням винятку', async () => {
    // Реальний інцидент: слабка локальна модель зіпсувала структуру YAML (видалила
    // ключ containers:, лишила його список "висячим" під іншим ключем) — детектор
    // (rego/conftest) не міг розпарсити файл і кидав виняток. Без rollback тут
    // зіпсований проміжний стан worker-а лишався б на диску назавжди: виняток
    // абортує весь прогін, і звичайний rollback-код (для "не чисто") не встигає
    // виконатись.
    const CRASHING_DETECTOR = [
      "import { existsSync, readFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      'export function lint(ctx) {',
      "  const p = join(ctx.cwd, 'out.txt')",
      "  const v = existsSync(p) ? readFileSync(p, 'utf8') : ''",
      "  if (v === 'corrupted') throw new Error('parse crash: невалідна структура')",
      "  if (v === 'done') return { violations: [] }",
      "  return { violations: [{ reason: 'not-done', message: 'out.txt=' + (v || 'absent') }] }",
      '}',
      ''
    ].join('\n')

    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, CRASHING_DETECTOR)

      await expect(
        runFixPipeline({
          rulesDir,
          cwd: dir,
          full: true,
          log: () => {
            /* no-op logger */
          },
          deps: { ladder: ONE_RUNG, workerFor: () => writeCorruptedWorker }
        })
      ).rejects.toThrow('parse crash')

      // S1 (файл був відсутній до worker-а) відновлено, а не лишено 'corrupted'.
      expect(existsSync(join(dir, 'out.txt'))).toBe(false)
    })
  })
})

describe('runFixPipeline — per-tier timeout (ADR 260620-0556)', () => {
  test('worker, що ніколи не резолвиться → fix timeout, ladder іде далі; ctx несе rung.timeoutMs', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const seen = []
      // Малі таймаути, щоб backstop (×1.25) спрацював швидко: 40ms → 50ms.
      const ladder = [
        { tier: 'local-min', model: 'fake/min', feedback: false, local: true, isAvg: false, timeoutMs: 40 },
        { tier: 'cloud-min', model: 'fake/cloud', feedback: true, local: false, isAvg: false, timeoutMs: 40 }
      ]
      const worker = (_v, ctx) => {
        seen.push({ tier: ctx.tier, timeoutMs: ctx.timeoutMs, feedback: ctx.feedback ?? null })
        // Модель зависшої cloud-SSE: promise без resolve/reject (спостережено live —
        // ESTABLISHED TCP, lint висів 1г41хв). Без backstop-гонки ladder стояла б вічно.
        if (ctx.tier === 'local-min') return Promise.race([])
        const p = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(p)
        writeFileSync(p, 'done')
      }
      const logs = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: s => {
          logs.push(s)
        },
        deps: { ladder, workerFor: () => worker }
      })
      expect(code).toBe(0)
      // rung.timeoutMs прокинуто у FixContext — шлях default-worker → runAgentFix opts.timeoutMs.
      expect(seen[0]).toMatchObject({ tier: 'local-min', timeoutMs: 40 })
      // Backstop обірвав зависший rung timeout-помилкою — outcome fail, не вічне очікування.
      expect(logs.join('')).toMatch(RE_LOCAL_TIMEOUT)
      // Timeout-помилка стала feedback-ом наступного rung-а, і ladder закрила concern.
      expect(seen[1].feedback).toMatchObject({ previousModel: 'fake/min' })
      expect(seen[1].feedback.previousError).toMatch(RE_FIX_TIMEOUT)
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
 * Worker, що фіксує rung.tier у переданий масив і закриває детектор ('done').
 * @param {string[]} seenTiers Акумулятор tier-ів у порядку виклику worker-а.
 * @returns {(v: unknown, ctx: object) => void} Worker для `deps.workerFor`.
 */
function tierRecordingDoneWorker(seenTiers) {
  return (_v, ctx) => {
    seenTiers.push(ctx.tier)
    const p = join(ctx.cwd, 'out.txt')
    ctx.recordWrite(p)
    writeFileSync(p, 'done')
  }
}

describe('runFixPipeline — skipLocalTier (concern-meta)', () => {
  test('skipLocalTier: true → local-min/local-min-retry пропущено, ladder стартує з cloud-min', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, DETECTOR, { skipLocalTier: true })
      const seenTiers = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: TWO_RUNG, workerFor: () => tierRecordingDoneWorker(seenTiers) }
      })
      expect(code).toBe(0)
      expect(seenTiers).toEqual(['cloud-min']) // local-min з ladder-а жодного разу не викликаний
    })
  })

  test('skipLocalTier: false (дефолт) → ladder іде з local-min, як звичайно', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir) // без skipLocalTier
      const seenTiers = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: TWO_RUNG, workerFor: () => tierRecordingDoneWorker(seenTiers) }
      })
      expect(code).toBe(0)
      expect(seenTiers[0]).toBe('local-min')
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

/**
 * Detector як DETECTOR, але з file-атрибуцією порушення (`file: 'target.txt'`) —
 * вмикає semantic-collateral veto (без file target-set порожній і veto незастосовний).
 */
const TARGETED_DETECTOR = [
  "import { existsSync, readFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'export function lint(ctx) {',
  "  const p = join(ctx.cwd, 'target.txt')",
  "  const v = existsSync(p) ? readFileSync(p, 'utf8') : ''",
  "  if (v === 'done') return { violations: [] }",
  "  return { violations: [{ reason: 'not-done', message: 'target.txt=' + (v || 'absent'), file: 'target.txt' }] }",
  '}',
  ''
].join('\n')

/**
 * Фікстура «App.vue collateral» (spec pi-fix-engine-migration §12, addendum 2026-07-05):
 * реальний кейс — gemma-4b «виправила» правило в consumer-репо, захардкодивши версію
 * замість виклику getVersion у сторонньому src/App.vue.
 */
const APP_VUE_ORIGINAL = [
  '<script setup>',
  "import { getVersion } from '@tauri-apps/api/app'",
  "const appVersion = ref('')",
  'appVersion.value = await getVersion()',
  '</script>',
  ''
].join('\n')

const APP_VUE_HARDCODED = [
  '<script setup>',
  "const appVersion = ref('')",
  "appVersion.value = '0.3.0' // we simulate it being available",
  '</script>',
  ''
].join('\n')

/**
 * Worker, що закриває порушення у target.txt і додатково СТВОРЮЄ новий файл поза
 * target-set — легітимний клас (scaffold/доки), який veto пропускає.
 * @param {unknown} _v Порушення (не використовуються).
 * @param {object} ctx Контекст fix-а з `cwd` і `recordWrite`.
 * @returns {void}
 */
function writeTargetPlusScaffoldWorker(_v, ctx) {
  const target = join(ctx.cwd, 'target.txt')
  ctx.recordWrite(target)
  writeFileSync(target, 'done')
  const scaffold = join(ctx.cwd, 'docs-note.md')
  ctx.recordWrite(scaffold)
  writeFileSync(scaffold, 'новий файл — легітимний scaffold')
}

describe('runFixPipeline — semantic-collateral veto (App.vue case, §12 addendum)', () => {
  test('правка наявного файлу поза target-set → veto, rollback, ескалація; телеметрія collateral-veto', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, TARGETED_DETECTOR)
      const appVue = join(dir, 'src', 'App.vue')
      await mkdir(join(dir, 'src'), { recursive: true })
      writeFileSync(appVue, APP_VUE_ORIGINAL)

      const tracePath = join(dir, 'llm-trace.jsonl')
      const prevTrace = env.N_LLM_TRACE_PATH
      env.N_LLM_TRACE_PATH = tracePath
      try {
        const feedbacks = []
        const worker = (_v, ctx) => {
          feedbacks.push(ctx.feedback ?? null)
          const target = join(ctx.cwd, 'target.txt')
          ctx.recordWrite(target)
          writeFileSync(target, 'done')
          if (ctx.tier === 'local-min') {
            // Слабка модель «заодно» хардкодить версію у сторонньому наявному файлі.
            ctx.recordWrite(appVue)
            writeFileSync(appVue, APP_VUE_HARDCODED)
          }
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
        // Порушення закрито cloud-rung-ом, а collateral local-rung-а відкочено.
        expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('done')
        expect(readFileSync(appVue, 'utf8')).toBe(APP_VUE_ORIGINAL)
        // Feedback наступному rung-у пояснює причину відхилення.
        expect(feedbacks[1]?.previousError).toContain('відхилено')
        expect(feedbacks[1]?.previousError).toContain('App.vue')
        // Телеметрія відхилених правок у llm-trace.
        const traceLines = readFileSync(tracePath, 'utf8')
          .trim()
          .split('\n')
          .map(l => JSON.parse(l))
        const veto = traceLines.find(r => r.kind === 'collateral-veto')
        expect(veto).toMatchObject({ rule: 'probe', rung: 'local-min', cleanDetect: true })
        expect(veto.rejectedFiles).toEqual(['src/App.vue'])
        expect(veto.targetFiles).toEqual(['target.txt'])
      } finally {
        if (prevTrace === undefined) delete env.N_LLM_TRACE_PATH
        else env.N_LLM_TRACE_PATH = prevTrace
      }
    })
  })

  test('створення НОВОГО файлу поза target-set дозволене → закривається першим rung-ом', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, TARGETED_DETECTOR)
      const worker = writeTargetPlusScaffoldWorker
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
      expect(existsSync(join(dir, 'docs-note.md'))).toBe(true)
    })
  })

  test('без file-атрибуції порушення target-set порожній → veto незастосовний (fail-open)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir) // DETECTOR без `file` у violation
      const unrelated = join(dir, 'unrelated.txt')
      writeFileSync(unrelated, 'original')
      const worker = (_v, ctx) => {
        const out = join(ctx.cwd, 'out.txt')
        ctx.recordWrite(out)
        writeFileSync(out, 'done')
        ctx.recordWrite(unrelated)
        writeFileSync(unrelated, 'collateral')
      }
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, workerFor: () => worker }
      })
      // Свідомий fail-open: без target-set veto не втручається.
      expect(code).toBe(0)
      expect(readFileSync(unrelated, 'utf8')).toBe('collateral')
    })
  })
})

/**
 * Detector «doc-беклог»: порушення на кожен відсутній docs/{a,b}.md — модель
 * doc-files-worker-а, де кожен файл — самодостатній кінцевий стан (issue #16).
 */
const DOCS_BACKLOG_DETECTOR = [
  "import { existsSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'export function lint(ctx) {',
  '  const violations = []',
  "  for (const f of ['docs/a.md', 'docs/b.md']) {",
  '    if (!existsSync(join(ctx.cwd, f)))',
  "      violations.push({ reason: 'missing', message: f + ' відсутня', file: f })",
  '  }',
  '  return { violations }',
  '}',
  ''
].join('\n')

/**
 * Worker-модель issue #16 для timeout-кейсу: local-min устигає одну durable-доку
 * й зависає (батч довший за таймаут рунга); cloud-min durable-дописує решту.
 * @param {Array<{file: string}>} violations Порушення (залишок doc-черги).
 * @param {object} ctx Контекст fix-а з `cwd`, `tier` і `recordDurableWrite`.
 * @returns {Promise<never>|void} local-min — вічний pending; інакше void.
 */
function durableOneThenHangWorker(violations, ctx) {
  if (ctx.tier === 'local-min') {
    const abs = join(ctx.cwd, 'docs', 'a.md')
    ctx.recordDurableWrite(abs)
    writeFileSync(abs, '# дока\n')
    return Promise.race([])
  }
  for (const v of violations) {
    const abs = join(ctx.cwd, v.file)
    ctx.recordDurableWrite(abs)
    writeFileSync(abs, '# дока\n')
  }
}

describe('runFixPipeline — durable-write worker (issue #16: doc-черга не стирається)', () => {
  test('часткова робота durable-worker-а переживає rollback; наступний rung продовжує з решти', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, DOCS_BACKLOG_DETECTOR)
      await mkdir(join(dir, 'docs'), { recursive: true })
      const seen = []
      // Кожен rung устигає рівно ОДНУ доку з черги (як batch під м'яким дедлайном).
      const worker = (violations, ctx) => {
        seen.push(violations.map(v => v.file))
        const next = violations[0]
        const abs = join(ctx.cwd, next.file)
        ctx.recordDurableWrite(abs)
        writeFileSync(abs, '# дока\n')
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
      // Прогрес по файлах: rung 1 бачив увесь беклог, rung 2 — лише залишок.
      expect(seen).toEqual([['docs/a.md', 'docs/b.md'], ['docs/b.md']])
      expect(existsSync(join(dir, 'docs', 'a.md'))).toBe(true)
      expect(existsSync(join(dir, 'docs', 'b.md'))).toBe(true)
    })
  })

  test('fix timeout посеред doc-черги: записані durable-доки лишаються, ескалація закриває решту', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir, DOCS_BACKLOG_DETECTOR)
      await mkdir(join(dir, 'docs'), { recursive: true })
      const ladder = [
        { tier: 'local-min', model: 'fake/min', feedback: false, local: true, isAvg: false, timeoutMs: 40 },
        { tier: 'cloud-min', model: 'fake/cloud', feedback: true, local: false, isAvg: false, timeoutMs: 1000 }
      ]
      const worker = durableOneThenHangWorker
      const logs = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: s => {
          logs.push(s)
        },
        deps: { ladder, workerFor: () => worker }
      })
      expect(code).toBe(0)
      expect(logs.join('')).toMatch(RE_LOCAL_TIMEOUT)
      // Ключове (issue #16): дока, записана ДО таймауту, НЕ стерта rollback-ом.
      expect(readFileSync(join(dir, 'docs', 'a.md'), 'utf8')).toBe('# дока\n')
      expect(existsSync(join(dir, 'docs', 'b.md'))).toBe(true)
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
        log: s => {
          lines.push(s)
        },
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
        log: s => {
          lines.push(s)
        },
        deps: {
          ladder: ONE_RUNG,
          workerFor: () => () => {
            /* no-op worker */
          }
        }
      })
      expect(code).toBe(0)
      const ticker = lines.find(l => l.includes('⏱'))
      expect(ticker).toContain('1/1 концернів')
      expect(ticker).toContain('знайдено 0')
    })
  })
})

/**
 * Фабрика фейкових chain-handle-ів: збирає end()-payload-и у sink для асертів.
 * @param {object[]} sink Масив, куди складаються фінальні записи ланцюжків.
 * @returns {(args: { kind: string, unit: string, cwd?: string }) => object} chainFactory для deps.
 */
function captureChainFactory(sink) {
  return ({ kind, unit, cwd }) => ({
    id: 'test-chain',
    kind,
    unit,
    cwd: cwd ?? null,
    nextStep: () => 1,
    note: () => {
      /* no-op акумуляція */
    },
    headers: () => ({}),
    traceFields: () => ({ chainId: 'test-chain', chainKind: kind, chainUnit: unit, chainStep: 1 }),
    end(args) {
      sink.push({ kind, unit, cwd: cwd ?? null, ...args })
      return args
    }
  })
}

describe('runFixPipeline — телеметрія ланцюжка (problem/resolvedBy/touchedFiles)', () => {
  test('T0 закриває: resolvedBy=t0, t0Applied, touchedFiles cwd-relative, problem зі стартового detect', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const ends = []
      const t0 = [
        {
          id: 'write-done',
          test: () => true,
          apply: (_v, ctx) => {
            const p = join(ctx.cwd, 'out.txt')
            writeFileSync(p, 'done')
            return { touchedFiles: [p], message: 'out.txt → done' }
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
          },
          chainFactory: captureChainFactory(ends)
        }
      })
      expect(code).toBe(0)
      expect(ends).toHaveLength(1)
      expect(ends[0].outcome).toBe('success')
      expect(ends[0].extra.t0Closed).toBe(true)
      expect(ends[0].extra.resolvedBy).toBe('t0')
      expect(ends[0].extra.t0Applied).toEqual([{ id: 'write-done', message: 'out.txt → done' }])
      expect(ends[0].extra.touchedFiles).toEqual(['out.txt'])
      expect(ends[0].extra.touchedTotal).toBe(1)
      expect(ends[0].extra.problem).toMatchObject({ violations: 1, reasons: ['not-done'] })
      expect(ends[0].extra.problem.sample).toContain('out.txt=absent')
    })
  })

  test('worker закриває: resolvedBy=tier:model, touchedFiles closing rung-а', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const ends = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, workerFor: () => writeDoneReportingWorker, chainFactory: captureChainFactory(ends) }
      })
      expect(code).toBe(0)
      expect(ends).toHaveLength(1)
      expect(ends[0].outcome).toBe('success')
      expect(ends[0].extra.resolvedBy).toBe('local-min:fake/min')
      expect(ends[0].extra.touchedFiles).toEqual(['out.txt'])
      expect(ends[0].extra.problem).toMatchObject({ violations: 1 })
    })
  })

  test('провал ladder-а: resolvedBy=null, touchedFiles порожні (правки rollback-нуто)', async () => {
    await withTmpDir(async dir => {
      const rulesDir = await seedConcern(dir)
      const ends = []
      const code = await runFixPipeline({
        rulesDir,
        cwd: dir,
        full: true,
        log: () => {
          /* no-op logger */
        },
        deps: { ladder: ONE_RUNG, workerFor: () => writeWrongWorker, chainFactory: captureChainFactory(ends) }
      })
      expect(code).toBe(1)
      expect(ends).toHaveLength(1)
      expect(ends[0].outcome).toBe('fail')
      expect(ends[0].extra.resolvedBy).toBeNull()
      expect(ends[0].extra.touchedFiles).toEqual([])
      expect(ends[0].extra.touchedTotal).toBe(0)
      expect(ends[0].extra.problem).toMatchObject({ violations: 1, reasons: ['not-done'] })
    })
  })
})
