/**
 * Реальний bench-runner для experiment-only tier sampling поверх lint fix ladder.
 *
 * Створює тимчасові git-fixtures, запускає `runAgentFix` через
 * `runTierSamplingExperiment` для local/cloud tier-ів, перевіряє кожен candidate
 * deterministic detector-ом і пише machine-readable JSON із clean/rescue/latency.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { env, exit, stdout } from 'node:process'

import { CLOUD_AVG, CLOUD_MAX, CLOUD_MIN, LOCAL_MIN, isLocalModel } from '@7n/llm-lib/model-tiers'
import { runAgentFix } from '@7n/llm-lib/agent-fix'
import { anchoredEnabled } from './default-worker.mjs'
import {
  buildExperimentLadder,
  runTierSamplingExperiment,
  samplingProfilesForTier
} from './tier-sampling-experiment.mjs'

const DEFAULT_OUT = 'docs/specs/2026-06-30-lint-tier-sampling-consensus-results.json'
const DEFAULT_TIMEOUT_MS = Number(env.N_CURSOR_TIER_BENCH_TIMEOUT_MS) || 180_000

const FIXTURES = [
  {
    id: 'package-script-no-fix',
    description: 'existing package.json script contains forbidden --fix',
    seed(root) {
      writeJson(join(root, 'package.json'), {
        type: 'module',
        scripts: {
          lint: 'eslint --fix src'
        },
        devDependencies: {}
      })
    },
    detect(root) {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      const lint = String(pkg.scripts?.lint ?? '')
      if (!lint.includes('--fix')) return []
      return [
        {
          ruleId: 'bench',
          concernId: 'package_script_no_fix',
          reason: 'forbidden-fix-flag',
          file: 'package.json',
          message: 'package.json scripts.lint must not contain --fix'
        }
      ]
    },
    ruleText(profile) {
      return [
        'У `package.json` поле `scripts.lint` не має містити `--fix`.',
        'Виправ тільки значення `scripts.lint`: прибери `--fix`, лиши команду `eslint src`.',
        profileInstruction(profile)
      ].join('\n')
    }
  },
  {
    id: 'missing-jscpd-config',
    description: 'missing .jscpd.json config must be created exactly',
    seed(root) {
      writeJson(join(root, 'package.json'), { type: 'module' })
      mkdirSync(join(root, 'src'), { recursive: true })
      writeFileSync(join(root, 'src', 'index.mjs'), 'export const value = 1\n')
    },
    detect(root) {
      const configPath = join(root, '.jscpd.json')
      if (!existsSync(configPath)) {
        return [
          {
            ruleId: 'bench',
            concernId: 'missing_jscpd_config',
            reason: 'missing-config',
            file: '.jscpd.json',
            message: '.jscpd.json is missing'
          }
        ]
      }
      let data
      try {
        data = JSON.parse(readFileSync(configPath, 'utf8'))
      } catch {
        return [
          {
            ruleId: 'bench',
            concernId: 'missing_jscpd_config',
            reason: 'invalid-json',
            file: '.jscpd.json',
            message: '.jscpd.json must be valid JSON'
          }
        ]
      }
      const ok =
        data.gitignore === true &&
        data.exitCode === 1 &&
        Array.isArray(data.reporters) &&
        data.reporters.includes('console') &&
        Number(data.minLines) >= 25
      if (ok) return []
      return [
        {
          ruleId: 'bench',
          concernId: 'missing_jscpd_config',
          reason: 'config-mismatch',
          file: '.jscpd.json',
          message: '.jscpd.json must contain gitignore=true, exitCode=1, reporters=[console], minLines>=25'
        }
      ]
    },
    ruleText(profile) {
      return [
        'Створи `.jscpd.json` у корені проєкту.',
        'Файл має бути valid JSON і містити:',
        '{ "gitignore": true, "exitCode": 1, "reporters": ["console"], "minLines": 25 }',
        'Не змінюй інші файли, якщо це не потрібно для цього правила.',
        profileInstruction(profile)
      ].join('\n')
    }
  }
]

/**
 * Запускає повний bench і пише JSON-результат.
 * @param {{ out?: string, tiers?: string[], fixtures?: string[] }} [opts] Фільтри прогону: шлях вихідного файлу, перелік tiers і fixtures.
 * @returns {Promise<object>} Підсумковий об'єкт bench-результату (він же записується у файл out).
 */
