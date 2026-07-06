#!/usr/bin/env node
/** @see ../lib/docs/chains-report.md */

/**
 * CLI-звіт по ланцюжках LLM-викликів: `n-llm-chains-report [--since <ISO>]`.
 * Читає глобальний trace (`tracePath()`), друкує per-kind/per-rule агрегати
 * і топ кандидатів на T0-дистиляцію.
 */
import { readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'
import { tracePath } from '../lib/trace.mjs'
import { buildChainsReport, parseTraceJsonl } from '../lib/chains-report.mjs'

const sinceIdx = argv.indexOf('--since')
const sinceTs = sinceIdx === -1 ? undefined : argv[sinceIdx + 1]
const path = tracePath()

let text
try {
  text = readFileSync(path, 'utf8')
} catch {
  console.log(`trace не знайдено: ${path}`)
  exit(0)
}

const report = buildChainsReport(parseTraceJsonl(text), { sinceTs })

/**
 * Друк секції-таблиці бакетів.
 * @param {string} title заголовок секції
 * @param {Record<string, object>} buckets kind → бакет
 * @returns {void}
 */
function printBuckets(title, buckets) {
  const keys = Object.keys(buckets)
  if (keys.length === 0) return
  console.log(`\n## ${title}`)
  console.log('kind/rule                    chains  ok  part fail esc%  avgSteps  cloudCalls  cloudTokens')
  for (const k of keys.toSorted()) {
    const b = buckets[k]
    console.log(
      `${k.padEnd(28)} ${String(b.chains).padStart(6)} ${String(b.success).padStart(3)} ${String(b.partial).padStart(4)} ${String(b.fail).padStart(4)} ${(b.escalationRate * 100).toFixed(0).padStart(4)} ${b.avgSteps.toFixed(1).padStart(9)} ${String(b.cloudCalls).padStart(11)} ${String(b.cloudTokens).padStart(12)}`
    )
  }
}

const sinceSuffix = sinceTs ? ` (з ${sinceTs})` : ''
console.log(`# Chains report — ${path}${sinceSuffix}`)
console.log(
  `Разом: ${report.totals.chains} ланцюжків, cloud-викликів ${report.totals.cloudCalls}, cloud-токенів ${report.totals.cloudTokens}`
)
printBuckets('Per kind', report.perKind)
printBuckets('Per rule (fix-concern)', report.perRule)

if (report.t0Candidates.length > 0) {
  console.log('\n## T0-кандидати (завжди ескалюють / cloud-only)')
  for (const u of report.t0Candidates.slice(0, 20)) {
    console.log(
      `- [${u.kind}] ${u.unit} — chains ${u.chains}, cloudCalls ${u.cloudCalls}, cloudTokens ${u.cloudTokens}${u.alwaysEscalated ? '' : ' (cloud-only)'}`
    )
  }
}

if (report.unclosed.length > 0) {
  console.log(`\n⚠ незакритих ланцюжків: ${report.unclosed.length} (креші/kill — не входять в rate)`)
}
