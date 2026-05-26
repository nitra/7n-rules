#!/usr/bin/env bun
/**
 * Spike-бенчмарк: вимірює тривалість Stryker-прогону для двох runner-конфігурацій
 * і за бажанням — incremental прогін (другий запуск без змін).
 *
 * Usage:
 *   bun run.mjs                                # усі 3 сценарії
 *   bun run.mjs --scenario=full-bun
 *   bun run.mjs --scenario=full-vitest
 *   bun run.mjs --scenario=incremental-vitest-noop
 */
import console from 'node:console'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import bunStrykerConfig from './demo/stryker.bun.config.mjs'
import vitestStrykerConfig from './demo/stryker.vitest.config.mjs'
import vitestConfig from './demo/vitest.config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEMO = join(HERE, 'demo')
const RESULTS = join(HERE, 'results')
const REPORTS = join(DEMO, 'reports')

const SCENARIOS = {
  'full-bun': {
    config: 'stryker.bun.config.mjs',
    cleanReports: true,
    incrementalFile: 'incremental-bun.json',
    testRunner: bunStrykerConfig.testRunner
  },
  'full-vitest': {
    config: 'stryker.vitest.config.mjs',
    cleanReports: true,
    incrementalFile: 'incremental-vitest.json',
    testRunner: vitestStrykerConfig.testRunner,
    vitestEnvironment: vitestConfig.test.environment
  },
  'incremental-vitest-noop': {
    config: 'stryker.vitest.config.mjs',
    cleanReports: false,
    incrementalFile: 'incremental-vitest.json',
    testRunner: vitestStrykerConfig.testRunner,
    vitestEnvironment: vitestConfig.test.environment
  }
}

const argv = process.argv.slice(2)
const scenarioArg = argv.find(a => a.startsWith('--scenario='))?.split('=')[1]
const list = scenarioArg ? [scenarioArg] : ['full-bun', 'full-vitest', 'incremental-vitest-noop']

mkdirSync(RESULTS, { recursive: true })

const summary = []
for (const name of list) {
  const cfg = SCENARIOS[name]
  if (!cfg) {
    console.error(`Unknown scenario: ${name}`)
    process.exit(2)
  }

  if (cfg.cleanReports && existsSync(REPORTS)) rmSync(REPORTS, { recursive: true, force: true })

  if (summary.length > 0) await sleep(2000)

  console.log(`\n=== ${name} ===`)
  const ts = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const logPath = join(RESULTS, `${name}-${ts}.log`)

  const t0 = performance.now()
  const proc = spawnSync('bunx', ['stryker', 'run', cfg.config], {
    cwd: DEMO,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' }
  })
  const durationMs = Math.round(performance.now() - t0)
  writeFileSync(logPath, (proc.stdout ?? '') + '\n---STDERR---\n' + (proc.stderr ?? ''))

  if (proc.status !== 0) {
    console.error(`✗ ${name}: stryker exit ${proc.status}, log: ${logPath}`)
    summary.push({ scenario: name, durationMs, error: `exit ${proc.status}`, logPath })
    continue
  }

  const mutationPath = join(REPORTS, 'stryker', 'mutation.json')
  if (!existsSync(mutationPath)) {
    console.error(`✗ ${name}: no mutation.json at ${mutationPath}`)
    summary.push({ scenario: name, durationMs, error: 'no mutation.json', logPath })
    continue
  }
  const report = JSON.parse(readFileSync(mutationPath, 'utf8'))
  let killed = 0,
    noCoverage = 0,
    survived = 0,
    timeout = 0
  for (const file of Object.values(report.files ?? {})) {
    for (const m of file.mutants ?? []) {
      switch (m.status) {
        case 'Killed': {
          killed++
          break
        }
        case 'Survived': {
          survived++
          break
        }
        case 'Timeout': {
          timeout++
          break
        }
        case 'NoCoverage': {
          noCoverage++
          break
        }
        // No default
      }
    }
  }
  const total = killed + survived + timeout + noCoverage
  const score = total > 0 ? Math.round((1000 * (killed + timeout)) / total) / 10 : 0

  const result = {
    scenario: name,
    durationMs,
    testRunner: cfg.testRunner,
    totalMutants: total,
    killed,
    survived,
    timeout,
    noCoverage,
    score,
    versions: {
      node: process.versions.node,
      bun: process.versions.bun ?? null
    },
    logPath
  }
  writeFileSync(join(RESULTS, `${name}-${ts}.json`), JSON.stringify(result, null, 2))
  console.log(`✓ ${name}: ${durationMs}ms, ${total} mutants, score ${score}%`)
  summary.push(result)
}

const bunFull = summary.find(s => s.scenario === 'full-bun')
const vitFull = summary.find(s => s.scenario === 'full-vitest')
const vitNoop = summary.find(s => s.scenario === 'incremental-vitest-noop')
const baseline = bunFull?.durationMs ?? null

const speedup = s => (baseline && s?.durationMs ? `${(baseline / s.durationMs).toFixed(2)}×` : 'n/a')
const fmt = s =>
  s?.error
    ? `| ${s.scenario} | — | ERROR (${s.error}) | — | — |`
    : `| ${s.scenario} | ${s?.totalMutants ?? '—'} | ${((s?.durationMs ?? 0) / 1000).toFixed(1)}s | ${s?.score ?? '—'}% | ${speedup(s)} |`

const md = [
  '# Vitest Runner Spike — Results',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Numbers',
  '',
  '| Сценарій | Мутантів | Час | Score | Speedup vs full-bun |',
  '| --- | --- | --- | --- | --- |',
  fmt(bunFull),
  fmt(vitFull),
  fmt(vitNoop),
  '',
  '## Environment',
  '',
  `- Node: ${process.versions.node}`,
  `- Bun: ${process.versions.bun ?? 'n/a'}`,
  '',
  '## Decision criteria',
  '',
  '- **Strong win** (рекомендую міграцію): `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest`',
  '- **Marginal**: 0.5×–0.8× → треба `touch-1-source` сценарій',
  '- **No win**: > 0.8× → не мігруємо',
  '',
  '## Reproduce',
  '',
  '```bash',
  'cd benchmarks/runner-comparison && bun run.mjs',
  '```',
  ''
].join('\n')
writeFileSync(join(HERE, 'SPIKE.md'), md)
console.log(`\n→ SPIKE.md updated`)