export async function runTierSamplingBench(opts = {}) {
  const out = opts.out ?? DEFAULT_OUT
  const wantedTiers = new Set(opts.tiers ?? ['local-min', 'cloud-min', 'cloud-avg', 'cloud-max'])
  const wantedFixtures = new Set(opts.fixtures ?? FIXTURES.map(f => f.id))
  const ladder = buildExperimentLadder({
    localMin: LOCAL_MIN,
    cloudMin: CLOUD_MIN,
    cloudAvg: CLOUD_AVG,
    cloudMax: CLOUD_MAX
  }).filter(r => wantedTiers.has(r.tier))

  const startedAt = new Date().toISOString()
  const result = {
    startedAt,
    finishedAt: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    models: { localMin: LOCAL_MIN, cloudMin: CLOUD_MIN, cloudAvg: CLOUD_AVG, cloudMax: CLOUD_MAX },
    fixtures: [],
    summary: null
  }

  for (const fixture of FIXTURES) {
    if (!wantedFixtures.has(fixture.id)) continue
    for (const rung of ladder) {
      const root = await mkdtemp(join(tmpdir(), `n-cursor-tier-bench-${fixture.id}-${rung.tier}-`))
      try {
        initGitFixture(root, fixture)
        const initialViolations = fixture.detect(root)
        const traceEvents = []
        const candidates = samplingProfilesForTier(rung.tier)
        logProgress({ event: 'start', fixture: fixture.id, tier: rung.tier, model: rung.model, candidates })
        const bench = await runTierSamplingExperiment({
          violations: initialViolations,
          ctx: {
            cwd: root,
            ruleId: 'bench',
            concernId: fixture.id,
            files: undefined,
            feedback: null
          },
          rung,
          candidates,
          worker: async (violations, ctx) => {
            const res = await runAgentFix('bench', renderViolations(violations), root, {
              model: ctx.model,
              tier: ctx.tier,
              timeoutMs: DEFAULT_TIMEOUT_MS,
              ruleText: fixture.ruleText(ctx.samplingProfile),
              feedback: ctx.feedback,
              caller: `tier-bench:${fixture.id}:${ctx.tier}:${ctx.samplingProfile}`,
              recordWrite: ctx.recordWrite,
              // A/B-прапорці Фази A: той самий env-опт-ін, що й у default-worker
              // (N_LLM_FIX_ANCHORED=1|cloud), + verify-loop бенча за N_LLM_FIX_BENCH_VERIFY=1
              // (evidence-гейт A1: фідбек детектора у ту саму сесію).
              anchoredEdits: anchoredEnabled(ctx.model, isLocalModel),
              verify:
                env.N_LLM_FIX_BENCH_VERIFY === '1'
                  ? () => {
                      const current = fixture.detect(root)
                      return { ok: current.length === 0, output: renderViolations(current) }
                    }
                  : undefined,
              deps: {
                selfCheck: () => {
                  const current = fixture.detect(root)
                  return { ok: current.length === 0, violations: current }
                },
                // samplingProfile/candidateId — концепт runner-а, worker про них не знає,
                // тому в trace вони дописуються тут, а не в runAgentFix.
                trace: event => {
                  traceEvents.push({ ...event, samplingProfile: ctx.samplingProfile, candidateId: ctx.candidateId })
                }
              }
            })
            if (res.error) throw new Error(res.error)
            return { touchedFiles: res.touchedFiles, telemetry: res.telemetry }
          },
          detect: () => fixture.detect(root),
          judge: ({ attempts }) => ({
            advice: attempts.map(a => ({ id: a.id, clean: a.clean, error: a.error, violations: a.violations.length }))
          })
        })
        const row = {
          fixture: fixture.id,
          description: fixture.description,
          tier: rung.tier,
          model: rung.model,
          clean: bench.clean,
          selected: bench.selected
            ? {
                id: bench.selected.id,
                samplingProfile: bench.selected.samplingProfile,
                wallMs: bench.selected.wallMs,
                touchedFiles: bench.selected.touchedFiles,
                changedBytes: bench.selected.changedBytes
              }
            : null,
          attempts: bench.attempts.map(a => ({
            id: a.id,
            samplingProfile: a.samplingProfile,
            clean: a.clean,
            wallMs: a.wallMs,
            touchedFiles: a.touchedFiles,
            changedBytes: a.changedBytes,
            error: a.error,
            violations: a.violations.map(v => ({ reason: v.reason, file: v.file, message: v.message })),
            telemetry: summarizeTelemetry(a.telemetry)
          })),
          traceEvents: traceEvents.map(event => summarizeTraceEvent(event)),
          judgeFeedback: bench.judgeFeedback,
          finalViolations: bench.finalViolations.map(v => ({ reason: v.reason, file: v.file, message: v.message }))
        }
        result.fixtures.push(row)
        logProgress({
          event: 'finish',
          fixture: fixture.id,
          tier: rung.tier,
          clean: row.clean,
          selected: row.selected?.samplingProfile ?? null,
          attempts: row.attempts.map(a => ({
            profile: a.samplingProfile,
            clean: a.clean,
            ms: a.wallMs,
            error: a.error
          }))
        })
      } finally {
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }
  }

  result.finishedAt = new Date().toISOString()
  result.summary = summarizeBench(result.fixtures)
  mkdirSync(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

/**
 * Наповнює тимчасовий каталог файлами fixture і ініціалізує в ньому git-репозиторій.
 * @param {string} root Корінь тимчасового каталогу fixture.
 * @param {{ seed: (root: string) => void }} fixture Fixture з функцією seed для наповнення каталогу.
 */
function initGitFixture(root, fixture) {
  fixture.seed(root)
  spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'bench@example.invalid'], { cwd: root, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Bench'], { cwd: root, stdio: 'ignore' })
}

/**
 * Пише дані як pretty-printed JSON, створюючи проміжні каталоги.
 * @param {string} path Шлях до вихідного файлу.
 * @param {object} data Дані для серіалізації.
 */
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * Форматує порушення в текстовий список для промпта агента.
 * @param {import('./types.mjs').LintViolation[]} violations Порушення для рендеру.
 * @returns {string} Markdown-список порушень, по рядку на кожне.
 */
function renderViolations(violations) {
  return violations.map(v => `- ${v.file ?? '(repo)'} [${v.reason}]: ${v.message}`).join('\n')
}

/**
 * Повертає інструкцію промпта для заданого sampling-профілю.
 * @param {string} profile Sampling-профіль кандидата ('conservative' або 'exploratory').
 * @returns {string} Рядок-інструкція для промпта агента.
 */
function profileInstruction(profile) {
  if (profile === 'exploratory') {
    return 'Sampling profile: exploratory. Якщо прямий мінімальний патч не спрацює, спробуй альтернативний підхід, але не змінюй unrelated files.'
  }
  return 'Sampling profile: conservative. Зроби найменший точний patch без unrelated changes.'
}

/**
 * Стискає телеметрію worker-а до компактного зведення для JSON-результату.
 * @param {object|undefined} t Телеметрія спроби від worker-а.
 * @returns {object|null} Зведення (лічильники, usage) або null, якщо телеметрії немає.
 */
function summarizeTelemetry(t) {
  if (!t) return null
  return {
    turnCount: t.turnCount ?? 0,
    toolCallCount: t.toolCallCount ?? 0,
    backstopHit: t.backstopHit === true,
    wallMs: t.wallMs ?? 0,
    edits: Array.isArray(t.edits) ? t.edits.length : 0,
    blocks: Array.isArray(t.blocks) ? t.blocks.length : 0,
    usage: aggregateUsage(Array.isArray(t.turns) ? t.turns.map(turn => turn.usage).filter(Boolean) : [])
  }
}

/**
 * Сумує per-turn usage у загальний usage attempt-а. Попередній прогін брав лише
 * останній turn і недооцінював tokens — final verdict це не міняло, але ламало
 * cost-порівняння між tiers.
 * @param {Array<{ input?: number, output?: number, cacheRead?: number, cacheWrite?: number, totalTokens?: number }>} usages Per-turn usage-записи спроби.
 * @returns {object|null} Сумарний usage по всіх turns або null, якщо записів немає.
 */
function aggregateUsage(usages) {
  if (usages.length === 0) return null
  const sum = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
    turnsCounted: usages.length
  }
  for (const u of usages) {
    sum.input += u.input ?? 0
    sum.output += u.output ?? 0
    sum.cacheRead += u.cacheRead ?? 0
    sum.cacheWrite += u.cacheWrite ?? 0
    sum.totalTokens += u.totalTokens ?? 0
    sum.costTotal += u.cost?.total ?? 0
  }
  return sum
}

/**
 * Вибирає з trace-події лише поля, потрібні для JSON-результату bench-а.
 * @param {object} event Повна trace-подія від runAgentFix.
 * @returns {object} Компактний запис події без важких payload-ів.
 */
function summarizeTraceEvent(event) {
  return {
    caller: event.caller,
    backend: event.backend,
    kind: event.kind,
    rule: event.rule,
    rung: event.rung,
    model: event.model,
    thinkingLevel: event.thinkingLevel ?? null,
    samplingProfile: event.samplingProfile ?? null,
    candidateId: event.candidateId ?? null,
    promptChars: event.promptChars,
    turnCount: event.turnCount,
    toolCallCount: event.toolCallCount,
    touchedFiles: event.touchedFiles,
    backstopHit: event.backstopHit,
    wallMs: event.wallMs,
    error: event.error ?? null
  }
}

/**
 * Агрегує rows у per-tier зведення: clean-rate, clean-attempt-rate, середній час спроби.
 * @param {Array<{ tier: string, clean: boolean, attempts: Array<{ clean: boolean, wallMs: number }> }>} rows Результати всіх пар fixture×tier.
 * @returns {{ byTier: object }} Зведення метрик, згруповане за tier.
 */
function summarizeBench(rows) {
  const byTier = {}
  for (const row of rows) {
    byTier[row.tier] ??= { total: 0, clean: 0, attempts: 0, cleanAttempts: 0, wallMs: 0 }
    const s = byTier[row.tier]
    s.total++
    if (row.clean) s.clean++
    for (const attempt of row.attempts) {
      s.attempts++
      if (attempt.clean) s.cleanAttempts++
      s.wallMs += attempt.wallMs
    }
  }
  for (const s of Object.values(byTier)) {
    s.cleanRate = s.total === 0 ? 0 : s.clean / s.total
    s.cleanAttemptRate = s.attempts === 0 ? 0 : s.cleanAttempts / s.attempts
    s.avgAttemptMs = s.attempts === 0 ? 0 : Math.round(s.wallMs / s.attempts)
  }
  return { byTier }
}

/**
 * Пише прогрес-подію одним JSON-рядком у stdout (NDJSON).
 * @param {object} event Подія прогресу з довільними полями.
 */
function logProgress(event) {
  stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`)
}

/**
 * Розбирає CLI-аргументи bench-а (--out, --tier, --fixture).
 * @param {string[]} argv Аргументи командного рядка без node і шляху скрипта.
 * @returns {{ out?: string, tiers?: string[], fixtures?: string[] }} Опції для runTierSamplingBench.
 */
function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--out': {
        opts.out = argv[++i]
        break
      }
      case '--tier': {
        opts.tiers = [...(opts.tiers ?? []), ...argv[++i].split(',')]
        break
      }
      case '--fixture': {
        opts.fixtures = [...(opts.fixtures ?? []), ...argv[++i].split(',')]
        // No default
        break
      }
    }
  }
  return opts
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runTierSamplingBench(parseArgs(process.argv.slice(2)))
    logProgress({ event: 'summary', summary: result.summary })
    exit(0)
  } catch (error) {
    console.error(error)
    exit(1)
  }
}
